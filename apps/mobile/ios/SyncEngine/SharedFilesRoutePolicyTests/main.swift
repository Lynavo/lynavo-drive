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
    SharedFilesRoutePolicy.shouldWaitForP2PTunnelRoute(
        hasTunnelCredentials: true,
        isTunnelActive: false
    ),
    "shared files must wait for the P2P tunnel after reconnect when credentials exist but the tunnel is not active"
)

expect(
    !SharedFilesRoutePolicy.shouldWaitForP2PTunnelRoute(
        hasTunnelCredentials: true,
        isTunnelActive: true
    ),
    "shared files must not wait for the P2P tunnel when the tunnel is already active"
)

expect(
    !SharedFilesRoutePolicy.shouldWaitForP2PTunnelRoute(
        hasTunnelCredentials: false,
        isTunnelActive: false
    ),
    "shared files must fall back to direct LAN when no P2P tunnel credentials exist"
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
