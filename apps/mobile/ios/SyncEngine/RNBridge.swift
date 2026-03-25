import Foundation
import React

@objc(NativeSyncEngine)
class NativeSyncEngineModule: RCTEventEmitter {

    static var shared: NativeSyncEngineModule?

    override init() {
        super.init()
        NativeSyncEngineModule.shared = self
    }

    override func supportedEvents() -> [String]! {
        return [
            "onDiscoveredDevicesChanged",
            "onSyncStateChanged",
            "onQueueUpdated",
            "onHistoryUpdated",
            "onBindingStateChanged",
            "onError",
        ]
    }

    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    // MARK: - Event Emitters

    func emitDiscoveredDevices(_ devices: [[String: Any]]) {
        sendEvent(withName: "onDiscoveredDevicesChanged", body: devices)
    }

    func emitSyncStateChanged(_ state: [String: Any]) {
        sendEvent(withName: "onSyncStateChanged", body: state)
    }

    func emitQueueUpdated(_ queue: [[String: Any]]) {
        sendEvent(withName: "onQueueUpdated", body: queue)
    }

    func emitHistoryUpdated() {
        sendEvent(withName: "onHistoryUpdated", body: nil)
    }

    func emitBindingStateChanged(_ binding: [String: Any]?) {
        sendEvent(withName: "onBindingStateChanged", body: binding)
    }

    func emitError(_ error: [String: Any]) {
        sendEvent(withName: "onError", body: error)
    }

    // MARK: - Bridge Methods

    @objc
    func requestPhotoPermission(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let result = await SyncEngineManager.shared.requestPhotoPermission()
            resolve(result)
        }
    }

    @objc
    func startDiscovery(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        SyncEngineManager.shared.startDiscovery()
        resolve(nil)
    }

    @objc
    func stopDiscovery(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        SyncEngineManager.shared.stopDiscovery()
        resolve(nil)
    }

    @objc
    func pairDevice(_ params: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let deviceId = params["deviceId"] as? String,
              let host = params["host"] as? String,
              let port = params["port"] as? Int,
              let code = params["connectionCode"] as? String else {
            reject("INVALID_PARAMS", "Missing required parameters", nil)
            return
        }
        Task {
            do {
                try await SyncEngineManager.shared.pairDevice(deviceId: deviceId, host: host, port: port, connectionCode: code)
                resolve(nil)
            } catch {
                reject("PAIR_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func disconnectAndUnbind(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                try await SyncEngineManager.shared.disconnectAndUnbind()
                resolve(nil)
            } catch {
                reject("DISCONNECT_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func getBindingState(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let state = await SyncEngineManager.shared.getBindingState()
            resolve(state)
        }
    }

    @objc
    func getSyncOverview(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let overview = await SyncEngineManager.shared.getSyncOverview()
            resolve(overview)
        }
    }

    @objc
    func getReadOnlyQueue(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let queue = await SyncEngineManager.shared.getReadOnlyQueue()
            resolve(queue)
        }
    }

    @objc
    func getHistoryDays(_ cursor: NSString?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let result = await SyncEngineManager.shared.getHistoryDays(cursor: cursor as String?)
            resolve(result)
        }
    }

    @objc
    func getAppInfo(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let result = await SyncEngineManager.shared.getAppInfo()
            resolve(result)
        }
    }

    @objc
    func exportDiagnostics(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let archivePath = try await SyncEngineManager.shared.exportDiagnostics()
                resolve(archivePath)
            } catch {
                reject("EXPORT_DIAGNOSTICS_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func getClientDisplayName(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        resolve(SyncEngineManager.shared.getClientDisplayName())
    }

    @objc
    func setClientDisplayName(_ name: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        SyncEngineManager.shared.setClientDisplayName(name as String)
        resolve(nil)
    }

    @objc
    func renameBoundDeviceAlias(_ alias: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                try await SyncEngineManager.shared.renameBoundDeviceAlias(alias: alias as String)
                resolve(nil)
            } catch {
                reject("RENAME_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func triggerSync(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        SyncEngineManager.shared.startSync()
        resolve(nil)
    }
}
