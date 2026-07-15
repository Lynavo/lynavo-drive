import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("PresenceReconnectPolicyTests failed: \(message)\n", stderr)
        exit(1)
    }
}

expect(
    PresenceReconnectPolicy.shouldProbeWhenDiscoveryAlreadyBrowsing(
        hasBinding: true,
        isDiscoveryBrowsing: true,
        bindingState: "offline",
        presenceHost: "172.16.20.108"
    ),
    "startDiscovery must probe the bound desktop when discovery is already browsing and the binding is offline"
)

expect(
    PresenceReconnectPolicy.shouldScheduleDelayedProbeAfterRecoveryExhausted(
        hasBinding: true,
        isDiscoveryBrowsing: true,
        bindingState: "offline",
        presenceHost: "172.16.20.108"
    ),
    "presence recovery exhaustion must schedule another LAN probe even when discovery is already browsing"
)

expect(
    !PresenceReconnectPolicy.shouldProbeWhenDiscoveryAlreadyBrowsing(
        hasBinding: true,
        isDiscoveryBrowsing: true,
        bindingState: "connected",
        presenceHost: "172.16.20.108"
    ),
    "connected bindings should stay on the normal heartbeat path instead of starting extra reconnect probes"
)

expect(
    !PresenceReconnectPolicy.shouldScheduleDelayedProbeAfterRecoveryExhausted(
        hasBinding: false,
        isDiscoveryBrowsing: true,
        bindingState: "offline",
        presenceHost: "172.16.20.108"
    ),
    "unbound mobile apps must not run desktop reconnect probes"
)

expect(
    !PresenceReconnectPolicy.shouldProbeWhenDiscoveryAlreadyBrowsing(
        hasBinding: true,
        isDiscoveryBrowsing: true,
        bindingState: "offline",
        presenceHost: nil
    ),
    "offline reconnect probes need a usable presence host"
)

expect(
    !PresenceReconnectPolicy.shouldProbeWhenDiscoveryAlreadyBrowsing(
        hasBinding: true,
        isDiscoveryBrowsing: true,
        bindingState: "offline",
        presenceHost: "8.8.8.8"
    ),
    "offline reconnect probes must stay scoped to private LAN hosts"
)

expect(
    PresenceReconnectPolicy.presenceResponseMatchesBinding(
        expectedDeviceId: "desktop-1",
        responseServerId: "desktop-1",
        responsePaired: true
    ),
    "presence responses from the bound desktop should pass identity validation"
)

expect(
    PresenceReconnectPolicy.presenceResponseMatchesBinding(
        expectedDeviceId: "desktop-1",
        responseServerId: "desktop-1",
        responsePaired: nil
    ),
    "presence responses from older desktops without paired must keep passing identity validation"
)

expect(
    !PresenceReconnectPolicy.presenceResponseMatchesBinding(
        expectedDeviceId: "desktop-1",
        responseServerId: "desktop-2",
        responsePaired: true
    ),
    "presence responses from a different desktop must not mark the binding connected"
)

expect(
    !PresenceReconnectPolicy.presenceResponseMatchesBinding(
        expectedDeviceId: "desktop-1",
        responseServerId: nil,
        responsePaired: true
    ),
    "presence responses without serverId must not mark the binding connected"
)

expect(
    !PresenceReconnectPolicy.presenceResponseMatchesBinding(
        expectedDeviceId: "desktop-1",
        responseServerId: "desktop-1",
        responsePaired: false
    ),
    "presence responses from an unpaired desktop must not keep the mobile binding connected"
)

expect(
    !PresenceReconnectPolicy.presenceResponseMatchesBinding(
        expectedDeviceId: "desktop-1",
        responseServerId: "desktop-1",
        responsePaired: true,
        responseDesktopAvailable: false
    ),
    "presence responses from a logged-out desktop must not keep the mobile binding connected"
)

expect(
    PresenceReconnectPolicy.shouldRetryPresenceHeartbeatWhileOffline(
        reason: "presence_heartbeat_timer_desktop_unavailable"
    ),
    "desktop unavailable offline should keep lightweight presence retry eligible"
)

expect(
    PresenceReconnectPolicy.shouldRetryPresenceHeartbeatWhileOffline(
        reason: " presence_recovery_failed_desktop_unavailable "
    ),
    "trimmed desktop unavailable offline should keep lightweight presence retry eligible"
)

expect(
    !PresenceReconnectPolicy.shouldRetryPresenceHeartbeatWhileOffline(
        reason: "presence_heartbeat_timer_unpaired"
    ),
    "unpaired offline must not keep presence retry eligible"
)

expect(
    !PresenceReconnectPolicy.shouldRetryPresenceHeartbeatWhileOffline(
        reason: "presence_heartbeat_timer_server_mismatch"
    ),
    "server mismatch offline must not keep presence retry eligible"
)

expect(
    !PresenceReconnectPolicy.shouldRetryPresenceHeartbeatWhileOffline(
        reason: "presence_recovery_exhausted"
    ),
    "generic recovery exhaustion must not keep presence retry eligible"
)

expect(
    !PresenceReconnectPolicy.shouldRetryPresenceHeartbeatWhileOffline(reason: ""),
    "blank offline reason must not keep presence retry eligible"
)

expect(
    PresenceReconnectPolicy.shouldInvalidatePairing(
        responsePaired: false,
        expectedDeviceId: "desktop-1",
        responseServerId: "desktop-1",
        tokenMissingForPersistedBinding: false,
        authRejected: false
    ),
    "presence paired:false is explicit invalidation evidence"
)

expect(
    !PresenceReconnectPolicy.shouldInvalidatePairing(
        responsePaired: false,
        expectedDeviceId: "desktop-1",
        responseServerId: "desktop-2",
        tokenMissingForPersistedBinding: false,
        authRejected: false
    ),
    "presence paired:false from a different desktop is server mismatch, not current binding invalidation"
)

expect(
    PresenceReconnectPolicy.shouldInvalidatePairing(
        responsePaired: nil,
        tokenMissingForPersistedBinding: true,
        authRejected: false
    ),
    "missing pairing token for a persisted binding is explicit invalidation evidence"
)

expect(
    PresenceReconnectPolicy.shouldInvalidatePairing(
        responsePaired: nil,
        tokenMissingForPersistedBinding: false,
        authRejected: true
    ),
    "stored-token auth rejection is explicit invalidation evidence"
)

expect(
    !PresenceReconnectPolicy.shouldInvalidatePairing(
        responsePaired: nil,
        tokenMissingForPersistedBinding: false,
        authRejected: false
    ),
    "generic offline evidence must not invalidate pairing"
)

expect(
    PresenceReconnectPolicy.isPairingInvalidationControlReason("connection_code_regenerated"),
    "desktop regenerated pairing code control frame should invalidate pairing"
)

expect(
    PresenceReconnectPolicy.isPairingInvalidationControlReason(" connection_code_set "),
    "desktop set pairing code control frame should invalidate pairing"
)

expect(
    !PresenceReconnectPolicy.isPairingInvalidationControlReason("offline"),
    "generic offline control reason must not invalidate pairing"
)

expect(
    !PresenceReconnectPolicy.isPairingInvalidationControlReason(""),
    "blank control reason must not invalidate pairing"
)

expect(
    PresenceReconnectPolicy.shouldMaintainPairingControlConnection(
        connectionState: "connected",
        syncInProgress: false,
        bindingDeviceId: "desktop-1",
        bindingPairingToken: "token-1",
        activeControlDeviceId: nil,
        activeControlPairingToken: nil
    ),
    "idle connected bindings should maintain a pairing control connection"
)

expect(
    PresenceReconnectPolicy.shouldMaintainPairingControlConnection(
        connectionState: "connected",
        syncInProgress: false,
        bindingDeviceId: "desktop-1",
        bindingPairingToken: "token-1",
        activeControlDeviceId: "desktop-1",
        activeControlPairingToken: "token-1"
    ),
    "the current pairing control connection should remain valid for the same binding identity"
)

expect(
    !PresenceReconnectPolicy.shouldMaintainPairingControlConnection(
        connectionState: "connected",
        syncInProgress: true,
        bindingDeviceId: "desktop-1",
        bindingPairingToken: "token-1",
        activeControlDeviceId: "desktop-1",
        activeControlPairingToken: "token-1"
    ),
    "active sync upload sessions already receive pairing invalidation frames"
)

expect(
    !PresenceReconnectPolicy.shouldMaintainPairingControlConnection(
        connectionState: "offline",
        syncInProgress: false,
        bindingDeviceId: "desktop-1",
        bindingPairingToken: "token-1",
        activeControlDeviceId: nil,
        activeControlPairingToken: nil
    ),
    "offline bindings should not keep an idle pairing control connection open"
)

expect(
    !PresenceReconnectPolicy.shouldMaintainPairingControlConnection(
        connectionState: "connected",
        syncInProgress: false,
        bindingDeviceId: "desktop-1",
        bindingPairingToken: "token-1",
        activeControlDeviceId: "desktop-2",
        activeControlPairingToken: "token-1"
    ),
    "a pairing control connection for another desktop is stale"
)

expect(
    PresenceReconnectPolicy.shouldSuppressGenericSyncPipelineErrorAfterPairingInvalidation(
        receivedPairingInvalidationControlFrame: true
    ),
    "pairing invalidation should terminate the upload round without a generic sync pipeline error"
)

expect(
    PresenceReconnectPolicy.shouldRunScheduledPairingControlRestart(
        scheduledGenerationMatchesCurrent: true,
        currentDeviceId: "desktop-1",
        currentPairingToken: "token-1",
        expectedDeviceId: "desktop-1",
        expectedPairingToken: "token-1"
    ),
    "scheduled pairing control restart should run when generation and binding identity still match"
)

expect(
    !PresenceReconnectPolicy.shouldRunScheduledPairingControlRestart(
        scheduledGenerationMatchesCurrent: false,
        currentDeviceId: "desktop-1",
        currentPairingToken: "token-1",
        expectedDeviceId: "desktop-1",
        expectedPairingToken: "token-1"
    ),
    "scheduled pairing control restart must not run after a newer generation superseded it"
)

expect(
    !PresenceReconnectPolicy.shouldRunScheduledPairingControlRestart(
        scheduledGenerationMatchesCurrent: true,
        currentDeviceId: "desktop-1",
        currentPairingToken: "token-2",
        expectedDeviceId: "desktop-1",
        expectedPairingToken: "token-1"
    ),
    "scheduled pairing control restart must not run after the binding token changed"
)

expect(
    PresenceReconnectPolicy.authRejectionMatchesCurrentBinding(
        pairingTargetDeviceId: "desktop-1",
        currentBindingDeviceId: "desktop-1"
    ),
    "stored-token auth rejection for the current bound desktop should invalidate the current binding"
)

expect(
    !PresenceReconnectPolicy.authRejectionMatchesCurrentBinding(
        pairingTargetDeviceId: "desktop-2",
        currentBindingDeviceId: "desktop-1"
    ),
    "stored-token auth rejection while switching to another desktop must not invalidate the current binding"
)

expect(
    !PresenceReconnectPolicy.authRejectionMatchesCurrentBinding(
        pairingTargetDeviceId: "desktop-2",
        currentBindingDeviceId: nil
    ),
    "stored-token auth rejection without a current binding must not invalidate the current binding"
)

expect(
    !PresenceReconnectPolicy.shouldApplyPairingInvalidationStorageMutation(
        currentDeviceId: "desktop-1",
        currentPairingToken: "new-token",
        expectedDeviceId: "desktop-1",
        expectedPairingToken: "old-token",
        existingInvalidationReason: nil
    ),
    "pairing invalidation storage mutation must not clear a newly re-paired binding for the same desktop"
)

expect(
    PresenceReconnectPolicy.shouldApplyPairingInvalidationStorageMutation(
        currentDeviceId: "desktop-1",
        currentPairingToken: "token-1",
        expectedDeviceId: "desktop-1",
        expectedPairingToken: "token-1",
        existingInvalidationReason: nil
    ),
    "pairing invalidation storage mutation should clear the current binding when device and token still match"
)

expect(
    !PresenceReconnectPolicy.shouldApplyPairingInvalidationStorageMutation(
        currentDeviceId: nil,
        currentPairingToken: nil,
        expectedDeviceId: "desktop-1",
        expectedPairingToken: "token-1",
        existingInvalidationReason: "presence_unpaired"
    ),
    "pairing invalidation storage mutation should be idempotent after the binding was already cleared"
)

expect(
    PresenceReconnectPolicy.delayedProbeIntervalAfterRecoveryExhausted(consecutiveDelayedProbeFailures: 0) == 5,
    "first delayed LAN probe after recovery exhaustion should run quickly"
)

expect(
    PresenceReconnectPolicy.delayedProbeIntervalAfterRecoveryExhausted(consecutiveDelayedProbeFailures: 5) == 5,
    "early delayed LAN probe failures should keep the fast reconnect cadence"
)

expect(
    PresenceReconnectPolicy.delayedProbeIntervalAfterRecoveryExhausted(consecutiveDelayedProbeFailures: 6) == 30,
    "delayed LAN probes should back off after repeated failures"
)
