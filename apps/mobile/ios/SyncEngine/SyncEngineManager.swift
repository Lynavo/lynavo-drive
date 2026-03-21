import Foundation

@objc
class SyncEngineManager: NSObject {
    static let shared = SyncEngineManager()

    private override init() {
        super.init()
    }

    // MARK: - Discovery
    func startDiscovery() async throws {
        print("[SyncEngine] startDiscovery (stub)")
    }

    func stopDiscovery() async throws {
        print("[SyncEngine] stopDiscovery (stub)")
    }

    // MARK: - Permissions
    func requestPhotoPermission() async -> String {
        print("[SyncEngine] requestPhotoPermission (stub)")
        return "granted"
    }

    // MARK: - Pairing
    func pairDevice(deviceId: String, host: String, port: Int, connectionCode: String) async throws {
        print("[SyncEngine] pairDevice \(deviceId) (stub)")
    }

    func disconnectAndUnbind() async throws {
        print("[SyncEngine] disconnectAndUnbind (stub)")
    }

    // MARK: - State Queries
    func getBindingState() async -> [String: Any]? {
        print("[SyncEngine] getBindingState (stub)")
        return nil
    }

    func getSyncOverview() async -> [String: Any] {
        print("[SyncEngine] getSyncOverview (stub)")
        return [
            "currentDeviceId": NSNull(),
            "currentDeviceName": NSNull(),
            "currentSpeedMbps": 0,
            "transferredBytes": 0,
            "totalBytes": 0,
            "progressPercent": 0,
            "uploadState": "idle"
        ]
    }

    func getReadOnlyQueue() async -> [[String: Any]] {
        print("[SyncEngine] getReadOnlyQueue (stub)")
        return []
    }

    func getHistoryDays(cursor: String?) async -> [String: Any] {
        print("[SyncEngine] getHistoryDays (stub)")
        return ["items": [], "nextCursor": NSNull()]
    }

    // MARK: - Settings
    func renameBoundDeviceAlias(alias: String) async throws {
        print("[SyncEngine] renameBoundDeviceAlias \(alias) (stub)")
    }
}
