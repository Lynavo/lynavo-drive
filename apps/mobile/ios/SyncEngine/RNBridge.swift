import Foundation
import Photos
import PhotosUI
import React
import UIKit

private func shareCacheFilename(_ rawFilename: String, fallbackURL: URL? = nil) -> String {
    let trimmed = rawFilename.trimmingCharacters(in: .whitespacesAndNewlines)
    let fallback = fallbackURL?.lastPathComponent ?? "remote-file"
    let candidate = trimmed.isEmpty ? fallback : trimmed
    let invalid = CharacterSet(charactersIn: "/\\:")
        .union(.controlCharacters)
        .union(.newlines)
    let sanitized = candidate
        .components(separatedBy: invalid)
        .filter { !$0.isEmpty }
        .joined(separator: "_")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    return sanitized.isEmpty ? "remote-file" : sanitized
}

private func uniqueShareCacheURL(directory: URL, filename: String) -> URL {
    let baseURL = directory.appendingPathComponent(filename)
    if !FileManager.default.fileExists(atPath: baseURL.path) {
        return baseURL
    }
    let name = (filename as NSString).deletingPathExtension
    let ext = (filename as NSString).pathExtension
    for index in 1...999 {
        let indexedName = ext.isEmpty ? "\(name)-\(index)" : "\(name)-\(index).\(ext)"
        let candidate = directory.appendingPathComponent(indexedName)
        if !FileManager.default.fileExists(atPath: candidate.path) {
            return candidate
        }
    }
    return directory.appendingPathComponent("\(UUID().uuidString)-\(filename)")
}

private func localDownloadMediaType(filename: String, mediaType: String?) -> String {
    let normalized = mediaType?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
    if normalized == "image" || normalized == "video" {
        return normalized!
    }

    let ext = (filename as NSString).pathExtension.lowercased()
    switch ext {
    case "jpg", "jpeg", "png", "gif", "bmp", "webp", "heic", "heif", "tiff", "tif":
        return "image"
    case "mp4", "mov", "avi", "mkv", "m4v":
        return "video"
    default:
        return "other"
    }
}

private func saveLocalDownloadToPhotos(fileURL: URL, mediaType: String) async throws {
    try await PHPhotoLibrary.shared().performChanges {
        if mediaType == "video" {
            PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileURL)
        } else {
            PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: fileURL)
        }
    }
}

private func persistDownloadedURLToLocalStorage(
    downloadedURL: URL,
    filename: String,
    mediaType rawMediaType: String?
) async throws -> [String: Any] {
    let safeFilename = shareCacheFilename(filename)
    let tempDir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lynavo_drive_local_downloads", isDirectory: true)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    let tempURL = uniqueShareCacheURL(directory: tempDir, filename: safeFilename)
    try FileManager.default.moveItem(at: downloadedURL, to: tempURL)

    let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let finalURL = uniqueShareCacheURL(directory: documentsURL, filename: safeFilename)
    try FileManager.default.moveItem(at: tempURL, to: finalURL)

    let mediaType = localDownloadMediaType(filename: safeFilename, mediaType: rawMediaType)
    if mediaType == "image" || mediaType == "video" {
        do {
            try await saveLocalDownloadToPhotos(fileURL: finalURL, mediaType: mediaType)
            return [
                "savedToPhotos": true,
                "localPath": finalURL.path,
                "savedLocation": "Photos",
            ]
        } catch {
            return [
                "savedToPhotos": false,
                "localPath": finalURL.path,
                "savedLocation": "Files",
            ]
        }
    }

    return [
        "savedToPhotos": false,
        "localPath": finalURL.path,
        "savedLocation": "Files",
    ]
}

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
            "onPairingInvalidated",
            "onPhotoLibraryChanged",
            "onError",
            "onSharedFileDownloadProgress",
            "onSharedFilesReachabilityChanged",
        ]
    }

    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    // MARK: - Event Emitters

    private func sendEventOnMain(withName name: String, body: Any?) {
        if Thread.isMainThread {
            sendEvent(withName: name, body: body)
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.sendEvent(withName: name, body: body)
        }
    }

    func emitDiscoveredDevices(_ devices: [[String: Any]]) {
        sendEventOnMain(withName: "onDiscoveredDevicesChanged", body: devices)
    }

    func emitSyncStateChanged(_ state: [String: Any]) {
        sendEventOnMain(withName: "onSyncStateChanged", body: state)
    }

    func emitQueueUpdated(_ queue: [[String: Any]]) {
        sendEventOnMain(withName: "onQueueUpdated", body: queue)
    }

    func emitHistoryUpdated() {
        sendEventOnMain(withName: "onHistoryUpdated", body: nil)
    }

    func emitBindingStateChanged(_ binding: [String: Any]?) {
        sendEventOnMain(withName: "onBindingStateChanged", body: binding)
    }

    func emitPairingInvalidated(_ payload: [String: Any]) {
        sendEventOnMain(withName: "onPairingInvalidated", body: payload)
    }

    func emitSharedFilesReachabilityChanged(_ state: [String: Any]?) {
        sendEventOnMain(withName: "onSharedFilesReachabilityChanged", body: state)
    }

    func emitError(_ error: [String: Any]) {
        sendEventOnMain(withName: "onError", body: error)
    }

    func emitPhotoLibraryChanged() {
        sendEventOnMain(withName: "onPhotoLibraryChanged", body: nil)
    }

    func emitSharedFileDownloadProgress(path: String, bytesWritten: Int64, totalBytes: Int64, progress: Double) {
        sendEventOnMain(
            withName: "onSharedFileDownloadProgress",
            body: [
                "path": path,
                "bytesWritten": NSNumber(value: bytesWritten),
                "totalBytes": NSNumber(value: totalBytes),
                "progress": progress,
            ]
        )
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
    func getPhotoAuthorizationStatus(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        switch status {
        case .authorized:
            resolve("authorized")
        case .limited:
            resolve("limited")
        case .denied:
            resolve("denied")
        case .restricted:
            resolve("restricted")
        case .notDetermined:
            resolve("notDetermined")
        @unknown default:
            resolve("unknown")
        }
    }

    @objc
    func presentLimitedPhotoPicker(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            guard let rootVC = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap({ $0.windows })
                .first(where: { $0.isKeyWindow })?
                .rootViewController else {
                reject("NO_VC", "No root view controller available", nil)
                return
            }
            // Find the topmost presented controller
            var topVC = rootVC
            while let presented = topVC.presentedViewController {
                topVC = presented
            }
            PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: topVC)
            resolve(nil)
        }
    }

    @objc
    func startDiscovery(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        SyncEngineManager.shared.startDiscovery()
        resolve(nil)
    }

    @objc
    func retryLanReconnect(_ params: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let allowWake = params["allowWake"] as? Bool ?? false
        Task {
            await SyncEngineManager.shared.retryLanReconnect(allowWake: allowWake)
            resolve(nil)
        }
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
            } catch let syncError as SyncEngineError {
                reject(syncError.nativeErrorCode ?? "PAIR_ERROR", syncError.localizedDescription, syncError.nsError)
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
    func getBindingInvalidationState(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let state = SyncEngineManager.shared.getBindingInvalidationStateForBridge()
        resolve(state ?? NSNull())
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
    func getHistoryDays(_ cursor: Any?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let cursorString: String?
            if let value = cursor as? String {
                cursorString = value
            } else if let value = cursor as? NSString {
                cursorString = value as String
            } else {
                cursorString = nil
            }
            let result = await SyncEngineManager.shared.getHistoryDays(cursor: cursorString)
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
    func recordDiagnosticsLog(_ category: NSString, message: NSString) {
        syncDiagnosticsLog(String(category), String(message))
    }

    @objc
    func getClientDisplayName(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        resolve(SyncEngineManager.shared.getClientDisplayName())
    }

    @objc
    func getClientId(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        resolve(SyncEngineManager.shared.getClientId())
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

    // MARK: - Lynavo Drive: Album Browser

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

    @objc
    func getAssetPreviewSource(_ assetLocalId: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let result = SyncEngineManager.shared.getAssetPreviewSource(
                assetLocalId: assetLocalId as String
            )
            resolve(result)
        }
    }

    // MARK: - Lynavo Drive: Auto Upload Control

    // DEPRECATED: RN side uses saveAutoUploadConfig() instead. To be removed next release cycle.
    @objc
    func pauseAutoUpload(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        SyncEngineManager.shared.pauseAutoUpload()
        resolve(nil)
    }

    @objc
    func disableAutoUpload(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        SyncEngineManager.shared.disableAutoUpload()
        resolve(nil)
    }

    // DEPRECATED: RN side uses saveAutoUploadConfig() instead. To be removed next release cycle.
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

    // MARK: - Lynavo Drive: Shared Files

    @objc
    func browseSharedFiles(_ scope: NSString, path: NSString, accessToken: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let result = try await SyncEngineManager.shared.browseSharedFiles(scope: scope as String, path: path as String, accessToken: accessToken as String)
                resolve(result)
            } catch {
                reject("SHARED_FILES_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func downloadSharedFile(_ scope: NSString, path: NSString, accessToken: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let result = try await SyncEngineManager.shared.downloadSharedFile(scope: scope as String, path: path as String, accessToken: accessToken as String)
                resolve(result)
            } catch {
                reject("DOWNLOAD_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func downloadReceivedFile(_ fileKey: NSString, filename: NSString, mediaType: NSString?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let result = try await SyncEngineManager.shared.downloadReceivedFile(
                    fileKey: fileKey as String,
                    filename: filename as String,
                    mediaType: mediaType as String?
                )
                resolve(result)
            } catch {
                reject("DOWNLOAD_RECEIVED_FILE_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func listReceivedFiles(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let result = try await SyncEngineManager.shared.listReceivedFiles()
                resolve(result)
            } catch {
                reject("LIST_RECEIVED_FILES_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func listGlobalReceivedFiles(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let result = try await SyncEngineManager.shared.listGlobalReceivedFiles()
                resolve(result)
            } catch {
                reject("LIST_GLOBAL_RECEIVED_FILES_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func getReceivedFilePreviewUrl(_ fileKey: NSString, kind: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let result = try await SyncEngineManager.shared.getReceivedFilePreviewUrl(
                    fileKey: fileKey as String,
                    kind: kind as String
                )
                resolve(result)
            } catch {
                reject("RECEIVED_FILE_PREVIEW_URL_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func getSharedFileStreamUrl(_ scope: NSString, path: NSString, accessToken: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let url = SyncEngineManager.shared.getSharedFileStreamUrl(scope: scope as String, path: path as String, accessToken: accessToken as String)
        resolve(url)
    }

    @objc
    func getPersonalFileThumbnailUrl(_ path: NSString, accessToken: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let url = try await SyncEngineManager.shared.getPersonalFileThumbnailUrl(
                    path: path as String,
                    accessToken: accessToken as String
                )
                resolve(url)
            } catch {
                reject("THUMBNAIL_URL_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func prepareSharedFilePreview(_ scope: NSString, path: NSString, accessToken: NSString, filename: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let result = try await SyncEngineManager.shared.prepareSharedFilePreview(
                    scope: scope as String,
                    path: path as String,
                    accessToken: accessToken as String,
                    filename: filename as String
                )
                resolve(result)
            } catch {
                reject("PREVIEW_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func downloadUrlToShareCache(_ url: NSString, filename: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                guard let remoteURL = URL(string: url as String) else {
                    reject("SHARE_DOWNLOAD_ERROR", "Invalid download URL", nil)
                    return
                }
                let (downloadedURL, response) = try await URLSession.shared.download(from: remoteURL)
                if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                    reject("SHARE_DOWNLOAD_ERROR", "Download failed with HTTP \(http.statusCode)", nil)
                    return
                }
                let destDir = FileManager.default.temporaryDirectory
                    .appendingPathComponent("lynavo_drive_shared_downloads", isDirectory: true)
                try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
                let safeFilename = shareCacheFilename(filename as String, fallbackURL: remoteURL)
                let destURL = uniqueShareCacheURL(directory: destDir, filename: safeFilename)
                try FileManager.default.moveItem(at: downloadedURL, to: destURL)
                resolve(destURL.path)
            } catch {
                reject("SHARE_DOWNLOAD_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func downloadUrlToLocal(_ url: NSString, filename: NSString, mediaType: NSString?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                guard let remoteURL = URL(string: url as String) else {
                    reject("LOCAL_DOWNLOAD_ERROR", "Invalid download URL", nil)
                    return
                }
                let (downloadedURL, response) = try await URLSession.shared.download(from: remoteURL)
                if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                    reject("LOCAL_DOWNLOAD_ERROR", "Download failed with HTTP \(http.statusCode)", nil)
                    return
                }
                let result = try await persistDownloadedURLToLocalStorage(
                    downloadedURL: downloadedURL,
                    filename: filename as String,
                    mediaType: mediaType as String?
                )
                resolve(result)
            } catch {
                reject("LOCAL_DOWNLOAD_ERROR", error.localizedDescription, error)
            }
        }
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

    @objc
    func shareFiles(_ localPaths: NSArray, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let fileURLs = localPaths.compactMap { item -> URL? in
            guard let path = item as? String else { return nil }
            return URL(fileURLWithPath: path)
        }
        guard !fileURLs.isEmpty else {
            reject("SHARE_ERROR", "No files to share", nil)
            return
        }
        for fileURL in fileURLs {
            guard FileManager.default.fileExists(atPath: fileURL.path) else {
                reject("SHARE_ERROR", "File not found", nil)
                return
            }
        }
        DispatchQueue.main.async {
            let activityVC = UIActivityViewController(
                activityItems: fileURLs,
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
            activityVC.popoverPresentationController?.sourceView = rootVC.view
            activityVC.completionWithItemsHandler = { _, completed, _, _ in
                resolve(completed)
            }
            rootVC.present(activityVC, animated: true)
        }
    }

    // MARK: - Account Identity Reset (Phase 1 / 2 / 3)

    @objc
    func wipeSyncIdentity(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        // wipeSyncIdentity mutates a large set of plain instance properties
        // on SyncEngineManager (protocolSession, isSyncing, sidecarHost,
        // runtimeUploadState, bindingConnectionState, etc.) that are also
        // touched from delegate callbacks, heartbeat timers, and other
        // `Task { @MainActor in ... }` blocks inside the manager. Running
        // the wipe on the cooperative pool races those mutators.
        //
        // AppDelegate already drives this synchronously from the main
        // thread (reinstall / self-heal paths), so align the bridge entry
        // point to the same main-actor context. `MainActor.run` hops onto
        // the main thread, runs the wipe to completion, and then resolves
        // the JS promise.
        Task { @MainActor in
            SyncEngineManager.shared.wipeSyncIdentity()
            resolve(nil)
        }
    }

    @objc
    func getKnownDeviceIds(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let ids = SyncEngineManager.shared.getKnownDeviceIds()
        resolve(ids)
    }
}
