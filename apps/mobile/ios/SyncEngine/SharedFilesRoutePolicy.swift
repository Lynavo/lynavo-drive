import Foundation

enum SharedFilesRoutePolicy {
    static let sharedFileListRequestTimeout: TimeInterval = 15
    static let sharedFileDownloadRequestTimeout: TimeInterval = 300
    static let sharedFileDownloadResourceTimeout: TimeInterval = 86_400
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

    static func shouldPreferLANRoute(hasReachableLANHost: Bool) -> Bool {
        hasReachableLANHost
    }

    static func shouldProbeFallbackDirectLANAfterDiscovery(
        hasFreshLANHost: Bool
    ) -> Bool {
        !hasFreshLANHost
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

    static func diagnosticNetworkPathSummary(_ snapshot: [String: Any]) -> String {
        let status = stringValue(snapshot["status"])
        let interfaces = networkInterfacesSummary(snapshot["interfaces"])
        return [
            "status=\(status)",
            "interfaces=[\(interfaces)]",
            "wifi=\(boolValue(snapshot["usesWiFi"]))",
            "cellular=\(boolValue(snapshot["usesCellular"]))",
            "wired=\(boolValue(snapshot["usesWiredEthernet"]))",
            "expensive=\(boolValue(snapshot["isExpensive"]))",
            "constrained=\(boolValue(snapshot["isConstrained"]))",
            "supportsIPv4=\(boolValue(snapshot["supportsIPv4"]))",
            "supportsIPv6=\(boolValue(snapshot["supportsIPv6"]))",
            "supportsDNS=\(boolValue(snapshot["supportsDNS"]))",
        ].joined(separator: " ")
    }

    private static func networkInterfacesSummary(_ value: Any?) -> String {
        guard let interfaces = value as? [[String: Any]], !interfaces.isEmpty else {
            return ""
        }
        return interfaces
            .map { iface in
                "\(stringValue(iface["name"]))(\(stringValue(iface["type"])))"
            }
            .joined(separator: ",")
    }

    private static func stringValue(_ value: Any?) -> String {
        if let value = value as? String {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? "unknown" : trimmed
        }
        return "unknown"
    }

    private static func boolValue(_ value: Any?) -> String {
        if let value = value as? Bool {
            return value ? "true" : "false"
        }
        if let value = value as? NSNumber {
            return value.boolValue ? "true" : "false"
        }
        return "unknown"
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

    static func shouldAttemptLANWake(
        allowWake: Bool
    ) -> Bool {
        allowWake
    }

    static func wakeLANReachableReason(baseReason: String) -> String {
        "\(baseReason)_wake_lan_reachable"
    }

    static func wakeFullResumeConfirmedReason(baseReason: String) -> String {
        "\(baseReason)_wake_full_resume_confirmed"
    }

    static func shouldPromoteBindingConnectedFromReachability(
        presenceConfirmed: Bool,
        fullResumeConfirmed: Bool
    ) -> Bool {
        presenceConfirmed || fullResumeConfirmed
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

    static func shouldClearLANReachabilityOnPresenceRecoveryStart(
        reachabilityState: String?,
        reachabilityRoute: String?
    ) -> Bool {
        reachabilityState == "available" && reachabilityRoute == "lan"
    }
}
