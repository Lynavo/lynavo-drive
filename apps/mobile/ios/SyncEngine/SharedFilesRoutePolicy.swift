import Foundation

enum SharedFilesRoutePolicy {
    static let p2pTunnelRouteModeAll = "all"
    static let p2pTunnelRouteModeWAN = "wan"
    static let p2pTunnelRouteModeRelay = "relay"

    static let sharedFileListRequestTimeout: TimeInterval = 15
    static let sharedFileDownloadRequestTimeout: TimeInterval = 300
    static let sharedFileDownloadResourceTimeout: TimeInterval = 86_400
    static let sharedFileTunnelHeartbeatGracePeriod: TimeInterval = 3
    static let sharedFileTunnelRouteWaitTimeout: TimeInterval = 4
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

    static func hasUsableDirectRouteHost(_ host: String?) -> Bool {
        normalizedHost(host) != nil
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
        shouldRetrySharedFileDownloadFailure(isLocalSaveFailure: isLocalSaveFailure, httpStatusCode: nil)
    }

    static func shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure: Bool,
        httpStatusCode: Int?
    ) -> Bool {
        if isLocalSaveFailure {
            return false
        }
        guard let httpStatusCode else {
            return true
        }
        return httpStatusCode == 408 ||
            httpStatusCode == 429 ||
            (500...599).contains(httpStatusCode)
    }

    static func encodedSharedFilePath(_ path: String) -> String {
        let normalizedPath = path
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        return normalizedPath
            .split(separator: "/", omittingEmptySubsequences: true)
            .map { segment in
                String(segment).addingPercentEncoding(
                    withAllowedCharacters: sharedFilePathSegmentAllowedCharacters
                ) ?? ""
            }
            .joined(separator: "/")
    }

    static func shouldWaitForP2PTunnelRoute(
        hasTunnelCredentials: Bool,
        isTunnelActive: Bool,
        hasUsableDirectRouteHost: Bool
    ) -> Bool {
        hasTunnelCredentials && !isTunnelActive && !hasUsableDirectRouteHost
    }

    static func shouldAcceptActiveP2PTunnelRoute(
        isTunnelActive: Bool,
        hasTunnelPort: Bool,
        selectedICERoute: String,
        hasReachableLANHost: Bool
    ) -> Bool {
        guard isTunnelActive, hasTunnelPort else {
            return false
        }

        let normalizedRoute = selectedICERoute.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalizedRoute == "turn_relay" ||
            normalizedRoute == "ipv6_direct" ||
            normalizedRoute == "public_ipv4_direct" ||
            normalizedRoute == "direct_reflexive" {
            return true
        }
        return hasReachableLANHost
    }

    static func nextP2PTunnelRouteModeAfterRejectedRoute(
        currentRouteMode: String,
        selectedICERoute _: String
    ) -> String {
        switch currentRouteMode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case p2pTunnelRouteModeRelay:
            return p2pTunnelRouteModeRelay
        case p2pTunnelRouteModeWAN:
            return p2pTunnelRouteModeRelay
        default:
            return p2pTunnelRouteModeWAN
        }
    }

    static func tunnelOptionsJSON(iceServersJSON: String, routeMode: String) -> String {
        let normalizedRouteMode = routeMode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let trimmedIceServers = iceServersJSON.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedRouteMode != p2pTunnelRouteModeAll else {
            return trimmedIceServers
        }

        let iceServersValue: Any
        if let data = trimmedIceServers.data(using: .utf8),
           let decoded = try? JSONSerialization.jsonObject(with: data) {
            iceServersValue = decoded
        } else {
            iceServersValue = []
        }
        let payload: [String: Any] = [
            "routeMode": normalizedRouteMode,
            "iceServers": iceServersValue,
        ]
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let encoded = String(data: data, encoding: .utf8)
        else {
            return trimmedIceServers
        }
        return encoded
    }

    static func shouldContinueWaitingForP2PTunnelRoute(
        hasTunnelCredentials: Bool,
        isTunnelActive: Bool,
        isRouteAcceptable: Bool
    ) -> Bool {
        hasTunnelCredentials && (!isTunnelActive || !isRouteAcceptable)
    }

    static func shouldAttemptWake(
        scope: String,
        path: String,
        operation: String
    ) -> Bool {
        let normalizedScope = scope.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedOperation = operation.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedPath = path
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let hasTraversalSegment = normalizedPath
            .replacingOccurrences(of: "\\", with: "/")
            .split(separator: "/", omittingEmptySubsequences: true)
            .contains("..")
        return normalizedScope == "personal" &&
            normalizedOperation == "list" &&
            normalizedPath.isEmpty &&
            !hasTraversalSegment
    }

    static func shouldAttemptWakeBeforeP2PFallback(
        allowWake: Bool,
        hasActiveTunnel: Bool
    ) -> Bool {
        allowWake && !hasActiveTunnel
    }

    static func shouldAllowPublicWake(
        scope: String,
        path: String,
        operation: String,
        trigger: String
    ) -> Bool {
        shouldAttemptWake(scope: scope, path: path, operation: operation) &&
            trigger == "shared_files_root_browse"
    }

    static func peerProxySkipReasons(
        hasMultiDesktopBindingSource: Bool,
        hasOnlineViviDropDesktopPeer: Bool,
        hasThirdPartyHelperConfigured: Bool
    ) -> [String] {
        var reasons: [String] = []
        if !hasMultiDesktopBindingSource {
            reasons.append("no_multi_desktop_binding_source")
        }
        if !hasOnlineViviDropDesktopPeer {
            reasons.append("no_online_vividrop_desktop_peer")
        }
        if !hasThirdPartyHelperConfigured {
            reasons.append("third_party_helper_not_configured")
        }
        return reasons
    }

    static func shouldAttemptPeerProxyWake(
        hasMultiDesktopBindingSource: Bool,
        hasOnlineViviDropDesktopPeer: Bool
    ) -> Bool {
        hasMultiDesktopBindingSource && hasOnlineViviDropDesktopPeer
    }

    static func wakeLANReachableReason(baseReason: String) -> String {
        "\(baseReason)_wake_lan_reachable"
    }

    static func wakeFullResumeConfirmedReason(baseReason: String) -> String {
        "\(baseReason)_wake_full_resume_confirmed"
    }

    static func isFullWakeConfirmed(
        lastResumeAt: Date,
        wakeAttemptStartedAt: Date
    ) -> Bool {
        lastResumeAt > wakeAttemptStartedAt
    }

    static func isFullWakeConfirmed(
        expectedDeviceId: String,
        responseServerId: String?,
        lastResumeAt: Date,
        wakeAttemptStartedAt: Date
    ) -> Bool {
        PresenceReconnectPolicy.presenceResponseMatchesBinding(
            expectedDeviceId: expectedDeviceId,
            responseServerId: responseServerId
        ) &&
            isFullWakeConfirmed(
                lastResumeAt: lastResumeAt,
                wakeAttemptStartedAt: wakeAttemptStartedAt
            )
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
