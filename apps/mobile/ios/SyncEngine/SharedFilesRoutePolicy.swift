import Foundation

enum SharedFilesRoutePolicy {
    static let sharedFileListRequestTimeout: TimeInterval = 15
    static let sharedFileDownloadRequestTimeout: TimeInterval = 300
    static let sharedFileDownloadResourceTimeout: TimeInterval = 86_400
    static let sharedFileTunnelHeartbeatGracePeriod: TimeInterval = 3
    static let sharedFileDownloadMaxAttempts = 4
    private static let sharedFilePathSegmentAllowedCharacters: CharacterSet = {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return allowed
    }()

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

    static func shouldPublishLANReachabilityFromDiscovery(
        hasFreshLANHost: Bool
    ) -> Bool {
        hasFreshLANHost
    }

    static func shouldPreferLANRoute(
        hasReachableLANHost: Bool,
        isTunnelActive _: Bool
    ) -> Bool {
        hasReachableLANHost
    }

    static func shouldProbeFallbackDirectLANBeforeP2P(
        hasFreshLANHost: Bool
    ) -> Bool {
        !hasFreshLANHost
    }

    static func shouldPublishP2PReachabilityFromTunnel(
        hasActiveTunnel: Bool,
        hasReachableLANHost: Bool
    ) -> Bool {
        hasActiveTunnel && !hasReachableLANHost
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

    static func shouldRetryDownloadOnTunnelAfterFailure(isTunnelRoute: Bool) -> Bool {
        isTunnelRoute
    }

    static func resumeOffsetForPartialDownload(existingBytes: Int64) -> Int64 {
        max(0, existingBytes)
    }

    static func shouldUseRangeRequest(resumeOffset: Int64) -> Bool {
        resumeOffset > 0
    }

    static func totalDownloadedBytes(existingBytes: Int64, receivedBytes: Int64) -> Int64 {
        max(0, existingBytes) + max(0, receivedBytes)
    }

    static func canResumePartialDownload(
        existingBytes: Int64,
        validator: String?,
        expectedBytes: Int64?
    ) -> Bool {
        guard existingBytes > 0,
              normalizedHost(validator) != nil
        else {
            return false
        }
        guard let expectedBytes else {
            return true
        }
        return existingBytes < expectedBytes
    }

    static func shouldRetrySharedFileDownloadFailure(isLocalSaveFailure: Bool) -> Bool {
        !isLocalSaveFailure
    }

    static func encodedSharedFilePath(_ path: String) -> String {
        let normalizedPath = path
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        return normalizedPath
            .split(separator: "/", omittingEmptySubsequences: true)
            .filter { !String($0).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .map { segment in
                String(segment).addingPercentEncoding(
                    withAllowedCharacters: sharedFilePathSegmentAllowedCharacters
                ) ?? ""
            }
            .joined(separator: "/")
    }

    static func shouldWaitForP2PTunnelRoute(
        hasTunnelCredentials: Bool,
        isTunnelActive: Bool
    ) -> Bool {
        hasTunnelCredentials && !isTunnelActive
    }

    static func shouldAttemptWake(
        scope: String,
        path: String,
        operation: String
    ) -> Bool {
        let normalizedScope = scope.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedOperation = operation.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedPath = path.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return normalizedScope == "personal" &&
            normalizedOperation == "list" &&
            normalizedPath.isEmpty
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

    static func shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
        reason: String,
        reachabilityState: String?,
        reachabilityRoute: String?,
        isTunnelActive: Bool,
        isTunnelStarting: Bool
    ) -> Bool {
        guard reason == "presence_recovery_exhausted" else { return false }
        guard reachabilityState == "available" else { return false }
        guard reachabilityRoute == "tunnel" || reachabilityRoute == "relay" else { return false }
        return isTunnelActive || isTunnelStarting
    }

    static func shouldClearLANReachabilityOnPresenceRecoveryStart(
        reachabilityState: String?,
        reachabilityRoute: String?
    ) -> Bool {
        reachabilityState == "available" && reachabilityRoute == "lan"
    }
}
