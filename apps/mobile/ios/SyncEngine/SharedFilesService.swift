import Foundation
import Photos

// MARK: - Data Structures

struct SharedFile {
    let name: String
    let path: String
    let type: String  // "image" | "video" | "document" | "other"
    let size: Int64
    let modifiedAt: String
    let thumbnailUrl: String?
    let isDirectory: Bool
}

struct SharedDirectory {
    let path: String
    let files: [SharedFile]
    let totalCount: Int
}

typealias SharedFileDownloadProgressHandler = (_ bytesWritten: Int64, _ totalBytes: Int64, _ progress: Double) -> Void

private enum SharedFilePartialDownloadError: Error {
    case invalidPartial(String)
}

private final class SharedFileDownloadDelegate: NSObject, URLSessionDataDelegate {
    private let destinationURL: URL
    private let initialOffset: Int64
    private let onProgress: SharedFileDownloadProgressHandler?
    private var continuation: CheckedContinuation<(URL, URLResponse), Error>?
    private var response: URLResponse?
    private var streamError: Error?
    private var fileHandle: FileHandle?
    private var receivedBytes: Int64 = 0
    private var expectedTotalBytes: Int64 = 0
    private var didResume = false

    init(destinationURL: URL, initialOffset: Int64, onProgress: SharedFileDownloadProgressHandler?) {
        self.destinationURL = destinationURL
        self.initialOffset = initialOffset
        self.onProgress = onProgress
    }

    func start(session: URLSession, request: URLRequest) async throws -> (URL, URLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            session.dataTask(with: request).resume()
        }
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let httpResponse = response as? HTTPURLResponse else {
            streamError = SyncEngineError.networkError("Missing HTTP response for shared file download")
            completionHandler(.cancel)
            return
        }

        if initialOffset > 0, httpResponse.statusCode == 200 || httpResponse.statusCode == 416 {
            streamError = SharedFilePartialDownloadError.invalidPartial(
                "Server did not accept shared file Range request status=\(httpResponse.statusCode)"
            )
            completionHandler(.cancel)
            return
        }
        if initialOffset > 0 {
            guard httpResponse.statusCode == 206,
                  Self.contentRangeStart(from: httpResponse) == initialOffset else {
                streamError = SharedFilePartialDownloadError.invalidPartial(
                    "Shared file Range response did not match offset=\(initialOffset)"
                )
                completionHandler(.cancel)
                return
            }
        } else if httpResponse.statusCode == 206 {
            streamError = SharedFilePartialDownloadError.invalidPartial(
                "Shared file Range response received without a partial download"
            )
            completionHandler(.cancel)
            return
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            streamError = SyncEngineError.networkError(
                "Sidecar returned HTTP \(httpResponse.statusCode) for shared file download"
            )
            completionHandler(.cancel)
            return
        }

        do {
            if !FileManager.default.fileExists(atPath: destinationURL.path) {
                FileManager.default.createFile(atPath: destinationURL.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: destinationURL)
            if initialOffset > 0 {
                handle.seekToEndOfFile()
            } else {
                handle.truncateFile(atOffset: 0)
            }
            fileHandle = handle
        } catch {
            streamError = error
            completionHandler(.cancel)
            return
        }

        self.response = response
        expectedTotalBytes = Self.expectedTotalBytes(from: httpResponse, initialOffset: initialOffset)
        completionHandler(.allow)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        guard streamError == nil else { return }
        guard let fileHandle else {
            streamError = SyncEngineError.networkError("Shared file download stream is not open")
            dataTask.cancel()
            return
        }

        fileHandle.write(data)
        receivedBytes += Int64(data.count)
        let bytesWritten = SharedFilesRoutePolicy.totalDownloadedBytes(
            existingBytes: initialOffset,
            receivedBytes: receivedBytes
        )
        let totalBytes = expectedTotalBytes > 0 ? expectedTotalBytes : 0
        let progress = totalBytes > 0 ? min(1, max(0, Double(bytesWritten) / Double(totalBytes))) : 0
        onProgress?(bytesWritten, totalBytes, progress)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard !didResume else { return }
        didResume = true

        fileHandle?.closeFile()
        fileHandle = nil

        if let streamError {
            continuation?.resume(throwing: streamError)
        } else if let error {
            continuation?.resume(throwing: error)
        } else if let response {
            continuation?.resume(returning: (destinationURL, response))
        } else {
            continuation?.resume(
                throwing: SyncEngineError.networkError("Missing shared file download response")
            )
        }
        continuation = nil
    }

    fileprivate static func expectedTotalBytes(from response: HTTPURLResponse, initialOffset: Int64) -> Int64 {
        if let contentRange = response.value(forHTTPHeaderField: "Content-Range"),
           let slashIndex = contentRange.lastIndex(of: "/") {
            let totalPart = contentRange[contentRange.index(after: slashIndex)...]
            if let total = Int64(totalPart) {
                return total
            }
        }
        if response.expectedContentLength > 0 {
            return initialOffset + response.expectedContentLength
        }
        return 0
    }

    private static func contentRangeStart(from response: HTTPURLResponse) -> Int64? {
        guard let contentRange = response.value(forHTTPHeaderField: "Content-Range") else {
            return nil
        }
        let parts = contentRange.split(separator: " ")
        guard parts.count == 2,
              let rangeStart = parts[1].split(separator: "-").first else {
            return nil
        }
        return Int64(rangeStart)
    }
}

// MARK: - SharedFilesService

/// HTTP client that talks to the sidecar shared file endpoints.
/// Uses URLSession for HTTP requests and parses JSON responses.
class SharedFilesService {
    /// The resolved sidecar host IP address (set after connection is established).
    var sidecarHost: String?
    var tunnelPort: UInt16?
    var isTunnelActive: Bool = false
    var useTunnelRoute: Bool = false

    private static let sidecarHttpPort = 39394

    private lazy var urlSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = SharedFilesRoutePolicy.sharedFileListRequestTimeout
        config.timeoutIntervalForResource = SharedFilesRoutePolicy.sharedFileDownloadResourceTimeout
        return URLSession(configuration: config)
    }()

    // MARK: - List Shared Files

    /// List files in the shared directory at the given path.
    func listSharedFiles(path: String = "") async throws -> SharedDirectory {
        let endpoint = path.isEmpty ? "/shared/list" : "/shared/list/\(path)"
        let url = try buildURL(path: endpoint)

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = SharedFilesRoutePolicy.sharedFileListRequestTimeout

        let (data, response) = try await urlSession.data(for: request)
        try validateHTTPResponse(response, path: endpoint)

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        return parseSharedDirectory(json)
    }

    // MARK: - Download File

    /// Download a shared file. Images and videos are saved to the Camera Roll;
    /// other file types are saved to a stable temp directory.
    /// Returns a result indicating where the file was saved.
    func downloadFile(
        path: String,
        onProgress: SharedFileDownloadProgressHandler? = nil
    ) async throws -> DownloadResult {
        let endpoint = "/shared/download/\(path)"
        let partialURL = try partialDownloadURL(path: path)
        var resumeOffset = SharedFilesRoutePolicy.resumeOffsetForPartialDownload(
            existingBytes: fileSize(at: partialURL)
        )

        var downloadedURLForCleanup: URL?
        defer {
            if let downloadedURLForCleanup {
                try? FileManager.default.removeItem(at: downloadedURLForCleanup)
            }
        }

        let downloadedURL: URL
        let response: URLResponse
        do {
            (downloadedURL, response) = try await performDownload(
                endpoint: endpoint,
                partialURL: partialURL,
                resumeOffset: resumeOffset,
                onProgress: onProgress
            )
        } catch SharedFilePartialDownloadError.invalidPartial(_) {
            try? FileManager.default.removeItem(at: partialURL)
            resumeOffset = 0
            (downloadedURL, response) = try await performDownload(
                endpoint: endpoint,
                partialURL: partialURL,
                resumeOffset: resumeOffset,
                onProgress: onProgress
            )
        }

        downloadedURLForCleanup = downloadedURL
        try validateHTTPResponse(response, path: endpoint)
        let totalBytes = fileSize(at: downloadedURL)
        try validateCompletedDownload(downloadedURL: downloadedURL, response: response)
        onProgress?(totalBytes, totalBytes, 1)

        // Move to a stable temp location first
        let filename = (path as NSString).lastPathComponent
        let destDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_shared_downloads", isDirectory: true)
        try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
        let destURL = destDir.appendingPathComponent(filename)
        try? FileManager.default.removeItem(at: destURL)
        try FileManager.default.moveItem(at: downloadedURL, to: destURL)
        downloadedURLForCleanup = nil

        // For images/videos: save to Camera Roll
        let fileType = classifyLocalFileType(filename: filename)
        if fileType == "image" || fileType == "video" {
            try await saveToPhotoLibrary(fileURL: destURL, isVideo: fileType == "video")
            try? FileManager.default.removeItem(at: destURL)
            slog("[SharedFilesService] saved %@ to Camera Roll", path)
            return DownloadResult(localPath: nil, savedToPhotos: true, savedLocation: "Photos")
        }

        // For other files: move to NSDocumentDirectory so it is accessible via iOS Files App
        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let finalURL = documentsURL.appendingPathComponent(filename)
        try? FileManager.default.removeItem(at: finalURL)
        try FileManager.default.moveItem(at: destURL, to: finalURL)

        return DownloadResult(localPath: finalURL.path, savedToPhotos: false, savedLocation: nil)
    }

    struct DownloadResult {
        let localPath: String?
        let savedToPhotos: Bool
        let savedLocation: String?
    }

    private func classifyLocalFileType(filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "jpg", "jpeg", "png", "gif", "bmp", "webp", "heic", "heif", "tiff", "tif":
            return "image"
        case "mp4", "mov", "avi", "mkv", "m4v":
            return "video"
        default:
            return "other"
        }
    }

    private func performDownload(
        endpoint: String,
        partialURL: URL,
        resumeOffset: Int64,
        onProgress: SharedFileDownloadProgressHandler?
    ) async throws -> (URL, URLResponse) {
        let url = try buildURL(path: endpoint)

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = SharedFilesRoutePolicy.sharedFileDownloadRequestTimeout
        if SharedFilesRoutePolicy.shouldUseRangeRequest(resumeOffset: resumeOffset) {
            request.setValue("bytes=\(resumeOffset)-", forHTTPHeaderField: "Range")
        }
        syncDiagnosticsLog(
            "SharedFiles",
            "downloadFile request endpoint=\(endpoint) resume_offset=\(resumeOffset) range=\(SharedFilesRoutePolicy.shouldUseRangeRequest(resumeOffset: resumeOffset))"
        )

        let delegate = SharedFileDownloadDelegate(
            destinationURL: partialURL,
            initialOffset: resumeOffset,
            onProgress: onProgress
        )
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = SharedFilesRoutePolicy.sharedFileDownloadRequestTimeout
        config.timeoutIntervalForResource = SharedFilesRoutePolicy.sharedFileDownloadResourceTimeout
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        let downloadSession = URLSession(configuration: config, delegate: delegate, delegateQueue: queue)
        defer { downloadSession.finishTasksAndInvalidate() }

        return try await delegate.start(session: downloadSession, request: request)
    }

    private func partialDownloadURL(path: String) throws -> URL {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_shared_downloads_tmp", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let token = Data(path.utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "=", with: "")
        return tempDir.appendingPathComponent("\(token).part")
    }

    private func fileSize(at url: URL) -> Int64 {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        if let size = attributes?[.size] as? NSNumber {
            return size.int64Value
        }
        return 0
    }

    private func validateCompletedDownload(downloadedURL: URL, response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else { return }
        let expectedBytes = SharedFileDownloadDelegate.expectedTotalBytes(
            from: httpResponse,
            initialOffset: 0
        )
        guard expectedBytes > 0 else { return }
        let actualBytes = fileSize(at: downloadedURL)
        guard actualBytes == expectedBytes else {
            throw SyncEngineError.networkError(
                "Incomplete shared file download expected=\(expectedBytes) actual=\(actualBytes)"
            )
        }
    }

    private func saveToPhotoLibrary(fileURL: URL, isVideo: Bool) async throws {
        try await PHPhotoLibrary.shared().performChanges {
            if isVideo {
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileURL)
            } else {
                PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: fileURL)
            }
        }
    }

    // MARK: - Streaming URL

    /// Construct the streaming URL for AVPlayer (video playback).
    func getStreamUrl(path: String) -> URL? {
        return try? buildURL(path: "/shared/stream/\(path)")
    }

    // MARK: - Thumbnail URL

    /// Construct the thumbnail URL for a shared file.
    func getThumbnailUrl(path: String) -> URL? {
        return try? buildURL(path: "/shared/thumbnail/\(path)")
    }

    private func buildURL(path: String) throws -> URL {
        var components = URLComponents()
        components.scheme = "http"
        components.path = path

        if useTunnelRoute, isTunnelActive, let port = tunnelPort {
            components.host = "127.0.0.1"
            components.port = Int(port)
        } else {
            guard let host = sidecarHost?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !host.isEmpty else {
                throw SyncEngineError.networkError("No sidecar host available for shared files")
            }
            components.host = host
            components.port = Self.sidecarHttpPort
        }

        guard let url = components.url else {
            throw SyncEngineError.networkError("Invalid shared files URL for path: \(path)")
        }
        return url
    }

    private func validateHTTPResponse(_ response: URLResponse, path: String) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SyncEngineError.networkError("Missing HTTP response for \(path)")
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw SyncEngineError.networkError(
                "Sidecar returned HTTP \(httpResponse.statusCode) for \(path)"
            )
        }
    }

    private func parseSharedDirectory(_ json: [String: Any]) -> SharedDirectory {
        let path = json["path"] as? String ?? ""
        let totalCount = json["totalCount"] as? Int
            ?? Int(json["totalCount"] as? Int64 ?? 0)
        let filesArray = json["files"] as? [[String: Any]] ?? []

        let files = filesArray.map { fileJson -> SharedFile in
            SharedFile(
                name: fileJson["name"] as? String ?? "",
                path: fileJson["path"] as? String ?? "",
                type: fileJson["type"] as? String ?? "other",
                size: fileJson["size"] as? Int64
                    ?? Int64(fileJson["size"] as? Int ?? 0),
                modifiedAt: fileJson["modifiedAt"] as? String ?? "",
                thumbnailUrl: fileJson["thumbnailUrl"] as? String,
                isDirectory: fileJson["isDirectory"] as? Bool ?? false
            )
        }

        return SharedDirectory(
            path: path,
            files: files,
            totalCount: totalCount
        )
    }
}
