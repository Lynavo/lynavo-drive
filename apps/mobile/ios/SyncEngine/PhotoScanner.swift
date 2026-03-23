import Foundation
import Photos
import CryptoKit

protocol PhotoScannerDelegate: AnyObject {
    func photoLibraryDidChange()
}

class PhotoScanner: NSObject, PHPhotoLibraryChangeObserver {

    weak var delegate: PhotoScannerDelegate?
    private var observing = false

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

    /// Scan all photos and videos, return items not yet uploaded
    func scanForNewAssets(clientId: String, completedFileKeys: Set<String>) -> [ScannedAsset] {
        let fetchOptions = PHFetchOptions()
        fetchOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        fetchOptions.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d",
                                              PHAssetMediaType.image.rawValue,
                                              PHAssetMediaType.video.rawValue)

        let assets = PHAsset.fetchAssets(with: fetchOptions)
        NSLog("[PhotoScanner] library has %d authorized assets, %d completed keys", assets.count, completedFileKeys.count)
        var results: [ScannedAsset] = []
        var skippedCount = 0

        assets.enumerateObjects { asset, _, _ in
            let fileKey = Self.computeFileKey(
                clientId: clientId,
                assetLocalId: asset.localIdentifier,
                resourceSize: 0,
                modifiedAt: asset.modificationDate?.iso8601String ?? "",
                mediaType: asset.mediaType == .video ? "video" : "image"
            )

            if completedFileKeys.contains(fileKey) {
                skippedCount += 1
            }
            if !completedFileKeys.contains(fileKey) {
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
        }

        NSLog("[PhotoScanner] scan result: %d new, %d skipped (already completed)", results.count, skippedCount)
        return results
    }

    /// Compute fileKey per spec Section 8.10
    static func computeFileKey(clientId: String, assetLocalId: String, resourceSize: Int64, modifiedAt: String, mediaType: String) -> String {
        let input = "\(clientId)|\(assetLocalId)||||\(modifiedAt)|\(mediaType)"
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
}

extension Date {
    var iso8601String: String {
        ISO8601DateFormatter().string(from: self)
    }
}
