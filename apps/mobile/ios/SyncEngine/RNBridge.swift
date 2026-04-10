import Foundation
import React
import UIKit

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

    @objc
    func resetAllStatus(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                try await SyncEngineManager.shared.resetAllStatus()
                resolve(nil)
            } catch {
                reject("RESET_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - Vivi Drop: Album Browser

    @objc
    func browseAlbum(_ params: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let mediaFilter = params["mediaFilter"] as? String ?? "all"
        let transferFilter = params["transferFilter"] as? String ?? "all"
        let offset = params["offset"] as? Int ?? 0
        let limit = params["limit"] as? Int ?? 50
        let collectionId = params["collectionId"] as? String
        Task {
            let result = SyncEngineManager.shared.browseAlbum(
                mediaFilter: mediaFilter,
                transferFilter: transferFilter,
                offset: offset,
                limit: limit,
                collectionId: collectionId
            )
            resolve(result)
        }
    }

    @objc
    func getAlbumStats(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let result = SyncEngineManager.shared.getAlbumStats()
            resolve(result)
        }
    }

    @objc
    func getAlbumCollections(_ mediaFilter: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let result = SyncEngineManager.shared.getAlbumCollections(mediaFilter: mediaFilter as String)
            resolve(result)
        }
    }

    // MARK: - Vivi Drop: Manual Upload

    @objc
    func submitManualUpload(_ params: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let assetLocalIds = params["assetLocalIds"] as? [String] else {
            reject("INVALID_PARAMS", "Missing assetLocalIds array", nil)
            return
        }
        Task {
            let result = SyncEngineManager.shared.submitManualUpload(assetLocalIds: assetLocalIds)
            resolve(result)
        }
    }

    @objc
    func cancelManualBatch(_ batchId: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        do {
            try SyncEngineManager.shared.cancelManualBatch(batchId: batchId as String)
            resolve(nil)
        } catch {
            reject("CANCEL_BATCH_ERROR", error.localizedDescription, error)
        }
    }

    // MARK: - Vivi Drop: Auto Upload Control

    @objc
    func pauseAutoUpload(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        SyncEngineManager.shared.pauseAutoUpload()
        resolve(nil)
    }

    @objc
    func resumeAutoUpload(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        SyncEngineManager.shared.resumeAutoUpload()
        resolve(nil)
    }

    @objc
    func getAutoUploadConfig(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let config = SyncEngineManager.shared.getAutoUploadConfig()
        resolve(config)
    }

    @objc
    func saveAutoUploadConfig(_ params: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let config = params as? [String: Any] else {
            reject("INVALID_PARAMS", "Invalid config object", nil)
            return
        }
        do {
            try SyncEngineManager.shared.saveAutoUploadConfig(config: config)
            resolve(nil)
        } catch {
            reject("SAVE_CONFIG_ERROR", error.localizedDescription, error)
        }
    }

    // MARK: - Vivi Drop: Shared Files

    @objc
    func browseSharedFiles(_ path: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let result = try await SyncEngineManager.shared.browseSharedFiles(path: path as String)
                resolve(result)
            } catch {
                reject("SHARED_FILES_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func downloadSharedFile(_ path: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let result = try await SyncEngineManager.shared.downloadSharedFile(path: path as String)
                resolve(result)
            } catch {
                reject("DOWNLOAD_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func getSharedFileStreamUrl(_ path: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let url = SyncEngineManager.shared.getSharedFileStreamUrl(path: path as String)
        resolve(url)
    }

    @objc
    func shareFile(_ localPath: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let fileURL = URL(fileURLWithPath: localPath as String)
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            reject("SHARE_ERROR", "File not found", nil)
            return
        }
        DispatchQueue.main.async {
            let activityVC = UIActivityViewController(
                activityItems: [fileURL],
                applicationActivities: nil
            )
            guard let rootVC = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap({ $0.windows })
                .first(where: { $0.isKeyWindow })?
                .rootViewController else {
                reject("SHARE_ERROR", "Cannot present share sheet", nil)
                return
            }
            activityVC.completionWithItemsHandler = { _, completed, _, _ in
                resolve(completed)
            }
            rootVC.present(activityVC, animated: true)
        }
    }
}
