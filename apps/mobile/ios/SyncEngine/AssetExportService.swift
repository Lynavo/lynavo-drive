import Foundation
import Photos

class AssetExportService {

    /// Export a PHAsset to a temporary file
    func exportAsset(
        _ asset: PHAsset,
        onDownloadProgress: ((Double) -> Void)? = nil
    ) async throws -> ExportedFile {
        let perfLoggingEnabled = syncFlowBoolSetting(
            envKey: "SYNCFLOW_UPLOAD_PERF_LOG",
            userDefaultsKey: "SyncFlowUploadPerfLog"
        )
        let exportStart = CFAbsoluteTimeGetCurrent()
        let resources = PHAssetResource.assetResources(for: asset)
        guard let resource = resources.first(where: { $0.type == .fullSizePhoto || $0.type == .video }) ?? resources.first else {
            throw SyncEngineError.permissionError("No resource found for asset")
        }

        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("syncflow_export")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

        let filename = resource.originalFilename
        let tempURL = tempDir.appendingPathComponent(UUID().uuidString + "_" + filename)

        // Export with iCloud download support
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true  // Allow iCloud download
        options.progressHandler = { progress in
            onDownloadProgress?(progress)
        }

        return try await withCheckedThrowingContinuation { continuation in
            PHAssetResourceManager.default().writeData(for: resource, toFile: tempURL, options: options) { error in
                if let error {
                    if perfLoggingEnabled {
                        let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - exportStart) * 1000)
                        slog("[SyncPerf] export asset=%@ file=%@ status=FAILED elapsedMs=%d error=%@", asset.localIdentifier, filename, elapsedMs, error.localizedDescription)
                    }
                    continuation.resume(throwing: error)
                } else {
                    do {
                        let attrs = try FileManager.default.attributesOfItem(atPath: tempURL.path)
                        let size = attrs[.size] as? Int64 ?? 0
                        let mimeType = Self.mimeType(for: filename)
                        if perfLoggingEnabled {
                            let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - exportStart) * 1000)
                            slog("[SyncPerf] export asset=%@ file=%@ size=%lld mediaType=%@ elapsedMs=%d", asset.localIdentifier, filename, size, asset.mediaType == .video ? "video" : "image", elapsedMs)
                        }

                        continuation.resume(returning: ExportedFile(
                            tempURL: tempURL,
                            originalFilename: filename,
                            fileSize: size,
                            mimeType: mimeType,
                            mediaType: asset.mediaType == .video ? "video" : "image",
                            createdAt: asset.creationDate?.iso8601String ?? "",
                            modifiedAt: asset.modificationDate?.iso8601String ?? ""
                        ))
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
        }
    }

    /// Clean up exported temp file
    func cleanup(tempURL: URL) {
        try? FileManager.default.removeItem(at: tempURL)
    }

    private static func mimeType(for filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "heic": return "image/heic"
        case "mp4": return "video/mp4"
        case "mov": return "video/quicktime"
        case "braw": return "video/x-blackmagic-raw"
        default: return "application/octet-stream"
        }
    }
}

struct ExportedFile {
    let tempURL: URL
    let originalFilename: String
    let fileSize: Int64
    let mimeType: String
    let mediaType: String
    let createdAt: String
    let modifiedAt: String
}
