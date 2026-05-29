import Foundation
import SyncFlowMobileTunnel

/// Swift wrapper that delegates P2P loopback proxying to the Go mobile library (SyncFlowMobileTunnel).
class LocalTCPProxy {
    private var activePort: Int?

    func start(
        signalingURL: String,
        clientID: String,
        targetClientID: String,
        token: String,
        pairingToken: String,
        iceServersJSON: String
    ) -> Int {
        slog("[LocalTCPProxy] Starting P2P tunnel connection with signaling: %@", signalingURL)
        syncDiagnosticsLog("LocalTCPProxy", "starting P2P tunnel signaling=\(signalingURL) target=\(targetClientID)")
        let port = MobiletunnelStartTunnel(signalingURL, clientID, targetClientID, token, pairingToken, iceServersJSON)
        if port > 0 {
            activePort = port
            slog("[LocalTCPProxy] P2P tunnel started successfully on port %ld", port)
            syncDiagnosticsLog("LocalTCPProxy", "P2P tunnel active port=\(port)")
        } else {
            activePort = nil
            slog("[LocalTCPProxy] Failed to start P2P tunnel, return code: %ld", port)
            syncDiagnosticsLog("LocalTCPProxy", "P2P tunnel failed returnCode=\(port)")
        }
        return port
    }

    func stop() {
        guard activePort != nil else { return }
        slog("[LocalTCPProxy] Stopping P2P tunnel")
        syncDiagnosticsLog("LocalTCPProxy", "stopping P2P tunnel")
        MobiletunnelStopTunnel()
        activePort = nil
    }

    func getActivePort() -> Int? {
        return activePort
    }
}
