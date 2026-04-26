import AVFoundation
import Foundation
import Photos
import UIKit

// MARK: - Data Structures

struct AlbumAssetInfo {
    let assetLocalId: String
    let filename: String
    let mediaType: String  // "image" | "video"
    let fileSize: Int64
    let creationDate: String
    let isTransferred: Bool
    let isQueued: Bool
}

struct AlbumStats {
    let totalCount: Int
    let transferredCount: Int
    let queuedCount: Int
    /// Assets that still need to be uploaded. When the auto-upload time range
    /// filter is active, this counts only assets inside the range; otherwise
    /// it falls back to `totalCount - transferredCount`.
    let pendingCount: Int
}

// MARK: - AlbumBrowserService

/// Browses the user's photo library for the album workbench UI.
/// Uses PHCachingImageManager for efficient thumbnail generation.
/// Cross-references with UploadStore to mark assets as transferred or queued.
class AlbumBrowserService {
    private let cachingImageManager = PHCachingImageManager()
    private weak var uploadStore: UploadStore?
    /// Late-bound by SyncEngineManager after both services are constructed.
    /// When non-nil and auto-upload is enabled, album stats honour the active
    /// time range filter for `pendingCount`.
    var autoUploadConfigStore: AutoUploadConfigStore?

    init(uploadStore: UploadStore?) {
        self.uploadStore = uploadStore
        cachingImageManager.allowsCachingHighQualityImages = false
    }

    // MARK: - Browse Assets

    /// Fetch album assets with filtering by media type, supporting pagination.
    /// This always shows all assets regardless of auto upload config —
    /// the auto upload config only affects automatic scanning, not browsing.
    /// When `collectionId` is provided, only assets belonging to that
    /// PHAssetCollection (iOS album / subfolder) are returned.
    func fetchAlbumAssets(
        mediaFilter: String,
        transferFilter: String,
        offset: Int,
        limit: Int,
        collectionId: String? = nil
    ) -> [AlbumAssetInfo] {
        let fetchOptions = PHFetchOptions()
        fetchOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]

        switch mediaFilter {
        case "photos":
            fetchOptions.predicate = NSPredicate(
                format: "mediaType == %d",
                PHAssetMediaType.image.rawValue
            )
        case "videos":
            fetchOptions.predicate = NSPredicate(
                format: "mediaType == %d",
                PHAssetMediaType.video.rawValue
            )
        default:
            // "all" — include both images and videos
            fetchOptions.predicate = NSPredicate(
                format: "mediaType == %d OR mediaType == %d",
                PHAssetMediaType.image.rawValue,
                PHAssetMediaType.video.rawValue
            )
        }

        // Fetch assets — scoped to a specific collection if requested
        let assets: PHFetchResult<PHAsset>
        if let colId = collectionId, !colId.isEmpty,
           let collection = PHAssetCollection.fetchAssetCollections(
               withLocalIdentifiers: [colId], options: nil
           ).firstObject {
            assets = PHAsset.fetchAssets(in: collection, options: fetchOptions)
        } else {
            assets = PHAsset.fetchAssets(with: fetchOptions)
        }

        // Build sets of transferred and queued asset IDs for cross-referencing
        let transferredAssetIds = buildTransferredAssetIds()
        let queuedAssetIds = buildQueuedAssetIds()

        // Build global sort order:
        // 1. selectable non-transferred assets
        // 2. queued-but-not-yet-transferred assets
        // 3. transferred assets
        //
        // This keeps the most actionable items at the top for manual selection.
        // Only reads localIdentifier (lightweight) — no resource extraction yet.
        var selectableIndices: [Int] = []
        var queuedIndices: [Int] = []
        var transferredIndices: [Int] = []
        for i in 0..<assets.count {
            let assetId = assets.object(at: i).localIdentifier
            if transferredAssetIds.contains(assetId) {
                transferredIndices.append(i)
            } else if queuedAssetIds.contains(assetId) {
                queuedIndices.append(i)
            } else {
                selectableIndices.append(i)
            }
        }
        let sortedIndices: [Int]
        switch transferFilter {
        case "untransferred":
            sortedIndices = selectableIndices + queuedIndices
        case "transferred":
            sortedIndices = transferredIndices
        default:
            sortedIndices = selectableIndices + queuedIndices + transferredIndices
        }

        // Apply pagination to the sorted index list
        let startIndex = min(offset, sortedIndices.count)
        let endIndex = min(offset + limit, sortedIndices.count)
        guard startIndex < endIndex else { return [] }

        var results: [AlbumAssetInfo] = []

        for pagePos in startIndex..<endIndex {
            let assetIndex = sortedIndices[pagePos]
            let asset = assets.object(at: assetIndex)
            let resources = PHAssetResource.assetResources(for: asset)
            let primaryResource = resources.first(where: {
                $0.type == .fullSizePhoto || $0.type == .video
            }) ?? resources.first

            let filename = primaryResource?.originalFilename ?? "unknown"
            let estimatedSize = primaryResource?.value(forKey: "fileSize") as? Int64 ?? 0
            let mediaType = asset.mediaType == .video ? "video" : "image"
            let creationDate = asset.creationDate?.iso8601String ?? ""

            let assetId = asset.localIdentifier
            let isTransferred = transferredAssetIds.contains(assetId)
            let isQueued = queuedAssetIds.contains(assetId)

            results.append(AlbumAssetInfo(
                assetLocalId: assetId,
                filename: filename,
                mediaType: mediaType,
                fileSize: estimatedSize,
                creationDate: creationDate,
                isTransferred: isTransferred,
                isQueued: isQueued
            ))
        }

        return results
    }

    // MARK: - Stats

    /// Get album statistics: total count, transferred count, queued count,
    /// and pending count (honours the active auto-upload time range filter).
    func getAlbumStats() -> AlbumStats {
        let mediaPredicate = NSPredicate(
            format: "mediaType == %d OR mediaType == %d",
            PHAssetMediaType.image.rawValue,
            PHAssetMediaType.video.rawValue
        )
        let totalOptions = PHFetchOptions()
        totalOptions.predicate = mediaPredicate
        let totalCount = PHAsset.fetchAssets(with: totalOptions).count

        let transferredIds = buildTransferredAssetIds()
        let queuedIds = buildQueuedAssetIds()
        let transferredCount = transferredIds.count
        let queuedCount = queuedIds.count

        let pendingCount: Int
        if let threshold = autoUploadConfigStore?.resolvedTimeThreshold() {
            let rangeOptions = PHFetchOptions()
            rangeOptions.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
                mediaPredicate,
                NSPredicate(format: "creationDate >= %@", threshold as NSDate),
            ])
            let rangeResult = PHAsset.fetchAssets(with: rangeOptions)
            var inRangeTransferred = 0
            rangeResult.enumerateObjects { asset, _, _ in
                if transferredIds.contains(asset.localIdentifier) {
                    inRangeTransferred += 1
                }
            }
            pendingCount = max(rangeResult.count - inRangeTransferred, 0)
        } else {
            pendingCount = max(totalCount - transferredCount, 0)
        }

        return AlbumStats(
            totalCount: totalCount,
            transferredCount: transferredCount,
            queuedCount: queuedCount,
            pendingCount: pendingCount
        )
    }

    // MARK: - Album Collections (Subfolders)

    /// List all user-visible photo albums (smart albums + user albums) with
    /// the count of assets matching the given mediaFilter in each.
    /// Returns items sorted by count descending, each containing:
    ///   - collectionId: PHAssetCollection.localIdentifier
    ///   - title: localizedTitle
    ///   - count: number of matching assets
    func getAlbumCollections(mediaFilter: String) -> [[String: Any]] {
        let assetFetchOptions = PHFetchOptions()
        switch mediaFilter {
        case "photos":
            assetFetchOptions.predicate = NSPredicate(
                format: "mediaType == %d",
                PHAssetMediaType.image.rawValue
            )
        case "videos":
            assetFetchOptions.predicate = NSPredicate(
                format: "mediaType == %d",
                PHAssetMediaType.video.rawValue
            )
        default:
            assetFetchOptions.predicate = NSPredicate(
                format: "mediaType == %d OR mediaType == %d",
                PHAssetMediaType.image.rawValue,
                PHAssetMediaType.video.rawValue
            )
        }

        var results: [[String: Any]] = []

        // Smart albums: Recents, Favorites, Screenshots, Selfies, Videos, etc.
        let smartAlbums = PHAssetCollection.fetchAssetCollections(
            with: .smartAlbum, subtype: .any, options: nil
        )
        smartAlbums.enumerateObjects { collection, _, _ in
            let count = PHAsset.fetchAssets(in: collection, options: assetFetchOptions).count
            guard count > 0 else { return }
            results.append([
                "collectionId": collection.localIdentifier,
                "title": collection.localizedTitle ?? "未命名",
                "count": count,
            ])
        }

        // User-created albums
        let userAlbums = PHAssetCollection.fetchAssetCollections(
            with: .album, subtype: .any, options: nil
        )
        userAlbums.enumerateObjects { collection, _, _ in
            let count = PHAsset.fetchAssets(in: collection, options: assetFetchOptions).count
            guard count > 0 else { return }
            results.append([
                "collectionId": collection.localIdentifier,
                "title": collection.localizedTitle ?? "未命名",
                "count": count,
            ])
        }

        // Sort by count descending
        results.sort { ($0["count"] as? Int ?? 0) > ($1["count"] as? Int ?? 0) }
        return results
    }

    // MARK: - Thumbnails

    /// Generate a thumbnail for a given asset local ID.
    func getThumbnail(assetLocalId: String, size: CGSize) -> UIImage? {
        let fetchResult = PHAsset.fetchAssets(
            withLocalIdentifiers: [assetLocalId],
            options: nil
        )
        guard let asset = fetchResult.firstObject else { return nil }

        let options = PHImageRequestOptions()
        options.isSynchronous = true
        options.deliveryMode = .opportunistic
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = false

        var resultImage: UIImage?
        cachingImageManager.requestImage(
            for: asset,
            targetSize: size,
            contentMode: .aspectFill,
            options: options
        ) { image, _ in
            resultImage = image
        }

        return resultImage
    }

    // MARK: - Full-resolution Preview (lazy)

    /// Returns a dictionary describing the preview source for a single asset.
    /// Keys: "uri" (String), "mediaType" ("image"|"video"), optional "error"
    /// ("cloud_unavailable"|"not_found").
    func getPreviewSource(assetLocalId: String) -> [String: Any] {
        let fetchResult = PHAsset.fetchAssets(
            withLocalIdentifiers: [assetLocalId],
            options: nil
        )
        guard let asset = fetchResult.firstObject else {
            return ["uri": "", "mediaType": "image", "error": "not_found"]
        }

        switch asset.mediaType {
        case .image:
            return fetchImagePreview(asset: asset, assetLocalId: assetLocalId)
        case .video:
            return fetchVideoPreview(asset: asset)
        default:
            return ["uri": "", "mediaType": "image", "error": "not_found"]
        }
    }

    private func fetchImagePreview(asset: PHAsset, assetLocalId: String) -> [String: Any] {
        let cacheDir = Self.previewCacheDir()
        let safeId = assetLocalId
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        let cacheFile = cacheDir.appendingPathComponent("\(safeId).jpg")

        if FileManager.default.fileExists(atPath: cacheFile.path) {
            return ["uri": cacheFile.absoluteString, "mediaType": "image"]
        }

        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.isSynchronous = false
        options.resizeMode = .none

        let semaphore = DispatchSemaphore(value: 0)
        var resultData: Data?
        let requestId = PHImageManager.default().requestImageDataAndOrientation(
            for: asset,
            options: options
        ) { data, _, _, _ in
            resultData = data
            semaphore.signal()
        }

        let timeoutResult = semaphore.wait(timeout: .now() + 15)
        if timeoutResult == .timedOut {
            PHImageManager.default().cancelImageRequest(requestId)
            return ["uri": "", "mediaType": "image", "error": "cloud_unavailable"]
        }

        guard let data = resultData else {
            return ["uri": "", "mediaType": "image", "error": "cloud_unavailable"]
        }

        do {
            try data.write(to: cacheFile, options: .atomic)
            return ["uri": cacheFile.absoluteString, "mediaType": "image"]
        } catch {
            return ["uri": "", "mediaType": "image", "error": "not_found"]
        }
    }

    private func fetchVideoPreview(asset: PHAsset) -> [String: Any] {
        // Mirror the upload path (AssetExportService) — PHAssetResourceManager.writeData
        // is the canonical way to materialize a PHAsset to disk. requestAVAsset was returning
        // AVComposition (slow-motion) or nil for some iCloud formats even when the underlying
        // resource was fully available, which caused false "cloud_unavailable" errors while
        // the upload pipeline succeeded on the same asset.
        let resources = PHAssetResource.assetResources(for: asset)
        guard let resource = resources.first(where: { $0.type == .video }) ?? resources.first else {
            return ["uri": "", "mediaType": "video", "error": "not_found"]
        }

        let ext = (resource.originalFilename as NSString).pathExtension.lowercased()
        let safeExt = ext.isEmpty ? "mov" : ext
        let cacheDir = Self.previewCacheDir()
        let safeId = asset.localIdentifier
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        let cacheFile = cacheDir.appendingPathComponent("\(safeId).\(safeExt)")

        if FileManager.default.fileExists(atPath: cacheFile.path) {
            return ["uri": cacheFile.absoluteString, "mediaType": "video"]
        }

        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        options.progressHandler = { progress in
            slog("[AlbumBrowser] iCloud video progress: %.0f%%", progress * 100)
        }

        let semaphore = DispatchSemaphore(value: 0)
        var writeError: Error?
        PHAssetResourceManager.default().writeData(
            for: resource,
            toFile: cacheFile,
            options: options
        ) { error in
            writeError = error
            semaphore.signal()
        }

        // 120s covers full-resolution iCloud fetches on slow networks; writeData is not
        // cancellable, so hitting this is a soft timeout for UX only — the download continues.
        let timeoutResult = semaphore.wait(timeout: .now() + 120)
        if timeoutResult == .timedOut {
            slog("[AlbumBrowser] video preview timeout for asset %@", asset.localIdentifier)
            return ["uri": "", "mediaType": "video", "error": "cloud_unavailable"]
        }

        if let err = writeError {
            slog("[AlbumBrowser] video preview write error: %@", err.localizedDescription)
            try? FileManager.default.removeItem(at: cacheFile)
            return ["uri": "", "mediaType": "video", "error": "cloud_unavailable"]
        }

        return ["uri": cacheFile.absoluteString, "mediaType": "video"]
    }

    static func previewCacheDir() -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_album_previews", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    // MARK: - Private Helpers

    private func buildTransferredAssetIds() -> Set<String> {
        guard let store = uploadStore else { return [] }
        let rows = store.query(
            "SELECT asset_local_id FROM upload_items WHERE status = 'completed'",
            bind: []
        )
        return Set(rows.compactMap { $0["asset_local_id"] as? String })
    }

    private func buildQueuedAssetIds() -> Set<String> {
        guard let store = uploadStore else { return [] }
        let rows = store.query(
            "SELECT asset_local_id FROM upload_items WHERE status IN ('queued', 'discovered', 'preparing', 'ready', 'cloud_downloading', 'uploading')",
            bind: []
        )
        return Set(rows.compactMap { $0["asset_local_id"] as? String })
    }
}
