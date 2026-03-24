import Foundation
import Photos
import UIKit
import CryptoKit
import Network

private let syncFlowTruthyValues: Set<String> = ["1", "true", "yes", "on"]

func syncFlowBoolSetting(envKey: String, userDefaultsKey: String, defaultValue: Bool = false) -> Bool {
    #if DEBUG
    if let raw = ProcessInfo.processInfo.environment[envKey]?.trimmingCharacters(in: .whitespacesAndNewlines),
       !raw.isEmpty
    {
        return syncFlowTruthyValues.contains(raw.lowercased())
    }

    if let raw = UserDefaults.standard.object(forKey: userDefaultsKey) {
        switch raw {
        case let value as Bool:
            return value
        case let value as NSNumber:
            return value.boolValue
        case let value as String:
            return syncFlowTruthyValues.contains(value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        default:
            break
        }
    }

    return defaultValue
    #else
    return defaultValue
    #endif
}

func syncFlowIntSetting(envKey: String, userDefaultsKey: String) -> Int? {
    #if DEBUG
    if let raw = ProcessInfo.processInfo.environment[envKey]?.trimmingCharacters(in: .whitespacesAndNewlines),
       !raw.isEmpty,
       let value = Int(raw)
    {
        return value
    }

    if let raw = UserDefaults.standard.object(forKey: userDefaultsKey) {
        switch raw {
        case let value as Int:
            return value
        case let value as NSNumber:
            return value.intValue
        case let value as String:
            return Int(value.trimmingCharacters(in: .whitespacesAndNewlines))
        default:
            break
        }
    }

    return nil
    #else
    return nil
    #endif
}

func syncFlowStringSetting(envKey: String, userDefaultsKey: String) -> String? {
    #if DEBUG
    if let raw = ProcessInfo.processInfo.environment[envKey]?.trimmingCharacters(in: .whitespacesAndNewlines),
       !raw.isEmpty
    {
        return raw
    }

    if let raw = UserDefaults.standard.object(forKey: userDefaultsKey) {
        switch raw {
        case let value as String:
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        default:
            break
        }
    }

    return nil
    #else
    return nil
    #endif
}

@objc
class SyncEngineManager: NSObject, DiscoveryServiceDelegate, PhotoScannerDelegate {
    static let shared = SyncEngineManager()

    private enum BindingConnectionState: String {
        case discovering
        case bound
        case connecting
        case connected
        case offline
    }

    let discoveryService = DiscoveryService()
    let bindingService = BindingService()
    let sessionService = SessionService()
    let backgroundService = BackgroundExecutionService()
    let photoScanner = PhotoScanner()
    let exportService = AssetExportService()
    let transport = TcpTransport()
    private var uploadStore: UploadStore?
    private var historyStore: HistoryLedgerStore?
    private var protocolSession: ProtocolSession?
    private var discoveredDevices: [String: DiscoveredDevice] = [:]  // keyed by deviceId
    private var photoLibraryChanged = false  // set by observer, consumed by watch loop
    private var watchLoopContinuation: CheckedContinuation<Void, Never>?
    private var sidecarHost: String?  // resolved IP of Mac, for HTTP heartbeat
    private var transitionBackgroundTaskId: UIBackgroundTaskIdentifier = .invalid
    private var bindingConnectionState: BindingConnectionState = .offline

    private override init() {
        super.init()
        do {
            uploadStore = try UploadStore()
            historyStore = HistoryLedgerStore(store: uploadStore!)
        } catch {
            NSLog("[SyncEngine] Failed to init stores: \(error)")
        }
        if uploadStore?.getBinding() != nil {
            bindingConnectionState = .bound
        }
        discoveryService.delegate = self
        photoScanner.delegate = self

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
        NSLog("[SyncEngine] app entered background, isSyncing=\(isSyncing)")
        guard isSyncing else { return }
        beginBackgroundTransitionIfNeeded(reason: "didEnterBackground")
        if sessionService.state == .syncingForeground {
            sessionService.transitionTo(.syncingBackground)
        }
    }

    @objc private func appWillEnterForeground() {
        NSLog("[SyncEngine] app entering foreground")
        endBackgroundTransitionIfNeeded(reason: "willEnterForeground")
        if sessionService.state == .syncingBackground {
            sessionService.transitionTo(.syncingForeground)
        }
    }

    // MARK: - Sync Pipeline (spec Section 7.3)

    private var isSyncing = false

    private func bindingStatePayload(
        binding overrideBinding: BindingRecord? = nil,
        connectionState overrideConnectionState: BindingConnectionState? = nil
    ) -> [String: Any]? {
        guard let binding = overrideBinding ?? uploadStore?.getBinding() else {
            return nil
        }

        return [
            "deviceId": binding.deviceId,
            "deviceName": binding.deviceName,
            "deviceAlias": binding.deviceAlias ?? binding.deviceName,
            "deviceType": binding.deviceType,
            "host": binding.host,
            "port": binding.port,
            "connectionState": (overrideConnectionState ?? bindingConnectionState).rawValue,
            "pairingId": binding.pairingId,
            "shareEnabled": binding.shareName != nil,
            "shareName": binding.shareName ?? NSNull(),
            "lastBoundAt": binding.lastBoundAt,
        ]
    }

    private func emitBindingStateChanged() {
        NativeSyncEngineModule.shared?.emitBindingStateChanged(bindingStatePayload())
    }

    private func updateBindingConnectionState(_ newState: BindingConnectionState, reason: String) {
        guard bindingConnectionState != newState else { return }
        NSLog("[SyncEngine] binding connection state %@ -> %@ (%@)",
              bindingConnectionState.rawValue,
              newState.rawValue,
              reason)
        bindingConnectionState = newState
        emitBindingStateChanged()
    }

    private func currentAppStateLabel() -> String {
        switch UIApplication.shared.applicationState {
        case .background:
            return "background"
        default:
            return sessionService.state == .syncingBackground ? "background" : "foreground"
        }
    }

    private func beginBackgroundTransitionIfNeeded(reason: String) {
        guard transitionBackgroundTaskId == .invalid else { return }
        transitionBackgroundTaskId = backgroundService.beginTransitionTask()
        NSLog("[BackgroundExec] began transition task reason=%@", reason)
    }

    private func endBackgroundTransitionIfNeeded(reason: String) {
        guard transitionBackgroundTaskId != .invalid else { return }
        backgroundService.endTransitionTask(transitionBackgroundTaskId)
        transitionBackgroundTaskId = .invalid
        NSLog("[BackgroundExec] ended transition task reason=%@", reason)
    }

    private func stopSyncLifecycle(finalState: SessionService.SyncEngineState) {
        isSyncing = false
        endBackgroundTransitionIfNeeded(reason: "syncStopped")
        SilentAudioService.shared.stop()
        sessionService.transitionTo(finalState)
    }

    private struct UploadTuning {
        let perfLoggingEnabled: Bool
        let chunkSizeBytes: Int
        let targetInFlightBytes: Int64
        let maxPipelineChunks: Int
        let ackTimeoutNs: UInt64
    }

    private func resolvedUploadTuning() -> UploadTuning {
        let perfLoggingEnabled = syncFlowBoolSetting(
            envKey: "SYNCFLOW_UPLOAD_PERF_LOG",
            userDefaultsKey: "SyncFlowUploadPerfLog"
        )
        let chunkMB = min(
            max(syncFlowIntSetting(
                envKey: "SYNCFLOW_UPLOAD_CHUNK_MB",
                userDefaultsKey: "SyncFlowUploadChunkMB"
            ) ?? 32, 1),
            48
        )
        let windowMB = min(
            max(syncFlowIntSetting(
                envKey: "SYNCFLOW_UPLOAD_WINDOW_MB",
                userDefaultsKey: "SyncFlowUploadWindowMB"
            ) ?? 512, chunkMB),
            1024
        )
        let maxPipelineChunks = min(
            max(syncFlowIntSetting(
                envKey: "SYNCFLOW_UPLOAD_PIPELINE_CHUNKS",
                userDefaultsKey: "SyncFlowUploadPipelineChunks"
            ) ?? 64, 1),
            128
        )
        let ackTimeoutSec = min(
            max(syncFlowIntSetting(
                envKey: "SYNCFLOW_UPLOAD_ACK_TIMEOUT_SEC",
                userDefaultsKey: "SyncFlowUploadAckTimeoutSec"
            ) ?? 8, 2),
            60
        )

        return UploadTuning(
            perfLoggingEnabled: perfLoggingEnabled,
            chunkSizeBytes: chunkMB * 1024 * 1024,
            targetInFlightBytes: Int64(windowMB) * 1024 * 1024,
            maxPipelineChunks: maxPipelineChunks,
            ackTimeoutNs: UInt64(ackTimeoutSec) * 1_000_000_000
        )
    }

    private func perfLog(_ message: String) {
        guard syncFlowBoolSetting(
            envKey: "SYNCFLOW_UPLOAD_PERF_LOG",
            userDefaultsKey: "SyncFlowUploadPerfLog"
        ) else {
            return
        }
        NSLog("[SyncPerf] %@", message)
    }

    private func resolvedForcedSidecarTarget() -> (host: String, port: UInt16)? {
        guard let host = syncFlowStringSetting(
            envKey: "SYNCFLOW_UPLOAD_FORCE_HOST",
            userDefaultsKey: "SyncFlowUploadForceHost"
        ) else {
            return nil
        }

        let portValue = syncFlowIntSetting(
            envKey: "SYNCFLOW_UPLOAD_FORCE_PORT",
            userDefaultsKey: "SyncFlowUploadForcePort"
        ) ?? 39393
        let clampedPort = min(max(portValue, 1), Int(UInt16.max))
        return (host: host, port: UInt16(clampedPort))
    }

    private func isRetryableSyncError(_ error: Error) -> Bool {
        if error is CancellationError {
            return false
        }
        if let syncError = error as? SyncEngineError {
            switch syncError {
            case .networkError:
                return true
            case .databaseError, .pairingError, .permissionError:
                return false
            }
        }
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain
    }

    private func retryDelayNs(forAttempt attempt: Int) -> UInt64 {
        let clampedAttempt = max(1, attempt)
        let exponent = min(clampedAttempt - 1, 4)
        let baseDelaySeconds = UInt64(2 << exponent)
        let jitterMs = UInt64(Int.random(in: 0...1000))
        let jitterNs = jitterMs * 1_000_000
        return min(baseDelaySeconds * 1_000_000_000 + jitterNs, 30_000_000_000)
    }

    private func clearResolvedSidecarHost() {
        guard resolvedForcedSidecarTarget() == nil else { return }
        sidecarHost = nil
    }

    /// Start a full photo scan and serial upload session over the open TCP connection.
    func startSync() {
        guard !isSyncing else {
            NSLog("[SyncEngine] startSync skipped — already syncing")
            return
        }
        isSyncing = true
        NSLog("[SyncEngine] startSync")
        sessionService.transitionTo(.scanning)
        backgroundService.submitContinuedTask()
        SilentAudioService.shared.start()
        if UIApplication.shared.applicationState == .background {
            beginBackgroundTransitionIfNeeded(reason: "startSyncWhileBackgrounded")
        }

        Task {
            do {
                try await runSyncPipeline()
            } catch {
                NSLog("[SyncEngine] sync pipeline failed: \(error)")
                self.protocolSession?.disconnect()
                self.protocolSession = nil
                self.clearResolvedSidecarHost()
                if self.uploadStore?.getBinding() != nil {
                    self.updateBindingConnectionState(.offline, reason: "pipeline_failed")
                }
                self.stopSyncLifecycle(finalState: .idle)
                NativeSyncEngineModule.shared?.emitError([
                    "code": "SYNC_PIPELINE_ERROR",
                    "message": "\(error)",
                ])
            }
        }
    }

    private func runSyncPipeline() async throws {
        NSLog("[SyncPipeline] START")

        // 0. Check prerequisites
        guard let binding = uploadStore?.getBinding() else {
            throw SyncEngineError.pairingError("No binding found — pair first")
        }
        guard let token = bindingService.getPairingToken() else {
            NSLog("[SyncPipeline] pairing token missing — clearing stale binding, need re-pair")
            try? uploadStore?.clearBinding()
            bindingConnectionState = .offline
            stopSyncLifecycle(finalState: .idle)
            NativeSyncEngineModule.shared?.emitBindingStateChanged(nil)
            return
        }

        // 1. Request photo permission
        let permStatus = await photoScanner.requestPermission()
        guard permStatus == .authorized || permStatus == .limited else {
            NSLog("[SyncEngine] photo permission denied")
            stopSyncLifecycle(finalState: .pausedNoPermission)
            return
        }

        // 2. Start observing photo library for new assets
        photoScanner.startObserving()

        let clientId = bindingService.getOrCreateClientId()

        // 3. Resolve sidecar IP for HTTP heartbeat (connect TCP briefly)
        if sidecarHost == nil {
            do {
                try await resolveSidecarHost(binding: binding, token: token, clientId: clientId)
            } catch {
                NSLog("[SyncPipeline] failed to resolve sidecar host: %@", "\(error)")
            }
        }

        // 4. Continuous loop: scan → connect → upload → disconnect → wait → repeat
        var roundNumber = 0

        while true {
            roundNumber += 1
            sessionService.transitionTo(.scanning)

            // Scan for new assets
            let completedKeys = Set(uploadStore?.getCompletedFileKeys() ?? [])
            let newAssets = photoScanner.scanForNewAssets(clientId: clientId, completedFileKeys: completedKeys)
            NSLog("[SyncPipeline] round %d: %d new assets (completed: %d)", roundNumber, newAssets.count, completedKeys.count)

            if newAssets.isEmpty {
                // Nothing to upload — wait for photo library changes
                NativeSyncEngineModule.shared?.emitSyncStateChanged([
                    "uploadState": "completed",
                    "progressPercent": 100,
                ])

                NSLog("[SyncPipeline] idle — waiting for new photos...")
                sessionService.transitionTo(.idle)
                photoLibraryChanged = false

                // Wait loop: send HTTP presence heartbeat every 30s while idle
                while !photoLibraryChanged {
                    sendPresenceHeartbeat(clientId: clientId)
                    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                        if photoLibraryChanged {
                            cont.resume()
                            return
                        }
                        watchLoopContinuation = cont
                        DispatchQueue.global().asyncAfter(deadline: .now() + 30) { [weak self] in
                            self?.watchLoopContinuation?.resume()
                            self?.watchLoopContinuation = nil
                        }
                    }
                }
                try await Task.sleep(nanoseconds: 2_000_000_000) // debounce
                photoLibraryChanged = false
                continue
            }

            // Write scanned assets to DB
            for asset in newAssets {
                let item = UploadItemRecord(
                    id: nil,
                    assetLocalId: asset.asset.localIdentifier,
                    modifiedAt: asset.asset.modificationDate?.iso8601String ?? "",
                    mediaType: asset.mediaType,
                    originalFilename: asset.originalFilename,
                    fileKey: asset.fileKey,
                    fileSize: asset.estimatedSize,
                    status: "queued",
                    tempFilePath: nil,
                    ackedOffset: 0,
                    lastErrorCode: nil,
                    updatedAt: ISO8601DateFormatter().string(from: Date())
                )
                try? uploadStore?.upsertUploadItem(item)
            }
            emitQueueToJS()

            // Connect, upload, disconnect — with retry on error
            var retryAttempt = 0
            let maxRetryDelay: UInt64 = 30_000_000_000
            var uploaded = false

            while !uploaded {
                do {
                    try await connectAndUpload(
                        binding: binding,
                        token: token,
                        clientId: clientId,
                        assets: newAssets,
                        recoveryMode: retryAttempt > 0
                    )
                    uploaded = true
                    photoLibraryChanged = false // reset after round
                } catch {
                    if !isRetryableSyncError(error) {
                        NSLog("[SyncPipeline] upload failed with non-retryable error: %@", "\(error)")
                        throw error
                    }

                    retryAttempt += 1
                    let delay = min(retryDelayNs(forAttempt: retryAttempt), maxRetryDelay)
                    let delaySeconds = Double(delay) / 1_000_000_000

                    clearResolvedSidecarHost()
                    updateBindingConnectionState(.offline, reason: "retryable_upload_failure")
                    sessionService.transitionTo(.backoffWaiting)
                    NSLog("[SyncPipeline] upload failed with retryable error: %@ — reconnecting in %.1fs (attempt %d)",
                          "\(error)", delaySeconds, retryAttempt)
                    NativeSyncEngineModule.shared?.emitSyncStateChanged([
                        "uploadState": "reconnecting",
                        "retryAttempt": retryAttempt,
                        "retryDelaySec": round(delaySeconds * 10) / 10,
                    ])
                    try await Task.sleep(nanoseconds: delay)
                    discoveryService.startBrowsing()
                }
            }
        }
    }

    /// Connect TCP, authenticate, upload given assets, disconnect.
    /// Throws on connection/auth/protocol errors (caller handles retry).
    private func connectAndUpload(
        binding: BindingRecord,
        token: String,
        clientId: String,
        assets: [ScannedAsset],
        recoveryMode: Bool
    ) async throws {
        // Connect TCP + auth
        let newTransport = TcpTransport()
        let session = ProtocolSession(transport: newTransport)
        protocolSession = session
        updateBindingConnectionState(.connecting, reason: "connect_and_upload_started")
        sessionService.transitionTo(.preparing)
        var activeSessionId: String?
        var uploadRoundCompleted = false

        defer {
            if let activeSessionId, sessionService.currentSessionId == activeSessionId {
                sessionService.endSession()
            }
            if protocolSession === session {
                protocolSession = nil
            }
            session.disconnect()
            if !uploadRoundCompleted {
                clearResolvedSidecarHost()
                if uploadStore?.getBinding() != nil {
                    updateBindingConnectionState(.offline, reason: "upload_round_incomplete")
                }
            }
        }

        if let forcedTarget = resolvedForcedSidecarTarget() {
            try await session.connect(host: forcedTarget.host, port: forcedTarget.port)
            sidecarHost = forcedTarget.host
            NSLog("[SyncPipeline] TCP connected via forced host %@:%d", forcedTarget.host, Int(forcedTarget.port))
        } else {
            // Find target device
            func findDevice() -> DiscoveredDevice? {
                if let exact = discoveredDevices[binding.deviceId], exact.endpoint != nil {
                    return exact
                }
                return discoveredDevices.values.first(where: { $0.endpoint != nil })
            }

            var targetEndpoint = findDevice()?.endpoint
            if targetEndpoint == nil {
                discoveryService.startBrowsing()
                for _ in 0..<20 {
                    try await Task.sleep(nanoseconds: 500_000_000)
                    if let found = findDevice() {
                        targetEndpoint = found.endpoint
                        break
                    }
                }
            }
            guard let endpoint = targetEndpoint else {
                throw SyncEngineError.networkError("Target device not found on network")
            }

            try await session.connect(endpoint: endpoint)
            sidecarHost = newTransport.remoteHost
            NSLog("[SyncPipeline] TCP connected to %@", sidecarHost ?? "unknown")
        }

        let (helloType, helloRes) = try await session.sendAndReceive(type: .helloReq, payload: [
            "clientId": clientId,
            "clientName": getClientDisplayName(),
            "clientPlatform": "ios",
            "appVersion": "1.0.0",
            "pairingToken": token,
            "appState": currentAppStateLabel(),
        ])
        guard helloType == .helloRes else {
            throw SyncEngineError.networkError("Expected HELLO_RES")
        }
        if let nonce = helloRes["nonce"] as? String {
            let hmac = newTransport.computeHMAC(token: token, nonce: nonce)
            let (authType, _) = try await session.sendAndReceive(type: .authReq, payload: [
                "clientId": clientId,
                "auth": hmac,
            ])
            if authType == .error {
                throw SyncEngineError.pairingError("HMAC auth failed")
            }
            NSLog("[SyncPipeline] auth successful")
        }
        updateBindingConnectionState(.connected, reason: "auth_success")

        // SYNC_BEGIN
        let sessionId = sessionService.startNewSession()
        activeSessionId = sessionId
        let (beginType, beginRes) = try await session.sendAndReceive(type: .syncBeginReq, payload: [
            "sessionId": sessionId,
            "queueTotalCount": assets.count,
            "queueTotalBytes": 0,
        ])
        let syncOk: Bool
        if let b = beginRes["ok"] as? Bool { syncOk = b }
        else if let n = beginRes["ok"] as? NSNumber { syncOk = n.boolValue }
        else { syncOk = (beginType == .syncBeginRes) }

        guard syncOk else {
            throw SyncEngineError.networkError("SYNC_BEGIN rejected")
        }

        NSLog("[SyncPipeline] uploading %d files", assets.count)

        // Upload files with prefetch: export next file while current uploads
        var nextExport: ExportedFile? = nil
        if !assets.isEmpty {
            nextExport = try? await exportService.exportAsset(assets[0].asset)
        }

        for (index, asset) in assets.enumerated() {
            let exported: ExportedFile
            if let prefetched = nextExport {
                exported = prefetched
                nextExport = nil
            } else {
                exported = try await exportService.exportAsset(asset.asset)
            }

            let nextIndex = index + 1
            if nextIndex < assets.count {
                let nextAsset = assets[nextIndex]
                Task {
                    nextExport = try? await self.exportService.exportAsset(nextAsset.asset)
                }
            }

            do {
                defer {
                    exportService.cleanup(tempURL: exported.tempURL)
                }
                try await uploadSingleFileWithExport(
                    asset: asset,
                    exported: exported,
                    sessionId: sessionId,
                    index: index,
                    total: assets.count,
                    session: session,
                    recoveryMode: recoveryMode
                )
            } catch {
                if isRetryableSyncError(error) {
                    NSLog("[SyncEngine] retryable upload failure for %@: %@", asset.fileKey, "\(error)")
                    try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                    emitQueueToJS()
                    throw error
                }

                NSLog("[SyncEngine] non-retryable upload failure for %@: %@", asset.fileKey, "\(error)")
                try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "failed")
                emitQueueToJS()
            }
        }

        // SYNC_END — then TCP will be closed as this function returns
        let (_, _) = try await session.sendAndReceive(type: .syncEndReq, payload: [:])
        uploadRoundCompleted = true
        NSLog("[SyncPipeline] upload round complete, disconnecting TCP")
    }

    // MARK: - Single File Upload (spec Sections 7.3, 7.4)

    private func uploadSingleFileWithExport(
        asset: ScannedAsset,
        exported: ExportedFile,
        sessionId: String,
        index: Int,
        total: Int,
        session: ProtocolSession,
        recoveryMode: Bool
    ) async throws {
        let tuning = resolvedUploadTuning()
        let fileTransferStart = CFAbsoluteTimeGetCurrent()
        try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "uploading")
        // Update filename + size now that we know them from export
        if var item = uploadStore?.getUploadItemByFileKey(asset.fileKey) {
            item.originalFilename = exported.originalFilename
            item.fileSize = exported.fileSize
            try? uploadStore?.upsertUploadItem(item)
        }
        emitQueueToJS()

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
            if tuning.perfLoggingEnabled {
                perfLog("file=\(asset.fileKey) action=SKIP size=\(exported.fileSize)")
            }
            NSLog("[SyncEngine] SKIP \(exported.originalFilename) (already exists)")
            try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "completed")
            return
        case "REJECT":
            let reason = initRes["reason"] as? String ?? "unknown"
            if tuning.perfLoggingEnabled {
                perfLog("file=\(asset.fileKey) action=REJECT reason=\(reason) size=\(exported.fileSize)")
            }
            NSLog("[SyncEngine] REJECT \(exported.originalFilename): \(reason)")
            try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "skipped")
            return
        case "RESUME":
            let offset = initRes["resumeOffset"] as? Int64 ?? 0
            if tuning.perfLoggingEnabled {
                perfLog("file=\(asset.fileKey) action=RESUME resumeOffset=\(offset) size=\(exported.fileSize)")
            }
            NSLog("[SyncEngine] RESUME \(exported.originalFilename) from offset \(offset)")
            try await streamFileData(
                fileURL: exported.tempURL, fileKey: asset.fileKey,
                startOffset: offset, fileSize: exported.fileSize,
                recoveryMode: true
            )
        case "UPLOAD":
            if tuning.perfLoggingEnabled {
                perfLog("file=\(asset.fileKey) action=UPLOAD size=\(exported.fileSize)")
            }
            NSLog("[SyncEngine] UPLOAD \(exported.originalFilename) (\(exported.fileSize) bytes)")
            try await streamFileData(
                fileURL: exported.tempURL, fileKey: asset.fileKey,
                startOffset: 0, fileSize: exported.fileSize,
                recoveryMode: recoveryMode
            )
        default:
            throw SyncEngineError.networkError("Unknown FILE_INIT action: \(action)")
        }

        // FILE_END_REQ → FILE_END_RES
        let sha256 = "" // Skip SHA256 for speed; server validates file size instead

        var (endType, endRes) = try await session.sendAndReceive(type: .fileEndReq, payload: [
            "fileKey": asset.fileKey,
            "fileSize": exported.fileSize,
            "sha256": sha256,
        ])

        // FILE_ACK can still arrive in-flight because FILE_DATA uses a small pipeline.
        // Keep draining until we get FILE_END_RES / ERROR.
        if endType != .fileEndRes && endType != .error {
            for _ in 0..<8 {
                let (nextType, nextRes) = try await session.waitForNextMessage()
                endType = nextType
                endRes = nextRes
                if endType == .fileEndRes || endType == .error {
                    break
                }
            }
        }

        // Check ok field — NSNumber from JSON might need special handling
        let isOk: Bool
        if let okBool = endRes["ok"] as? Bool { isOk = okBool }
        else if let okNum = endRes["ok"] as? NSNumber { isOk = okNum.boolValue }
        else if let okInt = endRes["ok"] as? Int { isOk = okInt != 0 }
        else { isOk = (endType == .fileEndRes) }

        // Always mark as completed + update history if we got a response
        try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: isOk ? "completed" : "failed")
        emitQueueToJS()

        if isOk {
            let transmissionMs = endRes["activeTransmissionMs"] as? Int64
                ?? (endRes["activeTransmissionMs"] as? NSNumber)?.int64Value
                ?? 100
            let binding = uploadStore?.getBinding()
            if let binding = binding {
                let dateStr = String(ISO8601DateFormatter().string(from: Date()).prefix(10))
                let ip = binding.host.isEmpty ? (binding.deviceAlias ?? binding.deviceName) : binding.host
                do {
                    try historyStore?.upsertDailyLedger(
                        date: dateStr,
                        deviceId: binding.deviceId,
                        deviceName: binding.deviceName,
                        deviceIp: ip,
                        fileCount: 1,
                        totalBytes: exported.fileSize,
                        transmissionMs: max(transmissionMs, 100)
                    )
                } catch {
                    NSLog("[SyncUpload] [%d/%d] ledger update FAILED: %@", index + 1, total, error.localizedDescription)
                }
                NativeSyncEngineModule.shared?.emitHistoryUpdated()
            }
            if tuning.perfLoggingEnabled {
                let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - fileTransferStart) * 1000)
                perfLog(
                    "file=\(asset.fileKey) action=COMPLETE size=\(exported.fileSize) endToEndMs=\(elapsedMs) sidecarActiveMs=\(transmissionMs)"
                )
            }
            NSLog("[SyncUpload] [%d/%d] completed %@", index + 1, total, exported.originalFilename)
        } else {
            if tuning.perfLoggingEnabled {
                let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - fileTransferStart) * 1000)
                perfLog("file=\(asset.fileKey) action=FAILED size=\(exported.fileSize) endToEndMs=\(elapsedMs)")
            }
            NSLog("[SyncUpload] [%d/%d] FILE_END not ok for %@", index + 1, total, exported.originalFilename)
        }
    }

    // MARK: - Stream FILE_DATA Chunks (spec Section 7.4, 7.7: 8 MiB chunks)

    // MARK: - Upload Throttle (set to 0 for full speed)
    /// Bytes per second limit. 0 = unlimited.
    private let uploadThrottleBytesPerSec: Int64 = 0

    private func streamFileData(
        fileURL: URL,
        fileKey: String,
        startOffset: Int64,
        fileSize: Int64,
        recoveryMode: Bool
    ) async throws {
        struct InFlightChunk {
            let offset: Int64
            let size: Int64
            let sendStartedAt: CFTimeInterval
        }

        let tuning = resolvedUploadTuning()
        let ackTimeoutNs = tuning.ackTimeoutNs
        let ackTimeoutSafetyMarginNs: UInt64 = 2_000_000_000
        let ackTimeoutFloorBytesPerSec = Double(3 * 1024 * 1024)

        func waitForAck(
            session: ProtocolSession,
            timeoutNs: UInt64
        ) async throws -> (LMUPMessageType, [String: Any]) {
            try await withThrowingTaskGroup(of: (LMUPMessageType, [String: Any]).self) { group in
                group.addTask {
                    try await session.waitForNextMessage()
                }
                group.addTask {
                    try await Task.sleep(nanoseconds: timeoutNs)
                    throw SyncEngineError.networkError("FILE_ACK timeout")
                }
                guard let next = try await group.next() else {
                    throw SyncEngineError.networkError("No FILE_ACK result")
                }
                group.cancelAll()
                return next
            }
        }

        func adaptiveAckTimeoutNs(
            baseTimeoutNs: UInt64,
            chunkSize: Int,
            maxObservedAckWait: CFTimeInterval
        ) -> UInt64 {
            let chunkBudgetNs = UInt64((Double(chunkSize) / ackTimeoutFloorBytesPerSec) * 1_000_000_000)
            let sizeBasedTimeoutNs = chunkBudgetNs + ackTimeoutSafetyMarginNs

            var observedTimeoutNs: UInt64 = 0
            if maxObservedAckWait > 0 {
                observedTimeoutNs = UInt64(maxObservedAckWait * 2.0 * 1_000_000_000) + ackTimeoutSafetyMarginNs
            }

            return max(baseTimeoutNs, sizeBasedTimeoutNs, observedTimeoutNs)
        }

        let chunkSize = uploadThrottleBytesPerSec > 0
            ? Int(min(Int64(512 * 1024), uploadThrottleBytesPerSec))  // smaller chunks when throttled
            : tuning.chunkSizeBytes
        // Keep a deep flight window for high-bandwidth LANs.
        let targetInFlightBytes = tuning.targetInFlightBytes
        let maxPipelineChunks = tuning.maxPipelineChunks
        let computedWindowChunks = Int(targetInFlightBytes / Int64(chunkSize))
        let steadyStatePipelineWindowChunks = uploadThrottleBytesPerSec > 0
            ? 2
            : min(max(2, computedWindowChunks), maxPipelineChunks)
        let conservativeStart = recoveryMode || startOffset > 0
        let recoveryPipelineWindowChunks = min(2, steadyStatePipelineWindowChunks)
        let recoveryMaxInFlightBytes = Int64(chunkSize * recoveryPipelineWindowChunks)
        let steadyStateMaxInFlightBytes = Int64(chunkSize * steadyStatePipelineWindowChunks)
        let recoveryAckTimeoutNs = max(ackTimeoutNs, 30_000_000_000)
        let progressPersistBytes: Int64 = 64 * 1024 * 1024
        let progressPersistInterval: CFTimeInterval = 2.0
        let progressEmitInterval: CFTimeInterval = 0.5
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { handle.closeFile() }

        handle.seek(toFileOffset: UInt64(startOffset))
        var nextOffset = startOffset
        var acknowledgedOffset = startOffset
        var inFlight: [InFlightChunk] = []
        var inFlightBytes: Int64 = 0
        var speedBytesLastCheck = startOffset
        var speedLastTime = CFAbsoluteTimeGetCurrent()
        var progressPersistOffset = startOffset
        var progressPersistTime = speedLastTime
        var lastProgressEmitTime = speedLastTime
        var speedMbps: Double = 0
        var totalReadBytes: Int64 = 0
        var totalReadTime: CFTimeInterval = 0
        var totalAckWaitTime: CFTimeInterval = 0
        var ackCount = 0
        var peakInFlightBytes: Int64 = 0
        var totalAckRoundTripTime: CFTimeInterval = 0
        var maxAckRoundTripTime: CFTimeInterval = 0
        var ackedChunkCount = 0
        var totalSendEnqueueTime: CFTimeInterval = 0
        var maxSendEnqueueTime: CFTimeInterval = 0
        var sendEnqueueCount = 0
        var totalWindowFillTime: CFTimeInterval = 0
        var maxWindowFillTime: CFTimeInterval = 0
        var windowFillCount = 0
        var maxAckWaitTime: CFTimeInterval = 0
        let transferStart = CFAbsoluteTimeGetCurrent()
        var streamOutcome = "STREAM_DONE"
        var streamFailure = ""

        guard let session = protocolSession else {
            throw SyncEngineError.networkError("No active protocol session")
        }

        func oldestInFlightAgeMs(now: CFTimeInterval) -> Int {
            guard let first = inFlight.first else { return 0 }
            return Int(max(now - first.sendStartedAt, 0) * 1000)
        }

        func emitStreamSummary() {
            guard tuning.perfLoggingEnabled else { return }
            let elapsed = max(CFAbsoluteTimeGetCurrent() - transferStart, 0.001)
            let ackedBytes = max(acknowledgedOffset - startOffset, 0)
            let avgAckWaitMs = ackCount > 0 ? (totalAckWaitTime * 1000) / Double(ackCount) : 0
            let avgAckRoundTripMs = ackedChunkCount > 0 ? (totalAckRoundTripTime * 1000) / Double(ackedChunkCount) : 0
            let avgSendEnqueueMs = sendEnqueueCount > 0 ? (totalSendEnqueueTime * 1000) / Double(sendEnqueueCount) : 0
            let avgWindowFillMs = windowFillCount > 0 ? (totalWindowFillTime * 1000) / Double(windowFillCount) : 0
            let throughputMBps = Double(ackedBytes) / elapsed / (1024 * 1024)
            let bufferedMessages = session.debugBufferedMessageCount()
            let now = CFAbsoluteTimeGetCurrent()

            var logLine =
                "file=\(fileKey) action=\(streamOutcome) ackedMiB=\(String(format: "%.1f", Double(ackedBytes) / (1024 * 1024))) elapsedMs=\(Int(elapsed * 1000)) throughputMBps=\(String(format: "%.1f", throughputMBps)) readMs=\(Int(totalReadTime * 1000)) sendEnqueueMs=\(Int(totalSendEnqueueTime * 1000)) avgSendEnqueueMs=\(String(format: "%.1f", avgSendEnqueueMs)) maxSendEnqueueMs=\(Int(maxSendEnqueueTime * 1000)) windowFillMs=\(Int(totalWindowFillTime * 1000)) avgWindowFillMs=\(String(format: "%.1f", avgWindowFillMs)) maxWindowFillMs=\(Int(maxWindowFillTime * 1000)) windowFillCount=\(windowFillCount) ackWaitMs=\(Int(totalAckWaitTime * 1000)) avgAckWaitMs=\(String(format: "%.1f", avgAckWaitMs)) maxAckWaitMs=\(Int(maxAckWaitTime * 1000)) ackCount=\(ackCount) avgAckRttMs=\(String(format: "%.1f", avgAckRoundTripMs)) maxAckRttMs=\(Int(maxAckRoundTripTime * 1000)) bufferedMessages=\(bufferedMessages) nextOffsetMiB=\(String(format: "%.1f", Double(nextOffset) / (1024 * 1024))) inFlightMiB=\(String(format: "%.1f", Double(inFlightBytes) / (1024 * 1024))) oldestInFlightMs=\(oldestInFlightAgeMs(now: now)) peakInFlightMiB=\(String(format: "%.1f", Double(peakInFlightBytes) / (1024 * 1024))) readMiB=\(String(format: "%.1f", Double(totalReadBytes) / (1024 * 1024)))"

            if !streamFailure.isEmpty {
                logLine += " error=\(streamFailure)"
            }

            perfLog(logLine)
        }

        defer {
            emitStreamSummary()
        }

        if tuning.perfLoggingEnabled {
            perfLog(
                "file=\(fileKey) action=STREAM_START chunkMiB=\(String(format: "%.1f", Double(chunkSize) / (1024 * 1024))) windowMiB=\(String(format: "%.1f", Double(steadyStateMaxInFlightBytes) / (1024 * 1024))) pipelineChunks=\(steadyStatePipelineWindowChunks) ackTimeoutNs=\(ackTimeoutNs) recoveryMode=\(conservativeStart) recoveryWindowMiB=\(String(format: "%.1f", Double(recoveryMaxInFlightBytes) / (1024 * 1024))) recoveryAckTimeoutNs=\(recoveryAckTimeoutNs)"
            )
        }

        while acknowledgedOffset < fileSize {
            let activeMaxInFlightBytes = conservativeStart && ackCount == 0
                ? recoveryMaxInFlightBytes
                : steadyStateMaxInFlightBytes
            // Fill pipeline window with new chunks.
            let windowFillStart = CFAbsoluteTimeGetCurrent()
            var windowFillReadTime: CFTimeInterval = 0
            var windowFillEnqueueTime: CFTimeInterval = 0
            var windowFillChunks = 0
            let windowFillStartOffset = nextOffset
            while nextOffset < fileSize && inFlightBytes < activeMaxInFlightBytes {
                let remaining = fileSize - nextOffset
                let readSize = Int(min(Int64(chunkSize), remaining))
                let readStart = CFAbsoluteTimeGetCurrent()
                let data = handle.readData(ofLength: readSize)
                let readElapsed = CFAbsoluteTimeGetCurrent() - readStart
                totalReadTime += readElapsed
                windowFillReadTime += readElapsed
                if data.isEmpty { break }

                let chunkOffset = nextOffset
                let sendStartedAt = CFAbsoluteTimeGetCurrent()
                session.sendFileData(fileKey: fileKey, offset: chunkOffset, chunk: data)
                let sendEnqueueElapsed = CFAbsoluteTimeGetCurrent() - sendStartedAt
                totalSendEnqueueTime += sendEnqueueElapsed
                maxSendEnqueueTime = max(maxSendEnqueueTime, sendEnqueueElapsed)
                windowFillEnqueueTime += sendEnqueueElapsed
                sendEnqueueCount += 1
                let sentBytes = Int64(data.count)
                totalReadBytes += sentBytes
                inFlight.append(InFlightChunk(
                    offset: chunkOffset,
                    size: sentBytes,
                    sendStartedAt: sendStartedAt
                ))
                inFlightBytes += sentBytes
                peakInFlightBytes = max(peakInFlightBytes, inFlightBytes)
                nextOffset += sentBytes
                windowFillChunks += 1

                // Throttle: sleep to limit upload speed
                if uploadThrottleBytesPerSec > 0 {
                    let sleepNs = UInt64(Double(data.count) / Double(uploadThrottleBytesPerSec) * 1_000_000_000)
                    try await Task.sleep(nanoseconds: sleepNs)
                }
            }

            let windowFillElapsed = CFAbsoluteTimeGetCurrent() - windowFillStart
            totalWindowFillTime += windowFillElapsed
            maxWindowFillTime = max(maxWindowFillTime, windowFillElapsed)
            windowFillCount += 1

            if tuning.perfLoggingEnabled
                && (
                    windowFillCount <= 3
                        || windowFillElapsed >= 0.5
                        || windowFillChunks <= 1
                        || windowFillCount % 16 == 0
                        || nextOffset == fileSize
                )
            {
                let avgWindowEnqueueMs = windowFillChunks > 0
                    ? (windowFillEnqueueTime * 1000) / Double(windowFillChunks)
                    : 0
                perfLog(
                    "file=\(fileKey) action=WINDOW_FILL iteration=\(windowFillCount) ackedMiB=\(String(format: "%.1f", Double(acknowledgedOffset - startOffset) / (1024 * 1024))) filledChunks=\(windowFillChunks) fillMiB=\(String(format: "%.1f", Double(nextOffset - windowFillStartOffset) / (1024 * 1024))) fillMs=\(Int(windowFillElapsed * 1000)) fillReadMs=\(Int(windowFillReadTime * 1000)) fillEnqueueMs=\(Int(windowFillEnqueueTime * 1000)) avgEnqueueMs=\(String(format: "%.1f", avgWindowEnqueueMs)) nextOffsetMiB=\(String(format: "%.1f", Double(nextOffset) / (1024 * 1024))) inFlightMiB=\(String(format: "%.1f", Double(inFlightBytes) / (1024 * 1024))) activeWindowMiB=\(String(format: "%.1f", Double(activeMaxInFlightBytes) / (1024 * 1024)))"
                )
            }

            if inFlight.isEmpty {
                break
            }

            // Drain one ACK per loop and advance cumulative progress.
            let ackWaitStart = CFAbsoluteTimeGetCurrent()
            let ackType: LMUPMessageType
            let ackRes: [String: Any]
            do {
                let baseAckTimeoutNs = conservativeStart && ackCount == 0
                    ? recoveryAckTimeoutNs
                    : ackTimeoutNs
                let activeAckTimeoutNs = adaptiveAckTimeoutNs(
                    baseTimeoutNs: baseAckTimeoutNs,
                    chunkSize: chunkSize,
                    maxObservedAckWait: maxAckWaitTime
                )
                (ackType, ackRes) = try await waitForAck(session: session, timeoutNs: activeAckTimeoutNs)
            } catch {
                streamOutcome = "STREAM_ABORT"
                streamFailure = "\(error)"
                if tuning.perfLoggingEnabled {
                    perfLog(
                        "file=\(fileKey) action=ACK_WAIT_FAILED ackedMiB=\(String(format: "%.1f", Double(max(acknowledgedOffset - startOffset, 0)) / (1024 * 1024))) nextOffsetMiB=\(String(format: "%.1f", Double(nextOffset) / (1024 * 1024))) inFlightMiB=\(String(format: "%.1f", Double(inFlightBytes) / (1024 * 1024))) oldestInFlightMs=\(oldestInFlightAgeMs(now: CFAbsoluteTimeGetCurrent())) bufferedMessages=\(session.debugBufferedMessageCount()) ackTimeoutNs=\(adaptiveAckTimeoutNs(baseTimeoutNs: (conservativeStart && ackCount == 0 ? recoveryAckTimeoutNs : ackTimeoutNs), chunkSize: chunkSize, maxObservedAckWait: maxAckWaitTime)) error=\(error)"
                    )
                }
                throw error
            }
            let ackReceivedAt = CFAbsoluteTimeGetCurrent()
            let ackWaitElapsed = ackReceivedAt - ackWaitStart
            totalAckWaitTime += ackWaitElapsed
            maxAckWaitTime = max(maxAckWaitTime, ackWaitElapsed)
            if ackType == .fileAck {
                ackCount += 1
                let committedOffset = (ackRes["committedOffset"] as? Int64)
                    ?? (ackRes["committedOffset"] as? NSNumber)?.int64Value
                    ?? acknowledgedOffset
                let clampedOffset = min(max(committedOffset, acknowledgedOffset), min(nextOffset, fileSize))
                acknowledgedOffset = clampedOffset

                let persistNow = CFAbsoluteTimeGetCurrent()
                if acknowledgedOffset - progressPersistOffset >= progressPersistBytes
                    || persistNow - progressPersistTime >= progressPersistInterval
                    || acknowledgedOffset == fileSize
                {
                    try? uploadStore?.updateUploadOffset(fileKey: fileKey, offset: acknowledgedOffset)
                    progressPersistOffset = acknowledgedOffset
                    progressPersistTime = persistNow
                }

                // Remove fully ACKed chunks from the pipeline window.
                while let first = inFlight.first, first.offset + first.size <= acknowledgedOffset {
                    let ackRoundTrip = ackReceivedAt - first.sendStartedAt
                    totalAckRoundTripTime += ackRoundTrip
                    maxAckRoundTripTime = max(maxAckRoundTripTime, ackRoundTrip)
                    ackedChunkCount += 1

                    inFlightBytes -= first.size
                    inFlight.removeFirst()
                }

                if tuning.perfLoggingEnabled && (ackCount <= 3 || ackWaitElapsed >= 0.5 || ackCount % 8 == 0) {
                    perfLog(
                        "file=\(fileKey) action=ACK_PROGRESS ackCount=\(ackCount) ackWaitMs=\(Int(ackWaitElapsed * 1000)) ackedMiB=\(String(format: "%.1f", Double(acknowledgedOffset - startOffset) / (1024 * 1024))) inFlightMiB=\(String(format: "%.1f", Double(inFlightBytes) / (1024 * 1024))) bufferedMessages=\(session.debugBufferedMessageCount())"
                    )
                }
            } else if ackType == .error {
                let errMsg = ackRes["message"] as? String ?? "server error"
                throw SyncEngineError.networkError("FILE_DATA error: \(errMsg)")
            }
            // For other unexpected types, just continue

            // Calculate speed (MB/s) from ACKed bytes (true committed progress).
            let now = CFAbsoluteTimeGetCurrent()
            let elapsed = now - speedLastTime
            if elapsed >= 0.5 {
                let bytesTransferred = Double(acknowledgedOffset - speedBytesLastCheck)
                speedMbps = (bytesTransferred / elapsed) / (1024 * 1024)
                speedBytesLastCheck = acknowledgedOffset
                speedLastTime = now
            }

            // Emit progress to RN
            if now - lastProgressEmitTime >= progressEmitInterval || acknowledgedOffset == fileSize {
                let progressPercent = fileSize > 0
                    ? Int(Double(acknowledgedOffset) / Double(fileSize) * 100)
                    : 0
                NativeSyncEngineModule.shared?.emitSyncStateChanged([
                    "uploadState": "uploading",
                    "progressPercent": progressPercent,
                    "transferredBytes": acknowledgedOffset,
                    "totalBytes": fileSize,
                    "currentFile": fileKey,
                    "currentSpeedMbps": round(speedMbps * 10) / 10,
                ])
                lastProgressEmitTime = now
            }
        }

        if acknowledgedOffset < fileSize {
            streamOutcome = "STREAM_ABORT"
            streamFailure = "FILE_DATA stream incomplete: acked \(acknowledgedOffset)/\(fileSize)"
            throw SyncEngineError.networkError(
                "FILE_DATA stream incomplete: acked \(acknowledgedOffset)/\(fileSize)"
            )
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

    // MARK: - Queue Event Emission

    private func emitQueueToJS() {
        guard let store = uploadStore else { return }
        let pending = store.getPendingUploadItems()
        let mapped: [[String: Any]] = pending.map { item in
            [
                "id": item.id ?? 0,
                "originalFilename": item.originalFilename ?? item.assetLocalId,
                "mediaType": item.mediaType,
                "fileSize": item.fileSize ?? 0,
                "status": item.status,
            ] as [String: Any]
        }
        NativeSyncEngineModule.shared?.emitQueueUpdated(mapped)
    }

    // MARK: - PhotoScannerDelegate

    func photoLibraryDidChange() {
        NSLog("[SyncEngine] photo library changed — flagging rescan")
        photoLibraryChanged = true
        // Wake up the watch loop if it's sleeping
        watchLoopContinuation?.resume()
        watchLoopContinuation = nil
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
        defer {
            if protocolSession === session {
                protocolSession = nil
            }
            session.disconnect()
        }

        // 1. Connect TCP — allow explicit host override for Wi-Fi-only profiling.
        if let forcedTarget = resolvedForcedSidecarTarget() {
            NSLog("[SyncEngine] connecting via forced host:port")
            try await session.connect(host: forcedTarget.host, port: forcedTarget.port)
        } else if let cachedDevice = discoveredDevices[deviceId], let endpoint = cachedDevice.endpoint {
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
            "clientName": getClientDisplayName(),
            "clientPlatform": "ios",
            "appVersion": "1.0.0",
            "appState": currentAppStateLabel(),
        ])

        guard helloType == .helloRes else {
            throw SyncEngineError.pairingError("Expected HELLO_RES, got \(helloType)")
        }

        let authRequired: Bool
        if let b = helloRes["authRequired"] as? Bool { authRequired = b }
        else if let n = helloRes["authRequired"] as? NSNumber { authRequired = n.boolValue }
        else { authRequired = true }

        guard authRequired else {
            // Already bound on server — ensure we have a local binding record too
            NSLog("[SyncEngine] already bound on server, ensuring local binding exists")
            if uploadStore?.getBinding() == nil {
                // Recreate binding from HELLO_RES info
                let serverName = helloRes["serverName"] as? String ?? ""
                let serverId = helloRes["serverId"] as? String ?? deviceId
                let binding = BindingRecord(
                    deviceId: serverId,
                    deviceName: serverName,
                    deviceAlias: nil,
                    deviceType: "mac",
                    host: host,
                    port: port,
                    pairingId: "",
                    pairingTokenKeychainRef: "syncflow_pairing_token",
                    shareName: helloRes["serverCapabilities"].flatMap { ($0 as? [String: Any])?["shareName"] as? String },
                    lastBoundAt: ISO8601DateFormatter().string(from: Date())
                )
                try? uploadStore?.saveBinding(binding)
                // Cache endpoint under binding deviceId so startSync finds it immediately
                if let cachedDevice = discoveredDevices.values.first(where: { $0.endpoint != nil }) {
                    discoveredDevices[serverId] = cachedDevice
                }
                NSLog("[SyncEngine] recreated local binding for \(serverId)")
            }
            startSync()
            return
        }

        // 3. PAIR_REQ → PAIR_RES  (spec Section 7.8)
        let (pairType, pairRes) = try await session.sendAndReceive(type: .pairReq, payload: [
            "clientId": clientId,
            "clientName": getClientDisplayName(),
            "connectionCode": connectionCode,
        ])

        guard pairType == .pairRes else {
            throw SyncEngineError.pairingError("Expected PAIR_RES, got \(pairType)")
        }

        let pairOk: Bool
        if let b = pairRes["ok"] as? Bool { pairOk = b }
        else if let n = pairRes["ok"] as? NSNumber { pairOk = n.boolValue }
        else { pairOk = (pairType == .pairRes) }

        guard pairOk else {
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

        // Cache endpoint under binding deviceId so startSync finds it immediately
        let bindingDeviceId = serverInfo["serverId"] as? String ?? deviceId
        if let cachedDevice = discoveredDevices.values.first(where: { $0.endpoint != nil }) {
            discoveredDevices[bindingDeviceId] = cachedDevice
        }

        // 6. Notify RN bridge
        bindingConnectionState = .bound
        NativeSyncEngineModule.shared?.emitBindingStateChanged(bindingStatePayload(binding: binding))

        NSLog("[SyncEngine] pairing successful — starting sync")
        startSync()
    }

    func disconnectAndUnbind() async throws {
        NSLog("[SyncEngine] disconnectAndUnbind")
        bindingService.clearPairingToken()
        try uploadStore?.clearBinding()
        bindingConnectionState = .offline
        sidecarHost = nil
        endBackgroundTransitionIfNeeded(reason: "disconnectAndUnbind")
        SilentAudioService.shared.stop()
        isSyncing = false
        protocolSession?.disconnect()
        protocolSession = nil
        transport.disconnect()
        sessionService.endSession()
        NativeSyncEngineModule.shared?.emitBindingStateChanged(nil)
    }

    // MARK: - State Queries

    func getBindingState() async -> [String: Any]? {
        bindingStatePayload()
    }

    func getSyncOverview() async -> [String: Any] {
        let state = sessionService.state.rawValue
        let sessionId = sessionService.currentSessionId ?? ""

        return [
            "sessionId": sessionId,
            "state": state,
            "completedCount": 0,
            "totalCount": 0,
            "currentSpeedMbps": 0,
            "transferredBytes": 0,
            "totalBytes": 0,
            "progressPercent": 0,
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
                "updatedAt": ledger.updatedAt,
            ]
        }
        return [
            "items": items,
            "nextCursor": result.nextCursor ?? NSNull(),
        ]
    }

    func getAppInfo() async -> [String: Any] {
        let bundle = Bundle.main
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        let appName =
            (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ??
            (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String) ??
            "SyncFlow"

        return [
            "appName": appName,
            "version": version,
            "build": build,
        ]
    }

    // MARK: - Client Display Name

    private static let clientNameKey = "syncflow_client_display_name"

    // MARK: - Sidecar Host Resolution

    /// Connect TCP briefly to resolve the sidecar's IP for HTTP heartbeats, then disconnect.
    private func resolveSidecarHost(binding: BindingRecord, token: String, clientId: String) async throws {
        if let forcedTarget = resolvedForcedSidecarTarget() {
            sidecarHost = forcedTarget.host
            updateBindingConnectionState(.connected, reason: "forced_sidecar_host")
            NSLog("[SyncPipeline] using forced sidecar host: %@:%d", forcedTarget.host, Int(forcedTarget.port))
            return
        }

        func findDevice() -> DiscoveredDevice? {
            if let exact = discoveredDevices[binding.deviceId], exact.endpoint != nil { return exact }
            return discoveredDevices.values.first(where: { $0.endpoint != nil })
        }

        var endpoint = findDevice()?.endpoint
        if endpoint == nil {
            discoveryService.startBrowsing()
            for _ in 0..<20 {
                try await Task.sleep(nanoseconds: 500_000_000)
                if let found = findDevice() { endpoint = found.endpoint; break }
            }
        }
        guard let ep = endpoint else { return }

        let transport = TcpTransport()
        let session = ProtocolSession(transport: transport)
        try await session.connect(endpoint: ep)
        sidecarHost = transport.remoteHost
        NSLog("[SyncPipeline] resolved sidecar host: %@", sidecarHost ?? "nil")

        // Auth so sidecar registers us as connected
        let (helloType, helloRes) = try await session.sendAndReceive(type: .helloReq, payload: [
            "clientId": clientId, "clientName": getClientDisplayName(),
            "clientPlatform": "ios", "appVersion": "1.0.0",
            "pairingToken": token, "appState": currentAppStateLabel(),
        ])
        if helloType == .helloRes, let nonce = helloRes["nonce"] as? String {
            let hmac = transport.computeHMAC(token: token, nonce: nonce)
            let _ = try? await session.sendAndReceive(type: .authReq, payload: [
                "clientId": clientId, "auth": hmac,
            ])
            updateBindingConnectionState(.connected, reason: "resolved_sidecar_host")
        }
        // Disconnect — we just needed the IP
        transport.disconnect()
    }

    // MARK: - HTTP Presence Heartbeat

    private func sendPresenceHeartbeat(clientId: String) {
        guard let host = sidecarHost, !host.isEmpty else { return }
        let port = 39394
        // IPv6 link-local needs brackets and zone ID in URL
        let hostPart = host.contains(":") ? "[\(host)]" : host
        let urlStr = "http://\(hostPart):\(port)/presence/\(clientId)"
        guard let url = URL(string: urlStr) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        URLSession.shared.dataTask(with: request) { _, _, error in
            if let error {
                NSLog("[Presence] heartbeat failed: %@", "\(error)")
                self.updateBindingConnectionState(.offline, reason: "presence_heartbeat_failed")
            } else {
                self.updateBindingConnectionState(.connected, reason: "presence_heartbeat_succeeded")
            }
        }.resume()
    }

    func getClientDisplayName() -> String {
        return UserDefaults.standard.string(forKey: Self.clientNameKey) ?? UIDevice.current.name
    }

    func setClientDisplayName(_ name: String) {
        UserDefaults.standard.set(name, forKey: Self.clientNameKey)
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
