import Foundation

enum PresenceReconnectPolicy {
    static let fastDelayedProbeIntervalAfterRecoveryExhausted: TimeInterval = 5
    static let steadyDelayedProbeIntervalAfterRecoveryExhausted: TimeInterval = 30
    static let maxFastDelayedProbeFailures = 6

    static func delayedProbeIntervalAfterRecoveryExhausted(
        consecutiveDelayedProbeFailures: Int
    ) -> TimeInterval {
        consecutiveDelayedProbeFailures < maxFastDelayedProbeFailures
            ? fastDelayedProbeIntervalAfterRecoveryExhausted
            : steadyDelayedProbeIntervalAfterRecoveryExhausted
    }

    static func shouldProbeWhenDiscoveryAlreadyBrowsing(
        hasBinding: Bool,
        isDiscoveryBrowsing: Bool,
        bindingState: String,
        presenceHost: String?
    ) -> Bool {
        hasBinding &&
            isOfflineReconnectState(bindingState) &&
            isDiscoveryBrowsing &&
            hasUsablePresenceHost(presenceHost)
    }

    static func shouldScheduleDelayedProbeAfterRecoveryExhausted(
        hasBinding: Bool,
        isDiscoveryBrowsing: Bool,
        bindingState: String,
        presenceHost: String?
    ) -> Bool {
        hasBinding &&
            bindingState == "offline" &&
            isDiscoveryBrowsing &&
            hasUsablePresenceHost(presenceHost)
    }

    static func presenceResponseMatchesBinding(
        expectedDeviceId: String,
        responseServerId: String?,
        responsePaired: Bool? = nil,
        responseDesktopAvailable: Bool? = nil
    ) -> Bool {
        let expected = expectedDeviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        let actual = responseServerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if responsePaired == false {
            return false
        }
        if responseDesktopAvailable == false {
            return false
        }
        return !expected.isEmpty && actual == expected
    }

    static func shouldRetryPresenceHeartbeatWhileOffline(reason: String?) -> Bool {
        reason?.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix("_desktop_unavailable") == true
    }

    static func shouldInvalidatePairing(
        responsePaired: Bool?,
        expectedDeviceId: String? = nil,
        responseServerId: String? = nil,
        tokenMissingForPersistedBinding: Bool,
        authRejected: Bool
    ) -> Bool {
        (responsePaired == false &&
            responseIdentityMatchesExpected(
                expectedDeviceId: expectedDeviceId,
                responseServerId: responseServerId
            )) ||
            tokenMissingForPersistedBinding ||
            authRejected
    }

    static func authRejectionMatchesCurrentBinding(
        pairingTargetDeviceId: String,
        currentBindingDeviceId: String?
    ) -> Bool {
        let target = pairingTargetDeviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        let current = currentBindingDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !target.isEmpty && target == current
    }

    static func isPairingInvalidationControlReason(_ reason: String?) -> Bool {
        switch reason?.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "connection_code_regenerated", "connection_code_set":
            return true
        default:
            return false
        }
    }

    static func shouldMaintainPairingControlConnection(
        connectionState: String,
        syncInProgress: Bool,
        bindingDeviceId: String?,
        bindingPairingToken: String?,
        activeControlDeviceId: String?,
        activeControlPairingToken: String?
    ) -> Bool {
        guard connectionState.trimmingCharacters(in: .whitespacesAndNewlines) == "connected",
              !syncInProgress else {
            return false
        }

        let deviceId = bindingDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let pairingToken = bindingPairingToken?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !deviceId.isEmpty, !pairingToken.isEmpty else {
            return false
        }

        let activeDeviceId = activeControlDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let activePairingToken = activeControlPairingToken?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if activeDeviceId.isEmpty && activePairingToken.isEmpty {
            return true
        }

        return activeDeviceId == deviceId && activePairingToken == pairingToken
    }

    static func shouldSuppressGenericSyncPipelineErrorAfterPairingInvalidation(
        receivedPairingInvalidationControlFrame: Bool
    ) -> Bool {
        receivedPairingInvalidationControlFrame
    }

    static func shouldRunScheduledPairingControlRestart(
        scheduledGenerationMatchesCurrent: Bool,
        currentDeviceId: String?,
        currentPairingToken: String?,
        expectedDeviceId: String?,
        expectedPairingToken: String?
    ) -> Bool {
        guard scheduledGenerationMatchesCurrent else {
            return false
        }

        let currentDevice = currentDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let currentToken = currentPairingToken?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let expectedDevice = expectedDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let expectedToken = expectedPairingToken?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !currentDevice.isEmpty &&
            !currentToken.isEmpty &&
            currentDevice == expectedDevice &&
            currentToken == expectedToken
    }

    static func shouldClearCurrentBindingForPairingInvalidation(
        currentDeviceId: String?,
        currentPairingToken: String?,
        expectedDeviceId: String?,
        expectedPairingToken: String?,
        existingInvalidationReason: String?
    ) -> Bool {
        if existingInvalidationReason?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            return false
        }

        let currentDevice = currentDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let expectedDevice = expectedDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !currentDevice.isEmpty,
              !expectedDevice.isEmpty,
              currentDevice == expectedDevice else {
            return false
        }

        let currentToken = currentPairingToken?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let expectedToken = expectedPairingToken?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if expectedToken.isEmpty {
            return currentToken.isEmpty
        }

        return currentToken == expectedToken
    }

    static func shouldApplyPairingInvalidationStorageMutation(
        currentDeviceId: String?,
        currentPairingToken: String?,
        expectedDeviceId: String?,
        expectedPairingToken: String?,
        existingInvalidationReason: String?
    ) -> Bool {
        shouldClearCurrentBindingForPairingInvalidation(
            currentDeviceId: currentDeviceId,
            currentPairingToken: currentPairingToken,
            expectedDeviceId: expectedDeviceId,
            expectedPairingToken: expectedPairingToken,
            existingInvalidationReason: existingInvalidationReason
        )
    }

    private static func isOfflineReconnectState(_ bindingState: String) -> Bool {
        bindingState == "offline" || bindingState == "bound"
    }

    private static func responseIdentityMatchesExpected(
        expectedDeviceId: String?,
        responseServerId: String?
    ) -> Bool {
        let expected = expectedDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let actual = responseServerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !expected.isEmpty && actual == expected
    }

    private static func hasUsablePresenceHost(_ presenceHost: String?) -> Bool {
        let value = presenceHost?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return isPrivateLANIPv4(value)
    }

    private static func isPrivateLANIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".")
        guard parts.count == 4 else { return false }
        let octets = parts.compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else {
            return false
        }

        return octets[0] == 10 ||
            (octets[0] == 172 && (16...31).contains(octets[1])) ||
            (octets[0] == 192 && octets[1] == 168)
    }
}
