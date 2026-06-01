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
