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

// MARK: - SharedFilesService

/// HTTP client that talks to the sidecar shared file endpoints.
/// Uses URLSession for HTTP requests and parses JSON responses.
class SharedFilesService {
    /// The resolved sidecar host IP address (set after connection is established).
    var sidecarHost: String?

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
    func downloadFile(path: String) async throws -> DownloadResult {
        let endpoint = "/shared/download/\(path)"
        let url = try buildURL(path: endpoint)

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 300

        let (tempURL, response) = try await urlSession.download(for: request)
        try validateHTTPResponse(response, path: endpoint)

        // Move to a stable temp location first
        let filename = (path as NSString).lastPathComponent
        let destDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_shared_downloads", isDirectory: true)
        try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
        let destURL = destDir.appendingPathComponent(filename)
        try? FileManager.default.removeItem(at: destURL)
        try FileManager.default.moveItem(at: tempURL, to: destURL)

        // For images/videos: save to Camera Roll
        let fileType = classifyLocalFileType(filename: filename)
        if fileType == "image" || fileType == "video" {
            try await saveToPhotoLibrary(fileURL: destURL, isVideo: fileType == "video")
            try? FileManager.default.removeItem(at: destURL)
            NSLog("[SharedFilesService] saved %@ to Camera Roll", path)
            return DownloadResult(localPath: nil, savedToPhotos: true)
        }

        NSLog("[SharedFilesService] downloaded %@ to %@", path, destURL.path)
        return DownloadResult(localPath: destURL.path, savedToPhotos: false)
    }

    struct DownloadResult {
        let localPath: String?
        let savedToPhotos: Bool
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
        guard let host = sidecarHost, !host.isEmpty else {
            throw SyncEngineError.networkError("Sidecar host not available for shared files")
        }

        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        components.port = Self.sidecarHttpPort
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
