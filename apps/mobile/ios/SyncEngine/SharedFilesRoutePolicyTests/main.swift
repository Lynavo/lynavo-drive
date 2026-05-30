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
