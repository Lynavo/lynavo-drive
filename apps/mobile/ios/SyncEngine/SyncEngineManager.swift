import Foundation
import Photos
import UIKit
import CryptoKit
import Network
import Darwin
import SSZipArchive

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

private func syncFlowGenericClientName(_ rawName: String) -> Bool {
    let normalized = rawName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalized.isEmpty {
        return true
    }
    let genericNames = [
        "iphone",
        "ipad",
        "ipod",
        "ipod touch",
        UIDevice.current.model.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
    ]
    return genericNames.contains(normalized)
}

private func syncFlowPreferredClientIPv4() -> String? {
    var addressList: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&addressList) == 0, let firstAddress = addressList else {
        return nil
    }
    defer { freeifaddrs(addressList) }

    let preferredPrefixes = ["en", "bridge"]
    var fallback: String?
    var pointer: UnsafeMutablePointer<ifaddrs>? = firstAddress

    while let current = pointer {
        let interface = current.pointee
        pointer = interface.ifa_next

        guard let addr = interface.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else {
            continue
        }

        let name = String(cString: interface.ifa_name)
        if name == "lo0" || name.hasPrefix("awdl") || name.hasPrefix("llw") || name.hasPrefix("utun") {
            continue
        }

        var hostBuffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let result = getnameinfo(
            addr,
            socklen_t(addr.pointee.sa_len),
            &hostBuffer,
            socklen_t(hostBuffer.count),
            nil,
            0,
            NI_NUMERICHOST
        )
        guard result == 0 else { continue }

        let host = String(cString: hostBuffer)
        if host == "127.0.0.1" || host.isEmpty {
            continue
        }
        if preferredPrefixes.contains(where: { name.hasPrefix($0) }) {
            return host
        }
        if fallback == nil {
            fallback = host
        }
    }

    return fallback
}

private final class SyncDiagnosticsLogStore {
    static let shared = SyncDiagnosticsLogStore()

    private let lock = NSLock()
    private var lines: [String] = []
    private let maxLines = 2000

    func record(category: String, message: String) {
        let formatter = ISO8601DateFormatter()
        let line = "\(formatter.string(from: Date())) [\(category)] \(message)"
        lock.lock()
        lines.append(line)
        if lines.count > maxLines {
            lines.removeFirst(lines.count - maxLines)
        }
        lock.unlock()
    }

    func snapshot() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return lines
    }
}

private func syncDiagnosticsLog(_ category: String, _ message: @autoclosure () -> String) {
    SyncDiagnosticsLogStore.shared.record(category: category, message: message())
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
    private var watchLoopContinuationToken: UUID?
    private let watchLoopContinuationLock = NSLock()
    private let incrementalQueueRescanLock = NSLock()
    private let incrementalQueueRescanQueue = DispatchQueue(
        label: "com.syncflow.incremental-photo-rescan",
        qos: .utility
    )
    private var incrementalQueueRescanWorkItem: DispatchWorkItem?
    private let cloudAssetDetectionLock = NSLock()
    private let cloudAssetDetectionQueue = DispatchQueue(
        label: "com.syncflow.cloud-asset-detection",
        qos: .utility
    )
    private var cloudAssetFlags: [String: Bool] = [:]
    private var cloudAssetDetectionInFlight: Set<String> = []
    private var sidecarHost: String?  // resolved IP of Mac, for HTTP heartbeat
    private var transitionBackgroundTaskId: UIBackgroundTaskIdentifier = .invalid
    private var bindingConnectionState: BindingConnectionState = .offline
    private let diagnosticsIssueLock = NSLock()
    private var recentRetryDiagnostic: [String: Any]?
    private var recentErrorDiagnostic: [String: Any]?

    private func preferredSidecarHost(probedHost: String?, device: DiscoveredDevice?) -> String? {
        if let probedHost, !probedHost.isEmpty, !probedHost.contains(":") {
            return probedHost
        }
        if let device, !device.ip.isEmpty {
            return device.ip
        }
        return probedHost
    }

    private func diagnosticsTimestamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private func recordRecentRetry(error: Error, attempt: Int, delaySeconds: Double) {
        let payload: [String: Any] = [
            "timestamp": diagnosticsTimestamp(),
            "message": "\(error)",
            "attempt": attempt,
            "delaySec": round(delaySeconds * 10) / 10,
            "bindingState": bindingConnectionState.rawValue,
            "sessionState": sessionService.state.rawValue,
        ]
        diagnosticsIssueLock.lock()
        recentRetryDiagnostic = payload
        diagnosticsIssueLock.unlock()
    }

    private func recordRecentError(code: String, message: String) {
        let payload: [String: Any] = [
            "timestamp": diagnosticsTimestamp(),
            "code": code,
            "message": message,
            "bindingState": bindingConnectionState.rawValue,
            "sessionState": sessionService.state.rawValue,
        ]
        diagnosticsIssueLock.lock()
        recentErrorDiagnostic = payload
        diagnosticsIssueLock.unlock()
    }

    private func diagnosticsIssueSnapshot() -> (recentRetry: [String: Any]?, recentError: [String: Any]?) {
        diagnosticsIssueLock.lock()
        defer { diagnosticsIssueLock.unlock() }
        return (recentRetryDiagnostic, recentErrorDiagnostic)
    }

    private func buildPendingUploadAssets(clientId: String) -> [ScannedAsset] {
        guard let store = uploadStore else { return [] }

        let pendingItems = store.getPendingUploadItems()
        guard !pendingItems.isEmpty else { return [] }

        let localIdentifiers = pendingItems.map(\.assetLocalId)
        let fetchedAssets = PHAsset.fetchAssets(withLocalIdentifiers: localIdentifiers, options: nil)
        var assetsByLocalId: [String: PHAsset] = [:]
        fetchedAssets.enumerateObjects { asset, _, _ in
            assetsByLocalId[asset.localIdentifier] = asset
        }

        var results: [ScannedAsset] = []
        var missingAssets = 0

        for item in pendingItems {
            guard let asset = assetsByLocalId[item.assetLocalId] else {
                missingAssets += 1
                continue
            }

            let resources = PHAssetResource.assetResources(for: asset)
            let primaryResource = resources.first(where: {
                $0.type == .fullSizePhoto || $0.type == .video
            }) ?? resources.first

            let originalFilename = item.originalFilename
                ?? primaryResource?.originalFilename
                ?? "unknown"
            let estimatedSize = item.fileSize
                ?? (primaryResource?.value(forKey: "fileSize") as? NSNumber)?.int64Value
                ?? 0
            let mediaType = item.mediaType.isEmpty
                ? (asset.mediaType == .video ? "video" : "image")
                : item.mediaType
            let fileKey = item.fileKey
                ?? PhotoScanner.computeFileKey(
                    clientId: clientId,
                    assetLocalId: asset.localIdentifier,
                    resourceSize: estimatedSize,
                    modifiedAt: asset.modificationDate?.iso8601String ?? "",
                    mediaType: mediaType
                )

            results.append(ScannedAsset(
                asset: asset,
                fileKey: fileKey,
                mediaType: mediaType,
                creationDate: asset.creationDate,
                originalFilename: originalFilename,
                estimatedSize: estimatedSize
            ))
        }

        if missingAssets > 0 {
            NSLog("[SyncPipeline] skipped %d pending items whose PHAsset could not be resolved", missingAssets)
            syncDiagnosticsLog("SyncPipeline", "skipped \(missingAssets) pending items whose PHAsset could not be resolved")
        }

        return results
    }

    private func emitPreparingStateForNextFile(nextAsset: ScannedAsset) {
        NativeSyncEngineModule.shared?.emitSyncStateChanged([
            "uploadState": "preparing",
            "progressPercent": 0,
            "currentSpeedMbps": 0,
            "transferredBytes": 0,
            "totalBytes": nextAsset.estimatedSize,
        ])
    }

    private func queueItemIdentity(_ item: UploadItemRecord) -> String {
        item.fileKey ?? item.assetLocalId
    }

    private func cachedCloudAssetFlag(for item: UploadItemRecord) -> Bool? {
        let key = queueItemIdentity(item)
        cloudAssetDetectionLock.lock()
        defer { cloudAssetDetectionLock.unlock() }
        return cloudAssetFlags[key]
    }

    private func setCachedCloudAssetFlag(_ isCloudAsset: Bool, for item: UploadItemRecord) -> Bool {
        let key = queueItemIdentity(item)
        cloudAssetDetectionLock.lock()
        defer { cloudAssetDetectionLock.unlock() }
        let previous = cloudAssetFlags[key]
        cloudAssetFlags[key] = isCloudAsset
        cloudAssetDetectionInFlight.remove(key)
        return previous != isCloudAsset
    }

    private func detectCloudBackedAsset(assetLocalId: String, mediaType: String) async -> Bool {
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: [assetLocalId], options: nil)
        guard let asset = assets.firstObject else { return false }

        if mediaType == "video" {
            let options = PHVideoRequestOptions()
            options.isNetworkAccessAllowed = false
            return await withCheckedContinuation { continuation in
                PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { avAsset, _, info in
                    let infoCloud = (info?[PHImageResultIsInCloudKey] as? NSNumber)?.boolValue ?? false
                    continuation.resume(returning: infoCloud || avAsset == nil)
                }
            }
        }

        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = false
        options.deliveryMode = .fastFormat
        options.resizeMode = .fast
        options.isSynchronous = false
        return await withCheckedContinuation { continuation in
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { _, _, _, info in
                let infoCloud = (info?[PHImageResultIsInCloudKey] as? NSNumber)?.boolValue ?? false
                continuation.resume(returning: infoCloud)
            }
        }
    }

    private func scheduleCloudAssetDetection(for items: [UploadItemRecord]) {
        let candidates = Array(items.prefix(64))
        for item in candidates {
            let key = queueItemIdentity(item)

            cloudAssetDetectionLock.lock()
            let alreadyKnown = cloudAssetFlags[key] != nil
            let alreadyInFlight = cloudAssetDetectionInFlight.contains(key)
            if !alreadyKnown && !alreadyInFlight {
                cloudAssetDetectionInFlight.insert(key)
            }
            cloudAssetDetectionLock.unlock()

            guard !alreadyKnown && !alreadyInFlight else { continue }

            cloudAssetDetectionQueue.async { [weak self] in
                guard let self else { return }
                Task {
                    let isCloudAsset = await self.detectCloudBackedAsset(
                        assetLocalId: item.assetLocalId,
                        mediaType: item.mediaType
                    )
                    let changed = self.setCachedCloudAssetFlag(isCloudAsset, for: item)
                    if changed {
                        self.emitQueueToJS()
                    }
                }
            }
        }
    }

    private func bridgeQueueItems(_ pending: [UploadItemRecord]) -> [[String: Any]] {
        scheduleCloudAssetDetection(for: pending)
        return pending.map { item in
            [
                "id": item.id ?? 0,
                "originalFilename": item.originalFilename ?? item.assetLocalId,
                "mediaType": item.mediaType,
                "fileSize": item.fileSize ?? 0,
                "status": item.status,
                "isCloudAsset": cachedCloudAssetFlag(for: item) ?? false,
            ] as [String: Any]
        }
    }

    private func markAssetPreparing(fileKey: String) {
        try? uploadStore?.updateUploadStatus(fileKey: fileKey, status: "preparing")
        emitQueueToJS()
    }

    private func exportAssetForUpload(_ asset: ScannedAsset) async throws -> ExportedFile {
        markAssetPreparing(fileKey: asset.fileKey)

        var markedCloudDownload = false
        return try await exportService.exportAsset(asset.asset) { [weak self] progress in
            guard progress < 1.0, !markedCloudDownload else { return }
            markedCloudDownload = true
            try? self?.uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "cloud_downloading")
            self?.emitQueueToJS()
        }
    }

    private func connectSession(
        _ session: ProtocolSession,
        device: DiscoveredDevice?,
        fallbackHost: String? = nil,
        fallbackPort: UInt16? = nil
    ) async throws {
        if let forcedTarget = resolvedForcedSidecarTarget() {
            try await session.connect(host: forcedTarget.host, port: forcedTarget.port)
            return
        }

        if let preferredHost = preferredSidecarHost(probedHost: nil, device: device),
           !preferredHost.isEmpty
        {
            try await session.connect(
                host: preferredHost,
                port: device?.port ?? fallbackPort ?? 39393
            )
            return
        }

        if let endpoint = device?.endpoint {
            try await session.connect(endpoint: endpoint)
            return
        }

        if let fallbackHost, !fallbackHost.isEmpty {
            try await session.connect(
                host: fallbackHost,
                port: fallbackPort ?? 39393
            )
            return
        }

        throw SyncEngineError.networkError("No sidecar endpoint available")
    }

    private func installWatchLoopContinuation(_ continuation: CheckedContinuation<Void, Never>) -> UUID {
        let token = UUID()
        watchLoopContinuationLock.lock()
        watchLoopContinuation = continuation
        watchLoopContinuationToken = token
        watchLoopContinuationLock.unlock()
        return token
    }

    private func resumeWatchLoopIfNeeded(expectedToken: UUID? = nil) {
        watchLoopContinuationLock.lock()
        guard let continuation = watchLoopContinuation else {
            watchLoopContinuationLock.unlock()
            return
        }
        if let expectedToken, watchLoopContinuationToken != expectedToken {
            watchLoopContinuationLock.unlock()
            return
        }
        watchLoopContinuation = nil
        watchLoopContinuationToken = nil
        watchLoopContinuationLock.unlock()
        continuation.resume()
    }

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
        syncDiagnosticsLog("SyncEngine", "binding connection state \(bindingConnectionState.rawValue) -> \(newState.rawValue) (\(reason))")
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

    private func currentAppVersionLabel() -> String {
        let bundle = Bundle.main
        return bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
    }

    private func currentClientIPv4() -> String? {
        return syncFlowPreferredClientIPv4()
    }

    private func defaultClientDisplayName() -> String {
        let rawName = UIDevice.current.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard syncFlowGenericClientName(rawName) else {
            return rawName
        }

        let clientId = bindingService.getOrCreateClientId().replacingOccurrences(of: "-", with: "")
        let suffix = String(clientId.suffix(4)).uppercased()
        let model = UIDevice.current.model.trimmingCharacters(in: .whitespacesAndNewlines)
        return suffix.isEmpty ? model : "\(model) \(suffix)"
    }

    private func localDateKey(for date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func buildClientHelloPayload(clientId: String, pairingToken: String? = nil) -> [String: Any] {
        var payload: [String: Any] = [
            "clientId": clientId,
            "clientName": getClientDisplayName(),
            "clientPlatform": "ios",
            "appVersion": currentAppVersionLabel(),
            "appState": currentAppStateLabel(),
        ]
        if let pairingToken, !pairingToken.isEmpty {
            payload["pairingToken"] = pairingToken
        }
        if let clientIP = currentClientIPv4() {
            payload["clientIp"] = clientIP
        }
        return payload
    }

    private func connectMetadataRefreshSession(
        binding: BindingRecord,
        discoveredDevice: DiscoveredDevice?,
        session: ProtocolSession
    ) async throws {
        try await connectSession(
            session,
            device: discoveredDevice,
            fallbackHost: binding.host,
            fallbackPort: UInt16(binding.port)
        )
    }

    private func pushClientMetadataUpdateIfPossible() {
        guard let binding = uploadStore?.getBinding(),
              let token = bindingService.getPairingToken()
        else {
            return
        }

        let discoveredDevice = discoveredDevices[binding.deviceId]

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }

            let transport = TcpTransport()
            let session = ProtocolSession(transport: transport)
            defer { session.disconnect() }

            do {
                try await self.connectMetadataRefreshSession(
                    binding: binding,
                    discoveredDevice: discoveredDevice,
                    session: session
                )
                let clientId = self.bindingService.getOrCreateClientId()
                let (helloType, helloRes) = try await session.sendAndReceive(
                    type: .helloReq,
                    payload: self.buildClientHelloPayload(clientId: clientId, pairingToken: token)
                )
                guard helloType == .helloRes else {
                    return
                }
                if let nonce = helloRes["nonce"] as? String {
                    let hmac = transport.computeHMAC(token: token, nonce: nonce)
                    let _ = try? await session.sendAndReceive(type: .authReq, payload: [
                        "clientId": clientId,
                        "auth": hmac,
                    ])
                }
                NSLog("[SyncEngine] pushed client metadata update to sidecar")
                syncDiagnosticsLog("SyncEngine", "pushed client metadata update to sidecar")
            } catch {
                NSLog("[SyncEngine] metadata refresh skipped: %@", "\(error)")
                syncDiagnosticsLog("SyncEngine", "metadata refresh skipped: \(error)")
            }
        }
    }

    private func beginBackgroundTransitionIfNeeded(reason: String) {
        guard transitionBackgroundTaskId == .invalid else { return }
        transitionBackgroundTaskId = backgroundService.beginTransitionTask()
        NSLog("[BackgroundExec] began transition task reason=%@", reason)
        syncDiagnosticsLog("BackgroundExec", "began transition task reason=\(reason)")
    }

    private func endBackgroundTransitionIfNeeded(reason: String) {
        guard transitionBackgroundTaskId != .invalid else { return }
        backgroundService.endTransitionTask(transitionBackgroundTaskId)
        transitionBackgroundTaskId = .invalid
        NSLog("[BackgroundExec] ended transition task reason=%@", reason)
        syncDiagnosticsLog("BackgroundExec", "ended transition task reason=\(reason)")
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
            ) ?? 8, 1),
            48
        )
        let windowMB = min(
            max(syncFlowIntSetting(
                envKey: "SYNCFLOW_UPLOAD_WINDOW_MB",
                userDefaultsKey: "SyncFlowUploadWindowMB"
            ) ?? 128, chunkMB),
            1024
        )
        let maxPipelineChunks = min(
            max(syncFlowIntSetting(
                envKey: "SYNCFLOW_UPLOAD_PIPELINE_CHUNKS",
                userDefaultsKey: "SyncFlowUploadPipelineChunks"
            ) ?? 16, 1),
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

    private func scheduleIncrementalQueueRescan(reason: String) {
        guard isSyncing else { return }

        incrementalQueueRescanLock.lock()
        incrementalQueueRescanWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            self?.performIncrementalQueueRescan(reason: reason)
        }
        incrementalQueueRescanWorkItem = workItem
        incrementalQueueRescanLock.unlock()

        incrementalQueueRescanQueue.asyncAfter(deadline: .now() + 2, execute: workItem)
    }

    private func performIncrementalQueueRescan(reason: String) {
        guard isSyncing, let store = uploadStore else { return }

        let clientId = bindingService.getOrCreateClientId()
        let trackedFileKeys = Set(store.getTrackedFileKeys())
        let untrackedAssets = photoScanner.scanForUntrackedAssets(
            clientId: clientId,
            trackedFileKeys: trackedFileKeys
        )

        guard !untrackedAssets.isEmpty else {
            NSLog("[SyncEngine] incremental photo rescan found no new assets (%@)", reason)
            syncDiagnosticsLog("SyncEngine", "incremental photo rescan found no new assets (\(reason))")
            return
        }

        let now = ISO8601DateFormatter().string(from: Date())
        for asset in untrackedAssets {
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
                updatedAt: now
            )
            try? store.upsertUploadItem(item)
        }

        NSLog(
            "[SyncEngine] incremental photo rescan queued %d new assets (%@)",
            untrackedAssets.count,
            reason
        )
        syncDiagnosticsLog("SyncEngine", "incremental photo rescan queued \(untrackedAssets.count) new assets (\(reason))")
        emitQueueToJS()
    }

    /// Start a full photo scan and serial upload session over the open TCP connection.
    func startSync() {
        guard !isSyncing else {
            NSLog("[SyncEngine] startSync skipped — already syncing")
            syncDiagnosticsLog("SyncEngine", "startSync skipped — already syncing")
            return
        }
        isSyncing = true
        NSLog("[SyncEngine] startSync")
        syncDiagnosticsLog("SyncEngine", "startSync")
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
                syncDiagnosticsLog("SyncEngine", "sync pipeline failed: \(error)")
                self.protocolSession?.disconnect()
                self.protocolSession = nil
                self.clearResolvedSidecarHost()
                if self.uploadStore?.getBinding() != nil {
                    self.updateBindingConnectionState(.offline, reason: "pipeline_failed")
                }
                self.stopSyncLifecycle(finalState: .idle)
                self.recordRecentError(code: "SYNC_PIPELINE_ERROR", message: "\(error)")
                NativeSyncEngineModule.shared?.emitError([
                    "code": "SYNC_PIPELINE_ERROR",
                    "message": "\(error)",
                ])
            }
        }
    }

    private func runSyncPipeline() async throws {
        NSLog("[SyncPipeline] START")
        syncDiagnosticsLog("SyncPipeline", "START")

        // 0. Check prerequisites
        guard let binding = uploadStore?.getBinding() else {
            throw SyncEngineError.pairingError("No binding found — pair first")
        }
        guard let token = bindingService.getPairingToken() else {
            NSLog("[SyncPipeline] pairing token missing — clearing stale binding, need re-pair")
            syncDiagnosticsLog("SyncPipeline", "pairing token missing — clearing stale binding")
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
            syncDiagnosticsLog("SyncEngine", "photo permission denied")
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
                syncDiagnosticsLog("SyncPipeline", "failed to resolve sidecar host: \(error)")
            }
        }

        // 4. Continuous loop: scan → connect → upload → disconnect → wait → repeat
        var roundNumber = 0

        while true {
            roundNumber += 1
            sessionService.transitionTo(.scanning)
            NativeSyncEngineModule.shared?.emitSyncStateChanged([
                "uploadState": "scanning",
                "progressPercent": 0,
            ])

            // Scan only truly untracked assets. Pending items already live in upload_items.
            let trackedKeys = Set(uploadStore?.getTrackedFileKeys() ?? [])
            let newAssets = photoScanner.scanForUntrackedAssets(clientId: clientId, trackedFileKeys: trackedKeys)

            if !newAssets.isEmpty {
                let queuePersistStart = CFAbsoluteTimeGetCurrent()
                let queuedItems = newAssets.map { asset in
                    UploadItemRecord(
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
                }
                try? uploadStore?.upsertUploadItems(queuedItems)
                NSLog(
                    "[SyncPipeline] persisted %d queued assets in %d ms",
                    queuedItems.count,
                    Int((CFAbsoluteTimeGetCurrent() - queuePersistStart) * 1000)
                )
                syncDiagnosticsLog("SyncPipeline", "persisted \(queuedItems.count) queued assets")
                emitQueueToJS()
            }

            let pendingAssets = buildPendingUploadAssets(clientId: clientId)
            NSLog(
                "[SyncPipeline] round %d: %d pending assets (%d new, tracked: %d)",
                roundNumber,
                pendingAssets.count,
                newAssets.count,
                trackedKeys.count
            )
            syncDiagnosticsLog("SyncPipeline", "round \(roundNumber): \(pendingAssets.count) pending assets (\(newAssets.count) new, tracked: \(trackedKeys.count))")

            if pendingAssets.isEmpty {
                // Nothing to upload — wait for photo library changes
                NativeSyncEngineModule.shared?.emitSyncStateChanged([
                    "uploadState": "completed",
                    "progressPercent": 100,
                ])

                NSLog("[SyncPipeline] idle — waiting for new photos...")
                syncDiagnosticsLog("SyncPipeline", "idle — waiting for new photos")
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
                        let token = installWatchLoopContinuation(cont)
                        DispatchQueue.global().asyncAfter(deadline: .now() + 30) { [token] in
                            SyncEngineManager.shared.resumeWatchLoopIfNeeded(expectedToken: token)
                        }
                    }
                }
                try await Task.sleep(nanoseconds: 2_000_000_000) // debounce
                photoLibraryChanged = false
                continue
            }

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
                        assets: pendingAssets,
                        recoveryMode: retryAttempt > 0
                    )
                    uploaded = true
                    photoLibraryChanged = false // reset after round
                } catch {
                    if !isRetryableSyncError(error) {
                        NSLog("[SyncPipeline] upload failed with non-retryable error: %@", "\(error)")
                        syncDiagnosticsLog("SyncPipeline", "upload failed with non-retryable error: \(error)")
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
                    syncDiagnosticsLog("SyncPipeline", "upload failed with retryable error: \(error) — reconnecting in \(String(format: "%.1f", delaySeconds))s (attempt \(retryAttempt))")
                    recordRecentRetry(error: error, attempt: retryAttempt, delaySeconds: delaySeconds)
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
        NativeSyncEngineModule.shared?.emitSyncStateChanged([
            "uploadState": "preparing",
            "progressPercent": 0,
        ])
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

        // Find target device
        func findDevice() -> DiscoveredDevice? {
            if let exact = discoveredDevices[binding.deviceId] {
                return exact
            }
            return discoveredDevices.values.first
        }

        var targetDevice = findDevice()
        if targetDevice == nil {
            discoveryService.startBrowsing()
            for _ in 0..<20 {
                try await Task.sleep(nanoseconds: 500_000_000)
                if let found = findDevice() {
                    targetDevice = found
                    break
                }
            }
        }

        try await connectSession(
            session,
            device: targetDevice,
            fallbackHost: binding.host,
            fallbackPort: UInt16(binding.port)
        )
        sidecarHost = preferredSidecarHost(probedHost: newTransport.remoteHost, device: targetDevice)
        NSLog("[SyncPipeline] TCP connected to %@", sidecarHost ?? "unknown")
        syncDiagnosticsLog("SyncPipeline", "TCP connected to \(sidecarHost ?? "unknown")")

        let (helloType, helloRes) = try await session.sendAndReceive(
            type: .helloReq,
            payload: buildClientHelloPayload(clientId: clientId, pairingToken: token)
        )
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
            syncDiagnosticsLog("SyncPipeline", "auth successful")
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
        syncDiagnosticsLog("SyncPipeline", "uploading \(assets.count) files")

        // Upload files with prefetch: export next file while current uploads
        var nextExport: ExportedFile? = nil
        if !assets.isEmpty {
            nextExport = try? await exportAssetForUpload(assets[0])
        }

        for (index, asset) in assets.enumerated() {
            if index > 0 {
                emitPreparingStateForNextFile(nextAsset: asset)
            }

            let exported: ExportedFile
            if let prefetched = nextExport {
                exported = prefetched
                nextExport = nil
            } else {
                exported = try await exportAssetForUpload(asset)
            }

            let nextIndex = index + 1
            if nextIndex < assets.count {
                let nextAsset = assets[nextIndex]
                Task {
                    nextExport = try? await self.exportAssetForUpload(nextAsset)
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
                    syncDiagnosticsLog("SyncEngine", "retryable upload failure for \(asset.fileKey): \(error)")
                    try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                    emitQueueToJS()
                    throw error
                }

                NSLog("[SyncEngine] non-retryable upload failure for %@: %@", asset.fileKey, "\(error)")
                syncDiagnosticsLog("SyncEngine", "non-retryable upload failure for \(asset.fileKey): \(error)")
                recordRecentError(code: "UPLOAD_FILE_FAILED", message: "\(asset.fileKey): \(error)")
                try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "failed")
                emitQueueToJS()
            }
        }

        // SYNC_END — then TCP will be closed as this function returns
        let (_, _) = try await session.sendAndReceive(type: .syncEndReq, payload: [:])
        uploadRoundCompleted = true
        NSLog("[SyncPipeline] upload round complete, disconnecting TCP")
        syncDiagnosticsLog("SyncPipeline", "upload round complete, disconnecting TCP")
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
                let dateStr = (endRes["ledgerDate"] as? String) ?? localDateKey()
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
        let progressEmitInterval: CFTimeInterval = 0.25
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

        func emitUploadProgress(now: CFTimeInterval) {
            let confirmedProgressPercent = fileSize > 0
                ? Int(Double(acknowledgedOffset) / Double(fileSize) * 100)
                : 0
            let sentProgressPercent = fileSize > 0
                ? Int(Double(nextOffset) / Double(fileSize) * 100)
                : 0
            NativeSyncEngineModule.shared?.emitSyncStateChanged([
                "uploadState": "uploading",
                "progressPercent": confirmedProgressPercent,
                "transferredBytes": acknowledgedOffset,
                "confirmedBytes": acknowledgedOffset,
                "sentBytes": nextOffset,
                "pendingConfirmBytes": max(nextOffset - acknowledgedOffset, 0),
                "sentProgressPercent": sentProgressPercent,
                "totalBytes": fileSize,
                "currentFile": fileKey,
                "currentSpeedMbps": round(speedMbps * 10) / 10,
            ])
            lastProgressEmitTime = now
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

            let postFillNow = CFAbsoluteTimeGetCurrent()
            if nextOffset > acknowledgedOffset
                && (
                    ackCount == 0
                        || postFillNow - lastProgressEmitTime >= progressEmitInterval
                        || nextOffset == fileSize
                )
            {
                emitUploadProgress(now: postFillNow)
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
                emitUploadProgress(now: now)
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
        NativeSyncEngineModule.shared?.emitQueueUpdated(bridgeQueueItems(pending))
    }

    // MARK: - PhotoScannerDelegate

    func photoLibraryDidChange() {
        NSLog("[SyncEngine] photo library changed — flagging rescan")
        photoLibraryChanged = true
        scheduleIncrementalQueueRescan(reason: "photo_library_changed")
        // Wake up the watch loop if it's sleeping
        resumeWatchLoopIfNeeded()
    }

    // MARK: - DiscoveryServiceDelegate

    func discoveryDidUpdate(devices: [DiscoveredDevice]) {
        NSLog("[SyncEngine] discoveryDidUpdate called with \(devices.count) devices")
        discoveredDevices = Dictionary(uniqueKeysWithValues: devices.map { ($0.deviceId, $0) })
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
        discoveredDevices.removeAll()
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
        let (helloType, helloRes) = try await session.sendAndReceive(
            type: .helloReq,
            payload: buildClientHelloPayload(clientId: clientId)
        )

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
        var pairPayload: [String: Any] = [
            "clientId": clientId,
            "clientName": getClientDisplayName(),
            "connectionCode": connectionCode,
        ]
        if let clientIP = currentClientIPv4() {
            pairPayload["clientIp"] = clientIP
        }
        let (pairType, pairRes) = try await session.sendAndReceive(type: .pairReq, payload: pairPayload)

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
        let mapped = bridgeQueueItems(pending)
        return pending.enumerated().map { index, item in
            var row = mapped[index]
            row["assetLocalId"] = item.assetLocalId
            row["fileKey"] = item.fileKey ?? ""
            row["ackedOffset"] = item.ackedOffset
            return row
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

    func exportDiagnostics() async throws -> String {
        let fileManager = FileManager.default
        let timestampFormatter = DateFormatter()
        timestampFormatter.locale = Locale(identifier: "en_US_POSIX")
        timestampFormatter.timeZone = TimeZone.current
        timestampFormatter.dateFormat = "yyyyMMdd-HHmmss"
        let timestamp = timestampFormatter.string(from: Date())

        let bundleName = "SyncFlow-Mobile-Diagnostics-\(timestamp)"
        let exportRoot = fileManager.temporaryDirectory.appendingPathComponent(bundleName, isDirectory: true)
        let archiveURL = fileManager.temporaryDirectory.appendingPathComponent("\(bundleName).zip")

        try? fileManager.removeItem(at: exportRoot)
        try? fileManager.removeItem(at: archiveURL)
        try fileManager.createDirectory(at: exportRoot, withIntermediateDirectories: true)

        let appInfo = await getAppInfo()
        let bindingState = await getBindingState()
        let syncOverview = await getSyncOverview()
        let queueSnapshot = await getReadOnlyQueue()
        let historyDays = await getHistoryDays(cursor: nil)
        let persistedActiveSession = uploadStore?.getActiveSession()
        let deviceInfo = await MainActor.run { () -> [String: Any] in
            let device = UIDevice.current
            return [
                "name": device.name,
                "model": device.model,
                "systemName": device.systemName,
                "systemVersion": device.systemVersion,
                "userInterfaceIdiom": device.userInterfaceIdiom.rawValue,
            ]
        }
        let applicationState = await MainActor.run { UIApplication.shared.applicationState }
        let photoAuthorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        let diagnosticsIssueState = diagnosticsIssueSnapshot()
        let activeQueueItem = queueSnapshot.first(where: { row in
            guard let status = row["status"] as? String else { return false }
            return status == "uploading" || status == "preparing" || status == "cloud_downloading"
        })
        let persistedSessionPayload: [String: Any] = persistedActiveSession.map { session in
            [
                "sessionId": session.sessionId,
                "startedAt": session.startedAt,
                "endedAt": session.endedAt ?? NSNull(),
                "state": session.state,
                "queueTotalCount": session.queueTotalCount,
                "queueTotalBytes": session.queueTotalBytes,
                "completedCount": session.completedCount,
                "completedBytes": session.completedBytes,
                "activeFileKey": session.activeFileKey ?? NSNull(),
                "activeOffset": session.activeOffset,
                "activeTransmissionMs": session.activeTransmissionMs,
                "updatedAt": session.updatedAt,
            ]
        } ?? [:]
        let activeSessionPayload: [String: Any] = [
            "sessionId": sessionService.currentSessionId ?? NSNull(),
            "state": sessionService.state.rawValue,
            "activeQueueItem": activeQueueItem ?? NSNull(),
            "persistedSession": persistedSessionPayload.isEmpty ? NSNull() : persistedSessionPayload,
        ]
        let runtimePayload: [String: Any] = [
            "applicationState": applicationState.rawValue,
            "bindingState": bindingState ?? NSNull(),
            "syncOverview": syncOverview,
            "queueCount": queueSnapshot.count,
            "historyPageCount": (historyDays["items"] as? [[String: Any]])?.count ?? 0,
            "photoAuthorization": photoAuthorizationLabel(photoAuthorization),
            "sidecarHost": sidecarHost ?? NSNull(),
            "activeSession": activeSessionPayload,
            "recentRetry": diagnosticsIssueState.recentRetry ?? NSNull(),
            "recentError": diagnosticsIssueState.recentError ?? NSNull(),
        ]
        let clientPayload: [String: Any] = [
            "clientId": bindingService.getOrCreateClientId(),
            "displayName": getClientDisplayName(),
            "hasPairingToken": bindingService.getPairingToken() != nil,
            "preferredIPv4": syncFlowPreferredClientIPv4() ?? NSNull(),
        ]

        let diagnostics: [String: Any] = [
            "generatedAt": ISO8601DateFormatter().string(from: Date()),
            "app": appInfo,
            "device": deviceInfo,
            "client": clientPayload,
            "runtime": runtimePayload,
        ]

        try writeJSONFile(diagnostics, to: exportRoot.appendingPathComponent("diagnostics.json"))
        try writeJSONFile(queueSnapshot, to: exportRoot.appendingPathComponent("queue.json"))
        try writeJSONFile(historyDays, to: exportRoot.appendingPathComponent("history.json"))
        try writeTextFile(
            SyncDiagnosticsLogStore.shared.snapshot().joined(separator: "\n"),
            to: exportRoot.appendingPathComponent("engine.log")
        )
        try exportDatabaseSnapshot(to: exportRoot)

        guard SSZipArchive.createZipFile(atPath: archiveURL.path, withContentsOfDirectory: exportRoot.path) else {
            throw SyncEngineError.databaseError("Failed to create diagnostics archive")
        }

        try? fileManager.removeItem(at: exportRoot)
        syncDiagnosticsLog("Diagnostics", "exported mobile diagnostics archive to \(archiveURL.lastPathComponent)")
        return archiveURL.path
    }

    private func photoAuthorizationLabel(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .authorized:
            return "authorized"
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

    private func writeJSONFile(_ object: Any, to url: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: .atomic)
    }

    private func writeTextFile(_ text: String, to url: URL) throws {
        try text.data(using: .utf8)?.write(to: url, options: .atomic)
    }

    private func exportDatabaseSnapshot(to exportRoot: URL) throws {
        guard let store = uploadStore else { return }
        try store.checkpointWal()

        let fileManager = FileManager.default
        let dbURL = URL(fileURLWithPath: UploadStore.dbPath())
        let siblingPaths = [
            dbURL,
            URL(fileURLWithPath: dbURL.path + "-wal"),
            URL(fileURLWithPath: dbURL.path + "-shm"),
        ]

        for sourceURL in siblingPaths where fileManager.fileExists(atPath: sourceURL.path) {
            let destinationURL = exportRoot.appendingPathComponent(sourceURL.lastPathComponent)
            try? fileManager.removeItem(at: destinationURL)
            try fileManager.copyItem(at: sourceURL, to: destinationURL)
        }
    }

    // MARK: - Client Display Name

    private static let legacyClientNameKey = "syncflow_client_display_name"

    // MARK: - Sidecar Host Resolution

    /// Connect TCP briefly to resolve the sidecar's IP for HTTP heartbeats, then disconnect.
    private func resolveSidecarHost(binding: BindingRecord, token: String, clientId: String) async throws {
        if let forcedTarget = resolvedForcedSidecarTarget() {
            sidecarHost = forcedTarget.host
            NSLog("[SyncPipeline] using forced sidecar host: %@:%d", forcedTarget.host, Int(forcedTarget.port))
            return
        }

        func findDevice() -> DiscoveredDevice? {
            if let exact = discoveredDevices[binding.deviceId], exact.endpoint != nil { return exact }
            return discoveredDevices.values.first(where: { $0.endpoint != nil })
        }

        var targetDevice = findDevice()
        var endpoint = targetDevice?.endpoint
        if endpoint == nil {
            discoveryService.startBrowsing()
            for _ in 0..<20 {
                try await Task.sleep(nanoseconds: 500_000_000)
                if let found = findDevice() {
                    targetDevice = found
                    endpoint = found.endpoint
                    break
                }
            }
        }
        let transport = TcpTransport()
        let session = ProtocolSession(transport: transport)
        try await connectSession(
            session,
            device: targetDevice,
            fallbackHost: binding.host,
            fallbackPort: UInt16(binding.port)
        )
        sidecarHost = preferredSidecarHost(probedHost: transport.remoteHost, device: targetDevice)
        NSLog("[SyncPipeline] resolved sidecar host: %@", sidecarHost ?? "nil")

        // Auth so sidecar registers us as connected
        let (helloType, helloRes) = try await session.sendAndReceive(
            type: .helloReq,
            payload: buildClientHelloPayload(clientId: clientId, pairingToken: token)
        )
        if helloType == .helloRes, let nonce = helloRes["nonce"] as? String {
            let hmac = transport.computeHMAC(token: token, nonce: nonce)
            let _ = try? await session.sendAndReceive(type: .authReq, payload: [
                "clientId": clientId, "auth": hmac,
            ])
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
        if let stored = bindingService.getClientDisplayName()?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !stored.isEmpty
        {
            return stored
        }

        let defaults = UserDefaults.standard
        if let legacy = defaults.string(forKey: Self.legacyClientNameKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !legacy.isEmpty,
           !syncFlowGenericClientName(legacy)
        {
            bindingService.saveClientDisplayName(legacy)
            defaults.removeObject(forKey: Self.legacyClientNameKey)
            return legacy
        }

        let generated = defaultClientDisplayName()
        defaults.removeObject(forKey: Self.legacyClientNameKey)
        return generated
    }

    func setClientDisplayName(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            bindingService.clearClientDisplayName()
            UserDefaults.standard.removeObject(forKey: Self.legacyClientNameKey)
            pushClientMetadataUpdateIfPossible()
            return
        }
        bindingService.saveClientDisplayName(trimmed)
        UserDefaults.standard.removeObject(forKey: Self.legacyClientNameKey)
        pushClientMetadataUpdateIfPossible()
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
