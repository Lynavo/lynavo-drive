import Foundation

struct StoredBinding {
    let serverId: String
    let sidecarHost: String
    let port: Int
    let pairingTokenKeychainRef: String
}

struct BindingRecord {
    let deviceId: String
    let deviceName: String?
    let deviceAlias: String?
    let deviceType: String?
    let host: String
    let port: Int
    let pairingId: String
    let pairingTokenKeychainRef: String
    let shareName: String?
    let lastBoundAt: String?
    let wake: String?
}

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
    lastBoundAt: "2026-06-08T03:25:00Z",
    wake: nil
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
    lastBoundAt: "2026-06-08T03:25:00Z",
    wake: nil
)
expect(
    BackgroundHandoffPolicy.resolveBinding(live: nil, persisted: invalid) == nil,
    "background handoff should reject persisted bindings without a server id"
)

expect(
    BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
        isTransitioningToBackground: false,
        isAppInBackground: false
    ),
    "foreground TCP pipeline should continue while the app is foregrounded"
)

expect(
    !BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
        isTransitioningToBackground: true,
        isAppInBackground: false
    ),
    "foreground TCP pipeline should pause after a background transition has started"
)

expect(
    !BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
        isTransitioningToBackground: false,
        isAppInBackground: true
    ),
    "foreground TCP pipeline should not continue while the app is backgrounded"
)
