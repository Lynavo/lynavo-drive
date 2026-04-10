import Foundation
import Photos
import CryptoKit

// MARK: - Result

struct ManualUploadResult {
    let queuedCount: Int
    let skippedCount: Int
    let batchId: String
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
    /// - Returns: ManualUploadResult with queued count, skipped count, and batch ID.
    func submitManualUpload(assets: [PHAsset]) -> ManualUploadResult {
        guard let store = uploadStore else {
            NSLog("[ManualUploadService] uploadStore unavailable — cannot submit")
            return ManualUploadResult(queuedCount: 0, skippedCount: 0, batchId: "")
        }

        let batchId = UUID().uuidString.lowercased()
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
                tempFilePath: nil,
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
                NSLog("[ManualUploadService] queued %d items (skipped %d) in batch %@",
                      queuedCount, skippedCount, batchId)
                syncDiagnosticsLog("ManualUploadService",
                    "queued \(queuedCount) items (skipped \(skippedCount)) in batch \(batchId)")
            } catch {
                NSLog("[ManualUploadService] failed to insert items: %@", "\(error)")
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
}
