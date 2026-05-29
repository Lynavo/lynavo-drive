import Foundation

// MARK: - Cross-protocol reset state machine
//
// T6 / M9. These types live at module scope (intentionally not nested
// inside SyncEngineManager) so the decision logic is linkable into
// test harnesses that cannot bring in UIKit / Photos. Production call
// sites access them via the `SyncEngineManager.UploadResetResult` /
// `SyncEngineManager.CrossProtocolResetDecision` nested typealiases,
// which forward here.

/// Outcome of a DELETE /upload/<cid>/<fkey> call. Callers use this to
/// decide whether it's safe to restart the TCP upload path on a row
/// that previously ran through HTTP/URLSession.
///
/// M9 split `.failed(String)` into specific cases so callers and logs
/// can distinguish timeouts / network errors / server errors; `.unknown`
/// is the last-resort bucket for truly uncategorised responses.
public enum UploadResetResultT6: Equatable {
    case reset                     // 200 status=reset — .part / committed_bytes cleared
    case notFound                  // 404 — already at zero, safe to proceed
    case concurrentTransfer(via: String)
    case timeout
    case networkError(String)
    case serverError(Int)          // HTTP 5xx with the status code preserved
    case unknown(String)           // last-resort bucket — truly uncategorised

    public static func == (lhs: UploadResetResultT6, rhs: UploadResetResultT6) -> Bool {
        switch (lhs, rhs) {
        case (.reset, .reset), (.notFound, .notFound), (.timeout, .timeout):
            return true
        case let (.concurrentTransfer(a), .concurrentTransfer(b)):
            return a == b
        case let (.networkError(a), .networkError(b)):
            return a == b
        case let (.serverError(a), .serverError(b)):
            return a == b
        case let (.unknown(a), .unknown(b)):
            return a == b
        default:
            return false
        }
    }
}

/// Side effects the TCP pipeline must apply after a DELETE round-trip.
///
/// - `clearRequiresRemoteReset` — write `requires_remote_reset=false`
///   before continuing to TCP FILE_INIT. Only true for `.reset` /
///   `.notFound`, which are both idempotent clean states.
/// - `proceedToTcpFileInit` — whether it's safe to resume TCP on this
///   row right now. True only when the sidecar's committed state is
///   known to be clean.
/// - `abortRound` — abort the current TCP round for this row and retry
///   later. True on every failure case; `requires_remote_reset` stays
///   in place so the next attempt reissues the DELETE.
/// - `diagnosticCode` — short identifier for the log/diagnostic payload
///   so logs can distinguish `timeout` / `server_error:503` /
///   `concurrent_transfer:http` / etc. at a glance.
public struct CrossProtocolResetDecisionT6: Equatable {
    public var clearRequiresRemoteReset: Bool
    public var proceedToTcpFileInit: Bool
    public var abortRound: Bool
    public var diagnosticCode: String

    public init(
        clearRequiresRemoteReset: Bool,
        proceedToTcpFileInit: Bool,
        abortRound: Bool,
        diagnosticCode: String
    ) {
        self.clearRequiresRemoteReset = clearRequiresRemoteReset
        self.proceedToTcpFileInit = proceedToTcpFileInit
        self.abortRound = abortRound
        self.diagnosticCode = diagnosticCode
    }
}

/// T6 — pure decision function. Kept free of stored state so the TCP
/// pipeline's cross-protocol reset branch can be tested in isolation.
public func decideCrossProtocolResetT6(_ result: UploadResetResultT6) -> CrossProtocolResetDecisionT6 {
    switch result {
    case .reset:
        return CrossProtocolResetDecisionT6(
            clearRequiresRemoteReset: true,
            proceedToTcpFileInit: true,
            abortRound: false,
            diagnosticCode: "reset"
        )
    case .notFound:
        return CrossProtocolResetDecisionT6(
            clearRequiresRemoteReset: true,
            proceedToTcpFileInit: true,
            abortRound: false,
            diagnosticCode: "not_found"
        )
    case .concurrentTransfer(let via):
        return CrossProtocolResetDecisionT6(
            clearRequiresRemoteReset: false,
            proceedToTcpFileInit: false,
            abortRound: true,
            diagnosticCode: "concurrent_transfer:\(via)"
        )
    case .timeout:
        return CrossProtocolResetDecisionT6(
            clearRequiresRemoteReset: false,
            proceedToTcpFileInit: false,
            abortRound: true,
            diagnosticCode: "timeout"
        )
    case .networkError:
        return CrossProtocolResetDecisionT6(
            clearRequiresRemoteReset: false,
            proceedToTcpFileInit: false,
            abortRound: true,
            diagnosticCode: "network_error"
        )
    case .serverError(let code):
        return CrossProtocolResetDecisionT6(
            clearRequiresRemoteReset: false,
            proceedToTcpFileInit: false,
            abortRound: true,
            diagnosticCode: "server_error:\(code)"
        )
    case .unknown(let reason):
        return CrossProtocolResetDecisionT6(
            clearRequiresRemoteReset: false,
            proceedToTcpFileInit: false,
            abortRound: true,
            diagnosticCode: "unknown:\(reason)"
        )
    }
}
