import Foundation

struct BindingRecord {
    let deviceId: String
    let deviceName: String
    let deviceAlias: String?
    let deviceType: String
    let host: String
    let port: Int
    let pairingId: String
    let pairingTokenKeychainRef: String
    let shareName: String?
    let lastBoundAt: String
}

struct StoredBinding: Equatable {
    let serverId: String
    let sidecarHost: String
    let port: Int
    let pairingTokenKeychainRef: String
}
