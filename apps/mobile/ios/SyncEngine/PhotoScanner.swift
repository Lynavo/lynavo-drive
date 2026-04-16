import Foundation
import Photos
import CryptoKit

protocol PhotoScannerDelegate: AnyObject {
    func photoLibraryDidChange()
}

class PhotoScanner: NSObject, PHPhotoLibraryChangeObserver {

    weak var delegate: PhotoScannerDelegate?
    private var observing = false

    /// Cached fetch result for incremental change tracking via PHChange.
    /// Updated after every full scan and after processing each PHChange delta.
    private var lastFetchResult: PHFetchResult<PHAsset>?

    /// Request photo library permission
    func requestPermission() async -> PHAuthorizationStatus {
        await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    }

    /// Start observing photo library for new assets
    func startObserving() {
        guard !observing else { return }
        observing = true
        PHPhotoLibrary.shared().register(self)
        NSLog("[PhotoScanner] started observing photo library changes")
    }

    /// Stop observing
    func stopObserving() {
        guard observing else { return }
        observing = false
        PHPhotoLibrary.shared().unregisterChangeObserver(self)
        NSLog("[PhotoScanner] stopped observing")
    }

    // MARK: - PHPhotoLibraryChangeObserver

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        NSLog("[PhotoScanner] photo library changed — notifying delegate")
        DispatchQueue.main.async { [weak self] in
            self?.delegate?.photoLibraryDidChange()
        }
    }

    // MARK: - Incremental (delta) scan

    /// Scan only the assets that were inserted or updated since the last fetch,
    /// using PHChange's changeDetails. Returns nil if no cached fetchResult exists
    /// (caller should fall back to a full scan).
    func scanChangedAssets(
        clientId: String,
        trackedFileKeys: Set<String>
    ) -> [ScannedAsset]? {
        guard let previous = lastFetchResult else { return nil }

        // PHChange.changeDetails requires a fresh PHChange instance — we can
        // achieve the same by re-fetching with the same options and diffing.
        let fetchOptions = Self.defaultFetchOptions(configStore: autoUploadConfigStore)
        let current = PHAsset.fetchAssets(with: fetchOptions)

        // PHFetchResultChangeDetails computes a diff between two fetch results
        // efficiently inside PhotoKit (backed by the Photos database).
        let details = PHFetchResultChangeDetails(from: previous, to: current, changedObjects: [])

        lastFetchResult = details.fetchResultAfterChanges

        let insertedIndexes = details.insertedIndexes ?? IndexSet()
        let changedIndexes = details.changedIndexes ?? IndexSet()
        let candidateIndexes = insertedIndexes.union(changedIndexes)

        guard !candidateIndexes.isEmpty else { return [] }

        let afterResult = details.fetchResultAfterChanges
        var results: [ScannedAsset] = []

        for index in candidateIndexes {
            guard index < afterResult.count else { continue }
            let asset = afterResult.object(at: index)
            let fileKey = Self.computeFileKey(
                clientId: clientId,
                assetLocalId: asset.localIdentifier,
                resourceSize: 0,
                modifiedAt: asset.modificationDate?.iso8601String ?? "",
                mediaType: asset.mediaType == .video ? "video" : "image"
            )

            guard !trackedFileKeys.contains(fileKey) else { continue }

            let resources = PHAssetResource.assetResources(for: asset)
            let primaryResource = resources.first(where: {
                $0.type == .fullSizePhoto || $0.type == .video
            }) ?? resources.first

            let filename = primaryResource?.originalFilename ?? "unknown"
            let estimatedSize = primaryResource?.value(forKey: "fileSize") as? Int64 ?? 0

            results.append(ScannedAsset(
                asset: asset,
                fileKey: fileKey,
                mediaType: asset.mediaType == .video ? "video" : "image",
                creationDate: asset.creationDate,
                originalFilename: filename,
                estimatedSize: estimatedSize
            ))
        }

        NSLog("[PhotoScanner] delta scan: %d candidates (%d inserted, %d changed), %d new untracked",
              candidateIndexes.count, insertedIndexes.count, changedIndexes.count, results.count)
        return results
    }

    // MARK: - Full scan (initial / fallback)

    /// Scan all photos and videos, return items whose fileKey is not already tracked.
    /// - Parameter onProgress: Optional callback invoked every 200 assets with (scannedSoFar, totalInLibrary).
    func scanForUntrackedAssets(
        clientId: String,
        trackedFileKeys: Set<String>,
        onProgress: ((_ scanned: Int, _ total: Int) -> Void)? = nil
    ) -> [ScannedAsset] {
        let fetchOptions = Self.defaultFetchOptions(configStore: autoUploadConfigStore)
        let assets = PHAsset.fetchAssets(with: fetchOptions)

        // Cache for future incremental scans
        lastFetchResult = assets

        let libraryTotal = assets.count
        NSLog("[PhotoScanner] library has %d authorized assets, %d tracked keys", libraryTotal, trackedFileKeys.count)
        var results: [ScannedAsset] = []
        var skippedCount = 0
        var processedCount = 0

        onProgress?(0, libraryTotal)

        assets.enumerateObjects { asset, _, _ in
            let fileKey = Self.computeFileKey(
                clientId: clientId,
                assetLocalId: asset.localIdentifier,
                resourceSize: 0,
                modifiedAt: asset.modificationDate?.iso8601String ?? "",
                mediaType: asset.mediaType == .video ? "video" : "image"
            )

            if trackedFileKeys.contains(fileKey) {
                skippedCount += 1
            }
            if !trackedFileKeys.contains(fileKey) {
                // Get filename and estimated size from PHAssetResource
                let resources = PHAssetResource.assetResources(for: asset)
                let primaryResource = resources.first(where: {
                    $0.type == .fullSizePhoto || $0.type == .video
                }) ?? resources.first

                let filename = primaryResource?.originalFilename ?? "unknown"
                let estimatedSize = primaryResource?.value(forKey: "fileSize") as? Int64 ?? 0

                results.append(ScannedAsset(
                    asset: asset,
                    fileKey: fileKey,
                    mediaType: asset.mediaType == .video ? "video" : "image",
                    creationDate: asset.creationDate,
                    originalFilename: filename,
                    estimatedSize: estimatedSize
                ))
            }

            processedCount += 1
            if processedCount % 200 == 0 {
                onProgress?(processedCount, libraryTotal)
            }
        }

        // Final progress callback so UI sees 100%
        onProgress?(libraryTotal, libraryTotal)

        NSLog("[PhotoScanner] scan result: %d new, %d skipped (already tracked)", results.count, skippedCount)
        return results
    }

    /// Scan assets that are not yet completed on the mobile side.
    func scanForNewAssets(clientId: String, completedFileKeys: Set<String>) -> [ScannedAsset] {
        scanForUntrackedAssets(clientId: clientId, trackedFileKeys: completedFileKeys)
    }

    // MARK: - Auto Upload Config Integration

    /// The auto upload config store, set by SyncEngineManager after initialization.
    /// Used to apply media type and time range filters during automatic scanning.
    weak var autoUploadConfigStore: AutoUploadConfigStore?

    // MARK: - Helpers

    /// Build fetch options for automatic scanning. Applies auto upload config
    /// predicates for media type and time range. This ONLY affects automatic
    /// scanning, NOT the album browser (which always shows everything).
    private static func defaultFetchOptions() -> PHFetchOptions {
        return defaultFetchOptions(configStore: nil)
    }

    static func defaultFetchOptions(configStore: AutoUploadConfigStore?) -> PHFetchOptions {
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]

        var predicates: [NSPredicate] = []

        // Auto upload uploads everything — no media type filter
        predicates.append(NSPredicate(
            format: "mediaType == %d OR mediaType == %d",
            PHAssetMediaType.image.rawValue,
            PHAssetMediaType.video.rawValue
        ))

        // Time range filter from config
        if let timeThreshold = configStore?.resolvedTimeThreshold() {
            predicates.append(NSPredicate(
                format: "creationDate >= %@",
                timeThreshold as NSDate
            ))
        }

        if predicates.count == 1 {
            options.predicate = predicates[0]
        } else {
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
        }

        return options
    }

    /// Compute fileKey — stable identifier for a file from this client.
    /// Uses clientId + assetLocalId + mediaType (NOT modifiedAt, which iOS can change).
    static func computeFileKey(clientId: String, assetLocalId: String, resourceSize: Int64, modifiedAt: String, mediaType: String) -> String {
        let input = "\(clientId)|\(assetLocalId)|\(mediaType)"
        let hash = SHA256.hash(data: Data(input.utf8))
        return hash.map { String(format: "%02x", $0) }.joined()
    }
}

struct ScannedAsset {
    let asset: PHAsset
    let fileKey: String
    let mediaType: String
    let creationDate: Date?
    let originalFilename: String
    let estimatedSize: Int64
    var source: String = "auto"  // "auto" | "manual"
}

extension Date {
    var iso8601String: String {
        ISO8601DateFormatter().string(from: self)
    }
}
