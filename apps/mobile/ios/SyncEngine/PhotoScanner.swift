import Foundation
import Photos
import CryptoKit

class PhotoScanner {

    /// Request photo library permission
    func requestPermission() async -> PHAuthorizationStatus {
        await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    }

    /// Scan all photos and videos, return items not yet uploaded
    func scanForNewAssets(clientId: String, completedFileKeys: Set<String>) -> [ScannedAsset] {
        let fetchOptions = PHFetchOptions()
        fetchOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        fetchOptions.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d",
                                              PHAssetMediaType.image.rawValue,
                                              PHAssetMediaType.video.rawValue)

        let assets = PHAsset.fetchAssets(with: fetchOptions)
        var results: [ScannedAsset] = []

        assets.enumerateObjects { asset, _, _ in
            let fileKey = Self.computeFileKey(
                clientId: clientId,
                assetLocalId: asset.localIdentifier,
                resourceSize: 0,  // Will be determined during export
                modifiedAt: asset.modificationDate?.iso8601String ?? "",
                mediaType: asset.mediaType == .video ? "video" : "image"
            )

            if !completedFileKeys.contains(fileKey) {
                results.append(ScannedAsset(
                    asset: asset,
                    fileKey: fileKey,
                    mediaType: asset.mediaType == .video ? "video" : "image",
                    creationDate: asset.creationDate
                ))
            }
        }

        return results
    }

    /// Compute fileKey per spec Section 8.10
    static func computeFileKey(clientId: String, assetLocalId: String, resourceSize: Int64, modifiedAt: String, mediaType: String) -> String {
        // Note: originalFilename is not available until export, use assetLocalId for initial key
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
}

extension Date {
    var iso8601String: String {
        ISO8601DateFormatter().string(from: self)
    }
}
