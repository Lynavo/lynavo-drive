import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("SharedFilesRoutePolicyTests failed: \(message)\n", stderr)
        exit(1)
    }
}

expect(
    SharedFilesRoutePolicy.sharedFileDownloadResourceTimeout >= 3_600,
    "shared file downloads must allow large P2P transfers to run longer than five minutes"
)

expect(
    SharedFilesRoutePolicy.sharedFileTunnelRouteWaitTimeout == 4,
    "shared files P2P fallback must wait briefly because LAN/WoL is the primary route"
)

expect(
    SharedFilesRoutePolicy.shouldWaitForP2PTunnelRoute(
        hasTunnelCredentials: true,
        isTunnelActive: false,
        hasUsableDirectRouteHost: false
    ),
    "shared files must wait for the P2P tunnel after reconnect when credentials exist but the tunnel is not active"
)

expect(
    !SharedFilesRoutePolicy.shouldWaitForP2PTunnelRoute(
        hasTunnelCredentials: true,
        isTunnelActive: true,
        hasUsableDirectRouteHost: false
    ),
    "shared files must not wait for the P2P tunnel when the tunnel is already active"
)

expect(
    !SharedFilesRoutePolicy.shouldWaitForP2PTunnelRoute(
        hasTunnelCredentials: false,
        isTunnelActive: false,
        hasUsableDirectRouteHost: false
    ),
    "shared files must fall back to direct LAN when no P2P tunnel credentials exist"
)

expect(
    !SharedFilesRoutePolicy.shouldWaitForP2PTunnelRoute(
        hasTunnelCredentials: true,
        isTunnelActive: false,
        hasUsableDirectRouteHost: true
    ),
    "shared files must prefer a usable direct LAN route over waiting for a not-yet-active P2P tunnel"
)

expect(
    SharedFilesRoutePolicy.shouldContinueWaitingForP2PTunnelRoute(
        hasTunnelCredentials: true,
        isTunnelActive: true,
        isRouteAcceptable: false
    ),
    "shared files must keep waiting when an active P2P tunnel selected an unacceptable route"
)

expect(
    !SharedFilesRoutePolicy.shouldContinueWaitingForP2PTunnelRoute(
        hasTunnelCredentials: true,
        isTunnelActive: true,
        isRouteAcceptable: true
    ),
    "shared files must stop waiting when an active P2P tunnel selected an acceptable route"
)

expect(
    !SharedFilesRoutePolicy.shouldAcceptActiveP2PTunnelRoute(
        isTunnelActive: true,
        hasTunnelPort: true,
        selectedICERoute: "direct_host",
        hasReachableLANHost: false
    ),
    "shared files must not trust a direct_host tunnel as a WAN route when LAN is not reachable"
)

expect(
    SharedFilesRoutePolicy.shouldAcceptActiveP2PTunnelRoute(
        isTunnelActive: true,
        hasTunnelPort: true,
        selectedICERoute: "ipv6_direct",
        hasReachableLANHost: false
    ),
    "shared files must accept an IPv6 direct tunnel before falling back to relay when LAN is not reachable"
)

expect(
    SharedFilesRoutePolicy.shouldAcceptActiveP2PTunnelRoute(
        isTunnelActive: true,
        hasTunnelPort: true,
        selectedICERoute: "direct_reflexive",
        hasReachableLANHost: false
    ),
    "shared files must accept a server-reflexive P2P tunnel when LAN is not reachable"
)

expect(
    SharedFilesRoutePolicy.shouldAcceptActiveP2PTunnelRoute(
        isTunnelActive: true,
        hasTunnelPort: true,
        selectedICERoute: "turn_relay",
        hasReachableLANHost: false
    ),
    "shared files may trust an active relay tunnel when LAN is not reachable"
)

expect(
    SharedFilesRoutePolicy.shouldAcceptActiveP2PTunnelRoute(
        isTunnelActive: true,
        hasTunnelPort: true,
        selectedICERoute: "direct_host",
        hasReachableLANHost: true
    ),
    "shared files may keep a direct_host tunnel only when LAN is also reachable"
)

expect(
    SharedFilesRoutePolicy.nextP2PTunnelRouteModeAfterRejectedRoute(
        currentRouteMode: "all",
        selectedICERoute: "link_local_direct"
    ) == "wan",
    "a rejected default tunnel route must retry with WAN candidate filtering before relay-only fallback"
)

expect(
    SharedFilesRoutePolicy.nextP2PTunnelRouteModeAfterRejectedRoute(
        currentRouteMode: "wan",
        selectedICERoute: "direct_host"
    ) == "relay",
    "a rejected WAN-filtered tunnel route must retry with relay-only ICE"
)

expect(
    SharedFilesRoutePolicy.nextP2PTunnelRouteModeAfterRejectedRoute(
        currentRouteMode: "relay",
        selectedICERoute: "direct_host"
    ) == "relay",
    "a rejected relay tunnel route must remain relay-only"
)

let wrappedTunnelOptions = SharedFilesRoutePolicy.tunnelOptionsJSON(
    iceServersJSON: #"[{"urls":["turn:turn.vividrop.cn:3478?transport=udp"],"username":"u","credential":"p"}]"#,
    routeMode: "wan"
)
let wrappedTunnelOptionsData = wrappedTunnelOptions.data(using: .utf8)!
let wrappedTunnelOptionsObject = try! JSONSerialization.jsonObject(with: wrappedTunnelOptionsData) as! [String: Any]
expect(
    wrappedTunnelOptionsObject["routeMode"] as? String == "wan",
    "tunnel options JSON must carry the requested route mode"
)
expect(
    ((wrappedTunnelOptionsObject["iceServers"] as? [[String: Any]])?.first?["urls"] as? [String])?.first
        == "turn:turn.vividrop.cn:3478?transport=udp",
    "tunnel options JSON must preserve the TURN URL including transport"
)

expect(
    SharedFilesRoutePolicy.shouldAttemptWakeBeforeP2PFallback(
        allowWake: true,
        hasActiveTunnel: false
    ),
    "opening the personal root should attempt wake before waiting for P2P fallback when no tunnel is active"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptWakeBeforeP2PFallback(
        allowWake: true,
        hasActiveTunnel: true
    ),
    "opening the personal root must use an active P2P tunnel directly instead of waking first"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptWakeBeforeP2PFallback(
        allowWake: false,
        hasActiveTunnel: false
    ),
    "shared files must not wake before P2P fallback outside the scoped personal trigger"
)

let peerProxySkipReasonsWithoutSources = SharedFilesRoutePolicy.peerProxySkipReasons(
    hasMultiDesktopBindingSource: false,
    hasOnlineViviDropDesktopPeer: false,
    hasThirdPartyHelperConfigured: false
)

expect(
    peerProxySkipReasonsWithoutSources.contains("no_multi_desktop_binding_source"),
    "peer proxy diagnostics must report when no multi-desktop binding source exists"
)

expect(
    peerProxySkipReasonsWithoutSources.contains("no_online_vividrop_desktop_peer"),
    "peer proxy diagnostics must report when no online Vivi Drop desktop peer exists"
)

expect(
    peerProxySkipReasonsWithoutSources.contains("third_party_helper_not_configured"),
    "peer proxy diagnostics must report when no explicit third-party helper is configured"
)

expect(
    !SharedFilesRoutePolicy.peerProxySkipReasons(
        hasMultiDesktopBindingSource: true,
        hasOnlineViviDropDesktopPeer: false,
        hasThirdPartyHelperConfigured: false
    ).contains("no_multi_desktop_binding_source"),
    "peer proxy diagnostics must not report missing multi-desktop source when the source exists"
)

expect(
    !SharedFilesRoutePolicy.peerProxySkipReasons(
        hasMultiDesktopBindingSource: false,
        hasOnlineViviDropDesktopPeer: true,
        hasThirdPartyHelperConfigured: false
    ).contains("no_online_vividrop_desktop_peer"),
    "peer proxy diagnostics must not report missing Vivi Drop peer when an online peer exists"
)

expect(
    !SharedFilesRoutePolicy.peerProxySkipReasons(
        hasMultiDesktopBindingSource: false,
        hasOnlineViviDropDesktopPeer: false,
        hasThirdPartyHelperConfigured: true
    ).contains("third_party_helper_not_configured"),
    "peer proxy diagnostics must not report missing third-party helper when one is explicitly configured"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptPeerProxyWake(
        hasMultiDesktopBindingSource: false,
        hasOnlineViviDropDesktopPeer: true
    ),
    "peer proxy wake must remain disabled without a durable multi-desktop binding source"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptPeerProxyWake(
        hasMultiDesktopBindingSource: true,
        hasOnlineViviDropDesktopPeer: false
    ),
    "peer proxy wake must remain disabled without an online authenticated Vivi Drop desktop peer"
)

expect(
    SharedFilesRoutePolicy.shouldAttemptPeerProxyWake(
        hasMultiDesktopBindingSource: true,
        hasOnlineViviDropDesktopPeer: true
    ),
    "peer proxy wake may be attempted only when both durable multi-desktop source and online desktop peer exist"
)

expect(
    SharedFilesRoutePolicy.wakeLANReachableReason(baseReason: "browse_shared_files")
        == "browse_shared_files_wake_lan_reachable",
    "LAN health recovery after WoL must be logged as LAN reachable, not full wake success"
)

expect(
    SharedFilesRoutePolicy.wakeFullResumeConfirmedReason(baseReason: "browse_shared_files")
        == "browse_shared_files_wake_full_resume_confirmed",
    "full wake success must require an explicit desktop resume confirmation"
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
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "Applications", operation: "list"),
    "nested personal folder listings must not trigger bound desktop wake"
)

expect(
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "Applications/Icon\r", operation: "download"),
    "personal downloads must not trigger bound desktop wake"
)

expect(
    SharedFilesRoutePolicy.shouldAllowPublicWake(
        scope: "personal",
        path: "",
        operation: "list",
        trigger: "shared_files_root_browse"
    ),
    "personal root browse must be allowed to use configured Wake-on-WAN"
)

expect(
    !SharedFilesRoutePolicy.shouldAllowPublicWake(
        scope: "personal",
        path: "",
        operation: "list",
        trigger: "manual_lan_reconnect"
    ),
    "manual reconnect must remain LAN-only and must not use configured Wake-on-WAN"
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
    SharedFilesRoutePolicy.freshLANHost(discoveredHost: " 192.168.1.20 ") == "192.168.1.20",
    "shared files should accept a freshly discovered private LAN host after network recovery"
)

expect(
    SharedFilesRoutePolicy.freshLANHost(discoveredHost: "8.8.8.8") == nil,
    "shared files must reject public discovery hosts for LAN recovery"
)

expect(
    SharedFilesRoutePolicy.shouldPublishLANReachabilityFromDiscovery(
        hasFreshLANHost: true
    ),
    "shared files should publish LAN reachability as soon as discovery has a fresh LAN route"
)

expect(
    !SharedFilesRoutePolicy.shouldPublishLANReachabilityFromDiscovery(
        hasFreshLANHost: false
    ),
    "shared files must not publish LAN reachability without a fresh LAN route"
)

expect(
    SharedFilesRoutePolicy.shouldPreferLANRoute(
        hasReachableLANHost: true,
        isTunnelActive: true
    ),
    "shared files should prefer a reachable LAN route over an active tunnel"
)

expect(
    !SharedFilesRoutePolicy.shouldPreferLANRoute(
        hasReachableLANHost: false,
        isTunnelActive: true
    ),
    "shared files should keep using the tunnel when no reachable LAN route exists"
)

expect(
    SharedFilesRoutePolicy.shouldProbeFallbackDirectLANBeforeP2P(
        hasFreshLANHost: false
    ),
    "shared files should probe the cached direct LAN route before waiting for P2P when Bonjour has no fresh host"
)

expect(
    !SharedFilesRoutePolicy.shouldProbeFallbackDirectLANBeforeP2P(
        hasFreshLANHost: true
    ),
    "shared files should not prefer stale cached direct LAN before P2P when Bonjour has already provided a fresh LAN host"
)

expect(
    SharedFilesRoutePolicy.shouldPublishP2PReachabilityFromTunnel(
        hasActiveTunnel: true,
        hasReachableLANHost: false
    ),
    "shared files should publish P2P reachability when the tunnel is active and LAN is not reachable"
)

expect(
    !SharedFilesRoutePolicy.shouldPublishP2PReachabilityFromTunnel(
        hasActiveTunnel: true,
        hasReachableLANHost: true
    ),
    "shared files must not let an active tunnel override a reachable LAN route"
)

expect(
    !SharedFilesRoutePolicy.shouldPublishP2PReachabilityFromTunnel(
        hasActiveTunnel: false,
        hasReachableLANHost: false
    ),
    "shared files must not publish P2P reachability when the tunnel is unavailable"
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
    SharedFilesRoutePolicy.hasUsableDirectRouteHost("10.0.0.8"),
    "shared files should allow a non-empty direct route host"
)

expect(
    !SharedFilesRoutePolicy.hasUsableDirectRouteHost(nil),
    "shared files must not treat a nil direct route host as usable after tunnel and LAN are unavailable"
)

expect(
    !SharedFilesRoutePolicy.hasUsableDirectRouteHost(" \n "),
    "shared files must not treat a blank direct route host as usable after tunnel and LAN are unavailable"
)

expect(
    SharedFilesRoutePolicy.shouldSuppressPresenceTunnelFailure(
        isTunnelRoute: true,
        activeSharedFileTunnelOperations: 1
    ),
    "presence failures on the tunnel must be suppressed while a shared-file tunnel operation is active"
)

expect(
    !SharedFilesRoutePolicy.shouldSuppressPresenceTunnelFailure(
        isTunnelRoute: true,
        activeSharedFileTunnelOperations: 0
    ),
    "presence failures on the tunnel must not be suppressed when no shared-file operation is active"
)

expect(
    SharedFilesRoutePolicy.shouldSuppressPresenceTunnelFailure(
        isTunnelRoute: true,
        activeSharedFileTunnelOperations: 0,
        secondsSinceLastSharedFileTunnelOperation: 0.25
    ),
    "presence failures on the tunnel must be suppressed briefly after a shared-file tunnel operation completes"
)

expect(
    !SharedFilesRoutePolicy.shouldSuppressPresenceTunnelFailure(
        isTunnelRoute: true,
        activeSharedFileTunnelOperations: 0,
        secondsSinceLastSharedFileTunnelOperation: 10
    ),
    "presence failures on the tunnel must not be suppressed long after shared-file tunnel activity"
)

expect(
    SharedFilesRoutePolicy.shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
        reason: "presence_recovery_exhausted",
        reachabilityState: "available",
        reachabilityRoute: "tunnel",
        isTunnelActive: true,
        isTunnelStarting: false
    ),
    "presence recovery exhaustion must not clear shared-files tunnel reachability while the tunnel is active"
)

expect(
    SharedFilesRoutePolicy.shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
        reason: "presence_recovery_exhausted",
        reachabilityState: "available",
        reachabilityRoute: "relay",
        isTunnelActive: false,
        isTunnelStarting: true
    ),
    "presence recovery exhaustion must not clear shared-files relay reachability while the tunnel is reconnecting"
)

expect(
    !SharedFilesRoutePolicy.shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
        reason: "pipeline_failed",
        reachabilityState: "available",
        reachabilityRoute: "tunnel",
        isTunnelActive: true,
        isTunnelStarting: false
    ),
    "non-presence offline transitions must still clear shared-files tunnel reachability"
)

expect(
    !SharedFilesRoutePolicy.shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
        reason: "presence_recovery_exhausted",
        reachabilityState: "available",
        reachabilityRoute: "lan",
        isTunnelActive: true,
        isTunnelStarting: false
    ),
    "LAN reachability must not be retained when presence recovery is exhausted"
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
        reachabilityRoute: "tunnel"
    ),
    "presence recovery must not clear tunnel reachability before tunnel liveness is known"
)

expect(
    !SharedFilesRoutePolicy.shouldClearLANReachabilityOnPresenceRecoveryStart(
        reachabilityState: "unavailable",
        reachabilityRoute: "lan"
    ),
    "presence recovery must not re-emit clears for already unavailable LAN reachability"
)

expect(
    SharedFilesRoutePolicy.shouldRetryDownloadOnTunnelAfterFailure(isTunnelRoute: true),
    "shared-file downloads that started on the tunnel must retry on a fresh tunnel instead of migrating to LAN"
)

expect(
    !SharedFilesRoutePolicy.shouldRetryDownloadOnTunnelAfterFailure(isTunnelRoute: false),
    "direct LAN shared-file downloads must not force a tunnel retry"
)

expect(
    SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts == 4,
    "shared-file downloads must allow repeated network-switch recovery attempts before failing"
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
    SharedFilesRoutePolicy.canResumePartialDownload(
        existingBytes: 1_024,
        validator: "Wed, 01 Jun 2026 08:00:00 GMT",
        expectedBytes: 4_096
    ),
    "shared-file partial downloads may resume only when a server validator is stored"
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
    !SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure: false,
        httpStatusCode: 404
    ),
    "missing shared files must not restart tunnels or retry downloads"
)

expect(
    SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure: false,
        httpStatusCode: 503
    ),
    "server-side shared-file failures should keep bounded retries"
)

expect(
    SharedFilesRoutePolicy.encodedSharedFilePath("相簿 A/IMG #1%.jpg") == "%E7%9B%B8%E7%B0%BF%20A/IMG%20%231%25.jpg",
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
