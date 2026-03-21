import Foundation
import Photos
import UIKit
import CryptoKit

@objc
class SyncEngineManager: NSObject, DiscoveryServiceDelegate {
    static let shared = SyncEngineManager()

    let discoveryService = DiscoveryService()
    let bindingService = BindingService()
    let sessionService = SessionService()
    let backgroundService = BackgroundExecutionService()
    let photoScanner = PhotoScanner()
    let exportService = AssetExportService()
    let uploadQueue = UploadQueueManager()
    let transport = TcpTransport()
    private var uploadStore: UploadStore?
    private var historyStore: HistoryLedgerStore?
    private var protocolSession: ProtocolSession?
    private var discoveredDevices: [String: DiscoveredDevice] = [:]  // keyed by deviceId

    private override init() {
        super.init()
        do {
            uploadStore = try UploadStore()
            historyStore = HistoryLedgerStore(store: uploadStore!)
        } catch {
            NSLog("[SyncEngine] Failed to init stores: \(error)")
        }
        uploadQueue.exportService = exportService
        discoveryService.delegate = self

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    // MARK: - App State Transitions

    @objc private func appDidEnterBackground() {
        NSLog("[SyncEngine] app entered background")
        if sessionService.state == .syncingForeground {
            sessionService.transitionTo(.syncingBackground)
            let taskId = backgroundService.beginTransitionTask()
            backgroundService.submitContinuedTask()
            // End transition task after a delay to allow BGTask scheduling
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                self.backgroundService.endTransitionTask(taskId)
            }
        }
    }

    @objc private func appWillEnterForeground() {
        NSLog("[SyncEngine] app entering foreground")
        if sessionService.state == .syncingBackground {
            sessionService.transitionTo(.syncingForeground)
        }
    }

    // MARK: - Sync Pipeline (spec Section 7.3)

    /// Start a full photo scan and serial upload session over the open TCP connection.
    func startSync() {
        NSLog("[SyncEngine] startSync")
        sessionService.transitionTo(.scanning)

        Task {
            do {
                try await runSyncPipeline()
            } catch {
                NSLog("[SyncEngine] sync pipeline failed: \(error)")
                sessionService.transitionTo(.idle)
                NativeSyncEngineModule.shared?.emitError([
                    "code": "SYNC_PIPELINE_ERROR",
                    "message": "\(error)",
                ])
            }
        }
    }

    private func runSyncPipeline() async throws {
        // 1. Request photo permission
        let status = await photoScanner.requestPermission()
        guard status == .authorized || status == .limited else {
            NSLog("[SyncEngine] photo permission denied")
            sessionService.transitionTo(.pausedNoPermission)
            return
        }

        // 2. Scan for assets not yet uploaded
        let clientId = bindingService.getOrCreateClientId()
        let allItems = uploadStore?.getPendingUploadItems() ?? []
        let completedKeys = Set(
            allItems.filter { $0.status == "completed" }.compactMap { $0.fileKey }
        )
        let newAssets = photoScanner.scanForNewAssets(clientId: clientId, completedFileKeys: completedKeys)

        NSLog("[SyncEngine] found \(newAssets.count) new assets to sync")

        guard !newAssets.isEmpty else {
            sessionService.transitionTo(.idle)
            NativeSyncEngineModule.shared?.emitSyncStateChanged([
                "uploadState": "completed",
                "progressPercent": 100,
            ])
            return
        }

        // 3. Start a new session
        let sessionId = sessionService.startNewSession()

        guard let session = protocolSession else {
            throw SyncEngineError.networkError("No active protocol session")
        }

        // 4. SYNC_BEGIN_REQ → SYNC_BEGIN_RES
        let (beginType, beginRes) = try await session.sendAndReceive(type: .syncBeginReq, payload: [
            "sessionId": sessionId,
            "queueTotalCount": newAssets.count,
            "queueTotalBytes": 0,  // actual sizes known only after export
        ])

        guard beginType == .syncBeginRes, beginRes["ok"] as? Bool == true else {
            throw SyncEngineError.networkError("SYNC_BEGIN rejected")
        }

        // 5. Upload each file serially (spec: single file at a time)
        for (index, asset) in newAssets.enumerated() {
            do {
                try await uploadSingleFile(
                    asset: asset,
                    sessionId: sessionId,
                    index: index,
                    total: newAssets.count,
                    session: session
                )
            } catch {
                NSLog("[SyncEngine] upload failed for \(asset.fileKey): \(error)")
                try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "failed")
                // Continue to next file — don't abort the whole session
            }
        }

        // 6. SYNC_END_REQ → SYNC_END_RES
        let (_, _) = try await session.sendAndReceive(type: .syncEndReq, payload: [:])

        sessionService.transitionTo(.idle)
        NativeSyncEngineModule.shared?.emitSyncStateChanged([
            "uploadState": "completed",
            "progressPercent": 100,
        ])
        NSLog("[SyncEngine] sync session \(sessionId) complete")
    }

    // MARK: - Single File Upload (spec Sections 7.3, 7.4)

    private func uploadSingleFile(
        asset: ScannedAsset,
        sessionId: String,
        index: Int,
        total: Int,
        session: ProtocolSession
    ) async throws {
        // Export PHAsset to a temp file
        let exported = try await exportService.exportAsset(asset.asset)
        defer { exportService.cleanup(tempURL: exported.tempURL) }

        try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "uploading")

        // FILE_INIT_REQ → FILE_INIT_RES
        let (initType, initRes) = try await session.sendAndReceive(type: .fileInitReq, payload: [
            "sessionId": sessionId,
            "fileKey": asset.fileKey,
            "originalFilename": exported.originalFilename,
            "mediaType": exported.mediaType,
            "mimeType": exported.mimeType,
            "fileSize": exported.fileSize,
            "createdAt": exported.createdAt,
            "modifiedAt": exported.modifiedAt,
            "queueIndex": index,
            "queueTotalCount": total,
        ])

        guard initType == .fileInitRes else {
            throw SyncEngineError.networkError("Expected FILE_INIT_RES, got \(initType)")
        }

        let action = initRes["action"] as? String ?? "REJECT"

        switch action {
        case "SKIP":
            NSLog("[SyncEngine] SKIP \(exported.originalFilename) (already exists)")
            try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "completed")
            return
        case "REJECT":
            let reason = initRes["reason"] as? String ?? "unknown"
            NSLog("[SyncEngine] REJECT \(exported.originalFilename): \(reason)")
            try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "skipped")
            return
        case "RESUME":
            let offset = initRes["resumeOffset"] as? Int64 ?? 0
            NSLog("[SyncEngine] RESUME \(exported.originalFilename) from offset \(offset)")
            try await streamFileData(
                fileURL: exported.tempURL, fileKey: asset.fileKey,
                startOffset: offset, fileSize: exported.fileSize
            )
        case "UPLOAD":
            NSLog("[SyncEngine] UPLOAD \(exported.originalFilename) (\(exported.fileSize) bytes)")
            try await streamFileData(
                fileURL: exported.tempURL, fileKey: asset.fileKey,
                startOffset: 0, fileSize: exported.fileSize
            )
        default:
            throw SyncEngineError.networkError("Unknown FILE_INIT action: \(action)")
        }

        // FILE_END_REQ → FILE_END_RES
        let sha256 = Self.computeSHA256(fileURL: exported.tempURL)
        let (endType, endRes) = try await session.sendAndReceive(type: .fileEndReq, payload: [
            "fileKey": asset.fileKey,
            "fileSize": exported.fileSize,
            "sha256": sha256,
        ])

        if endType == .fileEndRes, endRes["ok"] as? Bool == true {
            NSLog("[SyncEngine] completed: \(exported.originalFilename)")
            try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "completed")

            // Update daily ledger
            let storedBytes = endRes["storedBytes"] as? Int64 ?? exported.fileSize
            let transmissionMs = endRes["activeTransmissionMs"] as? Int64 ?? 0
            if let binding = uploadStore?.getBinding() {
                let dateStr = String(ISO8601DateFormatter().string(from: Date()).prefix(10))
                try? historyStore?.upsertDailyLedger(
                    date: dateStr,
                    deviceId: binding.deviceId,
                    deviceName: binding.deviceName,
                    deviceIp: binding.host,
                    fileCount: 1,
                    totalBytes: storedBytes,
                    transmissionMs: transmissionMs
                )
            }
        } else {
            throw SyncEngineError.networkError("FILE_END_RES not ok")
        }
    }

    // MARK: - Stream FILE_DATA Chunks (spec Section 7.4, 7.7: 8 MiB chunks)

    private func streamFileData(
        fileURL: URL,
        fileKey: String,
        startOffset: Int64,
        fileSize: Int64
    ) async throws {
        let chunkSize = 8 * 1024 * 1024  // 8 MiB per spec Section 7.7
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { handle.closeFile() }

        handle.seek(toFileOffset: UInt64(startOffset))
        var offset = startOffset

        guard let session = protocolSession else {
            throw SyncEngineError.networkError("No active protocol session")
        }

        while offset < fileSize {
            let data = handle.readData(ofLength: chunkSize)
            if data.isEmpty { break }

            // Send binary FILE_DATA frame
            transport.sendFileData(fileKey: fileKey, offset: offset, chunk: data)

            // Wait for FILE_ACK from server
            let (ackType, ackRes) = try await session.waitForNextMessage()
            if ackType == .fileAck {
                let committedOffset = ackRes["committedOffset"] as? Int64 ?? (offset + Int64(data.count))
                try? uploadStore?.updateUploadOffset(fileKey: fileKey, offset: committedOffset)
            } else if ackType == .error {
                let errMsg = ackRes["message"] as? String ?? "server error"
                throw SyncEngineError.networkError("FILE_DATA error: \(errMsg)")
            }
            // For other unexpected types, just continue

            offset += Int64(data.count)

            // Emit progress to RN
            let progressPercent = fileSize > 0 ? Int(Double(offset) / Double(fileSize) * 100) : 0
            NativeSyncEngineModule.shared?.emitSyncStateChanged([
                "uploadState": "uploading",
                "progressPercent": progressPercent,
                "transferredBytes": offset,
                "totalBytes": fileSize,
                "currentFile": fileKey,
            ])
        }
    }

    // MARK: - SHA-256

    static func computeSHA256(fileURL: URL) -> String {
        guard let handle = try? FileHandle(forReadingFrom: fileURL) else { return "" }
        defer { handle.closeFile() }

        var hasher = SHA256()
        let bufferSize = 1024 * 1024  // 1 MiB chunks for hashing
        while true {
            let data = handle.readData(ofLength: bufferSize)
            if data.isEmpty { break }
            hasher.update(data: data)
        }
        let digest = hasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - DiscoveryServiceDelegate

    func discoveryDidUpdate(devices: [DiscoveredDevice]) {
        NSLog("[SyncEngine] discoveryDidUpdate called with \(devices.count) devices")
        // Cache devices for endpoint lookup during pairing
        for device in devices {
            discoveredDevices[device.deviceId] = device
        }
        let mapped: [[String: Any]] = devices.map { device in
            [
                "deviceId": device.deviceId,
                "name": device.name,
                "ip": device.ip,
                "type": device.type,
                "port": Int(device.port),
                "protoVersion": device.protoVersion,
                "authMode": device.authMode,
                "shareEnabled": device.shareEnabled,
                "shareName": device.shareName ?? NSNull(),
            ]
        }
        if let bridge = NativeSyncEngineModule.shared {
            NSLog("[SyncEngine] emitting \(mapped.count) devices to RN")
            bridge.emitDiscoveredDevices(mapped)
        } else {
            NSLog("[SyncEngine] WARNING: NativeSyncEngineModule.shared is nil, cannot emit")
        }
    }

    // MARK: - Discovery

    func startDiscovery() {
        NSLog("[SyncEngine] startDiscovery - delegate is \(discoveryService.delegate == nil ? "nil" : "set")")
        discoveryService.startBrowsing()
    }

    func stopDiscovery() {
        NSLog("[SyncEngine] stopDiscovery")
        discoveryService.stopBrowsing()
    }

    // MARK: - Permissions

    func requestPhotoPermission() async -> String {
        let status = await photoScanner.requestPermission()
        switch status {
        case .authorized:
            return "granted"
        case .limited:
            return "limited"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        case .notDetermined:
            return "not_determined"
        @unknown default:
            return "unknown"
        }
    }

    // MARK: - Pairing (LMUP/2 handshake — spec Section 7.2)

    func pairDevice(deviceId: String, host: String, port: Int, connectionCode: String) async throws {
        NSLog("[SyncEngine] pairDevice: deviceId=\(deviceId) host=\(host) port=\(port)")

        let session = ProtocolSession(transport: transport)
        protocolSession = session

        // 1. Connect TCP — prefer Bonjour endpoint (avoids IP resolution issues)
        if let cachedDevice = discoveredDevices[deviceId], let endpoint = cachedDevice.endpoint {
            NSLog("[SyncEngine] connecting via Bonjour endpoint")
            try await session.connect(endpoint: endpoint)
        } else if !host.isEmpty {
            NSLog("[SyncEngine] connecting via host:port")
            try await session.connect(host: host, port: UInt16(port))
        } else {
            throw SyncEngineError.networkError("No endpoint or host available for device \(deviceId)")
        }

        let clientId = bindingService.getOrCreateClientId()

        // 2. HELLO_REQ → HELLO_RES  (spec Section 7.8)
        let (helloType, helloRes) = try await session.sendAndReceive(type: .helloReq, payload: [
            "clientId": clientId,
            "clientName": UIDevice.current.name,
            "clientPlatform": "ios",
            "appVersion": "1.0.0",
            "appState": "foreground",
        ])

        guard helloType == .helloRes else {
            throw SyncEngineError.pairingError("Expected HELLO_RES, got \(helloType)")
        }

        let authRequired = helloRes["authRequired"] as? Bool ?? true

        guard authRequired else {
            // Already bound — no PAIR_REQ needed
            NSLog("[SyncEngine] already bound, skipping PAIR_REQ")
            startSync()
            return
        }

        // 3. PAIR_REQ → PAIR_RES  (spec Section 7.8)
        let (pairType, pairRes) = try await session.sendAndReceive(type: .pairReq, payload: [
            "clientId": clientId,
            "clientName": UIDevice.current.name,
            "connectionCode": connectionCode,
        ])

        guard pairType == .pairRes else {
            throw SyncEngineError.pairingError("Expected PAIR_RES, got \(pairType)")
        }

        guard pairRes["ok"] as? Bool == true else {
            let errMsg = pairRes["error"] as? String ?? "unknown"
            throw SyncEngineError.pairingError("Pairing rejected: \(errMsg)")
        }

        // 4. Persist pairing token in Keychain
        if let token = pairRes["pairingToken"] as? String {
            bindingService.savePairingToken(token)
        }

        // 5. Persist binding record in SQLite
        let serverInfo = pairRes["serverInfo"] as? [String: Any] ?? [:]
        let binding = BindingRecord(
            deviceId: serverInfo["serverId"] as? String ?? deviceId,
            deviceName: serverInfo["serverName"] as? String ?? "",
            deviceAlias: nil,
            deviceType: "mac",
            host: host,
            port: port,
            pairingId: pairRes["pairingId"] as? String ?? "",
            pairingTokenKeychainRef: "syncflow_pairing_token",
            shareName: serverInfo["shareName"] as? String,
            lastBoundAt: ISO8601DateFormatter().string(from: Date())
        )
        try uploadStore?.saveBinding(binding)

        // 6. Notify RN bridge
        NativeSyncEngineModule.shared?.emitBindingStateChanged([
            "deviceId": binding.deviceId,
            "deviceName": binding.deviceName,
            "deviceType": binding.deviceType,
            "host": binding.host,
            "port": binding.port,
            "shareName": binding.shareName ?? NSNull(),
            "lastBoundAt": binding.lastBoundAt,
        ])

        NSLog("[SyncEngine] pairing successful — starting sync")
        startSync()
    }

    func disconnectAndUnbind() async throws {
        NSLog("[SyncEngine] disconnectAndUnbind")
        bindingService.clearPairingToken()
        try uploadStore?.clearBinding()
        protocolSession = nil
        transport.disconnect()
        sessionService.endSession()
    }

    // MARK: - State Queries

    func getBindingState() async -> [String: Any]? {
        guard let binding = uploadStore?.getBinding() else {
            return nil
        }
        return [
            "deviceId": binding.deviceId,
            "deviceName": binding.deviceName,
            "deviceAlias": binding.deviceAlias ?? NSNull(),
            "deviceType": binding.deviceType,
            "host": binding.host,
            "port": binding.port,
            "shareName": binding.shareName ?? NSNull(),
            "lastBoundAt": binding.lastBoundAt,
        ]
    }

    func getSyncOverview() async -> [String: Any] {
        let state = sessionService.state.rawValue
        let sessionId = sessionService.currentSessionId ?? ""
        let completedCount = uploadQueue.completedCount
        let totalCount = uploadQueue.totalCount

        return [
            "sessionId": sessionId,
            "state": state,
            "completedCount": completedCount,
            "totalCount": totalCount,
            "currentSpeedMbps": 0,
            "transferredBytes": 0,
            "totalBytes": 0,
            "progressPercent": totalCount > 0 ? (completedCount * 100) / totalCount : 0,
            "uploadState": state,
        ]
    }

    func getReadOnlyQueue() async -> [[String: Any]] {
        // Return pending items from the upload store if available
        guard let store = uploadStore else { return [] }
        let pending = store.getPendingUploadItems()
        return pending.map { item in
            [
                "id": item.id ?? 0,
                "assetLocalId": item.assetLocalId,
                "fileKey": item.fileKey ?? "",
                "originalFilename": item.originalFilename ?? "",
                "mediaType": item.mediaType,
                "fileSize": item.fileSize ?? 0,
                "status": item.status,
                "ackedOffset": item.ackedOffset,
            ] as [String: Any]
        }
    }

    func getHistoryDays(cursor: String?) async -> [String: Any] {
        guard let historyStore else {
            return ["items": [], "nextCursor": NSNull()]
        }
        let result = historyStore.getDailyLedgers(cursor: cursor)
        let items: [[String: Any]] = result.items.map { ledger in
            [
                "ledgerDate": ledger.ledgerDate,
                "deviceId": ledger.deviceId,
                "deviceName": ledger.deviceNameSnapshot,
                "deviceIp": ledger.deviceIpSnapshot,
                "fileCount": ledger.fileCount,
                "totalBytes": ledger.totalBytes,
                "transmissionMs": ledger.activeTransmissionMs,
            ]
        }
        return [
            "items": items,
            "nextCursor": result.nextCursor ?? NSNull(),
        ]
    }

    // MARK: - Settings

    func renameBoundDeviceAlias(alias: String) async throws {
        NSLog("[SyncEngine] renameBoundDeviceAlias \(alias)")
        guard var binding = uploadStore?.getBinding() else {
            throw SyncEngineError.pairingError("No active binding to rename")
        }
        binding.deviceAlias = alias
        try uploadStore?.saveBinding(binding)
    }
}
