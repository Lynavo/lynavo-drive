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

private final class SharedFileDownloadDelegate: NSObject, URLSessionDownloadDelegate {
    private let destinationURL: URL
    private let onProgress: SharedFileDownloadProgressHandler?
    private var continuation: CheckedContinuation<(URL, URLResponse), Error>?
    private var downloadError: Error?
    private var response: URLResponse?
    private var didResume = false

    init(destinationURL: URL, onProgress: SharedFileDownloadProgressHandler?) {
        self.destinationURL = destinationURL
        self.onProgress = onProgress
    }

    func start(session: URLSession, request: URLRequest) async throws -> (URL, URLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            session.downloadTask(with: request).resume()
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        let totalBytes = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : 0
        let progress = totalBytesExpectedToWrite > 0
            ? min(1, max(0, Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)))
            : 0
        onProgress?(totalBytesWritten, totalBytes, progress)
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        response = downloadTask.response
        do {
            try? FileManager.default.removeItem(at: destinationURL)
            try FileManager.default.moveItem(at: location, to: destinationURL)
        } catch {
            downloadError = error
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard !didResume else { return }
        didResume = true

        if let error {
            continuation?.resume(throwing: error)
        } else if let downloadError {
            continuation?.resume(throwing: downloadError)
        } else if let response {
            continuation?.resume(returning: (destinationURL, response))
        } else {
            continuation?.resume(
                throwing: SyncEngineError.networkError("Missing shared file download response")
            )
        }
        continuation = nil
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

    private static let sidecarHttpPort = 39394

    private lazy var urlSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 300
        return URLSession(configuration: config)
    }()

    // MARK: - List Shared Files

    /// List files in the shared directory at the given path.
    func listSharedFiles(path: String = "") async throws -> SharedDirectory {
        let endpoint = path.isEmpty ? "/shared/list" : "/shared/list/\(path)"
        let url = try buildURL(path: endpoint)

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 15

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
        let url = try buildURL(path: endpoint)

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 300

        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_shared_downloads_tmp", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let tempURL = tempDir.appendingPathComponent(UUID().uuidString)
        let delegate = SharedFileDownloadDelegate(destinationURL: tempURL, onProgress: onProgress)
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 300
        let downloadSession = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        defer { downloadSession.finishTasksAndInvalidate() }

        var downloadedURLForCleanup: URL?
        defer {
            if let downloadedURLForCleanup {
                try? FileManager.default.removeItem(at: downloadedURLForCleanup)
            }
        }

        let (downloadedURL, response) = try await delegate.start(session: downloadSession, request: request)
        downloadedURLForCleanup = downloadedURL
        try validateHTTPResponse(response, path: endpoint)
        let totalBytes = response.expectedContentLength > 0 ? response.expectedContentLength : 0
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

        slog("[SharedFilesService] downloaded %@ to %@", path, destURL.path)
        return DownloadResult(localPath: destURL.path, savedToPhotos: false, savedLocation: destURL.path)
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

    // MARK: - Private Helpers

    private func buildURL(path: String) throws -> URL {
        var components = URLComponents()
        components.scheme = "http"

        if isTunnelActive, let port = tunnelPort {
            components.host = "127.0.0.1"
            components.port = Int(port)
        } else if let host = sidecarHost?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !host.isEmpty {
            components.host = host
            components.port = Self.sidecarHttpPort
        } else {
            throw SyncEngineError.networkError("No sidecar host available for shared files")
        }
        components.path = path

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
