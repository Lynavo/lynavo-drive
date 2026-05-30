import Foundation

enum SharedFilesRoutePolicy {
    static let sharedFileListRequestTimeout: TimeInterval = 15
    static let sharedFileDownloadRequestTimeout: TimeInterval = 300
    static let sharedFileDownloadResourceTimeout: TimeInterval = 86_400
    static let sharedFileTunnelHeartbeatGracePeriod: TimeInterval = 3

    private static func normalizedHost(_ host: String?) -> String? {
        let value = host?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value
    }

    private static func ipv4Octets(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".")
        guard parts.count == 4 else { return nil }
        let octets = parts.compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else {
            return nil
        }
        return octets
    }

    static func isPrivateLANIPv4(_ host: String) -> Bool {
        guard let octets = ipv4Octets(host) else { return false }
        return octets[0] == 10 ||
            (octets[0] == 172 && (16...31).contains(octets[1])) ||
            (octets[0] == 192 && octets[1] == 168)
    }

    static func freshLANHost(discoveredHost: String?) -> String? {
        guard let host = normalizedHost(discoveredHost),
              isPrivateLANIPv4(host)
        else {
            return nil
        }
        return host
    }

    static func fallbackDirectHost(
        liveHost: String?,
        currentBindingHost: String?,
        persistedHost: String?
    ) -> String? {
        for host in [liveHost, currentBindingHost, persistedHost] {
            if let normalized = normalizedHost(host) {
                return normalized
            }
        }
        return nil
    }

    static func shouldInvalidateTunnelAfterRouteFailure(isTunnelRoute: Bool) -> Bool {
        isTunnelRoute
    }

    static func shouldWaitForP2PTunnelRoute(
        hasTunnelCredentials: Bool,
        isTunnelActive: Bool
    ) -> Bool {
        hasTunnelCredentials && !isTunnelActive
    }

    static func shouldSuppressPresenceTunnelFailure(
        isTunnelRoute: Bool,
        activeSharedFileTunnelOperations: Int,
        secondsSinceLastSharedFileTunnelOperation: TimeInterval? = nil
    ) -> Bool {
        guard isTunnelRoute else { return false }
        if activeSharedFileTunnelOperations > 0 {
            return true
        }
        guard let secondsSinceLastSharedFileTunnelOperation else {
            return false
        }
        return secondsSinceLastSharedFileTunnelOperation >= 0 &&
            secondsSinceLastSharedFileTunnelOperation <= sharedFileTunnelHeartbeatGracePeriod
    }
}
