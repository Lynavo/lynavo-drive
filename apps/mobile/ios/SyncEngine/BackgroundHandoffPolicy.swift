import Foundation

enum BackgroundHandoffPolicy {
    static func resolveBinding(live: StoredBinding?, persisted: BindingRecord?) -> StoredBinding? {
        if let live {
            return live
        }

        guard let persisted,
              !persisted.deviceId.isEmpty,
              !persisted.host.isEmpty,
              !persisted.pairingTokenKeychainRef.isEmpty
        else {
            return nil
        }

        return StoredBinding(
            serverId: persisted.deviceId,
            sidecarHost: persisted.host,
            port: persisted.port,
            pairingTokenKeychainRef: persisted.pairingTokenKeychainRef
        )
    }

    static func shouldContinueForegroundPipeline(
        isTransitioningToBackground: Bool,
        isAppInBackground: Bool
    ) -> Bool {
        !isAppInBackground && !isTransitioningToBackground
    }

}
