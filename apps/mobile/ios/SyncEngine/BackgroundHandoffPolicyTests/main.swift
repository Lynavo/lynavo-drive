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
        isSilentAudioPlaying: false,
        canUseBackgroundContinuation: false,
        isAppInBackground: false
    ),
    "foreground TCP pipeline should continue while not transitioning to background"
)
expect(
    !BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
        isTransitioningToBackground: true,
        isSilentAudioPlaying: false,
        canUseBackgroundContinuation: false,
        isAppInBackground: true
    ),
    "foreground TCP pipeline should pause at file boundaries in background without entitlement"
)
expect(
    !BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
        isTransitioningToBackground: true,
        isSilentAudioPlaying: true,
        canUseBackgroundContinuation: false,
        isAppInBackground: true
    ),
    "silent audio must not keep the foreground TCP pipeline alive without entitlement"
)
expect(
    BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
        isTransitioningToBackground: true,
        isSilentAudioPlaying: true,
        canUseBackgroundContinuation: true,
        isAppInBackground: true
    ),
    "foreground TCP pipeline should continue in the background while silent audio is playing"
)

expect(
    !BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
        isTransitioningToBackground: false,
        isSilentAudioPlaying: true,
        canUseBackgroundContinuation: false,
        isAppInBackground: true
    ),
    "passive entitlement expiry should stop silent-audio background continuation even before a transition flag is set"
)

expect(
    !BackgroundHandoffPolicy.canUseBackgroundContinuation(
        snapshot: nil,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ),
    "background continuation should fail closed without an entitlement snapshot"
)

let activeEntitlement = DriveEntitlementSnapshot(
    canUseBackgroundContinuation: true,
    checkedAt: Date(timeIntervalSince1970: 1_799_999_000),
    expiresAt: Date(timeIntervalSince1970: 1_800_000_100)
)
expect(
    BackgroundHandoffPolicy.canUseBackgroundContinuation(
        snapshot: activeEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ),
    "background continuation should be allowed while entitlement is true and unexpired"
)
expect(
    BackgroundHandoffPolicy.backgroundContinuationExpiryDate(
        snapshot: activeEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ) == Date(timeIntervalSince1970: 1_800_000_100),
    "background continuation expiry should use expiresAt when it arrives before checkedAt plus max age"
)

let maxAgeLimitedEntitlement = DriveEntitlementSnapshot(
    canUseBackgroundContinuation: true,
    checkedAt: Date(timeIntervalSince1970: 1_799_900_000),
    expiresAt: Date(timeIntervalSince1970: 1_800_100_000)
)
expect(
    BackgroundHandoffPolicy.backgroundContinuationExpiryDate(
        snapshot: maxAgeLimitedEntitlement,
        now: Date(timeIntervalSince1970: 1_799_901_000)
    ) == Date(timeIntervalSince1970: 1_799_986_400),
    "background continuation expiry should use checkedAt plus max age when it arrives before expiresAt"
)
expect(
    BackgroundHandoffPolicy.backgroundContinuationExpiryDate(
        snapshot: activeEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_100)
    ) == nil,
    "background continuation expiry should not schedule a past or immediate deadline"
)

let disabledEntitlement = DriveEntitlementSnapshot(
    canUseBackgroundContinuation: false,
    checkedAt: Date(timeIntervalSince1970: 1_799_999_000),
    expiresAt: Date(timeIntervalSince1970: 1_800_000_100)
)
expect(
    !BackgroundHandoffPolicy.canUseBackgroundContinuation(
        snapshot: disabledEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ),
    "background continuation should be denied when entitlement is false"
)
expect(
    BackgroundHandoffPolicy.backgroundContinuationExpiryDate(
        snapshot: disabledEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ) == nil,
    "disabled background continuation should not schedule an expiry"
)

let expiredEntitlement = DriveEntitlementSnapshot(
    canUseBackgroundContinuation: true,
    checkedAt: Date(timeIntervalSince1970: 1_799_999_000),
    expiresAt: Date(timeIntervalSince1970: 1_799_999_999)
)
expect(
    !BackgroundHandoffPolicy.canUseBackgroundContinuation(
        snapshot: expiredEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ),
    "background continuation should fail closed after entitlement expiry"
)

let noExpiryEntitlement = DriveEntitlementSnapshot(
    canUseBackgroundContinuation: true,
    checkedAt: Date(timeIntervalSince1970: 1_799_999_000),
    expiresAt: nil
)
expect(
    !BackgroundHandoffPolicy.canUseBackgroundContinuation(
        snapshot: noExpiryEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ),
    "background continuation should fail closed without a usable expiry"
)
expect(
    BackgroundHandoffPolicy.backgroundContinuationExpiryDate(
        snapshot: noExpiryEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ) == nil,
    "background continuation should not schedule expiry without a usable expiresAt"
)

let staleEntitlement = DriveEntitlementSnapshot(
    canUseBackgroundContinuation: true,
    checkedAt: Date(timeIntervalSince1970: 1_799_913_599),
    expiresAt: Date(timeIntervalSince1970: 1_800_000_100)
)
expect(
    !BackgroundHandoffPolicy.canUseBackgroundContinuation(
        snapshot: staleEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ),
    "background continuation should fail closed when entitlement snapshot is stale"
)
expect(
    BackgroundHandoffPolicy.backgroundContinuationExpiryDate(
        snapshot: staleEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ) == nil,
    "stale checkedAt should not schedule background continuation expiry"
)

let futureCheckedAtEntitlement = DriveEntitlementSnapshot(
    canUseBackgroundContinuation: true,
    checkedAt: Date(timeIntervalSince1970: 1_800_000_001),
    expiresAt: Date(timeIntervalSince1970: 1_800_000_100)
)
expect(
    !BackgroundHandoffPolicy.canUseBackgroundContinuation(
        snapshot: futureCheckedAtEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ),
    "background continuation should fail closed when entitlement snapshot checkedAt is in the future"
)
expect(
    BackgroundHandoffPolicy.backgroundContinuationExpiryDate(
        snapshot: futureCheckedAtEntitlement,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ) == nil,
    "future checkedAt should not schedule background continuation expiry"
)

expect(
    BackgroundHandoffPolicy.shouldForceForegroundPipelineYieldAfterEntitlementChange(
        isAppInBackground: true,
        isSyncing: true,
        canUseBackgroundContinuation: false
    ),
    "background entitlement revocation should force the foreground pipeline to yield at file boundaries"
)

expect(
    !BackgroundHandoffPolicy.shouldForceForegroundPipelineYieldAfterEntitlementChange(
        isAppInBackground: false,
        isSyncing: true,
        canUseBackgroundContinuation: false
    ),
    "foreground entitlement changes should not stop foreground LAN sync"
)

expect(
    BackgroundHandoffPolicy.shouldStopBackgroundContinuationRuntime(
        isAppInBackground: true,
        canUseBackgroundContinuation: false
    ),
    "background continuation runtime should stop when a background entitlement passively expires"
)

expect(
    !BackgroundHandoffPolicy.shouldStopBackgroundContinuationRuntime(
        isAppInBackground: false,
        canUseBackgroundContinuation: false
    ),
    "foreground LAN runtime should not be stopped by a missing background continuation entitlement"
)

let missingExpiryBridgeSnapshot = DriveEntitlementSnapshot.fromBridgeParams([
    "canUseBackgroundContinuation": true,
    "checkedAt": "2026-07-01T00:00:00.000Z"
])
expect(
    !BackgroundHandoffPolicy.canUseBackgroundContinuation(
        snapshot: missingExpiryBridgeSnapshot,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ),
    "bridge snapshots missing expiresAt should install as fail-closed, not throw and keep the old entitlement"
)

let invalidBridgeSnapshot = DriveEntitlementSnapshot.fromBridgeParams([
    "canUseBackgroundContinuation": "yes",
    "checkedAt": "not-a-date",
    "expiresAt": "also-not-a-date"
])
expect(
    !BackgroundHandoffPolicy.canUseBackgroundContinuation(
        snapshot: invalidBridgeSnapshot,
        now: Date(timeIntervalSince1970: 1_800_000_000)
    ),
    "invalid bridge snapshots should install as fail-closed"
)

expect(
    !BackgroundHandoffPolicy.shouldSubmitBackgroundContinuedTask(
        canUseBackgroundContinuation: false
    ),
    "continued BGProcessing task should not be submitted without background entitlement"
)

expect(
    !BackgroundHandoffPolicy.shouldRunBackgroundIncrementalScan(
        canUseBackgroundContinuation: false,
        autoUploadActive: true
    ),
    "background incremental scan should not run without background entitlement"
)

expect(
    BackgroundHandoffPolicy.shouldRunBackgroundIncrementalScan(
        canUseBackgroundContinuation: true,
        autoUploadActive: true
    ),
    "background incremental scan should run only when entitlement and auto upload are active"
)
