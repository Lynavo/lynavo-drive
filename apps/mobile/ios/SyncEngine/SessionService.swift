import Foundation

class SessionService {
    private(set) var currentSessionId: String?
    private(set) var state: SyncEngineState = .idle

    enum SyncEngineState: String {
        case idle
        case discovering
        case scanning
        case preparing
        case syncingForeground = "syncing_foreground"
        case syncingBackground = "syncing_background"
        case backoffWaiting = "backoff_waiting"
        case pausedNoTarget = "paused_no_target"
        case pausedNoPermission = "paused_no_permission"
        case stopped
    }

    func startNewSession() -> String {
        let sessionId = UUID().uuidString.lowercased()
        currentSessionId = sessionId
        state = .syncingForeground
        return sessionId
    }

    func transitionTo(_ newState: SyncEngineState) {
        NSLog("[SessionService] %@ -> %@", state.rawValue, newState.rawValue)
        state = newState
    }

    func endSession(transitionTo newState: SyncEngineState = .idle) {
        state = newState
        currentSessionId = nil
    }
}
