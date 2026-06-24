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
        responsePaired: Bool? = nil
    ) -> Bool {
        let expected = expectedDeviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        let actual = responseServerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if responsePaired == false {
            return false
        }
        return !expected.isEmpty && actual == expected
    }

    static func shouldInvalidatePairing(
        responsePaired: Bool?,
        tokenMissingForPersistedBinding: Bool,
        authRejected: Bool
    ) -> Bool {
        responsePaired == false || tokenMissingForPersistedBinding || authRejected
    }

    private static func isOfflineReconnectState(_ bindingState: String) -> Bool {
        bindingState == "offline" || bindingState == "bound"
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
