import Foundation

/// OSS builds do not include the remote tunnel implementation.
class LocalTCPProxy {
    func start(
        signalingURL: String,
        clientID: String,
        targetClientID: String,
        token: String,
        pairingToken: String,
        iceServersJSON: String
    ) -> Int {
        syncDiagnosticsLog("LocalTCPProxy", "P2P tunnel start skipped target=\(targetClientID); remote tunnel disabled in OSS")
        return 0
    }

    func stop() {
        syncDiagnosticsLog("LocalTCPProxy", "P2P tunnel stop skipped; remote tunnel disabled in OSS")
    }

    func getActivePort() -> Int? {
        return nil
    }

    func currentSelectedICERoute() -> String {
        return ""
    }
}
