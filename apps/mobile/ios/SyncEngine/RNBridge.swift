import Foundation
import Photos
import PhotosUI
import React
import UIKit

private struct DiagnosticsUploadNativeError: LocalizedError {
    let code: String
    let message: String

    var errorDescription: String? { message }
}

private func diagnosticsArchiveURL(from rawPath: String) -> URL? {
    let trimmed = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    if trimmed.hasPrefix("file://") {
        return URL(string: trimmed)
    }

    return URL(fileURLWithPath: trimmed)
}

private func diagnosticsUploadLog(_ message: String) {
    syncDiagnosticsLog("DiagnosticsUpload", message)
    slog("[DiagnosticsUpload] %@", message)
}

private func appendDiagnosticsMultipartString(_ value: String, to data: inout Data) {
    data.append(Data(value.utf8))
}

private func diagnosticsMultipartBody(
    archiveURL: URL,
    clientId: String,
    note: String,
    boundary: String
) throws -> Data {
    var body = Data()
    let filename = "diagnostics-\(Int(Date().timeIntervalSince1970 * 1000)).zip"

    appendDiagnosticsMultipartString("--\(boundary)\r\n", to: &body)
    appendDiagnosticsMultipartString("Content-Disposition: form-data; name=\"client_id\"\r\n\r\n", to: &body)
    appendDiagnosticsMultipartString(clientId, to: &body)
    appendDiagnosticsMultipartString("\r\n", to: &body)

    if !note.isEmpty {
        appendDiagnosticsMultipartString("--\(boundary)\r\n", to: &body)
        appendDiagnosticsMultipartString("Content-Disposition: form-data; name=\"note\"\r\n\r\n", to: &body)
        appendDiagnosticsMultipartString(note, to: &body)
        appendDiagnosticsMultipartString("\r\n", to: &body)
    }

    appendDiagnosticsMultipartString("--\(boundary)\r\n", to: &body)
    appendDiagnosticsMultipartString(
        "Content-Disposition: form-data; name=\"bundle\"; filename=\"\(filename)\"\r\n",
        to: &body
    )
    appendDiagnosticsMultipartString("Content-Type: application/zip\r\n\r\n", to: &body)
    body.append(try Data(contentsOf: archiveURL))
    appendDiagnosticsMultipartString("\r\n", to: &body)
    appendDiagnosticsMultipartString("--\(boundary)--\r\n", to: &body)

    return body
}

private func diagnosticsHeaders(from rawHeaders: Any?) -> [String: String] {
    guard let rawHeaders = rawHeaders as? NSDictionary else { return [:] }

    var headers: [String: String] = [:]
    for (key, value) in rawHeaders {
        guard let headerName = key as? String else { continue }
        if let headerValue = value as? String {
            headers[headerName] = headerValue
        }
    }
    return headers
}

private func performDiagnosticsArchiveUpload(
    archiveURL: URL,
    uploadURL: URL,
    clientId: String,
    note: String,
    headers: [String: String]
) async throws -> [String: Any] {
    let boundary = "syncflow-\(UUID().uuidString)"
    var request = URLRequest(url: uploadURL)
    request.httpMethod = "POST"
    for (key, value) in headers {
        if key.caseInsensitiveCompare("Content-Type") == .orderedSame {
            continue
        }
        request.setValue(value, forHTTPHeaderField: key)
    }
    let contentType = "multipart/form-data; boundary=\(boundary)"
    request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    request.httpBody = try diagnosticsMultipartBody(
        archiveURL: archiveURL,
        clientId: clientId,
        note: note,
        boundary: boundary
    )
    let uploadBytes = request.httpBody?.count ?? 0
    diagnosticsUploadLog(
        "started url=\(uploadURL.absoluteString) archive=\(archiveURL.lastPathComponent) bytes=\(uploadBytes) client_id=\(clientId) noteLen=\(note.count) contentType=\(contentType)"
    )

    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await URLSession.shared.data(for: request)
    } catch {
        diagnosticsUploadLog("failed network error=\(error)")
        throw error
    }
    guard let httpResponse = response as? HTTPURLResponse else {
        diagnosticsUploadLog("failed invalid response")
        throw DiagnosticsUploadNativeError(code: "NETWORK_ERROR", message: "Invalid diagnostics upload response")
    }
    let body = String(data: data, encoding: .utf8) ?? ""
    let clippedBody = body.count > 500 ? String(body.prefix(500)) : body
    diagnosticsUploadLog(
        "completed status=\(httpResponse.statusCode) responseBytes=\(data.count) body=\(clippedBody)"
    )

    if httpResponse.statusCode == 413 {
        throw DiagnosticsUploadNativeError(code: "BUNDLE_TOO_LARGE", message: "Diagnostics bundle too large")
    }

    guard httpResponse.statusCode == 200 else {
        throw DiagnosticsUploadNativeError(
            code: "SERVER_ERROR",
            message: body.isEmpty ? "Diagnostics upload failed with HTTP \(httpResponse.statusCode)" : body
        )
    }

    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let refId = json["ref_id"] as? String,
          let uploadedAt = json["uploaded_at"] as? String else {
        throw DiagnosticsUploadNativeError(code: "SERVER_ERROR", message: "Invalid diagnostics upload response JSON")
    }

    return ["ref_id": refId, "uploaded_at": uploadedAt]
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
            "onPhotoLibraryChanged",
            "onError",
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

    func emitError(_ error: [String: Any]) {
        sendEventOnMain(withName: "onError", body: error)
    }

    func emitPhotoLibraryChanged() {
        sendEventOnMain(withName: "onPhotoLibraryChanged", body: nil)
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
    func uploadDiagnosticsArchive(_ params: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let urlString = params["url"] as? String,
              let uploadURL = URL(string: urlString),
              let archivePath = params["archivePath"] as? String,
              let archiveURL = diagnosticsArchiveURL(from: archivePath),
              let clientId = params["client_id"] as? String,
              !clientId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            reject("INVALID_PARAMS", "Missing diagnostics upload parameters", nil)
            return
        }

        let headers = diagnosticsHeaders(from: params["headers"])
        // Optional user-supplied problem description. Server caps length again, so we
        // only need to ensure non-nil + trim here.
        let note = (params["note"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        Task {
            do {
                let result = try await performDiagnosticsArchiveUpload(
                    archiveURL: archiveURL,
                    uploadURL: uploadURL,
                    clientId: clientId,
                    note: note,
                    headers: headers
                )
                resolve(result)
            } catch let error as DiagnosticsUploadNativeError {
                reject(error.code, error.message, error)
            } catch {
                reject("NETWORK_ERROR", error.localizedDescription, error)
            }
        }
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

    @objc
    func getAssetPreviewSource(_ assetLocalId: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let result = SyncEngineManager.shared.getAssetPreviewSource(
                assetLocalId: assetLocalId as String
            )
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

    @objc
    func cancelAllManualUploads(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        do {
            try SyncEngineManager.shared.cancelAllManualUploads()
            resolve(nil)
        } catch {
            reject("CANCEL_MANUAL_QUEUE_ERROR", error.localizedDescription, error)
        }
    }

    // MARK: - Vivi Drop: Auto Upload Control

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
    func getOwnerUserId(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        // UserDefaults is thread-safe, so no main-actor hop is needed here.
        if let value = SyncEngineManager.shared.getOwnerUserId() {
            resolve(value)
        } else {
            resolve(NSNull())
        }
    }

    @objc
    func setOwnerUserId(_ userId: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        // UserDefaults is thread-safe, so no main-actor hop is needed here.
        // Reject the JS promise if the disk flush failed — the owner marker
        // is the Phase-2 durability anchor and a silent failure here is
        // indistinguishable from "user A never logged in" on the next cold
        // start, which bypasses the owner-mismatch wipe.
        let flushed = SyncEngineManager.shared.setOwnerUserId(userId as String)
        if flushed {
            resolve(nil)
        } else {
            reject(
                "SET_OWNER_USER_ID_FLUSH_FAILED",
                "UserDefaults.synchronize() returned false — owner marker not durably written",
                nil
            )
        }
    }

    @objc
    func getKnownDeviceIds(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let ids = SyncEngineManager.shared.getKnownDeviceIds()
        resolve(ids)
    }
}
