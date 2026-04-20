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

final class SyncDiagnosticsLogStore {
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

func syncDiagnosticsLog(_ category: String, _ message: @autoclosure () -> String) {
    SyncDiagnosticsLogStore.shared.record(category: category, message: message())
}

private func syncDiagnosticsDumpToConsole(_ lines: [String]) {
    if lines.isEmpty {
        NSLog("[Diagnostics] engine.log snapshot is empty at export time")
        return
    }

    NSLog("[Diagnostics] engine.log snapshot begin (%d lines)", lines.count)
    for line in lines {
        NSLog("[DiagnosticsLog] %@", line)
    }
    NSLog("[Diagnostics] engine.log snapshot end")
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
    private var albumBrowserService: AlbumBrowserService?
    private var autoUploadConfigStore: AutoUploadConfigStore?
    private var manualUploadService: ManualUploadService?
    let sharedFilesService = SharedFilesService()
    private var isAutoUploadInterrupted = false
    private var shouldAbortActiveAutoUpload = false
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
    private var sidecarHost: String? {  // resolved IP of Mac, for HTTP heartbeat
        didSet { sharedFilesService.sidecarHost = sidecarHost }
    }
    private lazy var heartbeatSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.isDiscretionary = false
        config.waitsForConnectivity = false
        config.networkServiceType = .responsiveData
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 5
        config.timeoutIntervalForResource = 5
        return URLSession(configuration: config)
    }()
    private var transitionBackgroundTaskId: UIBackgroundTaskIdentifier = .invalid
    private var bindingConnectionState: BindingConnectionState = .offline
    private var presenceHeartbeatTimer: DispatchSourceTimer?
    private let presenceRecoveryQueue = DispatchQueue(
        label: "com.syncflow.presence-recovery",
        qos: .utility
    )
    private let presenceRecoveryLock = NSLock()
    private var presenceRecoveryToken = UUID()
    private var presenceRecoveryWorkItem: DispatchWorkItem?
    private let diagnosticsIssueLock = NSLock()
    private var recentRetryDiagnostic: [String: Any]?
    private var recentErrorDiagnostic: [String: Any]?
    private var didAttemptRemoteHistoryReconciliation = false
    private var runtimeQueueTotalCount = 0
    private var runtimeQueueCompletedCount = 0
    private var runtimeQueueTotalBytes: Int64 = 0
    private var runtimeQueueCompletedBytes: Int64 = 0
    private var runtimeCurrentFileKey: String?
    private var runtimeCurrentFilename: String?
    private var runtimeCurrentFileConfirmedBytes: Int64 = 0
    private var runtimeCurrentFileTotalBytes: Int64 = 0
    private var runtimeCurrentSpeedMbps: Double = 0
    private var runtimeLastErrorCode: String?
    private var runtimeLastErrorMessage: String?
    private var runtimeLastSpeedCheckTime: CFAbsoluteTime = 0
    private var runtimeLastBytesTransferred: Int64 = 0
    private var runtimeUploadState = "idle"
    private var lastBackgroundPhotoLibraryChangeAt: CFAbsoluteTime = 0
    private let backgroundCaptureCooldown: CFTimeInterval = 90
    private var pendingRescanAfterThermalRecovery = false
    private var runtimePerformanceHint = "none"
    private var runtimePerformanceMessage: String?
    private var runtimeThermalState = "nominal"
    private var runtimeActiveTuningProfile = "normal"
    private var runtimeIsThermalLimited = false
    private var runtimeThermalReason: ThermalPerformanceReason?

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

    private func inferredBindingDeviceType(for deviceId: String) -> String {
        if let discovered = discoveredDevices[deviceId] {
            return discovered.type
        }
        if deviceId.hasPrefix("manual-") {
            return "win"
        }
        return "mac"
    }

    private func currentUploadTargetDeviceType() -> String? {
        guard let binding = uploadStore?.getBinding() else {
            return nil
        }

        if let discovered = discoveredDevices[binding.deviceId] {
            return discovered.type
        }

        switch binding.deviceType {
        case "mac", "win":
            return binding.deviceType
        default:
            return nil
        }
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

    private enum ThermalPerformanceReason: String {
        case backgroundThermal = "background_thermal"
        case thermalSerious = "thermal_serious"
        case thermalCritical = "thermal_critical"
        case thermalStreamPause = "thermal_stream_pause"
    }

    private func thermalStateLabel(_ state: ProcessInfo.ThermalState) -> String {
        switch state {
        case .nominal:
            return "nominal"
        case .fair:
            return "fair"
        case .serious:
            return "serious"
        case .critical:
            return "critical"
        @unknown default:
            return "unknown"
        }
    }

    private func thermalPerformanceReason(for profileLabel: String) -> ThermalPerformanceReason? {
        switch profileLabel {
        case ThermalPerformanceReason.backgroundThermal.rawValue:
            return .backgroundThermal
        case ThermalPerformanceReason.thermalSerious.rawValue:
            return .thermalSerious
        case ThermalPerformanceReason.thermalCritical.rawValue:
            return .thermalCritical
        default:
            return nil
        }
    }

    private func applyRuntimeThermalState(
        profileLabel: String,
        thermalState: ProcessInfo.ThermalState,
        overrideReason: ThermalPerformanceReason? = nil
    ) {
        let previousProfile = runtimeActiveTuningProfile
        let previousReason = runtimeThermalReason
        let previousThermalState = runtimeThermalState
        let nextThermalState = thermalStateLabel(thermalState)
        let nextReason = overrideReason ?? thermalPerformanceReason(for: profileLabel)

        runtimeActiveTuningProfile = profileLabel
        runtimeThermalState = nextThermalState
        runtimeThermalReason = nextReason
        runtimeIsThermalLimited = nextReason != nil
        runtimePerformanceHint = nextReason == nil ? "none" : "thermal_limited"
        runtimePerformanceMessage = nextReason == nil ? nil : "设备温度较高，已降低传输强度"

        if previousProfile != profileLabel || previousReason != nextReason || previousThermalState != nextThermalState {
            NSLog(
                "[SyncEngine] profile changed %@ -> %@ (thermal=%@, reason=%@)",
                previousProfile,
                profileLabel,
                nextThermalState,
                nextReason?.rawValue ?? "none"
            )
            syncDiagnosticsLog(
                "SyncEngine",
                "profile changed \(previousProfile) -> \(profileLabel) (thermal=\(nextThermalState), reason=\(nextReason?.rawValue ?? "none"))"
            )
        }

        if previousReason != .thermalStreamPause && nextReason == .thermalStreamPause {
            syncDiagnosticsLog("SyncEngine", "THERMAL_PAUSE thermal=\(nextThermalState) profile=\(profileLabel)")
        } else if previousReason == .thermalStreamPause && nextReason != .thermalStreamPause {
            syncDiagnosticsLog("SyncEngine", "THERMAL_RESUME thermal=\(nextThermalState) profile=\(profileLabel)")
        } else if previousReason != .thermalSerious && nextReason == .thermalSerious {
            syncDiagnosticsLog("SyncEngine", "THERMAL_THROTTLE thermal=\(nextThermalState) profile=\(profileLabel)")
        }
    }

    private func clearRuntimeCurrentFile() {
        runtimeCurrentFileKey = nil
        runtimeCurrentFilename = nil
        runtimeCurrentFileConfirmedBytes = 0
        runtimeCurrentFileTotalBytes = 0
    }

    private func clearRuntimeSyncRoundProgress(uploadState: String? = nil) {
        runtimeQueueTotalCount = 0
        runtimeQueueCompletedCount = 0
        runtimeQueueTotalBytes = 0
        runtimeQueueCompletedBytes = 0
        clearRuntimeCurrentFile()
        runtimeCurrentSpeedMbps = 0
        runtimeLastSpeedCheckTime = 0
        runtimeLastBytesTransferred = 0
        if let uploadState {
            runtimeUploadState = uploadState
        }
    }

    private func clearRuntimeReconnectError() {
        runtimeLastErrorCode = nil
        runtimeLastErrorMessage = nil
    }

    private func setRuntimeReconnectError(code: String?, message: String?) {
        runtimeLastErrorCode = code
        runtimeLastErrorMessage = message
    }

    private func beginRuntimeSyncOverview(
        totalCount: Int,
        totalBytes: Int64,
        completedCount: Int = 0,
        completedBytes: Int64 = 0
    ) {
        runtimeQueueTotalCount = totalCount
        runtimeQueueCompletedCount = completedCount
        runtimeQueueTotalBytes = totalBytes
        runtimeQueueCompletedBytes = completedBytes
        runtimeLastSpeedCheckTime = CFAbsoluteTimeGetCurrent()
        runtimeLastBytesTransferred = completedBytes
        runtimeCurrentSpeedMbps = 0
        clearRuntimeCurrentFile()
        clearRuntimeReconnectError()
        applyRuntimeThermalState(
            profileLabel: "normal",
            thermalState: ProcessInfo.processInfo.thermalState
        )
    }

    private func updateRuntimeSpeed() {
        let now = CFAbsoluteTimeGetCurrent()
        let elapsed = now - runtimeLastSpeedCheckTime
        guard elapsed >= 0.5 else { return }

        let totalTransferred = runtimeQueueCompletedBytes + runtimeCurrentFileConfirmedBytes
        let bytesDelta = totalTransferred - runtimeLastBytesTransferred
        if bytesDelta < 0 {
            // Reset if progress goes backward (should not happen with cumulative stats)
            runtimeLastBytesTransferred = totalTransferred
            runtimeLastSpeedCheckTime = now
            return
        }

        runtimeCurrentSpeedMbps = (Double(bytesDelta) / elapsed) / (1024 * 1024)
        runtimeLastBytesTransferred = totalTransferred
        runtimeLastSpeedCheckTime = now
    }

    private func runtimeSyncOverviewPayload(
        uploadState: String,
        progressPercent: Int? = nil
    ) -> [String: Any] {
        runtimeUploadState = uploadState
        let currentBinding = uploadStore?.getBinding()
        let pendingCounts = uploadStore?.getPendingCountsBySource() ?? (auto: 0, manual: 0)
        let currentTaskSource: Any = uploadStore?.getCurrentUploadingSource() ?? NSNull()
        let persistedQueueStats = uploadStore?.getQueueStats() ?? (totalCount: 0, totalBytes: 0, completedCount: 0, completedBytes: 0)
        let hasRuntimeRoundProgress =
            runtimeQueueTotalCount > 0 ||
            runtimeQueueCompletedCount > 0 ||
            runtimeQueueTotalBytes > 0 ||
            runtimeQueueCompletedBytes > 0 ||
            runtimeCurrentFileTotalBytes > 0
        let shouldFallbackToPersistedQueueStats =
            !hasRuntimeRoundProgress &&
            pendingCounts.manual == 0 &&
            pendingCounts.auto == 0 &&
            currentBinding != nil &&
            uploadState == "idle" &&
            persistedQueueStats.totalCount > 0

        let effectiveTotalCount =
            shouldFallbackToPersistedQueueStats
                ? persistedQueueStats.totalCount
                : runtimeQueueTotalCount
        let effectiveCompletedCount =
            shouldFallbackToPersistedQueueStats
                ? persistedQueueStats.completedCount
                : runtimeQueueCompletedCount
        let effectiveTotalBytes =
            shouldFallbackToPersistedQueueStats
                ? persistedQueueStats.totalBytes
                : runtimeQueueTotalBytes
        let effectiveCompletedBytes =
            shouldFallbackToPersistedQueueStats
                ? persistedQueueStats.completedBytes
                : runtimeQueueCompletedBytes
        let transferredBytes = effectiveCompletedBytes + runtimeCurrentFileConfirmedBytes
        let derivedProgressPercent: Int
        if let progressPercent {
            derivedProgressPercent = progressPercent
        } else if runtimeCurrentFileTotalBytes > 0 {
            derivedProgressPercent = Int(
                (Double(runtimeCurrentFileConfirmedBytes) / Double(runtimeCurrentFileTotalBytes)) * 100
            )
        } else if effectiveTotalCount > 0 && effectiveCompletedCount >= effectiveTotalCount {
            derivedProgressPercent = 100
        } else {
            derivedProgressPercent = uploadState == "completed" ? 100 : 0
        }

        let autoUploadState = autoUploadConfigStore?.getConfig().state ?? "disabled"

        return [
            "currentDeviceId": currentBinding?.deviceId ?? NSNull(),
            "currentDeviceName": currentBinding?.deviceAlias ?? currentBinding?.deviceName ?? NSNull(),
            "completedCount": effectiveCompletedCount,
            "completedBytes": effectiveCompletedBytes,
            "currentFile": runtimeCurrentFileKey ?? NSNull(),
            "currentFilename": runtimeCurrentFilename ?? NSNull(),
            "currentFileConfirmedBytes": runtimeCurrentFileConfirmedBytes,
            "currentFileTotalBytes": runtimeCurrentFileTotalBytes,
            "currentSpeedMbps": round(runtimeCurrentSpeedMbps * 10) / 10,
            "transferredBytes": transferredBytes,
            "lastErrorCode": runtimeLastErrorCode ?? NSNull(),
            "lastErrorMessage": runtimeLastErrorMessage ?? NSNull(),
            "performanceHint": runtimePerformanceHint,
            "performanceMessage": runtimePerformanceMessage ?? NSNull(),
            "progressPercent": derivedProgressPercent,
            "totalBytes": effectiveTotalBytes,
            "totalCount": effectiveTotalCount,
            "thermalState": runtimeThermalState,
            "activeTuningProfile": runtimeActiveTuningProfile,
            "isThermalLimited": runtimeIsThermalLimited,
            "uploadState": runtimeUploadState,
            "currentTaskSource": currentTaskSource,
            "autoUploadState": autoUploadState,
            "manualPending": pendingCounts.manual,
            "autoPending": pendingCounts.auto,
        ]
    }

    private func overviewLogValue(_ value: Any?) -> String {
        guard let value, !(value is NSNull) else { return "nil" }
        return String(describing: value)
    }

    private func logSyncOverviewEmission(_ context: String, payload: [String: Any]) {
        let message = String(
            format: "emit %@ state=%@ auto=%@ source=%@ completed=%@/%@ bytes=%@/%@ pending(manual=%@ auto=%@) currentFile=%@ currentBytes=%@/%@ progress=%@",
            context,
            overviewLogValue(payload["uploadState"]),
            overviewLogValue(payload["autoUploadState"]),
            overviewLogValue(payload["currentTaskSource"]),
            overviewLogValue(payload["completedCount"]),
            overviewLogValue(payload["totalCount"]),
            overviewLogValue(payload["completedBytes"]),
            overviewLogValue(payload["totalBytes"]),
            overviewLogValue(payload["manualPending"]),
            overviewLogValue(payload["autoPending"]),
            overviewLogValue(payload["currentFile"]),
            overviewLogValue(payload["currentFileConfirmedBytes"]),
            overviewLogValue(payload["currentFileTotalBytes"]),
            overviewLogValue(payload["progressPercent"])
        )
        NSLog("[SyncOverview] %@", message)
        syncDiagnosticsLog("SyncOverview", message)
    }

    private func isAutoUploadActiveForDiscovery() -> Bool {
        let config = autoUploadConfigStore?.getConfig()
        return config?.enabled == true &&
            config?.state == "active" &&
            !isAutoUploadInterrupted
    }

    private func emitScanningProgress(scanned: Int, total: Int) {
        guard isAutoUploadActiveForDiscovery() else { return }
        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            runtimeSyncOverviewPayload(uploadState: "scanning").merging([
                "scannedCount": scanned,
                "libraryTotal": total,
            ] as [String: Any]) { _, new in new }
        )
    }

    private func buildPendingUploadAssets(clientId: String, limit: Int? = 200) -> [ScannedAsset] {
        guard let store = uploadStore else { return [] }

        let pendingItems = store.getPendingUploadItemsSorted(
            limit: limit,
            excludeSource: isAutoUploadInterrupted ? "auto" : nil
        )
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
                estimatedSize: estimatedSize,
                source: item.source
            ))
        }

        if missingAssets > 0 {
            NSLog("[SyncPipeline] skipped %d pending items whose PHAsset could not be resolved", missingAssets)
            syncDiagnosticsLog("SyncPipeline", "skipped \(missingAssets) pending items whose PHAsset could not be resolved")
        }

        return results
    }

    private func emitPreparingStateForNextFile(nextAsset: ScannedAsset) {
        runtimeCurrentFileKey = nextAsset.fileKey
        runtimeCurrentFilename = nextAsset.originalFilename
        runtimeCurrentFileConfirmedBytes = 0
        runtimeCurrentFileTotalBytes = nextAsset.estimatedSize
        runtimeCurrentSpeedMbps = 0
        // Also update DB filename so the queue list shows the definitive name.
        if var item = uploadStore?.getUploadItemByFileKey(nextAsset.fileKey) {
            item.originalFilename = nextAsset.originalFilename
            if nextAsset.estimatedSize > 0 {
                item.fileSize = nextAsset.estimatedSize
            }
            try? uploadStore?.upsertUploadItem(item)
        }
        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            runtimeSyncOverviewPayload(uploadState: "preparing", progressPercent: 0)
        )
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
        // Only detect the first 2 items (current + next candidate) to minimise
        // PhotoKit pressure. The rest will be detected lazily when they reach
        // the head of the queue. Under thermal pressure, skip entirely.
        let thermalBatchLimit: Int
        switch ProcessInfo.processInfo.thermalState {
        case .critical, .serious: return
        default:                  thermalBatchLimit = 2
        }
        let candidates = Array(items.prefix(thermalBatchLimit))
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
            var dict: [String: Any] = [
                "id": item.id ?? 0,
                "assetLocalId": item.assetLocalId,
                "fileKey": item.fileKey ?? "",
                "originalFilename": item.originalFilename ?? item.assetLocalId,
                "mediaType": item.mediaType,
                "fileSize": item.fileSize ?? 0,
                "ackedOffset": item.ackedOffset,
                "status": item.status,
                "isCloudAsset": cachedCloudAssetFlag(for: item) ?? false,
                "source": item.source,
            ]
            if let batchId = item.batchId {
                dict["batchId"] = batchId
            }
            return dict
        }
    }

    private func markAssetPreparing(asset: ScannedAsset) {
        // Update status and write the definitive filename/size (from ScannedAsset, which
        // matches what AssetExportService will produce) before emitting the queue so that
        // the JS queue list immediately shows the correct filename instead of a stale
        // PHAsset-scan-time value.
        if var item = uploadStore?.getUploadItemByFileKey(asset.fileKey) {
            item.status = "preparing"
            item.originalFilename = asset.originalFilename
            if asset.estimatedSize > 0 {
                item.fileSize = asset.estimatedSize
            }
            try? uploadStore?.upsertUploadItem(item)
        } else {
            try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "preparing")
        }
        emitQueueToJS()
    }

    private func exportAssetForUpload(_ asset: ScannedAsset) async throws -> ExportedFile {
        markAssetPreparing(asset: asset)

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
        // Migrate keychain from old bundle ID before any keychain access
        bindingService.migrateKeychainIfNeeded()
        do {
            uploadStore = try UploadStore()
            historyStore = HistoryLedgerStore(store: uploadStore!)
            albumBrowserService = AlbumBrowserService(uploadStore: uploadStore)
            autoUploadConfigStore = AutoUploadConfigStore(store: uploadStore!)
            manualUploadService = ManualUploadService(uploadStore: uploadStore, bindingService: bindingService)
            photoScanner.autoUploadConfigStore = autoUploadConfigStore

            // Register photo library observer early so album browser receives
            // change events even before sync starts (e.g. limited picker flow).
            // Only register when permission is already granted — registering with
            // .notDetermined implicitly triggers the system permission dialog.
            // The sync lifecycle calls startObserving() again after explicitly
            // requesting permission, so this is just an early-start optimization.
            let photoStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            if photoStatus == .authorized || photoStatus == .limited {
                photoScanner.startObserving()
            }

            // Restore interrupted state from persisted config across app restarts
            if autoUploadConfigStore?.getConfig().state == "interrupted" {
                isAutoUploadInterrupted = true
                NSLog("[SyncEngine] restored interrupted state from persisted config")
            }

            // Cleanup is safe to run at any point during init — it only uses
            // the static AlbumBrowserService.previewCacheDir() helper and
            // dispatches its work onto a utility queue asynchronously.
            cleanupPreviewCacheIfNeeded()
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
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(thermalStateDidChange),
            name: ProcessInfo.thermalStateDidChangeNotification,
            object: nil
        )
        // Sweep leftover export temp files from previous sessions (crash / jetsam kills leave
        // large video files on disk that accumulate across launches and cause OOM).
        let exportTempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_export", isDirectory: true)
        try? FileManager.default.removeItem(at: exportTempDir)
        NSLog("[SyncEngine] cleared export temp dir on init")
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
        // Returning to foreground removes the "background + non-nominal" defer
        // condition. If a rescan was deferred while backgrounded, trigger it now —
        // thermalStateDidChange() won't fire if thermal state hasn't changed.
        if pendingRescanAfterThermalRecovery && isSyncing {
            let thermal = ProcessInfo.processInfo.thermalState
            if thermal != .serious && thermal != .critical {
                pendingRescanAfterThermalRecovery = false
                NSLog("[SyncEngine] foreground restored — triggering deferred rescan (thermal=%@)", thermalStateLabel(thermal))
                syncDiagnosticsLog("SyncEngine", "foreground restored — triggering deferred rescan (thermal=\(thermalStateLabel(thermal)))")
                scheduleIncrementalQueueRescan(reason: "foreground_recovery_compensation")
            }
        }

        // Validate connection immediately on foreground — the heartbeat timer
        // may not have fired while the app was suspended, leaving a stale
        // .connected state even though the desktop is no longer reachable.
        if bindingConnectionState == .connected || bindingConnectionState == .bound {
            let clientId = bindingService.getOrCreateClientId()
            sendPresenceHeartbeat(clientId: clientId)
        }
    }

    @objc private func thermalStateDidChange() {
        let state = ProcessInfo.processInfo.thermalState
        let label = thermalStateLabel(state)
        NSLog("[SyncEngine] thermal state changed to %@", label)
        syncDiagnosticsLog("SyncEngine", "thermal state changed to \(label)")
        _ = resolvedUploadTuning()
        if isSyncing {
            NativeSyncEngineModule.shared?.emitSyncStateChanged(
                runtimeSyncOverviewPayload(
                    uploadState: runtimeUploadState.isEmpty ? sessionService.state.rawValue : runtimeUploadState
                )
            )

            // Compensate for rescans that were deferred while thermally pressured.
            // Now that thermal state has improved, pick up any photo library changes
            // that arrived during the hot period.
            if pendingRescanAfterThermalRecovery
                && state != .serious && state != .critical
                && !(isAppBackgrounded() && state != .nominal)
            {
                pendingRescanAfterThermalRecovery = false
                NSLog("[SyncEngine] thermal recovered — triggering deferred rescan")
                syncDiagnosticsLog("SyncEngine", "thermal recovered to \(label) — triggering deferred rescan")
                scheduleIncrementalQueueRescan(reason: "thermal_recovery_compensation")
            }
        }
    }

    // MARK: - Sync Pipeline (spec Section 7.3)

    private var isSyncing = false
    private var isPairing = false


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

    private func refreshBoundServerMetadata(
        serverName rawServerName: String?,
        shareName rawShareName: String?,
        host rawHost: String? = nil
    ) {
        guard var binding = uploadStore?.getBinding() else { return }

        let normalizedServerName = rawServerName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedShareName = rawShareName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedHost = rawHost?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        var changedFields: [String] = []

        if let serverName = normalizedServerName,
           !serverName.isEmpty,
           binding.deviceName != serverName
        {
            binding.deviceName = serverName
            changedFields.append("deviceName")
        }

        if let shareName = normalizedShareName,
           !shareName.isEmpty,
           binding.shareName != shareName
        {
            binding.shareName = shareName
            changedFields.append("shareName")
        }

        if let host = normalizedHost,
           !host.isEmpty,
           binding.host != host
        {
            binding.host = host
            changedFields.append("host")
        }

        guard !changedFields.isEmpty else { return }

        do {
            try uploadStore?.saveBinding(binding)
            syncDiagnosticsLog(
                "SyncEngine",
                "binding metadata refreshed fields=\(changedFields.joined(separator: ",")) serverName=\(binding.deviceName)"
            )
            NativeSyncEngineModule.shared?.emitBindingStateChanged(
                bindingStatePayload(binding: binding)
            )
        } catch {
            syncDiagnosticsLog(
                "SyncEngine",
                "failed to refresh binding metadata error=\(error)"
            )
        }
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

        // Keep the standalone heartbeat timer in sync with connection state
        if newState == .connected {
            cancelPresenceRecoveryProbe(reason: "state_connected")
            startPresenceHeartbeatTimer()
        } else {
            stopPresenceHeartbeatTimer()
        }
    }

    private func maintainConnectedBindingState(reason: String) {
        guard uploadStore?.getBinding() != nil else { return }
        if bindingConnectionState != .connected {
            updateBindingConnectionState(.connected, reason: reason)
            return
        }

        syncDiagnosticsLog("SyncEngine", "binding connection state remains connected (\(reason))")
        cancelPresenceRecoveryProbe(reason: reason)
        startPresenceHeartbeatTimer()
        emitBindingStateChanged()
    }

    // MARK: - Standalone Presence Heartbeat Timer

    /// Runs independently of the sync pipeline so we detect desktop disappearance
    /// even when no upload is in progress.
    private func startPresenceHeartbeatTimer() {
        stopPresenceHeartbeatTimer()
        guard uploadStore?.getBinding() != nil else { return }
        let clientId = bindingService.getOrCreateClientId()
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        timer.schedule(deadline: .now() + 30, repeating: 30, leeway: .seconds(5))
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            // Skip if sync pipeline is running — it has its own heartbeat loop
            guard !self.isSyncing else { return }
            self.sendPresenceHeartbeat(clientId: clientId)
        }
        timer.resume()
        presenceHeartbeatTimer = timer
        NSLog("[SyncEngine] standalone presence heartbeat timer started")
        syncDiagnosticsLog("SyncEngine", "standalone presence heartbeat timer started")
    }

    private func stopPresenceHeartbeatTimer() {
        if let timer = presenceHeartbeatTimer {
            timer.cancel()
            presenceHeartbeatTimer = nil
            NSLog("[SyncEngine] standalone presence heartbeat timer stopped")
            syncDiagnosticsLog("SyncEngine", "standalone presence heartbeat timer stopped")
        }
    }

    private func cancelPresenceRecoveryProbe(reason: String) {
        presenceRecoveryLock.lock()
        presenceRecoveryToken = UUID()
        let workItem = presenceRecoveryWorkItem
        presenceRecoveryWorkItem = nil
        presenceRecoveryLock.unlock()

        if let workItem {
            workItem.cancel()
            syncDiagnosticsLog("SyncEngine", "presence recovery probe cancelled (\(reason))")
        }
    }

    private func setPresenceRecoveryWorkItem(_ workItem: DispatchWorkItem?) {
        presenceRecoveryLock.lock()
        presenceRecoveryWorkItem = workItem
        presenceRecoveryLock.unlock()
    }

    private func currentPresenceRecoveryToken() -> UUID {
        presenceRecoveryLock.lock()
        defer { presenceRecoveryLock.unlock() }
        return presenceRecoveryToken
    }

    private func startPresenceRecoveryProbe(
        clientId: String,
        maxAttempts: Int = 8,
        retryInterval: TimeInterval = 1
    ) {
        cancelPresenceRecoveryProbe(reason: "start_new_probe")
        updateBindingConnectionState(.connecting, reason: "presence_recovery_started")

        let token = UUID()
        presenceRecoveryLock.lock()
        presenceRecoveryToken = token
        presenceRecoveryLock.unlock()

        syncDiagnosticsLog(
            "SyncEngine",
            "presence recovery probe started attempts=\(maxAttempts) interval=\(retryInterval)s"
        )
        performPresenceRecoveryProbe(
            clientId: clientId,
            attempt: 1,
            maxAttempts: maxAttempts,
            retryInterval: retryInterval,
            token: token
        )
    }

    private func performPresenceRecoveryProbe(
        clientId: String,
        attempt: Int,
        maxAttempts: Int,
        retryInterval: TimeInterval,
        token: UUID
    ) {
        guard token == currentPresenceRecoveryToken() else { return }

        syncDiagnosticsLog(
            "SyncEngine",
            "presence recovery attempt \(attempt)/\(maxAttempts) host=\(sidecarHost ?? uploadStore?.getBinding()?.host ?? "nil")"
        )

        sendPresenceHeartbeat(
            clientId: clientId,
            successReason: "presence_recovery_succeeded",
            failureReason: "presence_recovery_failed",
            updateStateOnFailure: false
        ) { [weak self] success in
            guard let self = self else { return }
            guard token == self.currentPresenceRecoveryToken() else { return }

            if success {
                self.cancelPresenceRecoveryProbe(reason: "heartbeat_succeeded")
                if !self.isSyncing {
                    self.startSync()
                }
                return
            }

            guard attempt < maxAttempts else {
                self.cancelPresenceRecoveryProbe(reason: "exhausted")
                self.updateBindingConnectionState(.offline, reason: "presence_recovery_exhausted")
                return
            }

            let workItem = DispatchWorkItem { [weak self] in
                self?.performPresenceRecoveryProbe(
                    clientId: clientId,
                    attempt: attempt + 1,
                    maxAttempts: maxAttempts,
                    retryInterval: retryInterval,
                    token: token
                )
            }
            self.setPresenceRecoveryWorkItem(workItem)
            self.presenceRecoveryQueue.asyncAfter(deadline: .now() + retryInterval, execute: workItem)
        }
    }

    private func currentAppStateLabel(for applicationState: UIApplication.State) -> String {
        switch applicationState {
        case .background:
            return "background"
        default:
            return sessionService.state == .syncingBackground ? "background" : "foreground"
        }
    }

    private func isAppBackgrounded() -> Bool {
        sessionService.state == .syncingBackground
    }

    private func backgroundCaptureCooldownRemaining(now: CFAbsoluteTime = CFAbsoluteTimeGetCurrent()) -> CFTimeInterval {
        guard lastBackgroundPhotoLibraryChangeAt > 0 else { return 0 }
        return max(backgroundCaptureCooldown - (now - lastBackgroundPhotoLibraryChangeAt), 0)
    }

    private func isBackgroundCaptureRecentlyActive(now: CFAbsoluteTime = CFAbsoluteTimeGetCurrent()) -> Bool {
        isAppBackgrounded() && backgroundCaptureCooldownRemaining(now: now) > 0
    }

    private func currentAppStateLabel() async -> String {
        let applicationState = await MainActor.run { UIApplication.shared.applicationState }
        return currentAppStateLabel(for: applicationState)
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

    private func buildClientHelloPayload(clientId: String, pairingToken: String? = nil) async -> [String: Any] {
        var payload: [String: Any] = [
            "clientId": clientId,
            "clientName": getClientDisplayName(),
            "clientPlatform": "ios",
            "appVersion": currentAppVersionLabel(),
            "appState": await currentAppStateLabel(),
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
        guard let binding = uploadStore?.getBinding() else { return }
        let token = resolvedPairingToken(for: binding)
        guard let token else { return }

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
                    payload: await self.buildClientHelloPayload(clientId: clientId, pairingToken: token)
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
        shouldAbortActiveAutoUpload = false
        didAttemptRemoteHistoryReconciliation = false
        endBackgroundTransitionIfNeeded(reason: "syncStopped")
        SilentAudioService.shared.stop()
        sessionService.endSession(transitionTo: finalState)
    }

    private struct UploadTuning {
        let perfLoggingEnabled: Bool
        let chunkSizeBytes: Int
        let targetInFlightBytes: Int64
        let maxPipelineChunks: Int
        let ackTimeoutNs: UInt64
        let throttleBytesPerSec: Int64
        let prefetchNextFile: Bool
        let profileLabel: String
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
            ) ?? 32, chunkMB),
            256
        )
        let maxPipelineChunks = min(
            max(syncFlowIntSetting(
                envKey: "SYNCFLOW_UPLOAD_PIPELINE_CHUNKS",
                userDefaultsKey: "SyncFlowUploadPipelineChunks"
            ) ?? 8, 1),
            32
        )
        let ackTimeoutSec = min(
            max(syncFlowIntSetting(
                envKey: "SYNCFLOW_UPLOAD_ACK_TIMEOUT_SEC",
                userDefaultsKey: "SyncFlowUploadAckTimeoutSec"
            ) ?? 8, 2),
            60
        )

        var adjustedChunkMB = chunkMB
        var adjustedWindowMB = windowMB
        var adjustedMaxPipelineChunks = maxPipelineChunks
        var adjustedAckTimeoutSec = ackTimeoutSec
        var adjustedThrottleBytesPerSec: Int64 = 0
        var prefetchNextFile = true
        var profileLabel = "normal"

        let processInfo = ProcessInfo.processInfo
        let thermalState = processInfo.thermalState
        let isLowPowerModeEnabled = processInfo.isLowPowerModeEnabled
        let isBackgroundSync = sessionService.state == .syncingBackground
        let isActiveBackgroundCapture = isBackgroundCaptureRecentlyActive()
        let targetDeviceType = currentUploadTargetDeviceType()

        switch thermalState {
        case .serious:
            adjustedChunkMB = min(adjustedChunkMB, 2)
            adjustedWindowMB = min(adjustedWindowMB, 4)
            adjustedMaxPipelineChunks = min(adjustedMaxPipelineChunks, 2)
            adjustedAckTimeoutSec = max(adjustedAckTimeoutSec, 15)
            adjustedThrottleBytesPerSec = 6 * 1024 * 1024
            prefetchNextFile = false
            profileLabel = "thermal_serious"
        case .critical:
            adjustedChunkMB = 1
            adjustedWindowMB = min(adjustedWindowMB, 2)
            adjustedMaxPipelineChunks = 1
            adjustedAckTimeoutSec = max(adjustedAckTimeoutSec, 20)
            adjustedThrottleBytesPerSec = 4 * 1024 * 1024
            prefetchNextFile = false
            profileLabel = "thermal_critical"
        default:
            break
        }

        if isLowPowerModeEnabled && thermalState != .serious && thermalState != .critical {
            adjustedChunkMB = min(adjustedChunkMB, 4)
            adjustedWindowMB = min(adjustedWindowMB, 8)
            adjustedMaxPipelineChunks = min(adjustedMaxPipelineChunks, 3)
            adjustedAckTimeoutSec = max(adjustedAckTimeoutSec, 12)
            adjustedThrottleBytesPerSec = max(adjustedThrottleBytesPerSec, 8 * 1024 * 1024)
            prefetchNextFile = false
            profileLabel = "low_power"
        }

        if isBackgroundSync && profileLabel == "normal" {
            if thermalState != .nominal {
                // Backgrounded + thermal pressure → yield to foreground workload (e.g. video recording)
                adjustedChunkMB = min(adjustedChunkMB, 2)
                adjustedWindowMB = min(adjustedWindowMB, 3)
                adjustedMaxPipelineChunks = min(adjustedMaxPipelineChunks, 1)
                adjustedAckTimeoutSec = max(adjustedAckTimeoutSec, 15)
                adjustedThrottleBytesPerSec = max(adjustedThrottleBytesPerSec, 3 * 1024 * 1024)
                prefetchNextFile = false
                profileLabel = "background_thermal"
            } else {
                adjustedChunkMB = min(adjustedChunkMB, 4)
                adjustedWindowMB = min(adjustedWindowMB, 8)
                adjustedMaxPipelineChunks = min(adjustedMaxPipelineChunks, 2)
                prefetchNextFile = false
                profileLabel = "background"
            }
        }

        if isActiveBackgroundCapture {
            adjustedChunkMB = min(adjustedChunkMB, 2)
            adjustedWindowMB = min(adjustedWindowMB, 3)
            adjustedMaxPipelineChunks = min(adjustedMaxPipelineChunks, 1)
            adjustedAckTimeoutSec = max(adjustedAckTimeoutSec, 15)
            adjustedThrottleBytesPerSec = max(adjustedThrottleBytesPerSec, 3 * 1024 * 1024)
            prefetchNextFile = false
            profileLabel = "active_capture"
        }

        if targetDeviceType == "win" {
            adjustedChunkMB = min(adjustedChunkMB, 2)
            adjustedWindowMB = min(adjustedWindowMB, 4)
            adjustedMaxPipelineChunks = min(adjustedMaxPipelineChunks, 2)
            adjustedAckTimeoutSec = max(adjustedAckTimeoutSec, 20)
            adjustedThrottleBytesPerSec = max(adjustedThrottleBytesPerSec, 6 * 1024 * 1024)
            prefetchNextFile = false
            if profileLabel == "normal" {
                profileLabel = "windows_safe"
            } else {
                profileLabel += "_windows_safe"
            }
        }

        adjustedWindowMB = max(adjustedWindowMB, adjustedChunkMB)
        adjustedMaxPipelineChunks = max(adjustedMaxPipelineChunks, 1)

        applyRuntimeThermalState(
            profileLabel: profileLabel,
            thermalState: thermalState
        )

        return UploadTuning(
            perfLoggingEnabled: perfLoggingEnabled,
            chunkSizeBytes: adjustedChunkMB * 1024 * 1024,
            targetInFlightBytes: Int64(adjustedWindowMB) * 1024 * 1024,
            maxPipelineChunks: adjustedMaxPipelineChunks,
            ackTimeoutNs: UInt64(adjustedAckTimeoutSec) * 1_000_000_000,
            throttleBytesPerSec: adjustedThrottleBytesPerSec,
            prefetchNextFile: prefetchNextFile,
            profileLabel: profileLabel
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
            case .databaseError, .pairingError, .permissionError, .lowDiskPaused, .autoUploadInterrupted:
                return false
            }
        }
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain
    }

    private func classifyRetryableSyncError(
        _ error: Error,
        targetDeviceType: String?
    ) -> (code: String, message: String) {
        let errorDescription = "\(error)"
        let normalizedDescription = errorDescription.lowercased()

        if targetDeviceType == "win" {
            let windowsHostAbortSignatures = [
                "connection reset by peer",
                "software caused connection abort",
                "connection aborted",
                "broken pipe",
                "posix(53",
                "posix(54",
                "econnreset",
            ]
            let looksLikeWindowsHostAbort = windowsHostAbortSignatures.contains(where: {
                normalizedDescription.contains($0)
            })
            let looksLikeTimeout = normalizedDescription.contains("timed out")
                || normalizedDescription.contains("timeout")

            if looksLikeWindowsHostAbort && !looksLikeTimeout {
                return (
                    code: "WINDOWS_HOST_ABORTED_CONNECTION",
                    message: "Windows host aborted the transfer connection: \(errorDescription)"
                )
            }
        }

        if normalizedDescription.contains("file_ack timeout") {
            return (
                code: "FILE_ACK_TIMEOUT",
                message: "Timed out while waiting for the desktop to acknowledge upload data"
            )
        }

        if normalizedDescription.contains("connection timed out") {
            return (
                code: "CONNECTION_TIMEOUT",
                message: "Connection timed out while trying to continue the transfer"
            )
        }

        return (
            code: "RETRYABLE_NETWORK_ERROR",
            message: errorDescription
        )
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

        // Skip full-library rescan when device is thermally pressured or actively
        // capturing in the background — the scan is CPU-heavy (SHA256 + PhotoKit
        // per asset) and can wait until conditions improve. The new photos will be
        // picked up on the next normal scan round.
        let thermal = ProcessInfo.processInfo.thermalState
        if thermal == .serious || thermal == .critical {
            NSLog("[SyncEngine] deferring incremental rescan — thermal state %@", thermalStateLabel(thermal))
            pendingRescanAfterThermalRecovery = true
            return
        }
        if isAppBackgrounded() && thermal != .nominal {
            NSLog("[SyncEngine] deferring incremental rescan — backgrounded + thermal %@", thermalStateLabel(thermal))
            pendingRescanAfterThermalRecovery = true
            return
        }

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

        // Skip auto-discovery when auto upload is not active
        let autoUploadActive = isAutoUploadActiveForDiscovery()
        guard autoUploadActive else {
            NSLog("[SyncEngine] skipping incremental rescan — auto upload not active (%@)", reason)
            return
        }

        let clientId = bindingService.getOrCreateClientId()
        let trackedFileKeys = Set(store.getAutoDiscoveryTrackedFileKeys())

        // Prefer delta scan (only newly inserted/changed assets) over full-library
        // enumeration. Falls back to full scan when no cached fetchResult exists
        // (first run after launch).
        let untrackedAssets: [ScannedAsset]
        if let deltaResults = photoScanner.scanChangedAssets(
            clientId: clientId,
            trackedFileKeys: trackedFileKeys
        ) {
            untrackedAssets = deltaResults
            if !deltaResults.isEmpty {
                NSLog("[SyncEngine] incremental delta scan found %d new assets (%@)", deltaResults.count, reason)
                syncDiagnosticsLog("SyncEngine", "incremental delta scan found \(deltaResults.count) new assets (\(reason))")
            }
        } else {
            NSLog("[SyncEngine] no cached fetchResult — falling back to full scan (%@)", reason)
            untrackedAssets = photoScanner.scanForUntrackedAssets(
                clientId: clientId,
                trackedFileKeys: trackedFileKeys
            )
        }

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
                updatedAt: now,
                source: "auto",
                batchId: nil,
                priority: 0
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
            // Already running — wake the watch loop so it picks up newly
            // queued items (e.g. manual upload submitted while pipeline is
            // idle-waiting for photoLibraryChanged).
            NSLog("[SyncEngine] startSync: already syncing — waking watch loop")
            syncDiagnosticsLog("SyncEngine", "startSync: already syncing — waking watch loop")
            photoLibraryChanged = true
            resumeWatchLoopIfNeeded()
            return
        }

        // Check if there's anything to sync: auto upload must be active,
        // OR there must be pending manual items. If neither, skip starting
        // the full sync lifecycle (no background task, no audio session).
        let configState = autoUploadConfigStore?.getConfig().state ?? "disabled"
        let manualPending = uploadStore?.getPendingCountsBySource().manual ?? 0
        if configState != "active" && manualPending == 0 {
            NSLog("[SyncEngine] startSync skipped — auto upload %@, no manual pending", configState)
            syncDiagnosticsLog("SyncEngine", "startSync skipped — auto upload \(configState), no manual pending")
            // Emit current state so pages render correctly
            let payload = runtimeSyncOverviewPayload(uploadState: configState == "interrupted" ? "paused_auto_upload" : "idle")
            logSyncOverviewEmission("start_sync_skipped", payload: payload)
            NativeSyncEngineModule.shared?.emitSyncStateChanged(
                payload
            )
            return
        }

        isSyncing = true
        clearRuntimeCurrentFile()
        runtimeCurrentSpeedMbps = 0
        clearRuntimeReconnectError()
        NSLog("[SyncEngine] startSync")
        syncDiagnosticsLog("SyncEngine", "startSync")
        sessionService.transitionTo(.scanning)
        backgroundService.submitContinuedTask()
        SilentAudioService.shared.start()

        Task { [weak self] in
            await self?.runStartSyncFlow()
        }
    }

    func resetAllStatus() async throws {
        NSLog("[SyncEngine] resetAllStatus requested")
        syncDiagnosticsLog("SyncEngine", "resetAllStatus requested")

        // 1. Clear database status
        try uploadStore?.resetAllStatusData()

        // 2. Reset runtime variables
        runtimeQueueTotalCount = 0
        runtimeQueueCompletedCount = 0
        runtimeQueueTotalBytes = 0
        runtimeQueueCompletedBytes = 0
        runtimeCurrentFileKey = nil
        runtimeCurrentFilename = nil
        runtimeCurrentFileConfirmedBytes = 0
        runtimeCurrentFileTotalBytes = 0
        runtimeCurrentSpeedMbps = 0
        runtimeUploadState = "idle"

        // 3. Emit fresh states to JS
        emitQueueToJS()
        NativeSyncEngineModule.shared?.emitHistoryUpdated()
        NativeSyncEngineModule.shared?.emitSyncStateChanged(runtimeSyncOverviewPayload(uploadState: "idle"))

        NSLog("[SyncEngine] resetAllStatus completed")
        syncDiagnosticsLog("SyncEngine", "resetAllStatus completed")
    }

    private func runStartSyncFlow() async {
        let shouldBeginBackgroundTransition = await MainActor.run {
            UIApplication.shared.applicationState == .background
        }

        if shouldBeginBackgroundTransition {
            await MainActor.run {
                beginBackgroundTransitionIfNeeded(reason: "startSyncWhileBackgrounded")
            }
        }

        do {
            try await runSyncPipeline()
        } catch is CancellationError {
            protocolSession?.disconnect()
            protocolSession = nil
            clearResolvedSidecarHost()
            if uploadStore?.getBinding() != nil {
                updateBindingConnectionState(.offline, reason: "pipeline_cancelled")
            }
            stopSyncLifecycle(finalState: .idle)
        } catch let error as SyncEngineError {
            switch error {
            case .autoUploadInterrupted:
                NSLog("[SyncEngine] sync pipeline interrupted by user")
                syncDiagnosticsLog("SyncEngine", "sync pipeline interrupted by user")
                maintainConnectedBindingState(reason: "auto_upload_interrupted")
                let clientId = bindingService.getOrCreateClientId()
                sendPresenceHeartbeat(
                    clientId: clientId,
                    successReason: "auto_upload_interrupted_presence_restored",
                    failureReason: "auto_upload_interrupted_presence_failed",
                    updateStateOnFailure: false
                )
                clearRuntimeSyncRoundProgress(uploadState: "paused_auto_upload")
                let payload = runtimeSyncOverviewPayload(uploadState: "paused_auto_upload")
                logSyncOverviewEmission("pipeline_auto_interrupted", payload: payload)
                NativeSyncEngineModule.shared?.emitSyncStateChanged(
                    payload
                )
                stopSyncLifecycle(finalState: .interruptedAutoUpload)
            case .lowDiskPaused(let message):
                NSLog("[SyncEngine] sync pipeline paused due to low disk: %@", message)
                syncDiagnosticsLog("SyncEngine", "sync pipeline paused due to low disk: \(message)")
                protocolSession?.disconnect()
                protocolSession = nil
                stopSyncLifecycle(finalState: .idle)
                recordRecentError(code: "LOW_DISK_PAUSED", message: message)
                NativeSyncEngineModule.shared?.emitError([
                    "code": "LOW_DISK_PAUSED",
                    "message": message,
                ])
            default:
                NSLog("[SyncEngine] sync pipeline failed: \(error)")
                syncDiagnosticsLog("SyncEngine", "sync pipeline failed: \(error)")
                protocolSession?.disconnect()
                protocolSession = nil
                clearResolvedSidecarHost()
                if uploadStore?.getBinding() != nil {
                    updateBindingConnectionState(.offline, reason: "pipeline_failed")
                }
                stopSyncLifecycle(finalState: .idle)
                recordRecentError(code: "SYNC_PIPELINE_ERROR", message: "\(error)")
                NativeSyncEngineModule.shared?.emitError([
                    "code": "SYNC_PIPELINE_ERROR",
                    "message": "\(error)",
                ])
            }
        } catch {
            NSLog("[SyncEngine] sync pipeline failed: \(error)")
            syncDiagnosticsLog("SyncEngine", "sync pipeline failed: \(error)")
            protocolSession?.disconnect()
            protocolSession = nil
            clearResolvedSidecarHost()
            if uploadStore?.getBinding() != nil {
                updateBindingConnectionState(.offline, reason: "pipeline_failed")
            }
            stopSyncLifecycle(finalState: .idle)
            recordRecentError(code: "SYNC_PIPELINE_ERROR", message: "\(error)")
            NativeSyncEngineModule.shared?.emitError([
                "code": "SYNC_PIPELINE_ERROR",
                "message": "\(error)",
            ])
        }
    }

    private func runSyncPipeline() async throws {
        NSLog("[SyncPipeline] START")
        syncDiagnosticsLog("SyncPipeline", "START")

        // 0. Check prerequisites
        guard let binding = uploadStore?.getBinding() else {
            throw SyncEngineError.pairingError("No binding found — pair first")
        }
        guard let token = resolvedPairingToken(for: binding) else {
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
                // Probe succeeded — Mac is reachable and authenticated. Signal connected
                // so the UI stops showing the 'Connecting to xxx' banner while scanning.
                updateBindingConnectionState(.connected, reason: "sidecar_probe_success")
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
            clearRuntimeCurrentFile()
            runtimeCurrentSpeedMbps = 0
            NativeSyncEngineModule.shared?.emitSyncStateChanged(
                runtimeSyncOverviewPayload(uploadState: "scanning", progressPercent: 0)
            )
            // If sidecar was already resolved (previous round connected successfully),
            // restore .connected so the UI doesn't flash 'Connecting to...' during scan.
            if sidecarHost != nil {
                updateBindingConnectionState(.connected, reason: "scan_round_sidecar_known")
            }

            var pendingAssets = buildPendingUploadAssets(clientId: clientId, limit: 200)
            var newAssets: [ScannedAsset] = []
            var trackedAssetCount = uploadStore?.getAutoDiscoveryTrackedFileKeys().count ?? 0

            if pendingAssets.isEmpty {
                // Scan only when the persisted pending queue is empty. Large historical queues
                // are already stored in upload_items, so rescanning the full library every
                // 200-file batch just burns CPU/PhotoKit and makes the device hotter.
                var trackedKeys = Set(uploadStore?.getAutoDiscoveryTrackedFileKeys() ?? [])
                trackedAssetCount = trackedKeys.count
                if trackedKeys.isEmpty {
                    let restoredCount = await restoreCompletedUploadHistoryIfNeeded(
                        clientId: clientId,
                        fallbackHost: binding.host
                    )
                    if restoredCount > 0 {
                        trackedKeys = Set(uploadStore?.getAutoDiscoveryTrackedFileKeys() ?? [])
                        trackedAssetCount = trackedKeys.count
                        NSLog(
                            "[SyncPipeline] restored %d historical completed uploads before scan",
                            restoredCount
                        )
                        syncDiagnosticsLog("SyncPipeline", "restored \(restoredCount) historical completed uploads before scan")
                    }
                }
                // Only auto-scan when auto upload is active (PRD: disabled/interrupted = no auto discovery)
                let autoUploadActive = isAutoUploadActiveForDiscovery()
                if autoUploadActive {
                    newAssets = photoScanner.scanForUntrackedAssets(
                        clientId: clientId,
                        trackedFileKeys: trackedKeys
                    ) { [weak self] scanned, total in
                        self?.emitScanningProgress(scanned: scanned, total: total)
                    }
                }

                if !newAssets.isEmpty {
                    if isAutoUploadActiveForDiscovery() {
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
                                updatedAt: ISO8601DateFormatter().string(from: Date()),
                                source: "auto",
                                batchId: nil,
                                priority: 0
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
                    } else {
                        NSLog("[SyncPipeline] discarded %d scanned auto assets because auto upload was interrupted", newAssets.count)
                        syncDiagnosticsLog("SyncPipeline", "discarded \(newAssets.count) scanned auto assets after auto upload interruption")
                        newAssets = []
                    }
                }

                pendingAssets = buildPendingUploadAssets(clientId: clientId, limit: 200)
            } else {
                NSLog(
                    "[SyncPipeline] round %d reusing persisted pending queue (%d assets in batch), skipping full library scan",
                    roundNumber,
                    pendingAssets.count
                )
                syncDiagnosticsLog(
                    "SyncPipeline",
                    "round \(roundNumber): reusing persisted pending queue (\(pendingAssets.count) assets in batch), skipping full library scan"
                )
            }

            let stats = uploadStore?.getQueueStats() ?? (totalCount: 0, totalBytes: 0, completedCount: 0, completedBytes: 0)
            NSLog(
                "[SyncPipeline] round %d: %d pending assets (batch), global: %d/%d items, %lld/%lld bytes",
                roundNumber,
                pendingAssets.count,
                stats.completedCount,
                stats.totalCount,
                stats.completedBytes,
                stats.totalBytes
            )
            syncDiagnosticsLog("SyncPipeline", "round \(roundNumber): \(pendingAssets.count) pending assets (\(newAssets.count) new, tracked: \(trackedAssetCount))")

            if pendingAssets.isEmpty {
                // Determine idle reason based on auto upload state
                let configState = autoUploadConfigStore?.getConfig().state ?? "disabled"

                if configState == "interrupted" || isAutoUploadInterrupted {
                    // Interrupted: report interrupted state regardless of pending count
                    let autoPendingCount = uploadStore?.getPendingCountsBySource().auto ?? 0
                    let payload = runtimeSyncOverviewPayload(uploadState: "paused_auto_upload")
                    logSyncOverviewEmission("empty_queue_interrupted", payload: payload)
                    NativeSyncEngineModule.shared?.emitSyncStateChanged(
                        payload
                    )
                    NSLog("[SyncPipeline] idle — auto upload interrupted (auto pending: %d)", autoPendingCount)
                    syncDiagnosticsLog("SyncPipeline", "idle — auto interrupted (auto pending: \(autoPendingCount))")
                    sessionService.transitionTo(.interruptedAutoUpload)
                } else if configState == "disabled" {
                    // Disabled: emit idle, NOT completed — page should show "自动上传未开启"
                    let payload = runtimeSyncOverviewPayload(uploadState: "idle")
                    logSyncOverviewEmission("empty_queue_disabled", payload: payload)
                    NativeSyncEngineModule.shared?.emitSyncStateChanged(
                        payload
                    )
                    NSLog("[SyncPipeline] idle — auto upload disabled")
                    syncDiagnosticsLog("SyncPipeline", "idle — auto upload disabled")
                    sessionService.transitionTo(.idle)
                } else {
                    // Active + empty queue: truly completed
                    clearRuntimeCurrentFile()
                    runtimeCurrentSpeedMbps = 0
                    let payload = ([
                        "uploadState": "completed",
                        "progressPercent": 100,
                    ] as [String: Any]).merging(
                        runtimeSyncOverviewPayload(uploadState: "completed", progressPercent: 100)
                    ) { _, new in new }
                    logSyncOverviewEmission("empty_queue_completed", payload: payload)
                    NativeSyncEngineModule.shared?.emitSyncStateChanged(payload)

                    NSLog("[SyncPipeline] idle — all items completed, waiting for new photos...")
                    syncDiagnosticsLog("SyncPipeline", "idle — all completed, waiting for new photos")
                    sessionService.transitionTo(.idle)
                }
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
                        let heartbeatInterval: TimeInterval = ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue ? 120 : 30
                        DispatchQueue.global().asyncAfter(deadline: .now() + heartbeatInterval) { [token] in
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
                        totalCount: stats.totalCount,
                        totalBytes: stats.totalBytes,
                        completedCount: stats.completedCount,
                        completedBytes: stats.completedBytes,
                        recoveryMode: retryAttempt > 0
                    )
                    uploaded = true
                    photoLibraryChanged = false // reset after round
                } catch {
                    if Task.isCancelled {
                        throw CancellationError()
                    }
                    if !isRetryableSyncError(error) {
                        NSLog("[SyncPipeline] upload failed with non-retryable error: %@", "\(error)")
                        syncDiagnosticsLog("SyncPipeline", "upload failed with non-retryable error: \(error)")
                        throw error
                    }

                    retryAttempt += 1
                    let delay = min(retryDelayNs(forAttempt: retryAttempt), maxRetryDelay)
                    let delaySeconds = Double(delay) / 1_000_000_000
                    let retryableError = classifyRetryableSyncError(
                        error,
                        targetDeviceType: currentUploadTargetDeviceType()
                    )

                    clearResolvedSidecarHost()
                    updateBindingConnectionState(.offline, reason: "retryable_upload_failure")
                    sessionService.transitionTo(.backoffWaiting)
                    setRuntimeReconnectError(
                        code: retryableError.code,
                        message: retryableError.message
                    )
                    NSLog("[SyncPipeline] upload failed with retryable error: %@ — reconnecting in %.1fs (attempt %d)",
                          "\(error)", delaySeconds, retryAttempt)
                    syncDiagnosticsLog("SyncPipeline", "upload failed with retryable error: \(error) — reconnecting in \(String(format: "%.1f", delaySeconds))s (attempt \(retryAttempt))")
                    recordRecentRetry(error: error, attempt: retryAttempt, delaySeconds: delaySeconds)
                    recordRecentError(code: retryableError.code, message: retryableError.message)
                    NativeSyncEngineModule.shared?.emitSyncStateChanged(([
                        "lastErrorCode": retryableError.code,
                        "lastErrorMessage": retryableError.message,
                        "retryAttempt": retryAttempt,
                        "retryDelaySec": round(delaySeconds * 10) / 10,
                    ] as [String: Any]).merging(
                        runtimeSyncOverviewPayload(uploadState: "reconnecting")
                    ) { _, new in new })
                    let sleepDelay: UInt64 = delay
                    try await Task.sleep(nanoseconds: sleepDelay)
                    discoveryService.startBrowsing()
                }
            }

            // Post-round grace: poll briefly for newly queued pending items
            // before letting the outer loop transition to idle/completed.
            // If a new batch arrives within the window, the next iteration's
            // scan picks it up while `completedCount < totalCount` still
            // holds (totalCount bumps up when new items are queued), which
            // lets the RN-side `isBetweenItems` mask hide the preparation
            // UI during the inter-batch handoff. TCP still reconnects —
            // this only smooths the state transition, it does not change
            // session lifecycle.
            let postRoundGraceMs: UInt64 = 3_000
            let pollIntervalMs: UInt64 = 200
            var gracedMs: UInt64 = 0
            while gracedMs < postRoundGraceMs {
                if Task.isCancelled { break }
                let nextPending = buildPendingUploadAssets(clientId: clientId, limit: 1)
                if !nextPending.isEmpty {
                    NSLog("[SyncPipeline] post-round grace: new pending found after %llu ms", gracedMs)
                    syncDiagnosticsLog("SyncPipeline", "post-round grace: new pending found after \(gracedMs) ms")
                    break
                }
                try? await Task.sleep(nanoseconds: pollIntervalMs * 1_000_000)
                gracedMs += pollIntervalMs
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
        totalCount: Int,
        totalBytes: Int64,
        completedCount: Int,
        completedBytes: Int64,
        recoveryMode: Bool
    ) async throws {
        // Connect TCP + auth
        let newTransport = TcpTransport()
        let session = ProtocolSession(transport: newTransport)
        protocolSession = session
        if !recoveryMode {
            updateBindingConnectionState(.connecting, reason: "connect_and_upload_started")
        }
        sessionService.transitionTo(.preparing)
        beginRuntimeSyncOverview(
            totalCount: totalCount,
            totalBytes: totalBytes,
            completedCount: completedCount,
            completedBytes: completedBytes
        )
        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            runtimeSyncOverviewPayload(uploadState: "preparing", progressPercent: 0)
        )
        var activeSessionId: String?
        var uploadRoundCompleted = false
        var uploadRoundPausedForLowDisk = false
        var uploadRoundInterruptedByUser = false

        defer {
            if let activeSessionId, sessionService.currentSessionId == activeSessionId {
                sessionService.endSession()
            }
            if protocolSession === session {
                protocolSession = nil
            }
            session.disconnect()
            if uploadRoundInterruptedByUser {
                // User interrupted auto upload — close the TCP session so the
                // sidecar clears its live "syncing" state, but keep the mobile
                // binding state connected. The caller restores desktop presence
                // immediately via a heartbeat.
                maintainConnectedBindingState(reason: "upload_round_interrupted")
            } else {
                if !uploadRoundCompleted {
                    if uploadRoundPausedForLowDisk {
                        if uploadStore?.getBinding() != nil {
                            updateBindingConnectionState(.connected, reason: "upload_round_paused_low_disk")
                        }
                    } else {
                        clearResolvedSidecarHost()
                        if uploadStore?.getBinding() != nil {
                            updateBindingConnectionState(.offline, reason: "upload_round_incomplete")
                        }
                    }
                }
            }
        }

        // Find target device — only match by the binding's deviceId; do NOT fall back to
        // an arbitrary mDNS device so we never upload to the wrong machine.
        func findDevice() -> DiscoveredDevice? {
            return discoveredDevices[binding.deviceId]
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
            payload: await buildClientHelloPayload(clientId: clientId, pairingToken: token)
        )
        guard helloType == .helloRes else {
            throw SyncEngineError.networkError("Expected HELLO_RES")
        }
        refreshBoundServerMetadata(
            serverName: helloRes["serverName"] as? String,
            shareName: helloRes["serverCapabilities"]
                .flatMap { ($0 as? [String: Any])?["shareName"] as? String },
            host: sidecarHost
        )
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

        var tuning = resolvedUploadTuning()
        NSLog(
            "[SyncPipeline] upload tuning profile=%@ target=%@ chunkMiB=%.1f windowMiB=%.1f pipeline=%d prefetch=%@ throttleMiBps=%.1f",
            tuning.profileLabel,
            currentUploadTargetDeviceType() ?? "unknown",
            Double(tuning.chunkSizeBytes) / (1024 * 1024),
            Double(tuning.targetInFlightBytes) / (1024 * 1024),
            tuning.maxPipelineChunks,
            tuning.prefetchNextFile ? "on" : "off",
            Double(tuning.throttleBytesPerSec) / (1024 * 1024)
        )
        syncDiagnosticsLog(
            "SyncPipeline",
            "upload tuning profile=\(tuning.profileLabel) target=\(currentUploadTargetDeviceType() ?? "unknown") chunkMiB=\(String(format: "%.1f", Double(tuning.chunkSizeBytes) / (1024 * 1024))) windowMiB=\(String(format: "%.1f", Double(tuning.targetInFlightBytes) / (1024 * 1024))) pipeline=\(tuning.maxPipelineChunks) prefetch=\(tuning.prefetchNextFile ? "on" : "off") throttleMiBps=\(String(format: "%.1f", Double(tuning.throttleBytesPerSec) / (1024 * 1024)))"
        )

        // Exporting the next asset while the current one is uploading improves peak
        // throughput, but it also doubles sustained PhotoKit/disk/network pressure for
        // large videos. Disable prefetch when the device is already backgrounded,
        // constrained by Low Power Mode, or thermally limited.
        var nextExport: ExportedFile? = nil
        var prefetchTask: Task<Void, Never>? = nil
        /// When true, a cancelled prefetch is still running in the background.
        /// We must not consume `nextExport` and should clean it up when the task
        /// eventually finishes (handled by the task body itself).
        var prefetchInvalidated = false

        if tuning.prefetchNextFile, !assets.isEmpty {
            nextExport = try? await exportAssetForUpload(assets[0])
        }

        for (index, asset) in assets.enumerated() {
            // Between files: skip auto items when interrupted, skip cancelled batch items
            if index > 0 {
                if isAutoUploadInterrupted && asset.source == "auto" {
                    NSLog("[SyncPipeline] skipping auto item %@ — auto upload interrupted", asset.fileKey)
                    continue
                }
                // Check if this item was cancelled in DB (e.g. manual batch cancel)
                if let item = uploadStore?.getUploadItemByFileKey(asset.fileKey),
                   item.status == "cancelled" {
                    NSLog("[SyncPipeline] skipping cancelled item %@", asset.fileKey)
                    continue
                }
                emitPreparingStateForNextFile(nextAsset: asset)
            }

            // Re-evaluate tuning before each file — thermal state may have changed
            // since the batch started. If prefetch was on but now should be off,
            // mark it invalidated so we don't block waiting for a potentially
            // multi-GB export to finish. The background task will clean up its own
            // temp file when it completes.
            let previousProfile = tuning.profileLabel
            tuning = resolvedUploadTuning()
            if previousProfile != tuning.profileLabel {
                NSLog("[SyncPipeline] tuning changed mid-batch: %@ -> %@", previousProfile, tuning.profileLabel)
            }

            if !tuning.prefetchNextFile, prefetchTask != nil {
                NSLog("[SyncPipeline] invalidating prefetch — tuning now %@", tuning.profileLabel)
                prefetchTask?.cancel()
                // Do NOT await — PHAssetResourceManager.writeData is not cancellable
                // and blocking here defeats the purpose of thermal-aware cancellation.
                prefetchTask = nil
                prefetchInvalidated = true
                nextExport = nil  // will be cleaned by the task body on completion
            }

            // Wait for any in-flight prefetch before consuming its result.
            if !prefetchInvalidated {
                await prefetchTask?.value
            }
            prefetchTask = nil

            let exported: ExportedFile
            if !prefetchInvalidated, let prefetched = nextExport {
                exported = prefetched
                nextExport = nil
            } else {
                prefetchInvalidated = false
                exported = try await exportAssetForUpload(asset)
            }

            let nextIndex = index + 1
            if tuning.prefetchNextFile, nextIndex < assets.count {
                let nextAsset = assets[nextIndex]
                let exportSvc = self.exportService
                prefetchTask = Task {
                    let result = try? await self.exportAssetForUpload(nextAsset)
                    // If this task was cancelled (thermal escalation), clean up
                    // the temp file ourselves since nobody else will consume it.
                    if Task.isCancelled, let orphan = result {
                        exportSvc.cleanup(tempURL: orphan.tempURL)
                        return
                    }
                    nextExport = result
                }
            }

            // Pre-upload cancel check: if this item was cancelled after export
            // but before TCP upload begins, skip it and clean up the temp file.
            if let item = uploadStore?.getUploadItemByFileKey(asset.fileKey),
               item.status == "cancelled" {
                NSLog("[SyncPipeline] skipping cancelled item %@ before TCP upload", asset.fileKey)
                exportService.cleanup(tempURL: exported.tempURL)
                continue
            }

            do {
                defer {
                    exportService.cleanup(tempURL: exported.tempURL)
                }
                try await uploadSingleFileWithExport(
                    asset: asset,
                    exported: exported,
                    sessionId: sessionId,
                    index: completedCount + index,
                    total: totalCount,
                    session: session,
                    recoveryMode: recoveryMode
                )

                // After each file: check if a higher-priority item was inserted
                // (e.g. manual item while auto batch is running). If DB queue head
                // differs from our next batch item, break so outer loop re-fetches.
                let nextIndex = index + 1
                if nextIndex < assets.count {
                    if let queueHead = uploadStore?.getPendingUploadItemsSorted(
                        limit: 1,
                        excludeSource: isAutoUploadInterrupted ? "auto" : nil
                    ).first {
                        let nextBatchFileKey = assets[nextIndex].fileKey
                        if queueHead.fileKey != nil && queueHead.fileKey != nextBatchFileKey {
                            NSLog("[SyncPipeline] queue head changed (priority preemption) — breaking batch")
                            // Cancel prefetch for the now-stale next item
                            prefetchTask?.cancel()
                            await prefetchTask?.value
                            if let staleExport = nextExport {
                                exportService.cleanup(tempURL: staleExport.tempURL)
                                nextExport = nil
                            }
                            break
                        }
                    }
                }
            } catch {
                if let syncError = error as? SyncEngineError,
                   case .autoUploadInterrupted = syncError
                {
                    uploadRoundInterruptedByUser = true
                    NSLog("[SyncEngine] auto upload interrupted during file %@", asset.fileKey)
                    syncDiagnosticsLog("SyncEngine", "auto upload interrupted during file \(asset.fileKey)")
                    prefetchTask?.cancel()
                    await prefetchTask?.value
                    if let leakedExport = nextExport {
                        exportService.cleanup(tempURL: leakedExport.tempURL)
                        nextExport = nil
                    }
                    throw syncError
                }
                if let syncError = error as? SyncEngineError,
                   case .lowDiskPaused(let message) = syncError
                {
                    uploadRoundPausedForLowDisk = true
                    NSLog("[SyncEngine] low disk paused upload for %@: %@", asset.fileKey, message)
                    syncDiagnosticsLog("SyncEngine", "low disk paused upload for \(asset.fileKey): \(message)")
                    recordRecentError(code: "LOW_DISK_PAUSED", message: message)
                    try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                    emitQueueToJS()
                    prefetchTask?.cancel()
                    await prefetchTask?.value
                    if let leakedExport = nextExport {
                        exportService.cleanup(tempURL: leakedExport.tempURL)
                        nextExport = nil
                    }
                    throw syncError
                }
                if isRetryableSyncError(error) {
                    NSLog("[SyncEngine] retryable upload failure for %@: %@", asset.fileKey, "\(error)")
                    syncDiagnosticsLog("SyncEngine", "retryable upload failure for \(asset.fileKey): \(error)")
                    try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                    emitQueueToJS()
                    // Cancel prefetch and clean up any already-exported temp file to prevent leak.
                    prefetchTask?.cancel()
                    await prefetchTask?.value
                    if let leakedExport = nextExport {
                        exportService.cleanup(tempURL: leakedExport.tempURL)
                        nextExport = nil
                    }
                    throw error
                }

                NSLog("[SyncEngine] non-retryable upload failure for %@: %@", asset.fileKey, "\(error)")
                syncDiagnosticsLog("SyncEngine", "non-retryable upload failure for \(asset.fileKey): \(error)")
                recordRecentError(code: "UPLOAD_FILE_FAILED", message: "\(asset.fileKey): \(error)")
                try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "failed")
                emitQueueToJS()
            }
        }

        // Clean up any remaining prefetch on normal loop exit.
        await prefetchTask?.value
        if let remaining = nextExport {
            exportService.cleanup(tempURL: remaining.tempURL)
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
        runtimeCurrentFileKey = asset.fileKey
        runtimeCurrentFilename = exported.originalFilename
        runtimeCurrentFileConfirmedBytes = 0
        runtimeCurrentFileTotalBytes = exported.fileSize
        runtimeCurrentSpeedMbps = 0
        clearRuntimeReconnectError()
        emitQueueToJS()
        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            runtimeSyncOverviewPayload(uploadState: "uploading", progressPercent: 0)
        )

        do {
            if asset.source == "auto" && shouldAbortActiveAutoUpload {
                shouldAbortActiveAutoUpload = false
                try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "cancelled")
                clearRuntimeCurrentFile()
                runtimeCurrentSpeedMbps = 0
                emitQueueToJS()
                throw SyncEngineError.autoUploadInterrupted
            }

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
                runtimeQueueCompletedCount = max(runtimeQueueCompletedCount, index + 1)
                runtimeQueueCompletedBytes += exported.fileSize
                runtimeCurrentFileConfirmedBytes = exported.fileSize
                runtimeCurrentFileTotalBytes = exported.fileSize
                runtimeCurrentSpeedMbps = 0
                emitQueueToJS()
                let payload = runtimeSyncOverviewPayload(uploadState: "uploading", progressPercent: 100)
                if asset.source == "manual" || index + 1 >= total {
                    logSyncOverviewEmission(
                        "file_skipped_completed source=\(asset.source) index=\(index + 1)/\(total)",
                        payload: payload
                    )
                }
                NativeSyncEngineModule.shared?.emitSyncStateChanged(
                    payload
                )
                return
            case "REJECT":
                let reason = initRes["reason"] as? String ?? "unknown"
                if tuning.perfLoggingEnabled {
                    perfLog("file=\(asset.fileKey) action=REJECT reason=\(reason) size=\(exported.fileSize)")
                }
                NSLog("[SyncEngine] REJECT \(exported.originalFilename): \(reason)")
                if reason == "LOW_DISK_PAUSED" {
                    try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                    clearRuntimeCurrentFile()
                    emitQueueToJS()
                    throw SyncEngineError.lowDiskPaused(reason)
                }
                try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "skipped")
                clearRuntimeCurrentFile()
                emitQueueToJS()
                return
            case "RESUME":
                let offset = initRes["resumeOffset"] as? Int64 ?? 0
                if tuning.perfLoggingEnabled {
                    perfLog("file=\(asset.fileKey) action=RESUME resumeOffset=\(offset) size=\(exported.fileSize)")
                }
                NSLog("[SyncEngine] RESUME \(exported.originalFilename) from offset \(offset)")
                try await streamFileData(
                    fileURL: exported.tempURL,
                    fileKey: asset.fileKey,
                    source: asset.source,
                    startOffset: offset,
                    fileSize: exported.fileSize,
                    recoveryMode: true
                )
            case "UPLOAD":
                if tuning.perfLoggingEnabled {
                    perfLog("file=\(asset.fileKey) action=UPLOAD size=\(exported.fileSize)")
                }
                NSLog("[SyncEngine] UPLOAD \(exported.originalFilename) (\(exported.fileSize) bytes)")
                try await streamFileData(
                    fileURL: exported.tempURL,
                    fileKey: asset.fileKey,
                    source: asset.source,
                    startOffset: 0,
                    fileSize: exported.fileSize,
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
                runtimeQueueCompletedCount = max(runtimeQueueCompletedCount, index + 1)
                runtimeQueueCompletedBytes += exported.fileSize
                runtimeCurrentFileConfirmedBytes = exported.fileSize
                runtimeCurrentFileTotalBytes = exported.fileSize
                updateRuntimeSpeed()
                emitQueueToJS()
                let payload = runtimeSyncOverviewPayload(uploadState: "uploading", progressPercent: 100)
                if asset.source == "manual" || index + 1 >= total {
                    logSyncOverviewEmission(
                        "file_completed source=\(asset.source) index=\(index + 1)/\(total)",
                        payload: payload
                    )
                }
                NativeSyncEngineModule.shared?.emitSyncStateChanged(
                    payload
                )

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
                runtimeCurrentSpeedMbps = 0
                if tuning.perfLoggingEnabled {
                    let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - fileTransferStart) * 1000)
                    perfLog("file=\(asset.fileKey) action=FAILED size=\(exported.fileSize) endToEndMs=\(elapsedMs)")
                }
                NSLog("[SyncUpload] [%d/%d] FILE_END not ok for %@", index + 1, total, exported.originalFilename)
                clearRuntimeCurrentFile()
            }
        } catch {
            if asset.source == "auto" && shouldAbortActiveAutoUpload {
                shouldAbortActiveAutoUpload = false
                try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "cancelled")
                clearRuntimeCurrentFile()
                runtimeCurrentSpeedMbps = 0
                emitQueueToJS()
                throw SyncEngineError.autoUploadInterrupted
            }
            throw error
        }
    }

    // MARK: - Stream FILE_DATA Chunks (spec Section 7.4, 7.7: 8 MiB chunks)

    private func streamFileData(
        fileURL: URL,
        fileKey: String,
        source: String,
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
        var uploadThrottleBytesPerSec = tuning.throttleBytesPerSec
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
                    let tNs: UInt64 = timeoutNs
                    try await Task.sleep(nanoseconds: tNs)
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
            ? Int(min(Int64(1024 * 1024), uploadThrottleBytesPerSec))  // 1 MiB chunks when throttled (halves protocol overhead vs 512 KiB)
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
        let speedLastTime: CFTimeInterval = CFAbsoluteTimeGetCurrent()
        var lastProgressEmitTime: CFTimeInterval = speedLastTime
        var progressPersistOffset: Int64 = startOffset
        var progressPersistTime: CFTimeInterval = speedLastTime
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
            let currentTimestamp: CFTimeInterval = CFAbsoluteTimeGetCurrent()

            var logLine =
                "file=\(fileKey) action=\(streamOutcome) ackedMiB=\(String(format: "%.1f", Double(ackedBytes) / (1024 * 1024))) elapsedMs=\(Int(elapsed * 1000)) throughputMBps=\(String(format: "%.1f", throughputMBps)) readMs=\(Int(totalReadTime * 1000)) sendEnqueueMs=\(Int(totalSendEnqueueTime * 1000)) avgSendEnqueueMs=\(String(format: "%.1f", avgSendEnqueueMs)) maxSendEnqueueMs=\(Int(maxSendEnqueueTime * 1000)) windowFillMs=\(Int(totalWindowFillTime * 1000)) avgWindowFillMs=\(String(format: "%.1f", avgWindowFillMs)) maxWindowFillMs=\(Int(maxWindowFillTime * 1000)) windowFillCount=\(windowFillCount) ackWaitMs=\(Int(totalAckWaitTime * 1000)) avgAckWaitMs=\(String(format: "%.1f", avgAckWaitMs)) maxAckWaitMs=\(Int(maxAckWaitTime * 1000)) ackCount=\(ackCount) avgAckRttMs=\(String(format: "%.1f", avgAckRoundTripMs)) maxAckRttMs=\(Int(maxAckRoundTripTime * 1000)) bufferedMessages=\(bufferedMessages) nextOffsetMiB=\(String(format: "%.1f", Double(nextOffset) / (1024 * 1024))) inFlightMiB=\(String(format: "%.1f", Double(inFlightBytes) / (1024 * 1024))) oldestInFlightMs=\(oldestInFlightAgeMs(now: currentTimestamp)) peakInFlightMiB=\(String(format: "%.1f", Double(peakInFlightBytes) / (1024 * 1024))) readMiB=\(String(format: "%.1f", Double(totalReadBytes) / (1024 * 1024)))"

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
            runtimeCurrentFileKey = fileKey
            runtimeCurrentFileConfirmedBytes = acknowledgedOffset
            runtimeCurrentFileTotalBytes = fileSize
            updateRuntimeSpeed()
            NativeSyncEngineModule.shared?.emitSyncStateChanged(
                ([
                    "confirmedBytes": acknowledgedOffset,
                    "pendingConfirmBytes": max(nextOffset - acknowledgedOffset, 0),
                    "sentBytes": nextOffset,
                    "sentProgressPercent": sentProgressPercent,
                ] as [String: Any]).merging(
                    runtimeSyncOverviewPayload(
                        uploadState: "uploading",
                        progressPercent: confirmedProgressPercent
                    )
                ) { _, new in new }
            )
            lastProgressEmitTime = now
        }

        defer {
            emitStreamSummary()
        }

        func throwIfActiveAutoUploadWasInterrupted() throws {
            if source == "auto" && shouldAbortActiveAutoUpload {
                streamOutcome = "STREAM_INTERRUPTED"
                streamFailure = "auto upload interrupted by user"
                throw SyncEngineError.autoUploadInterrupted
            }
        }

        if tuning.perfLoggingEnabled {
            perfLog(
                "file=\(fileKey) action=STREAM_START chunkMiB=\(String(format: "%.1f", Double(chunkSize) / (1024 * 1024))) windowMiB=\(String(format: "%.1f", Double(steadyStateMaxInFlightBytes) / (1024 * 1024))) pipelineChunks=\(steadyStatePipelineWindowChunks) ackTimeoutNs=\(ackTimeoutNs) recoveryMode=\(conservativeStart) recoveryWindowMiB=\(String(format: "%.1f", Double(recoveryMaxInFlightBytes) / (1024 * 1024))) recoveryAckTimeoutNs=\(recoveryAckTimeoutNs)"
            )
        }

        while acknowledgedOffset < fileSize {
            try throwIfActiveAutoUploadWasInterrupted()
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
                try throwIfActiveAutoUploadWasInterrupted()
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
                    let sNs: UInt64 = sleepNs
                    try await Task.sleep(nanoseconds: sNs)
                }

                // Re-check thermal state every 16 chunks to react mid-transfer
                if windowFillChunks % 4 == 0 {
                    let currentThermal = ProcessInfo.processInfo.thermalState
                    if currentThermal == .critical {
                        // Apply thermal ceiling: use the stricter of the existing
                        // throttle and the thermal limit. When unthrottled (0), adopt
                        // the thermal limit directly.
                        let thermalCap: Int64 = 4 * 1024 * 1024
                        uploadThrottleBytesPerSec = uploadThrottleBytesPerSec > 0
                            ? min(uploadThrottleBytesPerSec, thermalCap)
                            : thermalCap
                        applyRuntimeThermalState(
                            profileLabel: tuning.profileLabel,
                            thermalState: currentThermal,
                            overrideReason: .thermalStreamPause
                        )
                        perfLog("file=\(fileKey) action=THERMAL_PAUSE thermal=critical — pausing stream")
                        var pauseElapsed: CFTimeInterval = 0
                        while ProcessInfo.processInfo.thermalState == .critical && pauseElapsed < 60 {
                            try await Task.sleep(nanoseconds: 5_000_000_000)
                            if Task.isCancelled { throw CancellationError() }
                            pauseElapsed += 5
                        }
                        let resumedThermalState = ProcessInfo.processInfo.thermalState
                        let resumedProfile = resolvedUploadTuning().profileLabel
                        applyRuntimeThermalState(
                            profileLabel: resumedProfile,
                            thermalState: resumedThermalState
                        )
                        perfLog("file=\(fileKey) action=THERMAL_RESUME pausedSec=\(Int(pauseElapsed))")
                    } else if currentThermal == .serious {
                        let thermalCap: Int64 = 6 * 1024 * 1024
                        uploadThrottleBytesPerSec = uploadThrottleBytesPerSec > 0
                            ? min(uploadThrottleBytesPerSec, thermalCap)
                            : thermalCap
                        applyRuntimeThermalState(
                            profileLabel: tuning.profileLabel,
                            thermalState: currentThermal,
                            overrideReason: .thermalSerious
                        )
                        if tuning.perfLoggingEnabled {
                            perfLog("file=\(fileKey) action=THERMAL_THROTTLE thermal=serious throttleMBps=6")
                        }
                    } else if runtimeIsThermalLimited {
                        applyRuntimeThermalState(
                            profileLabel: resolvedUploadTuning().profileLabel,
                            thermalState: currentThermal
                        )
                    }
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

            try throwIfActiveAutoUploadWasInterrupted()
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
                let errCode = ackRes["code"] as? String ?? ""
                let errMsg = ackRes["message"] as? String ?? "server error"
                if errCode == "LOW_DISK_PAUSED" {
                    throw SyncEngineError.lowDiskPaused(errMsg)
                }
                throw SyncEngineError.networkError("FILE_DATA error: \(errMsg)")
            }
            // For other unexpected types, just continue

            // Emit progress to RN
            let finalNow: CFTimeInterval = CFAbsoluteTimeGetCurrent()
            if finalNow - lastProgressEmitTime >= progressEmitInterval || acknowledgedOffset == fileSize {
                emitUploadProgress(now: finalNow)
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
        let pending = store.getPendingUploadItemsSorted(limit: 100)
        NativeSyncEngineModule.shared?.emitQueueUpdated(bridgeQueueItems(pending))
    }

    // MARK: - PhotoScannerDelegate

    func photoLibraryDidChange() {
        NSLog("[SyncEngine] photo library changed — flagging rescan")
        photoLibraryChanged = true
        if isAppBackgrounded() {
            lastBackgroundPhotoLibraryChangeAt = CFAbsoluteTimeGetCurrent()
            syncDiagnosticsLog(
                "SyncEngine",
                "photo library changed while backgrounded — switching upload tuning to active capture mode"
            )
        }
        scheduleIncrementalQueueRescan(reason: "photo_library_changed")
        // Wake up the watch loop if it's sleeping
        resumeWatchLoopIfNeeded()
        // Notify RN so album browser can refresh (e.g. after limited picker)
        NativeSyncEngineModule.shared?.emitPhotoLibraryChanged()
    }

    // MARK: - DiscoveryServiceDelegate

    func discoveryDidUpdate(devices: [DiscoveredDevice]) {
        NSLog("[SyncEngine] discoveryDidUpdate called with \(devices.count) devices")
        syncDiagnosticsLog("SyncEngine", "discoveryDidUpdate called with \(devices.count) devices")
        let deviceSummary = devices.map {
            "\($0.name)/\($0.ip.isEmpty ? "no-ip" : $0.ip)/\($0.deviceId)/\($0.type)/port:\($0.port)"
        }.joined(separator: ", ")
        syncDiagnosticsLog(
            "SyncEngine",
            "discoveryDidUpdate devices=\(deviceSummary.isEmpty ? "none" : deviceSummary)"
        )
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
            syncDiagnosticsLog("SyncEngine", "emitting \(mapped.count) devices to RN")
            bridge.emitDiscoveredDevices(mapped)
        } else {
            NSLog("[SyncEngine] WARNING: NativeSyncEngineModule.shared is nil, cannot emit")
            syncDiagnosticsLog("SyncEngine", "warning: NativeSyncEngineModule.shared is nil, cannot emit")
        }

        // Detect bound device disappearing / reappearing from Bonjour
        if let binding = uploadStore?.getBinding() {
            let boundDeviceVisible = devices.contains { $0.deviceId == binding.deviceId }
            if !boundDeviceVisible && (bindingConnectionState == .connected || bindingConnectionState == .bound) {
                // Bonjour is unreliable — the device can briefly disappear due to
                // mDNS cache expiry or Wi-Fi transitions. Probe with a heartbeat
                // before going offline; only mark offline if the probe also fails.
                NSLog("[SyncEngine] bound device %@ disappeared from discovery, verifying via heartbeat", binding.deviceId)
                syncDiagnosticsLog("SyncEngine", "bound device \(binding.deviceId) disappeared from discovery, verifying via heartbeat")
                let clientId = bindingService.getOrCreateClientId()
                sendPresenceHeartbeat(clientId: clientId)
            } else if boundDeviceVisible && (bindingConnectionState == .offline || bindingConnectionState == .bound) {
                NSLog("[SyncEngine] bound device %@ reappeared in discovery, probing connection", binding.deviceId)
                syncDiagnosticsLog("SyncEngine", "bound device \(binding.deviceId) reappeared in discovery, probing connection")
                // Resolve sidecar host from the rediscovered Bonjour entry so the
                // heartbeat has a target, then probe with short retries until the
                // sidecar HTTP API is ready after desktop restart.
                if let device = devices.first(where: { $0.deviceId == binding.deviceId }) {
                    sidecarHost = preferredSidecarHost(probedHost: device.ip, device: device)
                }
                let clientId = bindingService.getOrCreateClientId()
                startPresenceRecoveryProbe(clientId: clientId)
            }
        }
    }

    // MARK: - Discovery

    func startDiscovery() {
        NSLog("[SyncEngine] startDiscovery - delegate is \(discoveryService.delegate == nil ? "nil" : "set")")
        syncDiagnosticsLog("SyncEngine", "startDiscovery - delegate is \(discoveryService.delegate == nil ? "nil" : "set")")
        syncDiagnosticsLog(
            "SyncEngine",
            "startDiscovery existingDiscoveredDevices=\(discoveredDevices.count)"
        )
        discoveryService.startBrowsing()
    }

    func stopDiscovery() {
        NSLog("[SyncEngine] stopDiscovery")
        syncDiagnosticsLog("SyncEngine", "stopDiscovery")
        syncDiagnosticsLog(
            "SyncEngine",
            "stopDiscovery clearingDiscoveredDevices=\(discoveredDevices.count)"
        )
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

    /// Returns the Keychain key under which the pairing token for a given server
    /// should be stored. Using a per-server key prevents pairing with a second
    /// device from overwriting the first device's token.
    private func pairingTokenKeychainKey(for serverId: String) -> String {
        return "syncflow_pairing_token_\(serverId)"
    }

    /// Retrieves the pairing token for the given binding, falling back to the
    /// legacy single-key entry for bindings created before per-device storage.
    private func resolvedPairingToken(for binding: BindingRecord) -> String? {
        let token = bindingService.getPairingToken(forKey: binding.pairingTokenKeychainRef)
        if token != nil { return token }
        // Fallback: old binding used the global key — try it once for migration.
        if binding.pairingTokenKeychainRef != BindingService.legacyPairingTokenKey {
            return bindingService.getPairingToken(forKey: BindingService.legacyPairingTokenKey)
        }
        return nil
    }

    func pairDevice(deviceId: String, host: String, port: Int, connectionCode: String) async throws {
        NSLog("[SyncEngine] pairDevice: deviceId=\(deviceId) host=\(host) port=\(port)")

        // Guard against concurrent pairing calls (e.g. QR scanner firing onCodeScanned
        // many times before the stale-closure guard takes effect). Only one pairing
        // attempt is allowed at a time.
        guard !isPairing else {
            NSLog("[SyncEngine] pairDevice: already pairing — ignoring concurrent call")
            return
        }
        isPairing = true

        let session = ProtocolSession(transport: transport)
        protocolSession = session
        defer {
            isPairing = false
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

        func resetAutoUploadStateForFreshPairing(reason: String) {
            try? uploadStore?.resetAutoUploadConfig()
            isAutoUploadInterrupted = false
            NSLog("[SyncEngine] reset auto upload config after pairing: %@", reason)
        }

        // 2. HELLO_REQ → HELLO_RES  (spec Section 7.8)
        let (helloType, helloRes) = try await session.sendAndReceive(
            type: .helloReq,
            payload: await buildClientHelloPayload(clientId: clientId)
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
            let serverId = helloRes["serverId"] as? String ?? deviceId
            if let existingBinding = uploadStore?.getBinding() {
                if existingBinding.deviceId != serverId {
                    // Switching to a different device — reset queue so it receives all photos.
                    NSLog(
                        "[SyncEngine] device switch detected (authRequired=false): %@ → %@, resetting upload queue",
                        existingBinding.deviceId, serverId
                    )
                    try? uploadStore?.resetUploadQueue()
                    resetAutoUploadStateForFreshPairing(reason: "device_switch_auth_not_required")
                    didAttemptRemoteHistoryReconciliation = false
                } else {
                    // Explicitly entering a connection code is treated as a fresh pairing
                    // session. The sync screen should start from the default "auto upload
                    // not enabled" card instead of inheriting the previous active state.
                    resetAutoUploadStateForFreshPairing(reason: "same_device_repair_auth_not_required")
                }
            } else {
                // No local binding — recreate from HELLO_RES info
                let serverName = helloRes["serverName"] as? String ?? ""
                let keychainKey = pairingTokenKeychainKey(for: serverId)
                let binding = BindingRecord(
                    deviceId: serverId,
                    deviceName: serverName,
                    deviceAlias: nil,
                    deviceType: inferredBindingDeviceType(for: deviceId),
                    host: host,
                    port: port,
                    pairingId: "",
                    pairingTokenKeychainRef: keychainKey,
                    shareName: helloRes["serverCapabilities"].flatMap { ($0 as? [String: Any])?["shareName"] as? String },
                    lastBoundAt: ISO8601DateFormatter().string(from: Date())
                )
                try? uploadStore?.saveBinding(binding)
                resetAutoUploadStateForFreshPairing(reason: "recreate_local_binding_auth_not_required")
                // Re-index Bonjour entry under the server UUID (only if originally found via Bonjour).
                if let bonjourDevice = discoveredDevices[deviceId] {
                    discoveredDevices[serverId] = bonjourDevice
                }
                NSLog("[SyncEngine] recreated local binding for \(serverId)")
            }
            // Sync is no longer triggered automatically after pairing.
            // The user will initiate sync from the album workbench or sync screen.
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
            let errMsg = pairRes["error"] as? String ?? "连接码错误或已过期"
            throw SyncEngineError.pairingError(errMsg)
        }

        // 4. Persist pairing token in Keychain — keyed per server so that pairing
        //    with a second device doesn't overwrite the first device's token.
        let serverInfo = pairRes["serverInfo"] as? [String: Any] ?? [:]
        let serverId = serverInfo["serverId"] as? String ?? deviceId
        let keychainKey = pairingTokenKeychainKey(for: serverId)
        if let token = pairRes["pairingToken"] as? String {
            bindingService.savePairingToken(token, forKey: keychainKey)
        }

        // 5. Persist binding record in SQLite.
        //    If the user is switching to a DIFFERENT desktop device, reset the upload
        //    queue so the new device starts from scratch and receives all photos.
        //    daily_ledgers are kept so historical stats for the previous device are preserved.
        if let existingBinding = uploadStore?.getBinding(), existingBinding.deviceId != serverId {
            NSLog(
                "[SyncEngine] device switch detected: %@ → %@, resetting upload queue",
                existingBinding.deviceId, serverId
            )
            try? uploadStore?.resetUploadQueue()
            resetAutoUploadStateForFreshPairing(reason: "device_switch_pair_required")
            didAttemptRemoteHistoryReconciliation = false
        } else {
            resetAutoUploadStateForFreshPairing(reason: "successful_pairing")
        }

        let binding = BindingRecord(
            deviceId: serverId,
            deviceName: serverInfo["serverName"] as? String ?? "",
            deviceAlias: nil,
            deviceType: inferredBindingDeviceType(for: deviceId),
            host: host,
            port: port,
            pairingId: pairRes["pairingId"] as? String ?? "",
            pairingTokenKeychainRef: keychainKey,
            shareName: serverInfo["shareName"] as? String,
            lastBoundAt: ISO8601DateFormatter().string(from: Date())
        )
        try uploadStore?.saveBinding(binding)

        // Re-index the Bonjour-discovered entry under the server's own UUID so that
        // resolveSidecarHost can look it up by binding.deviceId in later rounds.
        // Only do this when the device was found via Bonjour (discoveredDevices[deviceId]
        // exists); for manually-entered IPs the entry won't exist and binding.host is used
        // as the fallback — copying an arbitrary discovered device here would be wrong.
        let bindingDeviceId = serverInfo["serverId"] as? String ?? deviceId
        if let bonjourDevice = discoveredDevices[deviceId] {
            discoveredDevices[bindingDeviceId] = bonjourDevice
        }

        // 6. Notify RN bridge — mark as connected (not just bound) because
        //    we just confirmed the host is reachable via TCP during pairing.
        //    Also cache sidecarHost so presence heartbeats can reach the desktop.
        sidecarHost = host
        updateBindingConnectionState(.connected, reason: "pairing_confirmed_reachable")
        NativeSyncEngineModule.shared?.emitBindingStateChanged(bindingStatePayload(binding: binding))

        // 7. Send a presence heartbeat so the desktop UI shows device as online
        //    immediately after pairing, without waiting for a full sync cycle.
        sendPresenceHeartbeat(clientId: clientId)

        NSLog("[SyncEngine] pairing successful — sync deferred until user action")
    }

    func disconnectAndUnbind() async throws {
        NSLog("[SyncEngine] disconnectAndUnbind")
        // Clear the token stored under the binding's per-device key (and the legacy
        // global key for bindings created before per-device storage was introduced).
        if let binding = uploadStore?.getBinding() {
            bindingService.clearPairingToken(forKey: binding.pairingTokenKeychainRef)
        }
        bindingService.clearPairingToken()  // also wipe any legacy single-key token
        try uploadStore?.clearBinding()

        // Reset auto upload config so the next pairing starts with auto upload off.
        // Without this, a stale "active" state from the previous session would cause
        // the sync activity screen to show "auto upload running" immediately after
        // re-pairing, even though the user never enabled it for the new session.
        try? uploadStore?.resetAutoUploadConfig()
        isAutoUploadInterrupted = false

        stopPresenceHeartbeatTimer()
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
        ].merging(runtimeSyncOverviewPayload(uploadState: runtimeUploadState.isEmpty ? state : runtimeUploadState)) { _, new in new }
    }

    func getReadOnlyQueue() async -> [[String: Any]] {
        // Return pending items from the upload store if available
        guard let store = uploadStore else { return [] }
        let pending = store.getPendingUploadItemsSorted(limit: 100)
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
            "hasPairingToken": {
                if let b = uploadStore?.getBinding() {
                    return resolvedPairingToken(for: b) != nil
                }
                return bindingService.getPairingToken() != nil
            }(),
            "preferredIPv4": syncFlowPreferredClientIPv4() ?? NSNull(),
        ]

        let diagnostics: [String: Any] = [
            "generatedAt": ISO8601DateFormatter().string(from: Date()),
            "app": appInfo,
            "device": deviceInfo,
            "client": clientPayload,
            "runtime": runtimePayload,
        ]
        let engineLogSnapshot = SyncDiagnosticsLogStore.shared.snapshot()

        syncDiagnosticsDumpToConsole(engineLogSnapshot)

        try writeJSONFile(diagnostics, to: exportRoot.appendingPathComponent("diagnostics.json"))
        try writeJSONFile(queueSnapshot, to: exportRoot.appendingPathComponent("queue.json"))
        try writeJSONFile(historyDays, to: exportRoot.appendingPathComponent("history.json"))
        try writeTextFile(
            engineLogSnapshot.joined(separator: "\n"),
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
            // Only return the device that matches the current binding exactly.
            // Do NOT fall back to any arbitrary mDNS-discovered device — if the
            // bound device isn't in the Bonjour map (e.g. it was paired manually),
            // connectSession will use binding.host as the fallback instead.
            return discoveredDevices[binding.deviceId]
        }

        var targetDevice = findDevice()
        var endpoint = targetDevice?.endpoint
        if endpoint == nil {
            discoveryService.startBrowsing()
            NativeSyncEngineModule.shared?.emitSyncStateChanged(
                runtimeSyncOverviewPayload(uploadState: "discovering").merging([
                    "discoveryElapsedSec": 0,
                ] as [String: Any]) { _, new in new }
            )
            for pollIndex in 0..<20 {
                try await Task.sleep(nanoseconds: 500_000_000)
                if let found = findDevice() {
                    targetDevice = found
                    endpoint = found.endpoint
                    break
                }
                let elapsed = Double(pollIndex + 1) * 0.5
                NativeSyncEngineModule.shared?.emitSyncStateChanged(
                    runtimeSyncOverviewPayload(uploadState: "discovering").merging([
                        "discoveryElapsedSec": elapsed,
                    ] as [String: Any]) { _, new in new }
                )
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
            payload: await buildClientHelloPayload(clientId: clientId, pairingToken: token)
        )
        if helloType == .helloRes {
            refreshBoundServerMetadata(
                serverName: helloRes["serverName"] as? String,
                shareName: helloRes["serverCapabilities"]
                    .flatMap { ($0 as? [String: Any])?["shareName"] as? String },
                host: sidecarHost
            )
        }
        if helloType == .helloRes, let nonce = helloRes["nonce"] as? String {
            let hmac = transport.computeHMAC(token: token, nonce: nonce)
            let _ = try? await session.sendAndReceive(type: .authReq, payload: [
                "clientId": clientId, "auth": hmac,
            ])
        }
        // Disconnect — we just needed the IP
        transport.disconnect()
    }

    // MARK: - Sidecar History Reconciliation

    private struct SidecarExistingFileKeysResponse: Decodable {
        let fileKeys: [String]
    }

    private func restoreCompletedUploadHistoryIfNeeded(
        clientId: String,
        fallbackHost: String
    ) async -> Int {
        guard !didAttemptRemoteHistoryReconciliation else { return 0 }

        guard let store = uploadStore else { return 0 }
        guard store.getTrackedFileKeys().isEmpty else { return 0 }
        let host = (sidecarHost?.isEmpty == false ? sidecarHost : fallbackHost)
        guard let host, !host.isEmpty else {
            NSLog("[SyncPipeline] skip history reconciliation: sidecar host unavailable")
            syncDiagnosticsLog("SyncPipeline", "skip history reconciliation: sidecar host unavailable")
            return 0
        }
        didAttemptRemoteHistoryReconciliation = true

        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            runtimeSyncOverviewPayload(uploadState: "reconciling")
        )

        do {
            let remoteCompletedFileKeys = try await fetchRemoteExistingFileKeys(clientId: clientId, host: host)
            guard !remoteCompletedFileKeys.isEmpty else {
                NSLog("[SyncPipeline] no remote files available on sidecar for reconciliation")
                syncDiagnosticsLog("SyncPipeline", "no remote files available on sidecar for reconciliation")
                return 0
            }

            let scannedAssets = photoScanner.scanForUntrackedAssets(clientId: clientId, trackedFileKeys: [])
            let matchingAssets = scannedAssets.filter { remoteCompletedFileKeys.contains($0.fileKey) }
            guard !matchingAssets.isEmpty else {
                NSLog(
                    "[SyncPipeline] sidecar existing-file-keys returned %d keys but none match current photo library",
                    remoteCompletedFileKeys.count
                )
                syncDiagnosticsLog(
                    "SyncPipeline",
                    "sidecar existing-file-keys returned \(remoteCompletedFileKeys.count) keys but none match current photo library"
                )
                return 0
            }

            let now = ISO8601DateFormatter().string(from: Date())
            let restoredItems = matchingAssets.map { asset in
                UploadItemRecord(
                    id: nil,
                    assetLocalId: asset.asset.localIdentifier,
                    modifiedAt: asset.asset.modificationDate?.iso8601String ?? "",
                    mediaType: asset.mediaType,
                    originalFilename: asset.originalFilename,
                    fileKey: asset.fileKey,
                    fileSize: asset.estimatedSize,
                    status: "completed",
                    tempFilePath: nil,
                    ackedOffset: asset.estimatedSize,
                    lastErrorCode: nil,
                    updatedAt: now,
                    source: "auto",
                    batchId: nil,
                    priority: 0
                )
            }
            try store.upsertUploadItems(restoredItems)
            emitQueueToJS()

            NSLog(
                "[SyncPipeline] restored %d/%d sidecar-confirmed uploads into local history",
                restoredItems.count,
                remoteCompletedFileKeys.count
            )
            syncDiagnosticsLog(
                "SyncPipeline",
                "restored \(restoredItems.count)/\(remoteCompletedFileKeys.count) sidecar-confirmed uploads into local history"
            )
            return restoredItems.count
        } catch {
            NSLog("[SyncPipeline] history reconciliation failed: %@", "\(error)")
            syncDiagnosticsLog("SyncPipeline", "history reconciliation failed: \(error)")
            return 0
        }
    }

    private func fetchRemoteExistingFileKeys(clientId: String, host: String) async throws -> Set<String> {
        let response: SidecarExistingFileKeysResponse = try await fetchSidecarJSON(
            path: "/devices/\(clientId)/existing-file-keys",
            queryItems: [],
            host: host
        )

        return Set(response.fileKeys)
    }

    private func fetchSidecarJSON<T: Decodable>(
        path: String,
        queryItems: [URLQueryItem],
        host: String
    ) async throws -> T {
        let hostPart = host.contains(":") ? "[\(host)]" : host
        var components = URLComponents()
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        let querySuffix = components.percentEncodedQuery.map { "?\($0)" } ?? ""
        let urlStr = "http://\(hostPart):39394\(path)\(querySuffix)"

        guard let url = URL(string: urlStr) else {
            throw SyncEngineError.networkError("Invalid sidecar URL for path \(path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SyncEngineError.networkError("Sidecar response missing HTTP status")
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw SyncEngineError.networkError("Sidecar returned HTTP \(httpResponse.statusCode) for \(path)")
        }

        return try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: - HTTP Presence Heartbeat

    private func sendPresenceHeartbeat(
        clientId: String,
        successReason: String = "presence_heartbeat_succeeded",
        failureReason: String = "presence_heartbeat_failed",
        updateStateOnFailure: Bool = true,
        completion: ((Bool) -> Void)? = nil
    ) {
        let host: String
        if let resolved = sidecarHost, !resolved.isEmpty {
            host = resolved
        } else if let fallback = uploadStore?.getBinding()?.host, !fallback.isEmpty {
            host = fallback
        } else {
            return
        }
        let port = 39394
        // IPv6 link-local needs brackets and zone ID in URL
        let hostPart = host.contains(":") ? "[\(host)]" : host
        let urlStr = "http://\(hostPart):\(port)/presence/\(clientId)"
        guard let url = URL(string: urlStr) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        heartbeatSession.dataTask(with: request) { data, response, error in
            if let error {
                NSLog("[Presence] heartbeat failed: %@", "\(error)")
                syncDiagnosticsLog("Presence", "heartbeat failed host=\(host) reason=\(failureReason) error=\(error)")
                if updateStateOnFailure {
                    self.updateBindingConnectionState(.offline, reason: failureReason)
                }
                completion?(false)
            } else {
                if let httpResponse = response as? HTTPURLResponse {
                    NSLog("[Presence] heartbeat succeeded: HTTP %d", httpResponse.statusCode)
                    syncDiagnosticsLog("Presence", "heartbeat succeeded host=\(host) status=\(httpResponse.statusCode) reason=\(successReason)")
                } else {
                    NSLog("[Presence] heartbeat succeeded")
                    syncDiagnosticsLog("Presence", "heartbeat succeeded host=\(host) reason=\(successReason)")
                }
                if let data,
                   let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                {
                    self.refreshBoundServerMetadata(
                        serverName: payload["serverName"] as? String,
                        shareName: payload["shareName"] as? String,
                        host: host
                    )
                }
                self.updateBindingConnectionState(.connected, reason: successReason)
                completion?(true)
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

    // MARK: - Auto Upload Interrupt / Enable

    /// Interrupt auto upload: skips auto items in queue, only processes manual items.
    /// Once interrupted, user must explicitly re-enable.
    func interruptAutoUpload() {
        guard !isAutoUploadInterrupted else { return }
        isAutoUploadInterrupted = true

        // Persist interrupted state so it survives app restart
        if var config = autoUploadConfigStore?.getConfig() {
            config.state = "interrupted"
            config.updatedAt = ISO8601DateFormatter().string(from: Date())
            do {
                try autoUploadConfigStore?.saveConfig(config)
            } catch {
                NSLog("[SyncEngine] WARN: failed to persist interrupted state: %@", "\(error)")
            }
        }

        // Clear pending auto items so they don't block manual uploads
        // (dedup check) and re-enabling auto upload starts a fresh scan.
        do {
            try uploadStore?.cancelPendingAutoItems()
        } catch {
            NSLog("[SyncEngine] WARN: failed to cancel pending auto items: %@", "\(error)")
        }

        let currentTaskSource = uploadStore?.getCurrentUploadingSource()
        if isSyncing && currentTaskSource == "auto" {
            shouldAbortActiveAutoUpload = true
            clearRuntimeSyncRoundProgress(uploadState: "paused_auto_upload")
            maintainConnectedBindingState(reason: "interrupt_auto_upload_requested")
            syncDiagnosticsLog("SyncEngine", "interrupting in-flight auto upload")
            protocolSession?.interruptPendingResponse(error: SyncEngineError.autoUploadInterrupted)
        }
        emitQueueToJS()

        NSLog("[SyncEngine] auto upload interrupted")
        syncDiagnosticsLog("SyncEngine", "auto upload interrupted")
        sessionService.transitionTo(.interruptedAutoUpload)
        let payload = runtimeSyncOverviewPayload(uploadState: "paused_auto_upload")
        logSyncOverviewEmission("interrupt_auto_upload", payload: payload)
        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            payload
        )
    }

    // DEPRECATED: to be removed, use enableAutoUpload/interruptAutoUpload instead
    func pauseAutoUpload() {
        interruptAutoUpload()
    }

    /// Re-enable auto upload: resumes processing auto items after interruption.
    func enableAutoUpload() {
        isAutoUploadInterrupted = false
        shouldAbortActiveAutoUpload = false

        // Persist active state so it survives app restart
        if var config = autoUploadConfigStore?.getConfig() {
            config.enabled = true
            config.state = "active"
            config.updatedAt = ISO8601DateFormatter().string(from: Date())
            do {
                try autoUploadConfigStore?.saveConfig(config)
            } catch {
                NSLog("[SyncEngine] WARN: failed to persist active state: %@", "\(error)")
            }
        }

        NSLog("[SyncEngine] auto upload re-enabled")
        syncDiagnosticsLog("SyncEngine", "auto upload re-enabled")
        if isSyncing {
            sessionService.transitionTo(.scanning)
            // Signal the watch loop that a re-scan is needed. Without this,
            // resumeWatchLoopIfNeeded() wakes the loop but it immediately
            // goes back to sleep because photoLibraryChanged is still false.
            photoLibraryChanged = true
            resumeWatchLoopIfNeeded()
        } else {
            // Pipeline not running (e.g. manual upload already finished) —
            // start it so auto upload actually begins scanning and uploading.
            startSync()
        }
        let payload = runtimeSyncOverviewPayload(uploadState: isSyncing ? "scanning" : "idle")
        logSyncOverviewEmission("enable_auto_upload", payload: payload)
        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            payload
        )
    }

    // DEPRECATED: to be removed, use enableAutoUpload/interruptAutoUpload instead
    func resumeAutoUpload() {
        enableAutoUpload()
    }

    /// Cancel remaining items in a manual batch.
    func cancelManualBatch(batchId: String) throws {
        try uploadStore?.cancelManualBatch(batchId: batchId)
        NSLog("[SyncEngine] cancelled manual batch %@", batchId)
        syncDiagnosticsLog("SyncEngine", "cancelled manual batch \(batchId)")
        emitQueueToJS()
    }

    func cancelAllManualUploads() throws {
        try uploadStore?.cancelAllManualUploads()
        NSLog("[SyncEngine] cancelled entire manual upload queue")
        syncDiagnosticsLog("SyncEngine", "cancelled entire manual upload queue")
        emitQueueToJS()
    }

    // MARK: - Album Browser

    private lazy var thumbnailCacheDir: URL = {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_album_thumbs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    func browseAlbum(
        mediaFilter: String,
        transferFilter: String,
        offset: Int,
        limit: Int,
        collectionId: String? = nil
    ) -> [[String: Any]] {
        guard let service = albumBrowserService else { return [] }
        let assets = service.fetchAlbumAssets(
            mediaFilter: mediaFilter,
            transferFilter: transferFilter,
            offset: offset,
            limit: limit,
            collectionId: collectionId
        )
        let thumbSize = CGSize(width: 200, height: 200)
        return assets.map { asset in
            // Generate cached thumbnail file
            let thumbUri = cachedThumbnailUri(
                service: service,
                assetLocalId: asset.assetLocalId,
                size: thumbSize
            )
            return [
                "assetLocalId": asset.assetLocalId,
                "filename": asset.filename,
                "mediaType": asset.mediaType,
                "fileSize": asset.fileSize,
                "creationDate": asset.creationDate,
                "thumbnailUri": thumbUri,
                "isTransferred": asset.isTransferred,
                "isQueued": asset.isQueued,
            ] as [String: Any]
        }
    }

    private func cachedThumbnailUri(
        service: AlbumBrowserService,
        assetLocalId: String,
        size: CGSize
    ) -> String {
        // Use a sanitized version of the asset ID as filename
        let safeId = assetLocalId
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        let thumbFile = thumbnailCacheDir.appendingPathComponent("\(safeId).jpg")

        // Return cached file if it exists
        if FileManager.default.fileExists(atPath: thumbFile.path) {
            return thumbFile.absoluteString
        }

        // Generate thumbnail
        guard let image = service.getThumbnail(assetLocalId: assetLocalId, size: size),
              let data = image.jpegData(compressionQuality: 0.7) else {
            return ""
        }
        try? data.write(to: thumbFile, options: .atomic)
        return thumbFile.absoluteString
    }

    func getAlbumStats() -> [String: Any] {
        guard let service = albumBrowserService else {
            return ["totalCount": 0, "transferredCount": 0, "queuedCount": 0]
        }
        let stats = service.getAlbumStats()
        return [
            "totalCount": stats.totalCount,
            "transferredCount": stats.transferredCount,
            "queuedCount": stats.queuedCount,
        ]
    }

    func getAlbumCollections(mediaFilter: String) -> [[String: Any]] {
        guard let service = albumBrowserService else { return [] }
        return service.getAlbumCollections(mediaFilter: mediaFilter)
    }

    func getAssetPreviewSource(assetLocalId: String) -> [String: Any] {
        guard let service = albumBrowserService else {
            return ["uri": "", "mediaType": "image", "error": "not_found"]
        }
        return service.getPreviewSource(assetLocalId: assetLocalId)
    }

    // MARK: - Album Preview Cache

    private func cleanupPreviewCacheIfNeeded() {
        DispatchQueue.global(qos: .utility).async {
            let fm = FileManager.default
            let dir = AlbumBrowserService.previewCacheDir()
            guard let files = try? fm.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
                options: .skipsHiddenFiles
            ) else { return }

            let now = Date()
            let ttl: TimeInterval = 24 * 60 * 60
            let sizeLimit: Int64 = 500 * 1024 * 1024

            var survivors: [(URL, Date, Int64)] = []
            var totalSize: Int64 = 0

            for url in files {
                let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                let mtime = values?.contentModificationDate ?? .distantPast
                let size = Int64(values?.fileSize ?? 0)

                if now.timeIntervalSince(mtime) > ttl {
                    try? fm.removeItem(at: url)
                    continue
                }
                survivors.append((url, mtime, size))
                totalSize += size
            }

            if totalSize > sizeLimit {
                // LRU: sort by mtime asc (oldest first)
                survivors.sort { $0.1 < $1.1 }
                for (url, _, size) in survivors {
                    if totalSize <= sizeLimit { break }
                    try? fm.removeItem(at: url)
                    totalSize -= size
                }
            }
        }
    }

    // MARK: - Manual Upload

    func submitManualUpload(assetLocalIds: [String]) -> [String: Any] {
        guard let service = manualUploadService else {
            return ["queuedCount": 0, "skippedCount": 0, "batchId": ""]
        }

        // Fetch PHAssets for the given local identifiers
        let fetchResult = PHAsset.fetchAssets(
            withLocalIdentifiers: assetLocalIds,
            options: nil
        )
        var assets: [PHAsset] = []
        fetchResult.enumerateObjects { asset, _, _ in
            assets.append(asset)
        }

        let result = service.submitManualUpload(assets: assets)

        // Emit queue update to JS
        emitQueueToJS()

        // Manual uploads must start immediately even when auto upload is disabled.
        // If the loop is already alive, just wake it; otherwise bootstrap it.
        if result.queuedCount > 0 {
            if isSyncing {
                photoLibraryChanged = true
                resumeWatchLoopIfNeeded()
            } else {
                startSync()
            }
        } else if isSyncing {
            resumeWatchLoopIfNeeded()
        }

        return [
            "queuedCount": result.queuedCount,
            "skippedCount": result.skippedCount,
            "batchId": result.batchId,
        ]
    }

    // MARK: - Auto Upload Config

    func getAutoUploadConfig() -> [String: Any] {
        guard let configStore = autoUploadConfigStore else {
            return [
                "enabled": false,
                "timeRangeMode": "from_now",
                "state": "disabled",
            ]
        }
        let config = configStore.getConfig()
        var result: [String: Any] = [
            "enabled": config.enabled,
            "timeRangeMode": config.timeRangeMode,
            "state": config.state,
        ]
        if let customTimeFrom = config.customTimeFrom {
            result["customTimeFrom"] = customTimeFrom
        }
        return result
    }

    func saveAutoUploadConfig(config: [String: Any]) throws {
        guard let configStore = autoUploadConfigStore else {
            throw SyncEngineError.databaseError("Auto upload config store not initialized")
        }
        let currentConfig = configStore.getConfig()
        let newEnabled = config["enabled"] as? Bool ?? currentConfig.enabled

        // Determine the persisted state from the state machine source of truth.
        // `enabled` is now legacy compatibility data and may not reflect the UI state.
        let newState: String
        if !newEnabled {
            newState = "disabled"
        } else if currentConfig.state == "disabled" {
            newState = "active"
        } else {
            newState = currentConfig.state
        }

        let record = AutoUploadConfigRecord(
            enabled: newEnabled,
            timeRangeMode: config["timeRangeMode"] as? String ?? currentConfig.timeRangeMode,
            customTimeFrom: config["customTimeFrom"] as? String ?? currentConfig.customTimeFrom,
            state: newState,
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
        try configStore.saveConfig(record)

        // When newly enabled from disabled, clear interrupt flag and wake scan loop
        if newEnabled && currentConfig.state == "disabled" {
            isAutoUploadInterrupted = false
            NSLog("[SyncEngine] auto-upload enabled — waking scan loop")
            photoLibraryChanged = true
            resumeWatchLoopIfNeeded()
        }

        // Config changed while already active — wake loop to pick up changes
        if newEnabled && currentConfig.state == "active" && isSyncing {
            NSLog("[SyncEngine] auto-upload config changed — waking scan loop")
            photoLibraryChanged = true
            resumeWatchLoopIfNeeded()
        }
    }

    // MARK: - Shared Files

    func browseSharedFiles(path: String) async throws -> [String: Any] {
        let directory = try await sharedFilesService.listSharedFiles(path: path)
        let files: [[String: Any]] = directory.files.map { file in
            var fileDict: [String: Any] = [
                "name": file.name,
                "path": file.path,
                "type": file.type,
                "size": file.size,
                "modifiedAt": file.modifiedAt,
                "isDirectory": file.isDirectory,
            ]
            // Build absolute URLs for thumbnails and video streams
            if file.type == "image", let thumbUrl = sharedFilesService.getThumbnailUrl(path: file.path) {
                fileDict["thumbnailUrl"] = thumbUrl.absoluteString
            }
            if file.type == "video", let streamUrl = sharedFilesService.getStreamUrl(path: file.path) {
                fileDict["streamUrl"] = streamUrl.absoluteString
            }
            return fileDict
        }
        return [
            "path": directory.path,
            "files": files,
            "totalCount": directory.totalCount,
        ]
    }

    func downloadSharedFile(path: String) async throws -> [String: Any] {
        let result = try await sharedFilesService.downloadFile(path: path)
        return [
            "savedToPhotos": result.savedToPhotos,
            "localPath": result.localPath ?? NSNull(),
        ]
    }

    func getSharedFileStreamUrl(path: String) -> String? {
        return sharedFilesService.getStreamUrl(path: path)?.absoluteString
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

    // MARK: - Account Identity Reset (Phase 1 / 2 / 3)

    /// UserDefaults key used as a 2-phase sentinel around a wipe. While set,
    /// the next cold start treats the wipe as interrupted and re-runs it. See
    /// AppDelegate for the launch-time self-heal branch.
    private static let wipeInProgressKey = "vivi_wipe_in_progress"
    /// UserDefaults key that remembers the last auth user id bound to the
    /// current sync identity. Used by the JS login flow to detect "user B
    /// logging in on a device that still has user A's sync state" and trigger
    /// a wipe. Stored as `String` so backend ids above 2^53 round-trip
    /// losslessly across the RN bridge; absence means "no owner recorded yet".
    /// Writes go through `setOwnerUserId(_:)` which flushes synchronously; see
    /// there for rationale — this marker is the Phase-2 durability anchor and
    /// a process kill before flush would defeat the owner-mismatch guard.
    private static let ownerUserIdKey = "lastSyncOwnerUserId"

    /// Prefixes of Keychain accounts that represent per-device pairing tokens.
    /// The current build writes `syncflow_pairing_token_<serverId>`; historical
    /// builds used `pairing_token_<serverId>` — we sweep both so an upgraded
    /// user never carries a dangling legacy entry past logout.
    private static let pairingTokenKeyPrefixes = ["syncflow_pairing_token_", "pairing_token_"]

    /// Single orchestrator for all sync-identity cleanup. Safe to call multiple
    /// times (idempotent — each step re-checks state). Individual step failures
    /// are logged and do not abort the rest of the wipe; the 2-phase flag
    /// ensures the next cold start retries if we are killed mid-way.
    ///
    /// Clears: binding row, pairing tokens (legacy + per-device), clientId,
    /// upload queue + sessions + daily ledger, auto-upload config, runtime
    /// pipeline state.
    ///
    /// Preserves: clientDisplayName (device preference, not account data)
    /// plus every UserDefaults key not explicitly touched below — including
    /// language/theme/permission state and diagnostic flags outside our
    /// scope. (Note: the `@vividrop/debug/*` namespace lives in AsyncStorage
    /// on the JS side, not UserDefaults; Swift never touches it here, so it
    /// is preserved by virtue of layer separation rather than by any
    /// allowlist on this method.)
    ///
    /// Flush semantics: the sentinel `set(...)` at the top is followed by an
    /// explicit `synchronize()` so it lands on disk before we start mutating
    /// anything else — `UserDefaults` otherwise batches writes and a process
    /// kill between the set and the eventual flush would leave the flag
    /// unobservable on next cold start, defeating the self-heal retry in
    /// `AppDelegate`. The `removeObject(forKey:)` at the bottom can stay
    /// batched: if we die before it flushes, the next cold start simply sees
    /// the flag still set and re-runs this method, which is idempotent
    /// against already-cleared state.
    @objc
    func wipeSyncIdentity() {
        let defaults = UserDefaults.standard
        defaults.set("1", forKey: Self.wipeInProgressKey)
        defaults.synchronize()  // Flush sentinel to disk immediately — see note above.
        NSLog("[SyncEngine] wipeSyncIdentity: begin (sentinel set)")
        syncDiagnosticsLog("SyncEngine", "wipeSyncIdentity: begin")

        // 1. Tear down any live networking / timers so we don't race the wipe.
        stopPresenceHeartbeatTimer()
        protocolSession?.disconnect()
        protocolSession = nil
        transport.disconnect()
        sessionService.endSession()
        sidecarHost = nil
        bindingConnectionState = .offline
        SilentAudioService.shared.stop()
        isSyncing = false
        isAutoUploadInterrupted = false
        shouldAbortActiveAutoUpload = false
        clearRuntimeSyncRoundProgress(uploadState: "idle")
        runtimeUploadState = "idle"
        runtimeLastErrorCode = nil
        runtimeLastErrorMessage = nil
        endBackgroundTransitionIfNeeded(reason: "wipeSyncIdentity")

        // 2. Enumerate per-device pairing tokens BEFORE clearing the binding
        // row — some installs rely on binding.pairingTokenKeychainRef to
        // locate the current device's token. Also fall back to a prefix
        // sweep for any orphaned legacy entries.
        let boundBinding = uploadStore?.getBinding()
        var pairingKeysToClear: Set<String> = []
        if let ref = boundBinding?.pairingTokenKeychainRef, !ref.isEmpty {
            pairingKeysToClear.insert(ref)
        }
        // Always include the legacy single-key token for completeness.
        pairingKeysToClear.insert(BindingService.legacyPairingTokenKey)
        for key in bindingService.listStoredKeychainKeys() {
            for prefix in Self.pairingTokenKeyPrefixes where key.hasPrefix(prefix) {
                pairingKeysToClear.insert(key)
            }
        }

        // 3. Clear binding row (SQLite).
        do {
            try uploadStore?.clearBinding()
        } catch {
            NSLog("[SyncEngine] wipeSyncIdentity: clearBinding failed: %@", "\(error)")
        }

        // 4. Clear every pairing token we located. `clearPairingToken(forKey:)`
        // is already no-op safe when the entry is missing.
        for key in pairingKeysToClear {
            bindingService.clearPairingToken(forKey: key)
        }
        bindingService.clearPairingToken()  // belt-and-braces: legacy single-key API

        // 5. Clear clientId so the next session generates a fresh UUID.
        bindingService.clearClientId()

        // 6. Clear upload queue + sessions + daily ledger in one shot.
        do {
            try uploadStore?.resetAllStatusData()
        } catch {
            NSLog("[SyncEngine] wipeSyncIdentity: resetAllStatusData failed: %@", "\(error)")
        }

        // 7. Reset auto upload config (persisted enabled flag, timeRangeMode,
        // customTimeFrom, state). Falls back to schema default row on next
        // read.
        do {
            try uploadStore?.resetAutoUploadConfig()
        } catch {
            NSLog("[SyncEngine] wipeSyncIdentity: resetAutoUploadConfig failed: %@", "\(error)")
        }

        // 8. Forget the previously-recorded owner so we don't false-trigger the
        // owner-mismatch path on the very next login.
        defaults.removeObject(forKey: Self.ownerUserIdKey)

        // 9. Push fresh empty state to JS so any foregrounded UI does not keep
        // rendering stale data (binding card, queue, history).
        NativeSyncEngineModule.shared?.emitBindingStateChanged(nil)
        NativeSyncEngineModule.shared?.emitQueueUpdated([])
        NativeSyncEngineModule.shared?.emitHistoryUpdated()
        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            runtimeSyncOverviewPayload(uploadState: "idle")
        )

        // 10. Clear the sentinel last — any crash before this point causes a
        // self-heal retry on next launch.
        defaults.removeObject(forKey: Self.wipeInProgressKey)
        NSLog("[SyncEngine] wipeSyncIdentity: complete (sentinel cleared)")
        syncDiagnosticsLog("SyncEngine", "wipeSyncIdentity: complete")
    }

    /// Last auth user id bound to the current sync identity, or `nil` if no
    /// owner has been recorded yet (fresh install / post-wipe). The value is
    /// a `String` so backend ids above 2^53 round-trip without hitting the
    /// `NSNumber`/`Double` precision ceiling — the JS bootstrap compares
    /// against `String(profile.id)`. `UserDefaults` is thread-safe, so this
    /// accessor is safe to call off the main actor.
    @objc
    func getOwnerUserId() -> String? {
        let defaults = UserDefaults.standard
        return defaults.string(forKey: Self.ownerUserIdKey)
    }

    /// Write the owner id as a string to preserve full precision across the
    /// RN bridge. `UserDefaults` is thread-safe; no main-actor hop needed.
    ///
    /// Returns `true` iff the write was durably flushed to disk. The caller
    /// (RNBridge.setOwnerUserId) rejects the JS promise on `false` so
    /// `bootstrapAuthedSession` can fail the bootstrap rather than flipping
    /// the navigator into `AuthedStack` with an un-marked owner that a
    /// future cold start can't detect.
    @objc
    func setOwnerUserId(_ id: String) -> Bool {
        let defaults = UserDefaults.standard
        defaults.set(id, forKey: Self.ownerUserIdKey)
        // Durable flush — this marker is the ONLY signal the Phase-2 owner
        // guard uses on next cold start. `UserDefaults` batches writes to
        // disk, so a process kill between `set(...)` and the OS's eventual
        // flush would leave the marker unobservable and bypass the guard.
        // `synchronize()` is formally deprecated but remains the documented
        // escape hatch for forced flush, and we are already using it for
        // the install_marker and wipe_in_progress sentinels for the same
        // reason (see AppDelegate.swift + wipeSyncIdentity above).
        //
        // `synchronize()` returns `false` if the write failed (disk full,
        // sandbox permissions, etc.). We propagate that up so the JS layer
        // can fail the bootstrap; silently treating it as success would
        // leave us one process-kill away from a Phase-2 bypass.
        let flushed = defaults.synchronize()
        if !flushed {
            NSLog("[SyncEngine] owner user id set FAILED to flush for %@", id)
        } else {
            NSLog("[SyncEngine] owner user id set to %@", id)
        }
        return flushed
    }
}
