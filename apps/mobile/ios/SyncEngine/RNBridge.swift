import Foundation
import React

@objc(NativeSyncEngine)
class NativeSyncEngineModule: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    func requestPhotoPermission(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let result = await SyncEngineManager.shared.requestPhotoPermission()
            resolve(result)
        }
    }

    @objc
    func startDiscovery(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                try await SyncEngineManager.shared.startDiscovery()
                resolve(nil)
            } catch {
                reject("DISCOVERY_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func stopDiscovery(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                try await SyncEngineManager.shared.stopDiscovery()
                resolve(nil)
            } catch {
                reject("DISCOVERY_ERROR", error.localizedDescription, error)
            }
        }
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
}
