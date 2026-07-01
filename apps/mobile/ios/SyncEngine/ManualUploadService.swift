import Foundation
import Photos
import CryptoKit

// MARK: - Result

struct ManualUploadResult {
    let queuedCount: Int
    let skippedCount: Int
    let batchId: String
}

struct DocumentUploadResult {
    let queuedCount: Int
    let skippedCount: Int
    let batchId: String
    let files: [[String: Any]]
}

// MARK: - ManualUploadService

/// Accepts user-selected PHAssets, generates upload items with source='manual',
/// deduplicates against the existing queue, and inserts with higher priority.
class ManualUploadService {
    private weak var uploadStore: UploadStore?
    private let bindingService: BindingService

    init(uploadStore: UploadStore?, bindingService: BindingService) {
        self.uploadStore = uploadStore
        self.bindingService = bindingService
    }

    // MARK: - Submit Manual Upload

    /// Submit manually selected assets for upload.
    /// - Returns: ManualUploadResult with queued count, skipped count, and manual queue ID.
    func submitManualUpload(assets: [PHAsset]) -> ManualUploadResult {
        guard let store = uploadStore else {
            slog("[ManualUploadService] uploadStore unavailable — cannot submit")
            return ManualUploadResult(queuedCount: 0, skippedCount: 0, batchId: "")
        }

        let batchId = store.getActiveManualQueueBatchId() ?? UUID().uuidString.lowercased()
        let clientId = bindingService.getOrCreateClientId()
        let now = ISO8601DateFormatter().string(from: Date())

        var queuedCount = 0
        var skippedCount = 0
        var itemsToInsert: [UploadItemRecord] = []

        for asset in assets {
            let assetLocalId = asset.localIdentifier

            // Deduplicate: check if this asset is already in the queue
            // (uploading, waiting/queued, or completed)
            if let existing = store.getItemByAssetId(assetLocalId) {
                let activeStatuses = [
                    "queued", "discovered", "preparing", "ready",
                    "cloud_downloading", "uploading", "completed"
                ]
                if activeStatuses.contains(existing.status) {
                    skippedCount += 1
                    continue
                }
            }

            // Get file metadata from PHAssetResource
            let resources = PHAssetResource.assetResources(for: asset)
            let primaryResource = resources.first(where: {
                $0.type == .fullSizePhoto || $0.type == .video
            }) ?? resources.first

            let filename = primaryResource?.originalFilename ?? "unknown"
            let estimatedSize = primaryResource?.value(forKey: "fileSize") as? Int64 ?? 0
            let mediaType = asset.mediaType == .video ? "video" : "image"

            // Compute fileKey using the same algorithm as PhotoScanner
            let fileKey = PhotoScanner.computeFileKey(
                clientId: clientId,
                assetLocalId: assetLocalId,
                resourceSize: 0,
                modifiedAt: asset.modificationDate?.iso8601String ?? "",
                mediaType: mediaType
            )

            let item = UploadItemRecord(
                id: nil,
                assetLocalId: assetLocalId,
                modifiedAt: asset.modificationDate?.iso8601String ?? "",
                mediaType: mediaType,
                originalFilename: filename,
                fileKey: fileKey,
                fileSize: estimatedSize,
                status: "queued",
                ackedOffset: 0,
                lastErrorCode: nil,
                updatedAt: now,
                source: "manual",
                batchId: batchId,
                priority: 1  // Manual items have higher priority than auto (0)
            )

            itemsToInsert.append(item)
            queuedCount += 1
        }

        // Batch insert all items
        if !itemsToInsert.isEmpty {
            do {
                try store.upsertUploadItems(itemsToInsert)
                slog("[ManualUploadService] queued %d items (skipped %d) in manual queue %@",
                      queuedCount, skippedCount, batchId)
                syncDiagnosticsLog("ManualUploadService",
                    "queued \(queuedCount) items (skipped \(skippedCount)) in manual queue \(batchId)")
            } catch {
                slog("[ManualUploadService] failed to insert items: %@", "\(error)")
                syncDiagnosticsLog("ManualUploadService", "failed to insert items: \(error)")
                return ManualUploadResult(queuedCount: 0, skippedCount: skippedCount, batchId: batchId)
            }
        }

        return ManualUploadResult(
            queuedCount: queuedCount,
            skippedCount: skippedCount,
            batchId: batchId
        )
    }

    // MARK: - Submit Document Upload

    func submitDocumentUploads(fileURLs: [URL]) -> DocumentUploadResult {
        guard let store = uploadStore else {
            slog("[ManualUploadService] uploadStore unavailable — cannot submit documents")
            return DocumentUploadResult(queuedCount: 0, skippedCount: fileURLs.count, batchId: "", files: [])
        }

        let batchId = store.getActiveManualQueueBatchId() ?? UUID().uuidString.lowercased()
        let clientId = bindingService.getOrCreateClientId()
        let now = ISO8601DateFormatter().string(from: Date())
        let fileManager = FileManager.default
        let stagingRoot = Self.documentStagingDirectory()

        var queuedCount = 0
        var skippedCount = 0
        var queuedFiles: [[String: Any]] = []
        var itemsToInsert: [UploadItemRecord] = []
        var stagedURLsToCleanup: [URL] = []

        do {
            try fileManager.createDirectory(at: stagingRoot, withIntermediateDirectories: true)
        } catch {
            slog("[ManualUploadService] failed to create document staging directory: %@", "\(error)")
            return DocumentUploadResult(queuedCount: 0, skippedCount: fileURLs.count, batchId: batchId, files: [])
        }

        for sourceURL in fileURLs {
            let didAccess = sourceURL.startAccessingSecurityScopedResource()
            defer {
                if didAccess {
                    sourceURL.stopAccessingSecurityScopedResource()
                }
            }

            let filename = Self.sanitizedFilename(sourceURL.lastPathComponent)
            let stagedURL = stagingRoot.appendingPathComponent("\(UUID().uuidString)_\(filename)")

            do {
                if fileManager.fileExists(atPath: stagedURL.path) {
                    try fileManager.removeItem(at: stagedURL)
                }
                try fileManager.copyItem(at: sourceURL, to: stagedURL)
                let sourceValues = try? sourceURL.resourceValues(
                    forKeys: [.contentModificationDateKey, .fileSizeKey]
                )
                let attrs = try fileManager.attributesOfItem(atPath: stagedURL.path)
                let stagedSize = (attrs[.size] as? NSNumber)?.int64Value ?? 0
                let size = sourceValues?.fileSize.map(Int64.init) ?? stagedSize
                guard size > 0 else {
                    try? fileManager.removeItem(at: stagedURL)
                    skippedCount += 1
                    continue
                }
                let modifiedAt = (
                    sourceValues?.contentModificationDate ??
                    (attrs[.modificationDate] as? Date) ??
                    Date()
                ).iso8601String
                let mimeType = Self.mimeType(for: filename)
                let mediaType = Self.mediaType(forMimeType: mimeType)
                let fileKey = Self.computeDocumentFileKey(
                    clientId: clientId,
                    filename: filename,
                    fileSize: size,
                    modifiedAt: modifiedAt,
                    sourceIdentity: sourceURL.absoluteString
                )
                let assetLocalId = "document:\(fileKey)"

                if let existing = store.getItemByAssetId(assetLocalId),
                   ["queued", "discovered", "preparing", "ready", "uploading", "completed"].contains(existing.status) {
                    try? fileManager.removeItem(at: stagedURL)
                    skippedCount += 1
                    continue
                }

                itemsToInsert.append(UploadItemRecord(
                    id: nil,
                    assetLocalId: assetLocalId,
                    modifiedAt: modifiedAt,
                    mediaType: mediaType,
                    originalFilename: filename,
                    fileKey: fileKey,
                    fileSize: size,
                    status: "queued",
                    ackedOffset: 0,
                    lastErrorCode: nil,
                    updatedAt: now,
                    source: "manual",
                    batchId: batchId,
                    priority: 1,
                    sourceKind: "document",
                    sourceFilePath: stagedURL.path,
                    mimeType: mimeType
                ))
                queuedFiles.append([
                    "name": filename,
                    "size": size,
                    "mimeType": mimeType,
                    "uri": sourceURL.absoluteString
                ])
                stagedURLsToCleanup.append(stagedURL)
                queuedCount += 1
            } catch {
                slog("[ManualUploadService] failed to stage document %@: %@", sourceURL.absoluteString, "\(error)")
                try? fileManager.removeItem(at: stagedURL)
                skippedCount += 1
            }
        }

        if !itemsToInsert.isEmpty {
            do {
                try store.upsertUploadItems(itemsToInsert)
                slog("[ManualUploadService] queued %d document items (skipped %d) in manual queue %@",
                      queuedCount, skippedCount, batchId)
                syncDiagnosticsLog(
                    "ManualUploadService",
                    "queued \(queuedCount) document items (skipped \(skippedCount)) in manual queue \(batchId)"
                )
            } catch {
                for stagedURL in stagedURLsToCleanup {
                    try? fileManager.removeItem(at: stagedURL)
                }
                slog("[ManualUploadService] failed to insert document items: %@", "\(error)")
                return DocumentUploadResult(queuedCount: 0, skippedCount: fileURLs.count, batchId: batchId, files: [])
            }
        }

        return DocumentUploadResult(
            queuedCount: queuedCount,
            skippedCount: skippedCount,
            batchId: batchId,
            files: queuedFiles
        )
    }

    private static func documentStagingDirectory() -> URL {
        let libraryDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
        return libraryDir
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("document_uploads", isDirectory: true)
    }

    private static func sanitizedFilename(_ raw: String) -> String {
        let fallback = "Document"
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmed.isEmpty ? fallback : trimmed
        let invalid = CharacterSet(charactersIn: "/\\:\0\r\n")
        let cleaned = base.components(separatedBy: invalid).joined(separator: "_")
        return cleaned.isEmpty ? fallback : cleaned
    }

    private static func mimeType(for filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "heic": return "image/heic"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "mp4": return "video/mp4"
        case "mov": return "video/quicktime"
        case "pdf": return "application/pdf"
        case "zip": return "application/zip"
        case "txt": return "text/plain"
        default: return "application/octet-stream"
        }
    }

    private static func mediaType(forMimeType mimeType: String) -> String {
        if mimeType.hasPrefix("image/") { return "image" }
        if mimeType.hasPrefix("video/") { return "video" }
        return "document"
    }

    private static func computeDocumentFileKey(
        clientId: String,
        filename: String,
        fileSize: Int64,
        modifiedAt: String,
        sourceIdentity: String
    ) -> String {
        let input = "\(clientId)|document|\(filename)|\(fileSize)|\(modifiedAt)|\(sourceIdentity)"
        let hash = SHA256.hash(data: Data(input.utf8))
        return hash.map { String(format: "%02x", $0) }.joined()
    }
}
