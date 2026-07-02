import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("SharedFilesRoutePolicyTests failed: \(message)\n", stderr)
        exit(1)
    }
}

expect(
    SharedFilesRoutePolicy.sharedFileListRequestTimeout == 15,
    "shared-file list requests should fail quickly on unavailable LAN routes"
)

expect(
    SharedFilesRoutePolicy.sharedFileDownloadRequestTimeout == 300,
    "shared-file download requests must allow large LAN transfers to continue"
)

expect(
    SharedFilesRoutePolicy.sharedFileDownloadResourceTimeout == 86_400,
    "shared-file downloads must allow long-running resource transfers"
)

expect(
    SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts == 4,
    "shared-file downloads must allow repeated network-switch recovery attempts before failing"
)

expect(SharedFilesRoutePolicy.isPrivateLANIPv4("10.0.0.8"), "10/8 must be treated as LAN")
expect(SharedFilesRoutePolicy.isPrivateLANIPv4("172.16.0.8"), "172.16/12 lower bound must be LAN")
expect(SharedFilesRoutePolicy.isPrivateLANIPv4("172.31.255.8"), "172.16/12 upper bound must be LAN")
expect(SharedFilesRoutePolicy.isPrivateLANIPv4("192.168.1.8"), "192.168/16 must be LAN")
expect(!SharedFilesRoutePolicy.isPrivateLANIPv4("172.32.0.8"), "172.32/16 must not be LAN")
expect(!SharedFilesRoutePolicy.isPrivateLANIPv4("8.8.8.8"), "public IPv4 hosts must not be LAN")
expect(!SharedFilesRoutePolicy.isPrivateLANIPv4("fe80::1"), "IPv6 strings must not pass IPv4 LAN checks")

expect(
    SharedFilesRoutePolicy.freshLANHost(discoveredHost: " 192.168.1.20 ") == "192.168.1.20",
    "shared files should accept a freshly discovered private LAN host after network recovery"
)

expect(
    SharedFilesRoutePolicy.freshLANHost(discoveredHost: "8.8.8.8") == nil,
    "shared files must reject public discovery hosts for LAN recovery"
)

expect(
    SharedFilesRoutePolicy.freshLANHost(discoveredHost: " \n ") == nil,
    "blank discovery hosts must not become LAN routes"
)

expect(
    SharedFilesRoutePolicy.shouldPublishLANReachabilityFromDiscovery(hasFreshLANHost: true),
    "shared files should publish LAN reachability as soon as discovery has a fresh LAN route"
)

expect(
    !SharedFilesRoutePolicy.shouldPublishLANReachabilityFromDiscovery(hasFreshLANHost: false),
    "shared files must not publish LAN reachability without a fresh LAN route"
)

expect(
    SharedFilesRoutePolicy.shouldPreferLANRoute(hasReachableLANHost: true),
    "shared files should use a reachable LAN route"
)

expect(
    !SharedFilesRoutePolicy.shouldPreferLANRoute(hasReachableLANHost: false),
    "shared files should not choose LAN when no reachable host exists"
)

expect(
    SharedFilesRoutePolicy.shouldProbeFallbackDirectLANAfterDiscovery(hasFreshLANHost: false),
    "shared files should probe cached direct LAN after discovery fails to provide a fresh host"
)

expect(
    !SharedFilesRoutePolicy.shouldProbeFallbackDirectLANAfterDiscovery(hasFreshLANHost: true),
    "shared files should not prefer stale cached LAN when discovery already has a fresh host"
)

expect(
    SharedFilesRoutePolicy.fallbackDirectHost(
        liveHost: "10.0.0.7",
        currentBindingHost: "10.0.0.8",
        persistedHost: "192.168.1.8"
    ) == "10.0.0.7",
    "shared files should prefer the live sidecar host when falling back to direct LAN"
)

expect(
    SharedFilesRoutePolicy.fallbackDirectHost(
        liveHost: nil,
        currentBindingHost: "10.0.0.8",
        persistedHost: "192.168.1.8"
    ) == "10.0.0.8",
    "shared files should prefer the current binding host over persisted host when falling back"
)

expect(
    SharedFilesRoutePolicy.fallbackDirectHost(
        liveHost: " \n ",
        currentBindingHost: nil,
        persistedHost: "192.168.1.8"
    ) == "192.168.1.8",
    "shared files should ignore blank direct LAN candidates"
)

expect(
    SharedFilesRoutePolicy.hasUsableDirectRouteHost("10.0.0.8"),
    "shared files should allow a non-empty direct route host"
)

expect(
    !SharedFilesRoutePolicy.hasUsableDirectRouteHost(nil),
    "shared files must not treat a nil direct route host as usable"
)

expect(
    !SharedFilesRoutePolicy.hasUsableDirectRouteHost(" \n "),
    "shared files must not treat a blank direct route host as usable"
)

let cellularPathSummary = SharedFilesRoutePolicy.diagnosticNetworkPathSummary([
    "status": "satisfied",
    "interfaces": [
        [
            "name": "pdp_ip0",
            "type": "cellular",
            "index": 7,
        ],
    ],
    "usesWiFi": false,
    "usesCellular": true,
    "usesWiredEthernet": false,
    "isExpensive": true,
    "isConstrained": false,
    "supportsIPv4": true,
    "supportsIPv6": true,
    "supportsDNS": true,
])

expect(
    cellularPathSummary == "status=satisfied interfaces=[pdp_ip0(cellular)] wifi=false cellular=true wired=false expensive=true constrained=false supportsIPv4=true supportsIPv6=true supportsDNS=true",
    "shared files diagnostics must format cellular network path snapshots deterministically"
)

expect(
    SharedFilesRoutePolicy.wakeLANReachableReason(baseReason: "browse_shared_files")
        == "browse_shared_files_wake_lan_reachable",
    "LAN health recovery after WoL must be logged as LAN reachable"
)

expect(
    SharedFilesRoutePolicy.wakeFullResumeConfirmedReason(baseReason: "browse_shared_files")
        == "browse_shared_files_wake_full_resume_confirmed",
    "full wake success must require an explicit desktop resume confirmation"
)

expect(
    SharedFilesRoutePolicy.shouldAttemptLANWake(allowWake: true),
    "shared files may attempt LAN wake for scoped personal root listings"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptLANWake(allowWake: false),
    "shared files must not attempt LAN wake when the caller does not allow it"
)

expect(
    !SharedFilesRoutePolicy.shouldPromoteBindingConnectedFromReachability(
        presenceConfirmed: false,
        fullResumeConfirmed: false
    ),
    "LAN reachability alone must not mark a binding connected"
)

expect(
    SharedFilesRoutePolicy.shouldPromoteBindingConnectedFromReachability(
        presenceConfirmed: true,
        fullResumeConfirmed: false
    ),
    "presence confirmation may mark a binding connected"
)

expect(
    SharedFilesRoutePolicy.shouldPromoteBindingConnectedFromReachability(
        presenceConfirmed: false,
        fullResumeConfirmed: true
    ),
    "full desktop resume confirmation may mark a binding connected"
)

let wakeAttemptStartedAt = ISO8601DateFormatter().date(from: "2026-06-11T03:50:00Z")!
let postWakeResumeAt = ISO8601DateFormatter().date(from: "2026-06-11T03:50:01Z")!
let preWakeResumeAt = ISO8601DateFormatter().date(from: "2026-06-11T03:49:59Z")!

expect(
    SharedFilesRoutePolicy.isFullWakeConfirmed(
        lastResumeAt: postWakeResumeAt,
        wakeAttemptStartedAt: wakeAttemptStartedAt
    ),
    "full wake confirmation should accept resume events after the wake attempt starts"
)

expect(
    !SharedFilesRoutePolicy.isFullWakeConfirmed(
        lastResumeAt: preWakeResumeAt,
        wakeAttemptStartedAt: wakeAttemptStartedAt
    ),
    "full wake confirmation must reject stale resume events from before the wake attempt"
)

expect(
    SharedFilesRoutePolicy.isFullWakeConfirmed(
        expectedDeviceId: " desktop-1 ",
        responseServerId: "desktop-1",
        lastResumeAt: postWakeResumeAt,
        wakeAttemptStartedAt: wakeAttemptStartedAt
    ),
    "full wake confirmation should accept matching desktop identity and fresh resume events"
)

expect(
    !SharedFilesRoutePolicy.isFullWakeConfirmed(
        expectedDeviceId: "desktop-1",
        responseServerId: "other-desktop",
        lastResumeAt: postWakeResumeAt,
        wakeAttemptStartedAt: wakeAttemptStartedAt
    ),
    "full wake confirmation must reject resume events from a different desktop"
)

expect(
    !SharedFilesRoutePolicy.isFullWakeConfirmed(
        expectedDeviceId: "desktop-1",
        responseServerId: nil,
        lastResumeAt: postWakeResumeAt,
        wakeAttemptStartedAt: wakeAttemptStartedAt
    ),
    "full wake confirmation must reject presence responses without a serverId"
)

expect(
    SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "", operation: "list"),
    "opening the personal root may attempt bound desktop wake"
)

expect(
    SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "/", operation: "list"),
    "wrapper slashes around the personal root should still allow wake"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "Applications", operation: "list"),
    "nested personal folder listings must not trigger bound desktop wake"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "Applications/Icon\r", operation: "download"),
    "personal downloads must not trigger bound desktop wake"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "Documents/report.pdf", operation: "preview"),
    "personal previews must not trigger bound desktop wake"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "team", path: "Applications", operation: "list"),
    "team shared files must not trigger bound desktop wake"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "../Documents", operation: "list"),
    "path traversal attempts must not trigger wake"
)

expect(
    SharedFilesRoutePolicy.shouldClearLANReachabilityOnPresenceRecoveryStart(
        reachabilityState: "available",
        reachabilityRoute: "lan"
    ),
    "presence recovery must clear stale LAN reachability after the LAN presence heartbeat fails"
)

expect(
    !SharedFilesRoutePolicy.shouldClearLANReachabilityOnPresenceRecoveryStart(
        reachabilityState: "available",
        reachabilityRoute: nil
    ),
    "presence recovery must not clear reachability without a LAN route marker"
)

expect(
    !SharedFilesRoutePolicy.shouldClearLANReachabilityOnPresenceRecoveryStart(
        reachabilityState: "unavailable",
        reachabilityRoute: "lan"
    ),
    "presence recovery must not re-emit clears for already unavailable LAN reachability"
)

expect(
    SharedFilesRoutePolicy.resumeOffsetForPartialDownload(existingBytes: 1_024) == 1_024,
    "shared-file downloads must resume from the existing partial byte count"
)

expect(
    SharedFilesRoutePolicy.resumeOffsetForPartialDownload(existingBytes: -1) == 0,
    "shared-file downloads must not send negative Range offsets"
)

expect(
    SharedFilesRoutePolicy.shouldUseRangeRequest(resumeOffset: 1),
    "shared-file downloads must use HTTP Range when a partial file exists"
)

expect(
    !SharedFilesRoutePolicy.shouldUseRangeRequest(resumeOffset: 0),
    "shared-file downloads must start with a full GET when no partial file exists"
)

expect(
    SharedFilesRoutePolicy.totalDownloadedBytes(existingBytes: 1_024, receivedBytes: 2_048) == 3_072,
    "shared-file progress must include bytes already persisted in the partial file"
)

expect(
    SharedFilesRoutePolicy.totalDownloadedBytes(existingBytes: -1, receivedBytes: 2_048) == 2_048,
    "shared-file progress must ignore invalid negative partial byte counts"
)

expect(
    SharedFilesRoutePolicy.canResumePartialDownload(
        existingBytes: 1_024,
        validator: "Wed, 01 Jun 2026 08:00:00 GMT",
        expectedBytes: 4_096
    ),
    "shared-file partial downloads may resume only when a server validator is stored"
)

expect(
    SharedFilesRoutePolicy.canResumePartialDownload(
        existingBytes: 1_024,
        validator: "Wed, 01 Jun 2026 08:00:00 GMT",
        expectedBytes: nil
    ),
    "shared-file partial downloads may resume without a total length when a validator is stored"
)

expect(
    !SharedFilesRoutePolicy.canResumePartialDownload(
        existingBytes: 1_024,
        validator: nil,
        expectedBytes: 4_096
    ),
    "shared-file partial downloads without a server validator must be discarded instead of being appended blindly"
)

expect(
    !SharedFilesRoutePolicy.canResumePartialDownload(
        existingBytes: 4_096,
        validator: "Wed, 01 Jun 2026 08:00:00 GMT",
        expectedBytes: 4_096
    ),
    "complete or oversized partial files must not be resumed with a Range request"
)

expect(
    SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(isLocalSaveFailure: false),
    "transport failures should use bounded shared-file download retries"
)

expect(
    !SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(isLocalSaveFailure: true),
    "local save failures must not trigger route retry or duplicate downloads"
)

expect(
    SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure: false,
        httpStatusCode: 408
    ),
    "request timeout responses should be retryable"
)

expect(
    SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure: false,
        httpStatusCode: 429
    ),
    "rate-limit responses should be retryable"
)

expect(
    !SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure: false,
        httpStatusCode: 404
    ),
    "missing shared files must not retry downloads"
)

expect(
    SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure: false,
        httpStatusCode: 503
    ),
    "server-side shared-file failures should keep bounded retries"
)

expect(
    SharedFilesRoutePolicy.encodedSharedFilePath("Album A/IMG #1%.jpg") == "%E7%9B%B8%E7%B0%BF%20A/IMG%20%231%25.jpg",
    "shared-file browse/download paths must be encoded per segment so spaces, hash, percent, and non-ASCII names remain valid URL path components"
)

expect(
    SharedFilesRoutePolicy.encodedSharedFilePath("/nested//file name.mov/") == "nested/file%20name.mov",
    "shared-file path encoding must trim wrapper slashes and ignore empty path segments"
)

expect(
    SharedFilesRoutePolicy.encodedSharedFilePath("Applications/Chrome Apps.localized/Icon\r") == "Applications/Chrome%20Apps.localized/Icon%0D",
    "shared-file path encoding must preserve macOS filenames with trailing carriage returns"
)
