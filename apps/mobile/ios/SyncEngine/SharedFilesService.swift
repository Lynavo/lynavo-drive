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

enum SharedDirectoryScope: String {
    case team
    case personal

    var endpointPrefix: String {
        switch self {
        case .team:
            return "/shared"
        case .personal:
            return "/personal"
        }
    }
}

typealias SharedFileDownloadProgressHandler = (_ bytesWritten: Int64, _ totalBytes: Int64, _ progress: Double) -> Void

private enum SharedFilePartialDownloadError: Error {
    case invalidPartial(String)
}

struct SharedFileLocalSaveError: Error, LocalizedError {
    let underlyingError: Error

    var errorDescription: String? {
        "Failed to save shared file locally: \(underlyingError)"
    }
}

struct SharedFileHTTPStatusError: Error, LocalizedError {
    let statusCode: Int
    let path: String

    var errorDescription: String? {
        "Sidecar returned HTTP \(statusCode) for \(path)"
    }
}

private struct SharedFilePartialDownloadMetadata: Codable {
    let validator: String
    let expectedBytes: Int64?
}

private final class SharedFileDownloadDelegate: NSObject, URLSessionDataDelegate {
    private let destinationURL: URL
    private let metadataURL: URL
    private let initialOffset: Int64
    private let onProgress: SharedFileDownloadProgressHandler?
    private var continuation: CheckedContinuation<(URL, URLResponse), Error>?
    private var response: URLResponse?
    private var streamError: Error?
    private var fileHandle: FileHandle?
    private var receivedBytes: Int64 = 0
    private var expectedTotalBytes: Int64 = 0
    private var didResume = false

    init(
        destinationURL: URL,
        metadataURL: URL,
        initialOffset: Int64,
        onProgress: SharedFileDownloadProgressHandler?
    ) {
        self.destinationURL = destinationURL
        self.metadataURL = metadataURL
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
            streamError = SharedFileHTTPStatusError(
                statusCode: httpResponse.statusCode,
                path: "shared file download"
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
        Self.writeMetadata(
            validator: Self.partialValidator(from: httpResponse),
            expectedBytes: expectedTotalBytes > 0 ? expectedTotalBytes : nil,
            to: metadataURL
        )
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

    private static func partialValidator(from response: HTTPURLResponse) -> String? {
        if let etag = response.value(forHTTPHeaderField: "ETag"),
           !etag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return etag
        }
        if let lastModified = response.value(forHTTPHeaderField: "Last-Modified"),
           !lastModified.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return lastModified
        }
        return nil
    }

    private static func writeMetadata(validator: String?, expectedBytes: Int64?, to url: URL) {
        guard let validator else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        let metadata = SharedFilePartialDownloadMetadata(
            validator: validator,
            expectedBytes: expectedBytes
        )
        guard let data = try? JSONEncoder().encode(metadata) else {
            return
        }
        try? data.write(to: url, options: .atomic)
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
    func listSharedFiles(
        scope: SharedDirectoryScope = .team,
        path: String = "",
        accessToken: String = "",
        pairingToken: String = "",
        clientID: String = "",
        clientName: String = ""
    ) async throws -> SharedDirectory {
        let encodedPath = SharedFilesRoutePolicy.encodedSharedFilePath(path)
        let endpoint = encodedPath.isEmpty
            ? "\(scope.endpointPrefix)/list"
            : "\(scope.endpointPrefix)/list/\(encodedPath)"
        let url = try buildURL(
            path: endpoint,
            queryItems: personalAccessQueryItems(scope: scope, clientID: clientID, clientName: clientName)
        )

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = SharedFilesRoutePolicy.sharedFileListRequestTimeout
        applyAuthorizationIfNeeded(to: &request, scope: scope, accessToken: accessToken)
        applyPersonalAccessSignatureIfNeeded(
            to: &request,
            scope: scope,
            pairingToken: pairingToken,
            clientID: clientID
        )

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
        scope: SharedDirectoryScope = .team,
        path: String,
        accessToken: String = "",
        pairingToken: String = "",
        clientID: String = "",
        clientName: String = "",
        onProgress: SharedFileDownloadProgressHandler? = nil
    ) async throws -> DownloadResult {
        let endpoint = "\(scope.endpointPrefix)/download/\(SharedFilesRoutePolicy.encodedSharedFilePath(path))"
        return try await downloadEndpointToLocalFile(
            endpoint: endpoint,
            queryItems: personalAccessQueryItems(scope: scope, clientID: clientID, clientName: clientName),
            partialKey: path,
            filename: (path as NSString).lastPathComponent,
            mediaType: nil,
            scope: scope,
            accessToken: accessToken,
            pairingToken: pairingToken,
            clientID: clientID,
            onProgress: onProgress
        )
    }

    func downloadReceivedFile(
        fileKey: String,
        clientId: String,
        clientName: String,
        filename: String,
        mediaType: String?,
        onProgress: SharedFileDownloadProgressHandler? = nil
    ) async throws -> DownloadResult {
        try await downloadEndpointToLocalFile(
            endpoint: "/resources/mobile/received/download",
            queryItems: [
                URLQueryItem(name: "clientId", value: clientId),
                URLQueryItem(name: "clientName", value: clientName),
                URLQueryItem(name: "fileKey", value: fileKey),
            ],
            partialKey: "received:\(fileKey)",
            filename: filename,
            mediaType: mediaType,
            scope: .team,
            accessToken: "",
            pairingToken: "",
            clientID: "",
            onProgress: onProgress
        )
    }

    func listReceivedFiles(
        clientId: String,
        clientName: String
    ) async throws -> [[String: Any]] {
        let url = try buildURL(
            path: "/resources/mobile/received",
            queryItems: [
                URLQueryItem(name: "clientId", value: clientId),
                URLQueryItem(name: "clientName", value: clientName),
                URLQueryItem(name: "scope", value: "client"),
            ]
        )

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = SharedFilesRoutePolicy.sharedFileListRequestTimeout

        let (data, response) = try await urlSession.data(for: request)
        try validateHTTPResponse(response, path: "/resources/mobile/received")

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        return json["items"] as? [[String: Any]] ?? []
    }

    func getReceivedFileMediaUrl(
        fileKey: String,
        clientId: String,
        clientName: String,
        kind: String
    ) throws -> URL {
        let normalizedKind: String
        switch kind.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "preview":
            normalizedKind = "preview"
        case "thumbnail":
            normalizedKind = "thumbnail"
        case "stream":
            normalizedKind = "stream"
        default:
            normalizedKind = "download"
        }
        return try buildURL(
            path: "/resources/mobile/received/\(normalizedKind)",
            queryItems: [
                URLQueryItem(name: "clientId", value: clientId),
                URLQueryItem(name: "clientName", value: clientName),
                URLQueryItem(name: "fileKey", value: fileKey),
            ]
        )
    }

    private func downloadEndpointToLocalFile(
        endpoint: String,
        queryItems: [URLQueryItem] = [],
        partialKey: String,
        filename: String,
        mediaType: String?,
        scope: SharedDirectoryScope,
        accessToken: String,
        pairingToken: String,
        clientID: String,
        onProgress: SharedFileDownloadProgressHandler?
    ) async throws -> DownloadResult {
        let partialURL = try partialDownloadURL(path: partialKey)
        let metadataURL = partialMetadataURL(for: partialURL)
        var partialMetadata = readPartialDownloadMetadata(at: metadataURL)
        var resumeOffset = SharedFilesRoutePolicy.resumeOffsetForPartialDownload(
            existingBytes: fileSize(at: partialURL)
        )
        syncDiagnosticsLog(
            "SharedFiles",
            "downloadEndpointToLocalFile preparing endpoint=\(endpoint) partial_key=\(partialKey) filename=\(filename) media_type=\(mediaType ?? "nil") resume_offset=\(resumeOffset) has_metadata=\(partialMetadata != nil)"
        )
        if !SharedFilesRoutePolicy.canResumePartialDownload(
            existingBytes: resumeOffset,
            validator: partialMetadata?.validator,
            expectedBytes: partialMetadata?.expectedBytes
        ) {
            removePartialDownload(partialURL: partialURL, metadataURL: metadataURL)
            partialMetadata = nil
            resumeOffset = 0
        }

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
                scope: scope,
                accessToken: accessToken,
                partialURL: partialURL,
                metadataURL: metadataURL,
                metadata: partialMetadata,
                resumeOffset: resumeOffset,
                queryItems: queryItems,
                pairingToken: pairingToken,
                clientID: clientID,
                onProgress: onProgress
            )
        } catch SharedFilePartialDownloadError.invalidPartial(_) {
            removePartialDownload(partialURL: partialURL, metadataURL: metadataURL)
            partialMetadata = nil
            resumeOffset = 0
            (downloadedURL, response) = try await performDownload(
                endpoint: endpoint,
                scope: scope,
                accessToken: accessToken,
                partialURL: partialURL,
                metadataURL: metadataURL,
                metadata: partialMetadata,
                resumeOffset: resumeOffset,
                queryItems: queryItems,
                pairingToken: pairingToken,
                clientID: clientID,
                onProgress: onProgress
            )
        }

        downloadedURLForCleanup = downloadedURL
        try validateHTTPResponse(response, path: endpoint)
        let totalBytes = fileSize(at: downloadedURL)
        try validateCompletedDownload(downloadedURL: downloadedURL, response: response)
        onProgress?(totalBytes, totalBytes, 1)

        do {
            let result = try await persistDownloadedFile(
                downloadedURL: downloadedURL,
                filename: filename,
                mediaType: mediaType
            )
            syncDiagnosticsLog(
                "SharedFiles",
                "downloadEndpointToLocalFile persisted endpoint=\(endpoint) filename=\(filename) saved_to_photos=\(result.savedToPhotos) local_path=\(result.localPath ?? "nil") saved_location=\(result.savedLocation ?? "nil")"
            )
            downloadedURLForCleanup = nil
            try? FileManager.default.removeItem(at: metadataURL)
            return result
        } catch {
            throw SharedFileLocalSaveError(underlyingError: error)
        }
    }

    /// Download a shared file to an app-owned temporary preview cache.
    /// This is used by QLPreviewController, which needs a local file URL.
    func downloadFileForPreview(
        scope: SharedDirectoryScope = .team,
        path: String,
        accessToken: String = "",
        pairingToken: String = "",
        filename: String = "",
        clientID: String = "",
        clientName: String = ""
    ) async throws -> URL {
        let endpoint = "\(scope.endpointPrefix)/download/\(SharedFilesRoutePolicy.encodedSharedFilePath(path))"
        let queryItems = personalAccessQueryItems(scope: scope, clientID: clientID, clientName: clientName)
        let partialURL = try partialDownloadURL(path: "preview:\(scope.rawValue):\(path)")
        let metadataURL = partialMetadataURL(for: partialURL)
        var partialMetadata = readPartialDownloadMetadata(at: metadataURL)
        var resumeOffset = SharedFilesRoutePolicy.resumeOffsetForPartialDownload(
            existingBytes: fileSize(at: partialURL)
        )
        syncDiagnosticsLog(
            "SharedFiles",
            "downloadFileForPreview preparing scope=\(scope.rawValue) path=\(path) endpoint=\(endpoint) resume_offset=\(resumeOffset) has_metadata=\(partialMetadata != nil)"
        )
        if !SharedFilesRoutePolicy.canResumePartialDownload(
            existingBytes: resumeOffset,
            validator: partialMetadata?.validator,
            expectedBytes: partialMetadata?.expectedBytes
        ) {
            removePartialDownload(partialURL: partialURL, metadataURL: metadataURL)
            partialMetadata = nil
            resumeOffset = 0
        }

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
                scope: scope,
                accessToken: accessToken,
                partialURL: partialURL,
                metadataURL: metadataURL,
                metadata: partialMetadata,
                resumeOffset: resumeOffset,
                queryItems: queryItems,
                pairingToken: pairingToken,
                clientID: clientID,
                onProgress: nil
            )
        } catch SharedFilePartialDownloadError.invalidPartial(_) {
            removePartialDownload(partialURL: partialURL, metadataURL: metadataURL)
            partialMetadata = nil
            resumeOffset = 0
            (downloadedURL, response) = try await performDownload(
                endpoint: endpoint,
                scope: scope,
                accessToken: accessToken,
                partialURL: partialURL,
                metadataURL: metadataURL,
                metadata: partialMetadata,
                resumeOffset: resumeOffset,
                queryItems: queryItems,
                pairingToken: pairingToken,
                clientID: clientID,
                onProgress: nil
            )
        }

        downloadedURLForCleanup = downloadedURL
        try validateHTTPResponse(response, path: endpoint)
        try validateCompletedDownload(downloadedURL: downloadedURL, response: response)

        let previewURL = try previewCacheURL(scope: scope, path: path, filename: filename)
        try? FileManager.default.removeItem(at: previewURL)
        try FileManager.default.moveItem(at: downloadedURL, to: previewURL)
        downloadedURLForCleanup = nil
        try? FileManager.default.removeItem(at: metadataURL)
        syncDiagnosticsLog(
            "SharedFiles",
            "downloadFileForPreview cached scope=\(scope.rawValue) path=\(path) preview_url=\(previewURL.absoluteString) bytes=\(fileSize(at: previewURL))"
        )
        return previewURL
    }

    struct DownloadResult {
        let localPath: String?
        let savedToPhotos: Bool
        let savedLocation: String?
    }

    private func previewCacheURL(
        scope: SharedDirectoryScope,
        path: String,
        filename: String
    ) throws -> URL {
        let previewDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_shared_previews", isDirectory: true)
            .appendingPathComponent(previewCacheToken(scope: scope, path: path), isDirectory: true)
        try FileManager.default.createDirectory(at: previewDir, withIntermediateDirectories: true)
        return previewDir.appendingPathComponent(previewFilename(scope: scope, path: path, filename: filename))
    }

    private func previewCacheToken(scope: SharedDirectoryScope, path: String) -> String {
        return Data("\(scope.rawValue):\(path)".utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "=", with: "")
    }

    private func previewFilename(scope: SharedDirectoryScope, path: String, filename: String) -> String {
        let fallback = (path as NSString).lastPathComponent
        let candidate = filename.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? fallback : filename
        let invalid = CharacterSet(charactersIn: "/\\:")
            .union(.controlCharacters)
            .union(.newlines)
        let sanitized = candidate
            .components(separatedBy: invalid)
            .filter { !$0.isEmpty }
            .joined(separator: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !sanitized.isEmpty {
            return sanitized
        }
        let token = Data("\(scope.rawValue):\(path)".utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "=", with: "")
        return token.isEmpty ? "shared-file" : token
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

    private func normalizedLocalFileType(filename: String, mediaType: String?) -> String {
        let normalized = mediaType?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if normalized == "image" || normalized?.hasPrefix("image/") == true {
            return "image"
        }
        if normalized == "video" || normalized?.hasPrefix("video/") == true {
            return "video"
        }
        return classifyLocalFileType(filename: filename)
    }

    private func persistDownloadedFile(
        downloadedURL: URL,
        filename: String,
        mediaType: String?
    ) async throws -> DownloadResult {
        let safeFilename = filename.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "remote-file"
            : filename.trimmingCharacters(in: .whitespacesAndNewlines)
        let destDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_shared_downloads", isDirectory: true)
        try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
        let destURL = destDir.appendingPathComponent(safeFilename)
        try? FileManager.default.removeItem(at: destURL)
        try FileManager.default.moveItem(at: downloadedURL, to: destURL)

        let fileType = normalizedLocalFileType(filename: safeFilename, mediaType: mediaType)
        syncDiagnosticsLog(
            "SharedFiles",
            "persistDownloadedFile target filename=\(safeFilename) media_type=\(mediaType ?? "nil") normalized_type=\(fileType)"
        )
        if fileType == "image" || fileType == "video" {
            try await saveToPhotoLibrary(fileURL: destURL, isVideo: fileType == "video")
            try? FileManager.default.removeItem(at: destURL)
            slog("[SharedFilesService] saved %@ to Camera Roll", safeFilename)
            syncDiagnosticsLog(
                "SharedFiles",
                "persistDownloadedFile saved_to_photos filename=\(safeFilename) normalized_type=\(fileType) saved_location=Photos"
            )
            return DownloadResult(localPath: nil, savedToPhotos: true, savedLocation: "Photos")
        }

        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let finalURL = documentsURL.appendingPathComponent(safeFilename)
        try? FileManager.default.removeItem(at: finalURL)
        try FileManager.default.moveItem(at: destURL, to: finalURL)
        syncDiagnosticsLog(
            "SharedFiles",
            "persistDownloadedFile saved_to_documents filename=\(safeFilename) local_path=\(finalURL.path)"
        )

        return DownloadResult(localPath: finalURL.path, savedToPhotos: false, savedLocation: nil)
    }

    private func performDownload(
        endpoint: String,
        scope: SharedDirectoryScope,
        accessToken: String,
        partialURL: URL,
        metadataURL: URL,
        metadata: SharedFilePartialDownloadMetadata?,
        resumeOffset: Int64,
        queryItems: [URLQueryItem] = [],
        pairingToken: String,
        clientID: String,
        onProgress: SharedFileDownloadProgressHandler?
    ) async throws -> (URL, URLResponse) {
        let url = try buildURL(path: endpoint, queryItems: queryItems)

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = SharedFilesRoutePolicy.sharedFileDownloadRequestTimeout
        applyAuthorizationIfNeeded(to: &request, scope: scope, accessToken: accessToken)
        applyPersonalAccessSignatureIfNeeded(
            to: &request,
            scope: scope,
            pairingToken: pairingToken,
            clientID: clientID
        )
        if SharedFilesRoutePolicy.shouldUseRangeRequest(resumeOffset: resumeOffset) {
            request.setValue("bytes=\(resumeOffset)-", forHTTPHeaderField: "Range")
            if let validator = metadata?.validator {
                request.setValue(validator, forHTTPHeaderField: "If-Range")
            }
        }
        syncDiagnosticsLog(
            "SharedFiles",
            "downloadFile request endpoint=\(endpoint) resume_offset=\(resumeOffset) range=\(SharedFilesRoutePolicy.shouldUseRangeRequest(resumeOffset: resumeOffset))"
        )

        let delegate = SharedFileDownloadDelegate(
            destinationURL: partialURL,
            metadataURL: metadataURL,
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

        let result = try await delegate.start(session: downloadSession, request: request)
        if let http = result.1 as? HTTPURLResponse {
            syncDiagnosticsLog(
                "SharedFiles",
                "downloadFile response endpoint=\(endpoint) status=\(http.statusCode) content_type=\(http.value(forHTTPHeaderField: "Content-Type") ?? "nil") content_length=\(http.value(forHTTPHeaderField: "Content-Length") ?? "nil")"
            )
        } else {
            syncDiagnosticsLog("SharedFiles", "downloadFile response endpoint=\(endpoint) non_http_response")
        }
        return result
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

    private func partialMetadataURL(for partialURL: URL) -> URL {
        partialURL.deletingPathExtension().appendingPathExtension("part.json")
    }

    private func readPartialDownloadMetadata(at url: URL) -> SharedFilePartialDownloadMetadata? {
        guard let data = try? Data(contentsOf: url) else {
            return nil
        }
        return try? JSONDecoder().decode(SharedFilePartialDownloadMetadata.self, from: data)
    }

    private func removePartialDownload(partialURL: URL, metadataURL: URL) {
        try? FileManager.default.removeItem(at: partialURL)
        try? FileManager.default.removeItem(at: metadataURL)
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
    func getStreamUrl(
        scope: SharedDirectoryScope = .team,
        path: String,
        accessToken: String = "",
        pairingToken: String = "",
        clientID: String = "",
        clientName: String = ""
    ) -> URL? {
        return try? buildMediaURL(
            path: "\(scope.endpointPrefix)/stream/\(SharedFilesRoutePolicy.encodedSharedFilePath(path))",
            scope: scope,
            accessToken: accessToken,
            pairingToken: pairingToken,
            clientID: clientID,
            clientName: clientName
        )
    }

    // MARK: - Thumbnail URL

    /// Construct the thumbnail URL for a shared file.
    func getThumbnailUrl(
        scope: SharedDirectoryScope = .team,
        path: String,
        accessToken: String = "",
        pairingToken: String = "",
        clientID: String = "",
        clientName: String = ""
    ) -> URL? {
        return try? buildMediaURL(
            path: "\(scope.endpointPrefix)/thumbnail/\(SharedFilesRoutePolicy.encodedSharedFilePath(path))",
            scope: scope,
            accessToken: accessToken,
            pairingToken: pairingToken,
            clientID: clientID,
            clientName: clientName
        )
    }

    private func buildURL(path: String, queryItems: [URLQueryItem] = []) throws -> URL {
        var components = URLComponents()
        components.scheme = "http"
        components.percentEncodedPath = path
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }

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

    private func buildMediaURL(
        path: String,
        scope: SharedDirectoryScope,
        accessToken: String,
        pairingToken: String,
        clientID: String,
        clientName: String
    ) throws -> URL {
        let baseURL = try buildURL(path: path)
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return baseURL
        }
        if scope == .personal {
            let token = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)
            if !token.isEmpty {
                components.queryItems = (components.queryItems ?? []) + [
                    URLQueryItem(name: "access_token", value: token),
                ]
            }
            components.queryItems = (components.queryItems ?? [])
                + personalAccessQueryItems(scope: scope, clientID: clientID, clientName: clientName)
            if let signatureItems = personalAccessSignatureQueryItems(
                scope: scope,
                pairingToken: pairingToken,
                method: "GET",
                escapedPath: components.percentEncodedPath,
                clientID: clientID
            ) {
                components.queryItems = (components.queryItems ?? []) + signatureItems
            }
        }
        return components.url ?? baseURL
    }

    private func personalAccessQueryItems(
        scope: SharedDirectoryScope,
        clientID: String,
        clientName: String
    ) -> [URLQueryItem] {
        guard scope == .personal else { return [] }
        let trimmedID = clientID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedID.isEmpty else { return [] }
        let trimmedName = clientName.trimmingCharacters(in: .whitespacesAndNewlines)
        return [
            URLQueryItem(name: "clientId", value: trimmedID),
            URLQueryItem(name: "clientName", value: trimmedName.isEmpty ? trimmedID : trimmedName),
        ]
    }

    private func applyAuthorizationIfNeeded(
        to request: inout URLRequest,
        scope: SharedDirectoryScope,
        accessToken: String
    ) {
        guard scope == .personal else { return }
        let token = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func applyPersonalAccessSignatureIfNeeded(
        to request: inout URLRequest,
        scope: SharedDirectoryScope,
        pairingToken: String,
        clientID: String
    ) {
        guard let url = request.url,
              let signatureItems = personalAccessSignatureQueryItems(
                scope: scope,
                pairingToken: pairingToken,
                method: request.httpMethod ?? "GET",
                escapedPath: percentEncodedPath(for: url),
                clientID: clientID
              ) else {
            return
        }
        for item in signatureItems {
            request.setValue(item.value, forHTTPHeaderField: item.name)
        }
    }

    private func personalAccessSignatureQueryItems(
        scope: SharedDirectoryScope,
        pairingToken: String,
        method: String,
        escapedPath: String,
        clientID: String
    ) -> [URLQueryItem]? {
        guard scope == .personal else { return nil }
        let token = pairingToken.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedID = clientID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty, !trimmedID.isEmpty else { return nil }

        let timestamp = Self.personalAccessTimestamp()
        let nonce = HMACAuthHelper.randomHexNonce()
        let signature = HMACAuthHelper.personalAccessSignature(
            pairingToken: token,
            method: method,
            escapedPath: escapedPath,
            clientId: trimmedID,
            timestamp: timestamp,
            nonce: nonce
        )
        return [
            URLQueryItem(name: "X-SyncFlow-Auth", value: signature),
            URLQueryItem(name: "X-SyncFlow-Auth-Timestamp", value: timestamp),
            URLQueryItem(name: "X-SyncFlow-Auth-Nonce", value: nonce),
        ]
    }

    private func percentEncodedPath(for url: URL) -> String {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path
    }

    private static func personalAccessTimestamp(date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }

    private func validateHTTPResponse(_ response: URLResponse, path: String) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SyncEngineError.networkError("Missing HTTP response for \(path)")
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw SharedFileHTTPStatusError(
                statusCode: httpResponse.statusCode,
                path: path
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
