import Foundation

enum ReceivedLibraryMediaURLPolicy {
    static func enrich(
        item: [String: Any],
        mediaURL: (_ fileKey: String, _ kind: String) -> String?
    ) -> [String: Any] {
        var next = item
        let fileKey = stringValue(item["fileKey"])
        let filename = stringValue(item["filename"]).isEmpty
            ? stringValue(item["displayName"])
            : stringValue(item["filename"])
        let mediaType = stringValue(item["mediaType"])

        guard !fileKey.isEmpty else {
            return next
        }

        if isReceivedImage(mediaType: mediaType, filename: filename) {
            if let previewURL = mediaURL(fileKey, "preview") {
                next["previewUrl"] = previewURL
            }
            if let thumbnailURL = mediaURL(fileKey, "thumbnail") {
                next["thumbnailUrl"] = thumbnailURL
            }
            return next
        }

        if isReceivedVideo(mediaType: mediaType, filename: filename) {
            if let previewURL = mediaURL(fileKey, "preview") {
                next["previewUrl"] = previewURL
            }
            if let thumbnailURL = mediaURL(fileKey, "thumbnail") {
                next["thumbnailUrl"] = thumbnailURL
            }
            if let streamURL = mediaURL(fileKey, "stream") {
                next["streamUrl"] = streamURL
            }
            return next
        }

        return next
    }

    private static func stringValue(_ value: Any?) -> String {
        (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private static func isReceivedImage(mediaType: String, filename: String) -> Bool {
        let normalized = mediaType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized == "image" || normalized.hasPrefix("image/") {
            return true
        }
        let ext = (filename as NSString).pathExtension.lowercased()
        return ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff", "tif"].contains(ext)
    }

    private static func isReceivedVideo(mediaType: String, filename: String) -> Bool {
        let normalized = mediaType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized == "video" || normalized.hasPrefix("video/") {
            return true
        }
        let ext = (filename as NSString).pathExtension.lowercased()
        return ["mp4", "mov", "avi", "mkv", "webm", "m4v"].contains(ext)
    }
}
