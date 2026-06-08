import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("BackgroundHandoffPolicyTests failed: \(message)\n", stderr)
        exit(1)
    }
}

let stored = StoredBinding(
    serverId: "desktop-1",
    sidecarHost: "192.168.1.20",
    port: 39393,
    pairingTokenKeychainRef: "token-ref"
)

let persisted = BindingRecord(
    deviceId: "desktop-2",
    deviceName: "Desktop",
    deviceAlias: nil,
    deviceType: "mac",
    host: "192.168.1.21",
    port: 39393,
    pairingId: "pairing-id",
    pairingTokenKeychainRef: "persisted-token-ref",
    shareName: nil,
    lastBoundAt: "2026-06-08T03:25:00Z"
)

expect(
    BackgroundHandoffPolicy.resolveBinding(live: stored, persisted: persisted)?.serverId == "desktop-1",
    "background handoff should prefer the live binding snapshot"
)

let fallback = BackgroundHandoffPolicy.resolveBinding(live: nil, persisted: persisted)
expect(
    fallback?.serverId == "desktop-2" &&
        fallback?.sidecarHost == "192.168.1.21" &&
        fallback?.pairingTokenKeychainRef == "persisted-token-ref",
    "background handoff should fall back to the persisted binding when currentBinding is nil"
)

let invalid = BindingRecord(
    deviceId: "",
    deviceName: "Desktop",
    deviceAlias: nil,
    deviceType: "mac",
    host: "192.168.1.21",
    port: 39393,
    pairingId: "pairing-id",
    pairingTokenKeychainRef: "persisted-token-ref",
    shareName: nil,
    lastBoundAt: "2026-06-08T03:25:00Z"
)
expect(
    BackgroundHandoffPolicy.resolveBinding(live: nil, persisted: invalid) == nil,
    "background handoff should reject persisted bindings without a server id"
)

expect(
    BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
        isTransitioningToBackground: false,
        isSilentAudioPlaying: false
    ),
    "foreground TCP pipeline should continue while not transitioning to background"
)
expect(
    !BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
        isTransitioningToBackground: true,
        isSilentAudioPlaying: false
    ),
    "foreground TCP pipeline should pause after yielding to background handoff"
)
expect(
    BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
        isTransitioningToBackground: true,
        isSilentAudioPlaying: true
    ),
    "foreground TCP pipeline should continue in the background while silent audio is playing"
)
