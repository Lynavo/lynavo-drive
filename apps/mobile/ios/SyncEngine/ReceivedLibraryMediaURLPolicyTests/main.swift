import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("ReceivedLibraryMediaURLPolicyTests failed: \(message)\n", stderr)
        exit(1)
    }
}

func mediaURL(fileKey: String, kind: String) -> String? {
    "http://192.168.1.100:39594/resources/mobile/received/\(kind)?fileKey=\(fileKey)"
}

let videoItem: [String: Any] = [
    "fileKey": "video-key",
    "filename": "IMG_0346.MOV",
    "mediaType": "video",
    "thumbnailUrl": "/resources/mobile/received/thumbnail?fileKey=video-key",
]

let enrichedVideo = ReceivedLibraryMediaURLPolicy.enrich(item: videoItem, mediaURL: mediaURL)

expect(
    enrichedVideo["thumbnailUrl"] as? String == "http://192.168.1.100:39594/resources/mobile/received/thumbnail?fileKey=video-key",
    "received videos must expose an absolute thumbnail URL for React Native Image"
)
expect(
    enrichedVideo["previewUrl"] as? String == "http://192.168.1.100:39594/resources/mobile/received/preview?fileKey=video-key",
    "received videos must expose an absolute preview URL"
)
expect(
    enrichedVideo["streamUrl"] as? String == "http://192.168.1.100:39594/resources/mobile/received/stream?fileKey=video-key",
    "received videos must expose an absolute stream URL"
)

let heicItem: [String: Any] = [
    "fileKey": "heic-key",
    "filename": "IMG_0345.HEIC",
    "mediaType": "image",
]

let enrichedHEIC = ReceivedLibraryMediaURLPolicy.enrich(item: heicItem, mediaURL: mediaURL)

expect(
    enrichedHEIC["thumbnailUrl"] as? String == "http://192.168.1.100:39594/resources/mobile/received/thumbnail?fileKey=heic-key",
    "received HEIC images must keep using an absolute thumbnail URL"
)
expect(
    enrichedHEIC["previewUrl"] as? String == "http://192.168.1.100:39594/resources/mobile/received/preview?fileKey=heic-key",
    "received HEIC images must expose an absolute preview URL"
)

print("ReceivedLibraryMediaURLPolicyTests passed")
