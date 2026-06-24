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

private func syncFlowIsPrivateLANIPv4(_ host: String) -> Bool {
    SharedFilesRoutePolicy.isPrivateLANIPv4(host)
}

private struct DesktopPowerSnapshot {
    let state: String?
    let lastResumeAt: Date?

    static func fromJSONValue(_ value: Any?) -> DesktopPowerSnapshot? {
        guard let object = value as? [String: Any] else { return nil }
        let state = (object["state"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let lastResumeAt = (object["lastResumeAt"] as? String)
            .flatMap { ISO8601DateFormatter().date(from: $0) }
        return DesktopPowerSnapshot(state: state?.isEmpty == false ? state : nil, lastResumeAt: lastResumeAt)
    }
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
        slog("[Diagnostics] engine.log snapshot is empty at export time")
        return
    }

    slog("[Diagnostics] engine.log snapshot begin (%d lines)", lines.count)
    for line in lines {
        slog("[DiagnosticsLog] %@", line)
    }
    slog("[Diagnostics] engine.log snapshot end")
}

@objc
class SyncEngineManager: NSObject, DiscoveryServiceDelegate, PhotoScannerDelegate, BackgroundUploadBindingSource {
    static let shared = SyncEngineManager()

    private enum BindingConnectionState: String {
        case discovering
        case bound
        case connecting
        case connected
        case offline
    }

    private enum SharedFilesReachabilityState: String {
        case unknown
        case waking
        case available
        case unavailable
    }

    private enum SharedFilesReachabilityRoute: String {
        case lan
        case tunnel
        case relay
    }

    private struct P2PTunnelCredentials: Equatable {
        let signalingURL: String
        let accessToken: String
        let iceServersJSON: String
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
    private let wakeOnLanService = WakeOnLanService()
    /// Live snapshot of the current binding. Takes priority over SQLite in
    /// BackgroundUploadService.resolveCurrentBinding() so a just-paired
    /// binding is visible before the row is flushed. Written by the pairing /
    /// restore paths via `persistBinding(_:)`. Cleared by `clearBinding` /
    /// wipe / logout paths.
    private(set) var currentBinding: StoredBinding?
    private var sharedFilesReachabilityPayload: [String: Any]?
    /// Set while the app is transitioning to background. The foreground TCP
    /// upload loop observes this between files and breaks out so the
    /// BackgroundUploadService can take over.
    var isTransitioningToBackground = false
    private let backgroundSilentAudioFeatureLock = NSLock()
    private var backgroundSilentAudioFeatureEnabled = false
    let backgroundUploadService = BackgroundUploadService.shared
    /// Timeout / poll tuning for `transitionToBackgroundUpload`. Expressed as
    /// private static lets so unit-level reasoning sees concrete numbers.
    private static let transitionBackgroundWaitTimeoutSeconds: UInt64 = 25
    private static let transitionPollIntervalMilliseconds: UInt64 = 100
    /// Timeout for DELETE /upload cross-protocol reset. Not a background
    /// URLSession request — fires on the short-lived HTTP client used by
    /// `sidecarResetUpload`.
    private static let crossProtocolResetDeleteTimeoutSeconds: TimeInterval = 10
    private var isAutoUploadInterrupted = false
    private var shouldAbortActiveAutoUpload = false
    private var shouldAbortActiveManualUpload = false
    private var protocolSession: ProtocolSession?
    private var activeUploadSession: ProtocolSession?
    private var discoveredDevices: [String: DiscoveredDevice] = [:]  // keyed by deviceId
    private var photoLibraryChanged = false  // set by observer, consumed by watch loop
    private var shouldAbortActiveUploadForBindingChange = false
    private var lastEmittedDiscoveredDevicesSignature: String?
    private var watchLoopContinuation: CheckedContinuation<Void, Never>?
    private var watchLoopContinuationToken: UUID?
    private let watchLoopContinuationLock = NSLock()
    private let incrementalQueueRescanLock = NSLock()
    private let incrementalQueueRescanQueue = DispatchQueue(
        label: "com.syncflow.incremental-photo-rescan",
        qos: .utility
    )
    private var incrementalQueueRescanWorkItem: DispatchWorkItem?
    private let deferredAutoExportFailuresLock = NSLock()
    private var deferredAutoExportFailures: [String: CFTimeInterval] = [:]
    private let deferredAutoExportRetryAfterSeconds: CFTimeInterval = 60
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
    /// M8 — ref-counted background-transition assertion (FU5: state machine
    /// extracted to `BackgroundTransitionRefCount` so it can be unit-tested
    /// without UIKit).
    ///
    /// `appDidEnterBackground` and `transitionToBackgroundUpload` both call
    /// `beginBackgroundTransitionIfNeeded` / `endBackgroundTransitionIfNeeded`
    /// and nest: the outer pair spans the whole transition, the inner pair
    /// only wraps the `transitionToBackgroundUpload` async body (via
    /// `defer`). A pure bool / `== .invalid` gate would release the outer
    /// UIApplication assertion the moment the inner `defer end()` ran,
    /// leaving the outer caller with nothing to back it. The helper counts
    /// open scopes and only ends the real UIApplication task when the count
    /// drops back to zero; `forceEnd` clamps the count on terminal cleanup
    /// paths.
    private lazy var backgroundTransitionRefCount: BackgroundTransitionRefCount<UIBackgroundTaskIdentifier> = {
        return BackgroundTransitionRefCount<UIBackgroundTaskIdentifier>(
            invalidToken: .invalid,
            acquire: { [weak self] in
                guard let self = self else { return .invalid }
                return self.backgroundService.beginTransitionTask()
            },
            release: { [weak self] token in
                self?.backgroundService.endTransitionTask(token)
            },
            log: { event, reason, refCount in
                // Preserve the exact log phrasing from the pre-extraction
                // implementation so diagnostic log greps keep matching.
                let phrase: String
                switch event {
                case "began": phrase = "began transition task"
                case "nestedBegin": phrase = "nested begin transition"
                case "ended": phrase = "ended transition task"
                case "nestedEnd": phrase = "nested end transition"
                case "forceEnded": phrase = "force-ended transition task"
                default: phrase = "\(event) transition task"
                }
                if event == "forceEnded" {
                    NSLog("[BackgroundExec] %@ reason=%@", phrase, reason)
                    syncDiagnosticsLog("BackgroundExec", "\(phrase) reason=\(reason)")
                } else {
                    NSLog("[BackgroundExec] %@ reason=%@ refCount=%d", phrase, reason, refCount)
                    syncDiagnosticsLog("BackgroundExec", "\(phrase) reason=\(reason) refCount=\(refCount)")
                }
            }
        )
    }()
    private var bindingConnectionState: BindingConnectionState = .offline
    private var presenceHeartbeatTimer: DispatchSourceTimer?
    private let presenceRecoveryQueue = DispatchQueue(
        label: "com.syncflow.presence-recovery",
        qos: .utility
    )
    private let presenceRecoveryMaxAttempts = 10
    private let presenceRecoveryRetryInterval: TimeInterval = 1
    private let presenceRecoveryLock = NSLock()
    private var presenceRecoveryToken = UUID()
    private var presenceRecoveryWorkItem: DispatchWorkItem?
    private var presenceDelayedRecoveryProbeFailures = 0
    private let localTCPProxy = LocalTCPProxy()
    private let p2pTunnelQueue = DispatchQueue(
        label: "com.syncflow.p2p-tunnel",
        qos: .utility
    )
    private var p2pTunnelCredentials: P2PTunnelCredentials?
    private var p2pTunnelGeneration = 0
    private var p2pTunnelStarting = false
    private var p2pTunnelRouteMode = SharedFilesRoutePolicy.p2pTunnelRouteModeAll
    private struct P2PTunnelRouteState {
        let hasCredentials: Bool
        let isActive: Bool
        let isStarting: Bool
        let port: UInt16?
        let selectedICERoute: String
        let routeMode: String
    }
    private let sharedFileTunnelOperationLock = NSLock()
    private var activeSharedFileTunnelOperations = 0
    private var lastSharedFileTunnelOperationEndedAt: TimeInterval?
    private let diagnosticsIssueLock = NSLock()
    private var recentRetryDiagnostic: [String: Any]?
    private var recentErrorDiagnostic: [String: Any]?
    private var didAttemptRemoteHistoryReconciliation = false
    private var runtimeQueueTotalCount = 0
    private var runtimeQueueCompletedCount = 0
    private var runtimeQueueTotalBytes: Int64 = 0
    private var runtimeQueueCompletedBytes: Int64 = 0
    private var runtimeRoundBaselineCompletedCount = 0
    private var runtimeRoundBaselineCompletedBytes: Int64 = 0
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
    private var runtimeManualUploadCancelled = false
    private var runtimeLastCompletedTaskSource: String?
    private var runtimeRoundSource: String?
    private var lastBackgroundPhotoLibraryChangeAt: CFAbsoluteTime = 0
    private let backgroundCaptureCooldown: CFTimeInterval = 90
    private var pendingRescanAfterThermalRecovery = false
    private var runtimePerformanceHint = "none"
    private var runtimePerformanceMessage: String?
    private var runtimeThermalState = "nominal"
    private var runtimeActiveTuningProfile = "normal"
    private var runtimeIsThermalLimited = false
    private var runtimeThermalReason: ThermalPerformanceReason?
    private let albumBrowserQueue = DispatchQueue(
        label: "com.syncflow.album-browser",
        qos: .userInitiated
    )
    private let albumBrowserQueueKey = DispatchSpecificKey<Void>()

    private func preferredSidecarHost(probedHost: String?, device: DiscoveredDevice?) -> String? {
        SidecarHostResolutionPolicy.preferredHost(
            probedHost: probedHost,
            deviceHost: device?.ip
        )
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

        return uploadTargetDeviceType(for: binding)
    }

    private func uploadTargetDeviceType(for binding: BindingRecord) -> String? {

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
            slog(
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
        runtimeRoundBaselineCompletedCount = 0
        runtimeRoundBaselineCompletedBytes = 0
        clearRuntimeCurrentFile()
        runtimeCurrentSpeedMbps = 0
        runtimeLastSpeedCheckTime = 0
        runtimeLastBytesTransferred = 0
        runtimeLastCompletedTaskSource = nil
        runtimeRoundSource = nil
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
        completedBytes: Int64 = 0,
        source: String? = nil
    ) {
        runtimeQueueTotalCount = totalCount
        runtimeQueueCompletedCount = completedCount
        runtimeQueueTotalBytes = totalBytes
        runtimeQueueCompletedBytes = completedBytes
        runtimeRoundBaselineCompletedCount = completedCount
        runtimeRoundBaselineCompletedBytes = completedBytes
        runtimeRoundSource = source
        runtimeLastSpeedCheckTime = CFAbsoluteTimeGetCurrent()
        runtimeLastBytesTransferred = completedBytes
        runtimeCurrentSpeedMbps = 0
        runtimeLastCompletedTaskSource = nil
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
        progressPercent: Int? = nil,
        includePersistedIdleStats: Bool = true
    ) -> [String: Any] {
        runtimeUploadState = uploadState
        let preservesManualCancellation =
            uploadState == "idle" || uploadState == "paused_auto_upload"
        if !preservesManualCancellation {
            runtimeManualUploadCancelled = false
        }
        let manualUploadCancelled =
            runtimeManualUploadCancelled && preservesManualCancellation
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
            includePersistedIdleStats &&
            !manualUploadCancelled &&
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

        var payload: [String: Any] = [
            "currentDeviceId": currentBinding?.deviceId ?? NSNull(),
            "currentDeviceName": currentBinding?.deviceAlias ?? currentBinding?.deviceName ?? NSNull(),
            "completedCount": effectiveCompletedCount,
            "completedBytes": effectiveCompletedBytes,
            "roundBaselineCompletedCount": runtimeRoundBaselineCompletedCount,
            "roundBaselineCompletedBytes": runtimeRoundBaselineCompletedBytes,
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
            "lastCompletedTaskSource": runtimeLastCompletedTaskSource ?? NSNull(),
            "autoUploadState": autoUploadState,
            "manualPending": pendingCounts.manual,
            "autoPending": pendingCounts.auto,
        ]
        if manualUploadCancelled {
            payload["manualUploadCancelled"] = true
        }
        return payload
    }

    private func overviewLogValue(_ value: Any?) -> String {
        guard let value, !(value is NSNull) else { return "nil" }
        return String(describing: value)
    }

    private func logSyncOverviewEmission(_ context: String, payload: [String: Any]) {
        let message = String(
            format: "emit %@ state=%@ auto=%@ source=%@ lastSource=%@ completed=%@/%@ bytes=%@/%@ pending(manual=%@ auto=%@) currentFile=%@ currentBytes=%@/%@ progress=%@",
            context,
            overviewLogValue(payload["uploadState"]),
            overviewLogValue(payload["autoUploadState"]),
            overviewLogValue(payload["currentTaskSource"]),
            overviewLogValue(payload["lastCompletedTaskSource"]),
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
        slog("[SyncOverview] %@", message)
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

    private func activeDeferredAutoExportFailureKeys() -> Set<String> {
        let now = CFAbsoluteTimeGetCurrent()
        deferredAutoExportFailuresLock.lock()
        deferredAutoExportFailures = deferredAutoExportFailures.filter { _, retryAfter in
            retryAfter > now
        }
        let keys = Set(deferredAutoExportFailures.keys)
        deferredAutoExportFailuresLock.unlock()
        return keys
    }

    private func deferAutoExportFailure(fileKey: String) {
        deferredAutoExportFailuresLock.lock()
        deferredAutoExportFailures[fileKey] = CFAbsoluteTimeGetCurrent() + deferredAutoExportRetryAfterSeconds
        deferredAutoExportFailuresLock.unlock()
    }

    private func clearDeferredAutoExportFailure(fileKey: String) {
        deferredAutoExportFailuresLock.lock()
        deferredAutoExportFailures.removeValue(forKey: fileKey)
        deferredAutoExportFailuresLock.unlock()
    }

    private func isPhotoKitExportError(_ error: Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == PHPhotosErrorDomain
    }

    private func photoKitExportErrorSummary(_ error: Error) -> String {
        let nsError = error as NSError
        guard nsError.domain == PHPhotosErrorDomain else {
            return "\(error)"
        }
        return "\(nsError.domain) Code=\(nsError.code)"
    }

    private func photoExportRetryDelayNs(forAttempt attempt: Int) -> UInt64 {
        let seconds: UInt64
        switch attempt {
        case 1: seconds = 1
        case 2: seconds = 3
        default: seconds = 6
        }
        return seconds * 1_000_000_000
    }

    private func buildPendingUploadAssets(clientId: String, limit: Int? = 200) -> [ScannedAsset] {
        guard let store = uploadStore else { return [] }

        let pendingItems = store.getPendingUploadItemsSorted(
            limit: limit,
            excludeSource: isAutoUploadInterrupted ? "auto" : nil
        )
        guard !pendingItems.isEmpty else { return [] }

        let localIdentifiers = pendingItems
            .filter { $0.sourceKind != "document" }
            .map(\.assetLocalId)
        let fetchedAssets = PHAsset.fetchAssets(withLocalIdentifiers: localIdentifiers, options: nil)
        var assetsByLocalId: [String: PHAsset] = [:]
        fetchedAssets.enumerateObjects { asset, _, _ in
            assetsByLocalId[asset.localIdentifier] = asset
        }

        var results: [ScannedAsset] = []
        var missingAssets = 0
        let fileManager = FileManager.default

        for item in pendingItems {
            if item.sourceKind == "document" {
                guard let sourceFilePath = item.sourceFilePath,
                      fileManager.fileExists(atPath: sourceFilePath) else {
                    missingAssets += 1
                    continue
                }
                let sourceURL = URL(fileURLWithPath: sourceFilePath)
                let attrs = try? fileManager.attributesOfItem(atPath: sourceFilePath)
                let size = item.fileSize
                    ?? (attrs?[.size] as? NSNumber)?.int64Value
                    ?? 0
                results.append(ScannedAsset(
                    asset: nil,
                    fileKey: item.fileKey ?? item.assetLocalId,
                    mediaType: item.mediaType.isEmpty ? "document" : item.mediaType,
                    creationDate: nil,
                    originalFilename: item.originalFilename ?? sourceURL.lastPathComponent,
                    estimatedSize: size,
                    source: item.source,
                    batchId: item.batchId,
                    sourceKind: "document",
                    sourceFilePath: sourceFilePath,
                    mimeType: item.mimeType,
                    assetLocalId: item.assetLocalId
                ))
                continue
            }

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
                source: item.source,
                batchId: item.batchId,
                assetLocalId: asset.localIdentifier
            ))
        }

        if missingAssets > 0 {
            slog("[SyncPipeline] skipped %d pending items whose PHAsset could not be resolved", missingAssets)
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

    private func isManualUploadCancelled(fileKey: String, source: String) -> Bool {
        guard source == "manual" else { return false }
        if shouldAbortActiveManualUpload {
            return true
        }
        return uploadStore?.getUploadItemByFileKey(fileKey)?.status == "cancelled"
    }

    private func throwIfManualUploadCancelled(fileKey: String, source: String) throws {
        if isManualUploadCancelled(fileKey: fileKey, source: source) {
            throw SyncEngineError.manualUploadCancelled
        }
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

    private func manualUploadQueueAssets(from pendingAssets: [ScannedAsset]) -> [ScannedAsset] {
        guard let first = pendingAssets.first, first.source == "manual" else { return [] }
        guard let batchId = first.batchId, !batchId.isEmpty else {
            return Array(pendingAssets.prefix { $0.source == "manual" })
        }
        return Array(pendingAssets.prefix { $0.source == "manual" && $0.batchId == batchId })
    }

    private func estimatedTotalBytes(for assets: [ScannedAsset]) -> Int64 {
        assets.reduce(Int64(0)) { total, asset in
            total + max(asset.estimatedSize, 0)
        }
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
        let candidates = Array(items.filter { $0.sourceKind != "document" }.prefix(thermalBatchLimit))
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
        if asset.sourceKind == "document" {
            return try exportDocumentForUpload(asset)
        }

        guard let photoAsset = asset.asset else {
            throw SyncEngineError.permissionError("Missing PHAsset for upload item")
        }

        let maxAttempts = asset.source == "auto" ? 4 : 2
        var attempt = 1

        while true {
            markAssetPreparing(asset: asset)

            var markedCloudDownload = false
            do {
                let exported = try await exportService.exportAsset(photoAsset) { [weak self] progress in
                    guard progress < 1.0, !markedCloudDownload else { return }
                    markedCloudDownload = true
                    try? self?.uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "cloud_downloading")
                    self?.emitQueueToJS()
                }
                clearDeferredAutoExportFailure(fileKey: asset.fileKey)
                return exported
            } catch {
                guard isPhotoKitExportError(error), attempt < maxAttempts else {
                    throw error
                }
                let delayNs = photoExportRetryDelayNs(forAttempt: attempt)
                slog(
                    "[SyncPipeline] PhotoKit export failed for %@ (%@), retrying in %.1fs (attempt %d/%d)",
                    asset.fileKey,
                    photoKitExportErrorSummary(error),
                    Double(delayNs) / 1_000_000_000,
                    attempt + 1,
                    maxAttempts
                )
                syncDiagnosticsLog(
                    "SyncPipeline",
                    "PhotoKit export failed for \(asset.fileKey) (\(photoKitExportErrorSummary(error))), retrying attempt \(attempt + 1)/\(maxAttempts)"
                )
                try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                clearRuntimeCurrentFile()
                emitQueueToJS()
                try await Task.sleep(nanoseconds: delayNs)
                attempt += 1
            }
        }
    }

    private func exportDocumentForUpload(_ asset: ScannedAsset) throws -> ExportedFile {
        markAssetPreparing(asset: asset)
        guard let sourceFilePath = asset.sourceFilePath else {
            throw SyncEngineError.permissionError("Missing document source path")
        }
        let sourceURL = URL(fileURLWithPath: sourceFilePath)
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: sourceURL.path) else {
            throw SyncEngineError.permissionError("Document source file not found")
        }

        let tempDir = fileManager.temporaryDirectory.appendingPathComponent("syncflow_export")
        try fileManager.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let filename = asset.originalFilename.isEmpty ? sourceURL.lastPathComponent : asset.originalFilename
        let tempURL = tempDir.appendingPathComponent(UUID().uuidString + "_" + filename)
        if fileManager.fileExists(atPath: tempURL.path) {
            try fileManager.removeItem(at: tempURL)
        }
        try fileManager.copyItem(at: sourceURL, to: tempURL)
        let attrs = try fileManager.attributesOfItem(atPath: tempURL.path)
        let size = (attrs[.size] as? NSNumber)?.int64Value ?? asset.estimatedSize
        let modifiedAt = (attrs[.modificationDate] as? Date)?.iso8601String ?? ""

        return ExportedFile(
            tempURL: tempURL,
            originalFilename: filename,
            fileSize: size,
            mimeType: asset.mimeType ?? "application/octet-stream",
            mediaType: asset.mediaType.isEmpty ? "document" : asset.mediaType,
            createdAt: "",
            modifiedAt: modifiedAt
        )
    }

    private func connectSession(
        _ session: ProtocolSession,
        device: DiscoveredDevice?,
        fallbackHost: String? = nil,
        fallbackPort: UInt16? = nil
    ) async throws {
        let usableFallbackHost = SidecarHostResolutionPolicy.usableFallbackHost(fallbackHost)

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

        if SidecarHostResolutionPolicy.isLoopbackHost(device?.ip),
           let usableFallbackHost {
            try await session.connect(
                host: usableFallbackHost,
                port: fallbackPort ?? 39393
            )
            return
        }

        if let endpoint = device?.endpoint {
            try await session.connect(endpoint: endpoint)
            return
        }

        if let usableFallbackHost {
            try await session.connect(
                host: usableFallbackHost,
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

    /// True when the TCP loop has already consumed the armed continuation
    /// matching `expectedToken` — i.e. the loop reached a file boundary and
    /// signalled us via `resumeWatchLoopIfNeeded()`, clearing the shared slot.
    /// Also true if the slot is empty (nothing armed) or if a newer token has
    /// taken over (our armed sentinel is no longer relevant).
    private func isTCPLoopAtFileBoundary(expectedToken: UUID) -> Bool {
        watchLoopContinuationLock.lock()
        defer { watchLoopContinuationLock.unlock() }
        if watchLoopContinuation == nil { return true }
        if watchLoopContinuationToken != expectedToken { return true }
        return false
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
        albumBrowserQueue.setSpecific(key: albumBrowserQueueKey, value: ())
        // Migrate keychain from old bundle ID before any keychain access
        bindingService.migrateKeychainIfNeeded()
        do {
            uploadStore = try UploadStore()
            historyStore = HistoryLedgerStore(store: uploadStore!)
            albumBrowserService = AlbumBrowserService(uploadStore: uploadStore)
            autoUploadConfigStore = AutoUploadConfigStore(store: uploadStore!)
            manualUploadService = ManualUploadService(uploadStore: uploadStore, bindingService: bindingService)
            // Wire the binding-version accessor (H2): BindingService reads /
            // bumps the `binding_version` meta row through UploadStore, so
            // both `currentBindingVersion()` and `bumpBindingVersion()` need
            // the store reference before any pair completes.
            bindingService.uploadStore = uploadStore
            photoScanner.autoUploadConfigStore = autoUploadConfigStore
            albumBrowserService?.autoUploadConfigStore = autoUploadConfigStore

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
                slog("[SyncEngine] restored interrupted state from persisted config")
            }

            // Cleanup is safe to run at any point during init — it only uses
            // the static AlbumBrowserService.previewCacheDir() helper and
            // dispatches its work onto a utility queue asynchronously.
            cleanupPreviewCacheIfNeeded()
        } catch {
            slog("[SyncEngine] Failed to init stores: \(error)")
        }
        if uploadStore?.getBinding() != nil {
            bindingConnectionState = .bound
            startPresenceHeartbeatTimer()
        }
        refreshCurrentBindingFromStore()
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
        //
        // Phase 3.6: DO NOT delete temp files still referenced by
        // upload_items.temp_file_path — those are the prepared HTTP bodies
        // that BackgroundUploadService hands to URLSession. Unconditional
        // removal here would orphan every in-flight background upload and
        // cause a 422 body_size_mismatch chain on relaunch.
        let exportTempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_export", isDirectory: true)
        let preservePaths: Set<String> = Set(
            (uploadStore?.getItemsWithTempFiles() ?? [])
                .compactMap { $0.tempFilePath }
                .filter { !$0.isEmpty }
        )
        if FileManager.default.fileExists(atPath: exportTempDir.path) {
            if preservePaths.isEmpty {
                try? FileManager.default.removeItem(at: exportTempDir)
                slog("[SyncEngine] cleared export temp dir on init")
            } else {
                var preservedCount = 0
                var deletedCount = 0
                if let entries = try? FileManager.default.contentsOfDirectory(
                    at: exportTempDir,
                    includingPropertiesForKeys: nil,
                    options: []
                ) {
                    for entry in entries {
                        if preservePaths.contains(entry.path) {
                            preservedCount += 1
                            continue
                        }
                        try? FileManager.default.removeItem(at: entry)
                        deletedCount += 1
                    }
                }
                slog(
                    "[SyncEngine] export temp dir sweep: preserved=%d deleted=%d (prepared HTTP bodies kept)",
                    preservedCount,
                    deletedCount
                )
            }
        }

        // Start the passive network-path observer. Pure instrumentation:
        // it only writes to SyncDiagnosticsLogStore so the diagnostic
        // bundle can show WHY a connection dropped when the user walked
        // between WiFi networks. It never triggers reconnect or discovery.
        NetworkPathObserver.shared.start()
    }

    // MARK: - App State Transitions

    func setBackgroundSilentAudioEnabled(_ enabled: Bool) {
        backgroundSilentAudioFeatureLock.lock()
        backgroundSilentAudioFeatureEnabled = enabled
        backgroundSilentAudioFeatureLock.unlock()
        if !enabled {
            SilentAudioService.shared.stop()
        }
        slog("[SilentAudio] feature %@", enabled ? "enabled" : "disabled")
        syncDiagnosticsLog("SilentAudio", "feature \(enabled ? "enabled" : "disabled")")
    }

    private func isBackgroundSilentAudioEnabled() -> Bool {
        backgroundSilentAudioFeatureLock.lock()
        defer { backgroundSilentAudioFeatureLock.unlock() }
        return backgroundSilentAudioFeatureEnabled
    }

    @objc private func appDidEnterBackground() {
        slog("[SyncEngine] app entered background, isSyncing=\(isSyncing)")
        let silentAudioStarted: Bool
        if isBackgroundSilentAudioEnabled() {
            silentAudioStarted = SilentAudioService.shared.start()
            if !silentAudioStarted {
                syncDiagnosticsLog("SilentAudio", "background audio failed to start; falling back to background handoff")
            }
        } else {
            silentAudioStarted = false
            SilentAudioService.shared.stop()
            syncDiagnosticsLog("SilentAudio", "background audio skipped — feature disabled")
        }
        if !isSyncing {
            stopPresenceHeartbeatTimer()
            cancelPresenceRecoveryProbe(reason: "app_entered_background")
        }
        guard isSyncing else { return }
        if silentAudioStarted {
            if sessionService.state == .syncingForeground {
                sessionService.transitionTo(.syncingBackground)
            }
            syncDiagnosticsLog("SyncPipeline", "continuing TCP pipeline in background with silent audio")
            return
        }
        beginBackgroundTransitionIfNeeded(reason: "didEnterBackground")
        isTransitioningToBackground = true
        if sessionService.state == .syncingForeground {
            sessionService.transitionTo(.syncingBackground)
        }
        Task { [weak self] in
            await self?.transitionToBackgroundUpload()
        }
    }

    /// Invoked when the app moves to background while a foreground TCP upload
    /// loop is in flight. Waits (bounded) for the active FILE to drain so we
    /// don't slice mid-FILE_DATA, then hands off the next queue-head file to
    /// BackgroundUploadService for URLSession background transport.
    ///
    /// The wait path uses `watchLoopContinuation` so the existing foreground
    /// loop can `resumeWatchLoopIfNeeded()` as soon as it detects
    /// `isTransitioningToBackground == true` between files.
    private func transitionToBackgroundUpload() async {
        beginBackgroundTransitionIfNeeded(reason: "transitionToBackgroundUpload")
        defer { endBackgroundTransitionIfNeeded(reason: "transitionToBackgroundUpload") }

        // Clear the "foreground resume requested" flag before we enqueue a
        // new background URLSession task. The flag is set every time the app
        // enters the foreground (see appWillEnterForeground); without this
        // clear, any subsequent bg→fg→bg cycle would leave it stuck true
        // forever and chainNextIfAppropriate() would refuse to queue the
        // next file after the first background completion.
        //
        // It must be cleared here (not in appDidEnterBackground) because
        // background enqueue flows through transitionToBackgroundUpload
        // only — clearing too early would also miss any direct call paths
        // that bypass appDidEnterBackground.
        backgroundUploadService.clearForegroundResumeRequest()

        // (1) Install a sentinel watchLoopContinuation so the foreground TCP
        //     loop can wake us at the next file boundary. The previous
        //     implementation used `withTaskGroup` + `withCheckedContinuation`
        //     racing against a timeout child; because `withCheckedContinuation`
        //     does NOT exit on task cancellation, the group never returned if
        //     the timeout branch won — the continuation child stayed suspended
        //     waiting for `resume()`, `withTaskGroup` implicitly awaited all
        //     children, and the handoff permanently deadlocked.
        //
        //     We now install a continuation whose ONLY purpose is to carry a
        //     token the TCP loop can use to signal "I reached a file
        //     boundary". We then poll-sleep on a bounded deadline instead of
        //     awaiting the continuation. If the TCP loop resumes the
        //     continuation (via `resumeWatchLoopIfNeeded()` in the file-boundary
        //     check), it is cleared from the shared slot and the poll observes
        //     that as "at file boundary". If the deadline elapses first the
        //     poll exits; `resumeWatchLoopIfNeeded(expectedToken:)` below
        //     cleans up whatever is still armed under our token.
        let token = UUID()
        // Park a sentinel continuation in the shared slot from a detached
        // Task. The Task suspends on `withCheckedContinuation` until either
        // the TCP loop (file boundary) or our own timeout path below calls
        // `resumeWatchLoopIfNeeded(expectedToken: token)`, which resumes the
        // sentinel and lets the detached Task finish. No continuation leak.
        //
        // We `await` an install-ack signal before starting the poll loop so
        // there is no race where the poll observes an empty slot before the
        // detached Task has parked the sentinel.
        await withCheckedContinuation { (installAck: CheckedContinuation<Void, Never>) in
            Task.detached { [weak self] in
                guard let self else {
                    installAck.resume()
                    return
                }
                await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                    self.watchLoopContinuationLock.lock()
                    if let existing = self.watchLoopContinuation {
                        existing.resume()
                    }
                    self.watchLoopContinuation = cont
                    self.watchLoopContinuationToken = token
                    self.watchLoopContinuationLock.unlock()
                    // Slot is now armed with our sentinel; unblock the caller
                    // to begin its deadline-bounded poll.
                    installAck.resume()
                }
            }
        }

        let deadline = Date().addingTimeInterval(
            TimeInterval(Self.transitionBackgroundWaitTimeoutSeconds)
        )
        while Date() < deadline {
            if isTCPLoopAtFileBoundary(expectedToken: token) {
                break
            }
            try? await Task.sleep(
                nanoseconds: Self.transitionPollIntervalMilliseconds * 1_000_000
            )
        }
        // On both exit paths (file-boundary reached OR timeout elapsed) we
        // must resume any still-armed continuation under our token so the
        // detached Task above unblocks and releases resources.
        resumeWatchLoopIfNeeded(expectedToken: token)

        // (2) Hand off to the background upload service, if we still have a
        //     binding. Preparation is disabled here because the foreground
        //     loop is responsible for exporting the next asset; the
        //     background path only enqueues an already-prepared body.
        //
        //     M7 / Spec L52: the fast path is explicitly budgeted
        //     `BackgroundUploadService.backgroundTransitionPreparationBudgetSeconds`
        //     for export/SHA256 work. That constant is currently 0, so
        //     `allowPreparation` MUST be false here — any row without a
        //     prepared body is deferred to the next BGProcessing wake-up
        //     where preparation is actually budgeted. If the constant ever
        //     grows non-zero, this call site is the single place to
        //     branch on it.
        precondition(
            BackgroundUploadService.backgroundTransitionPreparationBudgetSeconds == 0,
            "M7: transitionToBackgroundUpload assumes zero preparation budget — re-evaluate allowPreparation before raising the constant"
        )
        guard let binding = BackgroundHandoffPolicy.resolveBinding(
            live: currentBinding,
            persisted: uploadStore?.getBinding()
        ) else {
            NSLog("[SyncEngine] background handoff skipped — no binding")
            syncDiagnosticsLog("SyncEngine", "background handoff skipped — no binding")
            return
        }
        let clientId = bindingService.getOrCreateClientId()
        let result = await backgroundUploadService.enqueueNextPendingFileIfIdle(
            binding: binding,
            clientId: clientId,
            allowPreparation: false
        )
        NSLog("[SyncEngine] background handoff result=%@", "\(result)")
        syncDiagnosticsLog(
            "SyncEngine",
            "background handoff result=\(result) clientId=\(clientId.prefix(8))…"
        )
    }

    @objc private func appWillEnterForeground() {
        slog("[SyncEngine] app entering foreground")
        SilentAudioService.shared.stop()
        isTransitioningToBackground = false
        backgroundUploadService.requestForegroundResumeAfterBackgroundTask()
        endBackgroundTransitionIfNeeded(reason: "willEnterForeground")
        // M7 / Spec L49: `BackgroundUploadService.foregroundBannerForRepairDelaySeconds`
        // is the (currently 0) delay between this foreground transition
        // and surfacing a repair banner when needs_repair is true. With
        // the value pinned at 0 no DispatchQueue.asyncAfter hop is
        // required — the RN layer reads needs_repair on the next render
        // pass immediately after this method returns. Any future
        // non-zero value should schedule the banner on this queue using
        // the constant; wiring lives on the RN side today so no hard
        // reference appears here yet.
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
                slog("[SyncEngine] foreground restored — triggering deferred rescan (thermal=%@)", thermalStateLabel(thermal))
                syncDiagnosticsLog("SyncEngine", "foreground restored — triggering deferred rescan (thermal=\(thermalStateLabel(thermal)))")
                scheduleIncrementalQueueRescan(reason: "foreground_recovery_compensation")
            }
        }

        // Validate connection immediately on foreground — the heartbeat timer
        // may not have fired while the app was suspended, leaving a stale
        // .connected state even though the desktop is no longer reachable.
        if uploadStore?.getBinding() != nil {
            let clientId = bindingService.getOrCreateClientId()
            verifyPresenceWithRecovery(clientId: clientId)
        }
    }

    @objc private func thermalStateDidChange() {
        let state = ProcessInfo.processInfo.thermalState
        let label = thermalStateLabel(state)
        slog("[SyncEngine] thermal state changed to %@", label)
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
                slog("[SyncEngine] thermal recovered — triggering deferred rescan")
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

        var payload: [String: Any] = [
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
        if let wake = binding.wake {
            payload["wake"] = wake.toPayload()
        } else {
            payload["wake"] = NSNull()
        }
        if let sharedFilesReachabilityPayload,
           sharedFilesReachabilityPayload["deviceId"] as? String == binding.deviceId {
            payload["sharedFilesReachability"] = sharedFilesReachabilityPayload
        }
        return payload
    }

    private func emitBindingStateChanged() {
        NativeSyncEngineModule.shared?.emitBindingStateChanged(bindingStatePayload())
    }

    private func updateSharedFilesReachability(
        _ state: SharedFilesReachabilityState,
        route: SharedFilesReachabilityRoute?,
        reason: String
    ) {
        guard let binding = uploadStore?.getBinding() else { return }
        let routeValue: Any
        if let route {
            routeValue = route.rawValue
        } else {
            routeValue = NSNull()
        }
        let payload: [String: Any] = [
            "deviceId": binding.deviceId,
            "state": state.rawValue,
            "route": routeValue,
            "reason": reason,
            "updatedAt": diagnosticsTimestamp(),
        ]
        let previousState = sharedFilesReachabilityPayload?["state"] as? String ?? "nil"
        let previousRoute = sharedFilesReachabilityPayload?["route"] as? String ?? "nil"
        sharedFilesReachabilityPayload = payload
        syncDiagnosticsLog(
            "SharedFiles",
            "reachability \(previousState)/\(previousRoute) -> \(state.rawValue)/\(route?.rawValue ?? "nil") (\(reason))"
        )
        NativeSyncEngineModule.shared?.emitSharedFilesReachabilityChanged(payload)
    }

    private func clearSharedFilesReachability(reason: String) {
        guard sharedFilesReachabilityPayload != nil else { return }
        sharedFilesReachabilityPayload = nil
        syncDiagnosticsLog("SharedFiles", "reachability cleared (\(reason))")
        NativeSyncEngineModule.shared?.emitSharedFilesReachabilityChanged(nil)
    }

    private func refreshBoundServerMetadata(
        expectedDeviceId: String,
        serverName rawServerName: String?,
        shareName rawShareName: String?,
        host rawHost: String? = nil,
        wake: WakeCapability? = nil
    ) {
        guard var binding = uploadStore?.getBinding() else { return }
        guard binding.deviceId == expectedDeviceId else {
            syncDiagnosticsLog(
                "SyncEngine",
                "skipped binding metadata refresh for stale device=\(expectedDeviceId) current=\(binding.deviceId)"
            )
            return
        }

        let normalizedServerName = rawServerName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedShareName = rawShareName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedHost = rawHost?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if let wake {
            syncDiagnosticsLog(
                "SyncEngine",
                "binding metadata refresh candidate host=\(normalizedHost ?? "nil") \(wakeCapabilityLogSummary(wake)) existingWakeUsable=\(binding.wake?.hasUsableTargets == true)"
            )
        }

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

        let mergedWake = mergeWakeCapability(newWake: wake, existingWake: binding.wake)
        if let mergedWake,
           binding.wake != mergedWake
        {
            binding.wake = mergedWake
            changedFields.append("wake")
        }

        guard !changedFields.isEmpty else {
            if let wake {
                syncDiagnosticsLog(
                    "SyncEngine",
                    "binding metadata unchanged host=\(normalizedHost ?? "nil") \(wakeCapabilityLogSummary(wake))"
                )
            }
            return
        }

        do {
            try persistBinding(binding)
            syncDiagnosticsLog(
                "SyncEngine",
                "binding metadata refreshed fields=\(changedFields.joined(separator: ",")) serverName=\(binding.deviceName) \(wakeCapabilityLogSummary(binding.wake))"
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
        let retainSharedFilesTunnel = newState == .offline &&
            retainSharedFilesTunnelReachabilityForBindingOffline(reason: reason)
        slog("[SyncEngine] binding connection state %@ -> %@ (%@)",
              bindingConnectionState.rawValue,
              newState.rawValue,
              reason)
        syncDiagnosticsLog("SyncEngine", "binding connection state \(bindingConnectionState.rawValue) -> \(newState.rawValue) (\(reason))")
        bindingConnectionState = newState
        if newState == .offline && !retainSharedFilesTunnel {
            clearSharedFilesReachability(reason: "binding_state_offline")
        }
        emitBindingStateChanged()

        // Keep the standalone heartbeat timer in sync with connection state
        if newState == .connected || newState == .bound {
            cancelPresenceRecoveryProbe(reason: "state_\(newState.rawValue)")
            startPresenceHeartbeatTimer()
            if newState == .connected {
                startP2PTunnelIfNeeded(reason: "state_connected")
            }
        } else {
            stopPresenceHeartbeatTimer()
            if newState == .offline {
                if retainSharedFilesTunnel {
                    syncDiagnosticsLog(
                        "SharedFiles",
                        "retained P2P tunnel while binding offline (\(reason))"
                    )
                } else {
                    stopP2PTunnel(reason: "state_offline")
                }
            }
        }

    }

    private func retainSharedFilesTunnelReachabilityForBindingOffline(reason: String) -> Bool {
        let routeState = p2pTunnelQueue.sync {
            currentP2PTunnelRouteStateLocked()
        }
        let reachabilityState = sharedFilesReachabilityPayload?["state"] as? String
        let reachabilityRoute = sharedFilesReachabilityPayload?["route"] as? String
        guard SharedFilesRoutePolicy.shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
            reason: reason,
            reachabilityState: reachabilityState,
            reachabilityRoute: reachabilityRoute,
            isTunnelActive: routeState.isActive,
            isTunnelStarting: routeState.isStarting
        ) else {
            return false
        }
        let route = SharedFilesReachabilityRoute(rawValue: reachabilityRoute ?? "") ?? .tunnel
        updateSharedFilesReachability(
            .available,
            route: route,
            reason: "\(reason)_tunnel_retained"
        )
        return true
    }

    private func clearSharedFilesLANReachabilityOnPresenceRecoveryStart() {
        let reachabilityState = sharedFilesReachabilityPayload?["state"] as? String
        let reachabilityRoute = sharedFilesReachabilityPayload?["route"] as? String
        guard SharedFilesRoutePolicy.shouldClearLANReachabilityOnPresenceRecoveryStart(
            reachabilityState: reachabilityState,
            reachabilityRoute: reachabilityRoute
        ) else {
            return
        }
        clearSharedFilesReachability(reason: "presence_recovery_started_lan_unreachable")
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
        startP2PTunnelIfNeeded(reason: reason)
        emitBindingStateChanged()
    }

    func setTunnelCredentials(signalingURL: String, accessToken: String, iceServersJSON: String) {
        let trimmedURL = signalingURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedIceServersJSON = iceServersJSON.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedURL.isEmpty, !trimmedToken.isEmpty else {
            p2pTunnelQueue.async { [weak self] in
                guard let self else { return }
                self.p2pTunnelCredentials = nil
                self.stopP2PTunnelLocked(reason: "credentials_cleared")
                slog("[SyncEngine] tunnel credentials cleared")
                syncDiagnosticsLog("SyncEngine", "tunnel credentials cleared")
            }
            return
        }

        let credentials = P2PTunnelCredentials(
            signalingURL: trimmedURL,
            accessToken: trimmedToken,
            iceServersJSON: trimmedIceServersJSON
        )
        p2pTunnelQueue.async { [weak self] in
            guard let self else { return }
            let changed = self.p2pTunnelCredentials != credentials
            self.p2pTunnelCredentials = credentials
            if changed {
                self.stopP2PTunnelLocked(reason: "credentials_changed")
            }
            slog("[SyncEngine] setTunnelCredentials received signalingUrl=%@", trimmedURL)
            syncDiagnosticsLog("SyncEngine", "setTunnelCredentials received signalingUrl=\(trimmedURL)")
            if !trimmedIceServersJSON.isEmpty {
                syncDiagnosticsLog("SyncEngine", "setTunnelCredentials received ICE servers JSON")
            }
            self.startP2PTunnelIfNeededLocked(reason: "credentials_received")
        }
    }

    private func startP2PTunnelIfNeeded(reason: String) {
        p2pTunnelQueue.async { [weak self] in
            self?.startP2PTunnelIfNeededLocked(reason: reason)
        }
    }

    private func currentP2PTunnelRouteStateLocked() -> P2PTunnelRouteState {
        let port = sharedFilesService.tunnelPort
        return P2PTunnelRouteState(
            hasCredentials: p2pTunnelCredentials != nil,
            isActive: sharedFilesService.isTunnelActive && port != nil,
            isStarting: p2pTunnelStarting,
            port: port,
            selectedICERoute: localTCPProxy.currentSelectedICERoute(),
            routeMode: p2pTunnelRouteMode
        )
    }

    private func p2pTunnelRouteState(startReason: String?) async -> P2PTunnelRouteState {
        p2pTunnelQueue.sync {
            if let startReason {
                startP2PTunnelIfNeededLocked(reason: startReason)
            }
            return currentP2PTunnelRouteStateLocked()
        }
    }

    private func waitForP2PTunnelActive(
        reason: String,
        timeoutNanoseconds: UInt64 = UInt64(SharedFilesRoutePolicy.sharedFileTunnelRouteWaitTimeout * 1_000_000_000)
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(Double(timeoutNanoseconds) / 1_000_000_000)
        let pollIntervalNanoseconds: UInt64 = 500_000_000
        var attempt = 0
        var didLogWait = false

        while true {
            let startReason = attempt == 0 ? reason : "\(reason)_retry_\(attempt)"
            let state = await p2pTunnelRouteState(startReason: startReason)
            var isRouteAcceptable = false
            if state.isActive,
               await acceptedSharedFilesTunnelHost(
                   state: state,
                   hasReachableLANHost: false,
                   reason: reason
               ) != nil {
                isRouteAcceptable = true
                syncDiagnosticsLog(
                    "SharedFiles",
                    "P2P tunnel ready for shared files reason=\(reason) port=\(state.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(state.selectedICERoute)) attempts=\(attempt + 1)"
                )
                return true
            }

            guard SharedFilesRoutePolicy.shouldContinueWaitingForP2PTunnelRoute(
                hasTunnelCredentials: state.hasCredentials,
                isTunnelActive: state.isActive,
                isRouteAcceptable: isRouteAcceptable
            ) else {
                if !state.hasCredentials {
                    syncDiagnosticsLog(
                        "SharedFiles",
                        "P2P tunnel unavailable for shared files reason=\(reason); credentials missing"
                    )
                }
                return false
            }

            if Date() >= deadline {
                break
            }

            if !didLogWait {
                didLogWait = true
                updateSharedFilesReachability(
                    .unknown,
                    route: sharedFilesReachabilityRoute(forTunnelRouteMode: state.routeMode),
                    reason: "\(reason)_p2p_wait_started"
                )
                syncDiagnosticsLog(
                    "SharedFiles",
                    "waiting for P2P tunnel before shared files route reason=\(reason) routeMode=\(state.routeMode)"
                )
            }

            if state.isActive {
                await restartRejectedSharedFilesTunnel(
                    state: state,
                    reason: "\(reason)_wait_unacceptable_route_\(attempt)"
                )
            }

            let remaining = max(0, deadline.timeIntervalSinceNow)
            let sleepSeconds = min(remaining, Double(pollIntervalNanoseconds) / 1_000_000_000)
            if sleepSeconds > 0 {
                try? await Task.sleep(nanoseconds: UInt64(sleepSeconds * 1_000_000_000))
            }
            attempt += 1
        }

        var finalState = await p2pTunnelRouteState(startReason: nil)
        if finalState.isActive,
           await acceptedSharedFilesTunnelHost(
               state: finalState,
               hasReachableLANHost: false,
               reason: "\(reason)_deadline"
           ) != nil {
            syncDiagnosticsLog(
                "SharedFiles",
                "P2P tunnel became ready at wait deadline reason=\(reason) port=\(finalState.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(finalState.selectedICERoute))"
            )
            return true
        }

        while finalState.hasCredentials,
              !finalState.isActive,
              let nextRouteMode = SharedFilesRoutePolicy.nextP2PTunnelRouteModeAfterStartupTimeout(
                  currentRouteMode: finalState.routeMode
              ) {
            updateSharedFilesReachability(
                .unknown,
                route: sharedFilesReachabilityRoute(forTunnelRouteMode: nextRouteMode),
                reason: "\(reason)_startup_timeout_retry_\(nextRouteMode)"
            )
            syncDiagnosticsLog(
                "SharedFiles",
                "advancing P2P tunnel route mode after startup timeout reason=\(reason) \(finalState.routeMode)->\(nextRouteMode) active=\(finalState.isActive) port=\(finalState.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(finalState.selectedICERoute))"
            )
            await restartP2PTunnelAndWait(
                reason: "\(reason)_startup_timeout_retry_\(nextRouteMode)",
                routeMode: nextRouteMode
            )
            finalState = await p2pTunnelRouteState(startReason: nil)
            if finalState.isActive,
               await acceptedSharedFilesTunnelHost(
                   state: finalState,
                   hasReachableLANHost: false,
                   reason: "\(reason)_startup_timeout_retry_\(nextRouteMode)_ready"
               ) != nil {
                syncDiagnosticsLog(
                    "SharedFiles",
                    "P2P tunnel ready after startup timeout retry reason=\(reason) routeMode=\(nextRouteMode) port=\(finalState.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(finalState.selectedICERoute))"
                )
                return true
            }
        }

        syncDiagnosticsLog(
            "SharedFiles",
            "P2P tunnel wait timed out for shared files reason=\(reason) hasCredentials=\(finalState.hasCredentials) active=\(finalState.isActive) port=\(finalState.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(finalState.selectedICERoute))"
        )
        return false
    }

    private func startP2PTunnelIfNeededLocked(reason: String) {
        guard let credentials = p2pTunnelCredentials else {
            syncDiagnosticsLog("SyncEngine", "P2P tunnel skipped: credentials missing (\(reason))")
            return
        }
        if p2pTunnelStarting { return }
        if sharedFilesService.isTunnelActive, sharedFilesService.tunnelPort != nil {
            syncDiagnosticsLog(
                "SyncEngine",
                "P2P tunnel start skipped: already active reason=\(reason) port=\(sharedFilesService.tunnelPort.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(localTCPProxy.currentSelectedICERoute()))"
            )
            return
        }

        guard let binding = uploadStore?.getBinding() else {
            syncDiagnosticsLog("SyncEngine", "P2P tunnel skipped: no bound desktop (\(reason))")
            return
        }
        guard let pairingToken = resolvedPairingToken(for: binding),
              !pairingToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            syncDiagnosticsLog("SyncEngine", "P2P tunnel skipped: pairing token missing target=\(binding.deviceId)")
            return
        }

        let clientId = bindingService.getOrCreateClientId()
        let generation = p2pTunnelGeneration
        p2pTunnelStarting = true
        syncDiagnosticsLog(
            "SyncEngine",
            "P2P tunnel starting target=\(binding.deviceId) reason=\(reason) routeMode=\(p2pTunnelRouteMode) networkPath=\(SharedFilesRoutePolicy.diagnosticNetworkPathSummary(NetworkPathObserver.shared.snapshot()))"
        )
        let iceServersJSON = SharedFilesRoutePolicy.tunnelOptionsJSON(
            iceServersJSON: credentials.iceServersJSON,
            routeMode: p2pTunnelRouteMode
        )
        let port = localTCPProxy.start(
            signalingURL: credentials.signalingURL,
            clientID: clientId,
            targetClientID: binding.deviceId,
            token: credentials.accessToken,
            pairingToken: pairingToken,
            iceServersJSON: iceServersJSON
        )

        let shouldCommit = generation == p2pTunnelGeneration && p2pTunnelCredentials == credentials
        if shouldCommit, port > 0, port <= Int(UInt16.max) {
            sharedFilesService.tunnelPort = UInt16(port)
            sharedFilesService.isTunnelActive = true
            p2pTunnelStarting = false
            syncDiagnosticsLog("SyncEngine", "P2P tunnel active on local port \(port) selectedRoute=\(normalizedICERouteLabel(localTCPProxy.currentSelectedICERoute()))")
            return
        }

        if port > 0 {
            localTCPProxy.stop()
        }
        if shouldCommit {
            let failedRouteMode = p2pTunnelRouteMode
            let nextRouteMode = SharedFilesRoutePolicy.storedP2PTunnelRouteModeAfterStartFailure(
                currentRouteMode: failedRouteMode
            )
            p2pTunnelRouteMode = nextRouteMode
            sharedFilesService.tunnelPort = nil
            sharedFilesService.isTunnelActive = false
            syncDiagnosticsLog(
                "SyncEngine",
                "P2P tunnel failed to start routeMode=\(failedRouteMode), fallback to route selection nextRouteMode=\(nextRouteMode)"
            )
        }
        p2pTunnelStarting = false
    }

    private func stopP2PTunnel(reason: String) {
        p2pTunnelQueue.async { [weak self] in
            self?.stopP2PTunnelLocked(reason: reason)
        }
    }

    private func stopP2PTunnelLocked(reason: String) {
        p2pTunnelGeneration += 1
        p2pTunnelStarting = false
        p2pTunnelRouteMode = SharedFilesRoutePolicy.p2pTunnelRouteModeAll
        sharedFilesService.tunnelPort = nil
        sharedFilesService.isTunnelActive = false
        sharedFilesService.useTunnelRoute = false
        localTCPProxy.stop()
        syncDiagnosticsLog("SyncEngine", "P2P tunnel stopped (\(reason))")
    }

    private func restartP2PTunnel(reason: String) {
        p2pTunnelQueue.async { [weak self] in
            guard let self else { return }
            self.restartP2PTunnelLocked(reason: reason)
        }
    }

    private func restartP2PTunnelAndWait(reason: String, routeMode: String? = nil) async {
        p2pTunnelQueue.sync {
            if let routeMode {
                p2pTunnelRouteMode = routeMode
            }
            restartP2PTunnelLocked(reason: reason)
        }
    }

    private func restartP2PTunnelLocked(reason: String) {
        syncDiagnosticsLog("SyncEngine", "P2P tunnel restarting (\(reason))")
        let routeMode = p2pTunnelRouteMode
        stopP2PTunnelLocked(reason: reason)
        p2pTunnelRouteMode = routeMode
        startP2PTunnelIfNeededLocked(reason: "\(reason)_restart")
    }

    private func beginSharedFileTunnelOperation(
        path: String,
        reason: String,
        isTunnelRoute: Bool
    ) -> Bool {
        guard isTunnelRoute else { return false }

        sharedFileTunnelOperationLock.lock()
        activeSharedFileTunnelOperations += 1
        let active = activeSharedFileTunnelOperations
        sharedFileTunnelOperationLock.unlock()

        syncDiagnosticsLog(
            "SharedFiles",
            "shared file tunnel operation began reason=\(reason) path=\(path) active=\(active)"
        )
        return true
    }

    private func endSharedFileTunnelOperation(
        path: String,
        reason: String,
        didBegin: Bool
    ) {
        guard didBegin else { return }

        sharedFileTunnelOperationLock.lock()
        activeSharedFileTunnelOperations = max(0, activeSharedFileTunnelOperations - 1)
        lastSharedFileTunnelOperationEndedAt = Date().timeIntervalSinceReferenceDate
        let active = activeSharedFileTunnelOperations
        sharedFileTunnelOperationLock.unlock()

        syncDiagnosticsLog(
            "SharedFiles",
            "shared file tunnel operation ended reason=\(reason) path=\(path) active=\(active)"
        )
    }

    private func currentSharedFileTunnelOperationState() -> (
        activeOperations: Int,
        secondsSinceLastOperation: TimeInterval?
    ) {
        sharedFileTunnelOperationLock.lock()
        defer { sharedFileTunnelOperationLock.unlock() }
        let secondsSinceLastOperation = lastSharedFileTunnelOperationEndedAt.map {
            Date().timeIntervalSinceReferenceDate - $0
        }
        return (activeSharedFileTunnelOperations, secondsSinceLastOperation)
    }

    private func withSharedFileTunnelOperation<T>(
        path: String,
        reason: String,
        isTunnelRoute: Bool,
        _ operation: () async throws -> T
    ) async throws -> T {
        let didBegin = beginSharedFileTunnelOperation(
            path: path,
            reason: reason,
            isTunnelRoute: isTunnelRoute
        )
        defer {
            endSharedFileTunnelOperation(
                path: path,
                reason: reason,
                didBegin: didBegin
            )
        }
        return try await operation()
    }

    // MARK: - Standalone Presence Heartbeat Timer

    /// Runs independently of the sync pipeline so we detect desktop disappearance
    /// even when no upload is in progress.
    private func startPresenceHeartbeatTimer() {
        stopPresenceHeartbeatTimer()
        guard uploadStore?.getBinding() != nil else { return }
        let clientId = bindingService.getOrCreateClientId()
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        timer.schedule(deadline: .now() + 2, repeating: 30, leeway: .seconds(5))
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            // Skip if sync pipeline is running — it has its own heartbeat loop
            guard !self.isSyncing else { return }
            self.startP2PTunnelIfNeeded(reason: "presence_heartbeat_timer")
            // A single HTTP timeout on the presence port can be a transient Wi-Fi
            // hiccup; the DiscoveryService's TCP probe on the protocol port often
            // still sees the desktop. Don't flip the UI to offline on one miss —
            // suppress the direct state update and hand off to the retry probe,
            // which only marks offline after presence_recovery_exhausted.
            self.sendPresenceHeartbeat(
                clientId: clientId,
                updateStateOnFailure: false
            ) { [weak self] success in
                guard let self = self, !success else { return }
                self.startPresenceRecoveryProbe(clientId: clientId)
            }
        }
        timer.resume()
        presenceHeartbeatTimer = timer
        slog("[SyncEngine] standalone presence heartbeat timer started")
        syncDiagnosticsLog("SyncEngine", "standalone presence heartbeat timer started")
    }

    private func stopPresenceHeartbeatTimer() {
        if let timer = presenceHeartbeatTimer {
            timer.cancel()
            presenceHeartbeatTimer = nil
            slog("[SyncEngine] standalone presence heartbeat timer stopped")
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

    private func currentPresenceHeartbeatHost() -> String? {
        if let resolved = sidecarHost, !resolved.isEmpty {
            return resolved
        }
        if let fallback = uploadStore?.getBinding()?.host, !fallback.isEmpty {
            return fallback
        }
        return nil
    }

    private func startPresenceRecoveryProbe(
        clientId: String,
        maxAttempts: Int? = nil,
        retryInterval: TimeInterval? = nil,
        promoteOfflineToConnecting: Bool = false,
        delayedProbe: Bool = false
    ) {
        let maxAttempts = maxAttempts ?? presenceRecoveryMaxAttempts
        let retryInterval = retryInterval ?? presenceRecoveryRetryInterval
        if !delayedProbe {
            presenceDelayedRecoveryProbeFailures = 0
        }
        cancelPresenceRecoveryProbe(reason: "start_new_probe")
        clearSharedFilesLANReachabilityOnPresenceRecoveryStart()
        if bindingConnectionState != .offline || promoteOfflineToConnecting {
            updateBindingConnectionState(.connecting, reason: "presence_recovery_started")
        } else {
            syncDiagnosticsLog("SyncEngine", "presence recovery started while already offline; keeping offline state")
        }
        publishSharedFilesP2PReachabilityAfterLANFailure(reason: "presence_recovery_started")

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
            token: token,
            delayedProbe: delayedProbe
        )
    }

    private func performPresenceRecoveryProbe(
        clientId: String,
        attempt: Int,
        maxAttempts: Int,
        retryInterval: TimeInterval,
        token: UUID,
        delayedProbe: Bool
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

            if success {
                // A successful heartbeat transitions binding state to connected,
                // and that transition cancels the recovery probe/token. Treat
                // the success callback as authoritative so recovery can resume
                // pending uploads after desktop relaunch.
                self.presenceDelayedRecoveryProbeFailures = 0
                self.cancelPresenceRecoveryProbe(reason: "heartbeat_succeeded")
                self.resumeSyncAfterConnectionRecovery(reason: "presence_recovery_succeeded")
                return
            }

            guard token == self.currentPresenceRecoveryToken() else { return }

            guard attempt < maxAttempts else {
                if delayedProbe {
                    self.presenceDelayedRecoveryProbeFailures += 1
                }
                self.cancelPresenceRecoveryProbe(reason: "exhausted")
                self.updateBindingConnectionState(.offline, reason: "presence_recovery_exhausted")
                self.restartDiscoveryAfterPresenceRecoveryExhausted()
                return
            }

            let workItem = DispatchWorkItem { [weak self] in
                self?.performPresenceRecoveryProbe(
                    clientId: clientId,
                    attempt: attempt + 1,
                    maxAttempts: maxAttempts,
                    retryInterval: retryInterval,
                    token: token,
                    delayedProbe: delayedProbe
                )
            }
            self.setPresenceRecoveryWorkItem(workItem)
            self.presenceRecoveryQueue.asyncAfter(deadline: .now() + retryInterval, execute: workItem)
        }
    }

    private func resumeSyncAfterConnectionRecovery(reason: String) {
        let configState = autoUploadConfigStore?.getConfig().state ?? "disabled"
        let pendingCounts = uploadStore?.getPendingCountsBySource() ?? (auto: 0, manual: 0)
        let shouldResume = configState == "active" || pendingCounts.manual > 0

        guard shouldResume else {
            syncDiagnosticsLog(
                "SyncEngine",
                "connection recovery did not resume sync (\(reason)) auto=\(configState) pending(manual=\(pendingCounts.manual) auto=\(pendingCounts.auto))"
            )
            return
        }

        if isSyncing && sessionService.state == .pausedNoTarget {
            syncDiagnosticsLog(
                "SyncEngine",
                "connection recovery correcting stale syncing flag before resume (\(reason))"
            )
            isSyncing = false
        }

        syncDiagnosticsLog(
            "SyncEngine",
            "connection recovery resuming sync (\(reason)) auto=\(configState) pending(manual=\(pendingCounts.manual) auto=\(pendingCounts.auto)) isSyncing=\(isSyncing) session=\(sessionService.state.rawValue)"
        )
        startSync()
    }

    private func restartDiscoveryAfterPresenceRecoveryExhausted() {
        guard let binding = uploadStore?.getBinding() else { return }
        guard bindingConnectionState == .offline else { return }

        if discoveryService.isBrowsing {
            syncDiagnosticsLog(
                "DiscoveryService",
                "presence recovery exhausted; discovery already browsing deviceId=\(binding.deviceId)"
            )
            scheduleDelayedPresenceRecoveryProbeAfterExhaustion(binding: binding)
            return
        }

        discoveryService.startBrowsing()
        syncDiagnosticsLog(
            "DiscoveryService",
            "presence recovery exhausted restarted discovery deviceId=\(binding.deviceId)"
        )
    }

    private func probeBoundDesktopIfDiscoveryAlreadyBrowsing(reason: String) -> Bool {
        let binding = uploadStore?.getBinding()
        let host = currentPresenceHeartbeatHost()
        guard PresenceReconnectPolicy.shouldProbeWhenDiscoveryAlreadyBrowsing(
            hasBinding: binding != nil,
            isDiscoveryBrowsing: discoveryService.isBrowsing,
            bindingState: bindingConnectionState.rawValue,
            presenceHost: host
        ) else {
            return false
        }

        guard let binding else { return false }
        syncDiagnosticsLog(
            "SyncEngine",
            "probing bound desktop while discovery already browsing reason=\(reason) deviceId=\(binding.deviceId) host=\(host ?? "nil")"
        )
        let clientId = bindingService.getOrCreateClientId()
        startPresenceRecoveryProbe(clientId: clientId, promoteOfflineToConnecting: true)
        return true
    }

    private func scheduleDelayedPresenceRecoveryProbeAfterExhaustion(binding: BindingRecord) {
        let host = currentPresenceHeartbeatHost()
        guard PresenceReconnectPolicy.shouldScheduleDelayedProbeAfterRecoveryExhausted(
            hasBinding: true,
            isDiscoveryBrowsing: discoveryService.isBrowsing,
            bindingState: bindingConnectionState.rawValue,
            presenceHost: host
        ) else {
            return
        }

        let clientId = bindingService.getOrCreateClientId()
        let delay = PresenceReconnectPolicy.delayedProbeIntervalAfterRecoveryExhausted(
            consecutiveDelayedProbeFailures: presenceDelayedRecoveryProbeFailures
        )
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let currentBinding = self.uploadStore?.getBinding()
            guard currentBinding?.deviceId == binding.deviceId else { return }
            guard PresenceReconnectPolicy.shouldScheduleDelayedProbeAfterRecoveryExhausted(
                hasBinding: currentBinding != nil,
                isDiscoveryBrowsing: self.discoveryService.isBrowsing,
                bindingState: self.bindingConnectionState.rawValue,
                presenceHost: self.currentPresenceHeartbeatHost()
            ) else {
                return
            }
            syncDiagnosticsLog(
                "SyncEngine",
                "presence recovery delayed LAN probe starting deviceId=\(binding.deviceId)"
            )
            self.startPresenceRecoveryProbe(
                clientId: clientId,
                maxAttempts: 1,
                retryInterval: self.presenceRecoveryRetryInterval,
                promoteOfflineToConnecting: false,
                delayedProbe: true
            )
        }
        setPresenceRecoveryWorkItem(workItem)
        presenceRecoveryQueue.asyncAfter(deadline: .now() + delay, execute: workItem)
        syncDiagnosticsLog(
            "SyncEngine",
            "presence recovery delayed LAN probe scheduled deviceId=\(binding.deviceId) delay=\(delay)s failures=\(presenceDelayedRecoveryProbeFailures)"
        )
    }

    private func verifyPresenceWithRecovery(
        clientId: String,
        successReason: String = "presence_heartbeat_succeeded",
        failureReason: String = "presence_heartbeat_failed"
    ) {
        let expectedHost = currentPresenceHeartbeatHost()
        sendPresenceHeartbeat(
            clientId: clientId,
            successReason: successReason,
            failureReason: failureReason,
            updateStateOnFailure: false
        ) { [weak self] success in
            guard let self = self, !success else { return }
            let currentHost = self.currentPresenceHeartbeatHost()
            if currentHost != expectedHost {
                syncDiagnosticsLog(
                    "SyncEngine",
                    "presence heartbeat result ignored because host changed \(expectedHost ?? "nil") -> \(currentHost ?? "nil")"
                )
                return
            }
            self.startPresenceRecoveryProbe(clientId: clientId)
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
        return bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
    }

    private func currentClientIPv4() -> String? {
        return syncFlowPreferredClientIPv4()
    }

    private func defaultClientDisplayName() -> String {
        let rawName = UIDevice.current.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let model = UIDevice.current.model.trimmingCharacters(in: .whitespacesAndNewlines)
        return syncFlowResolvedDefaultClientDisplayName(
            rawName: rawName,
            model: model
        )
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
            "stableDeviceId": bindingService.getOrCreateStableDeviceId(),
            "clientName": getClientDisplayName(),
            "clientPlatform": "ios",
            "appVersion": currentAppVersionLabel(),
            "appCompatibilityVersion": syncFlowAppCompatibilityVersion,
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

    private func structuredPairingErrorCode(_ rawCode: Any?) -> String? {
        guard let code = (rawCode as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !code.isEmpty else {
            return nil
        }
        let stableCodes: Set<String> = [
            "PAIRING_CODE_INVALID",
            "PAIRING_CLIENT_BLOCKED",
            "PAIR_TOKEN_INVALID",
            "APP_VERSION_INCOMPATIBLE",
        ]
        return stableCodes.contains(code) ? code : nil
    }

    private func pairingErrorMetadata(_ rawMeta: Any?) -> [String: Any]? {
        if let meta = rawMeta as? [String: Any] {
            return meta
        }
        if let meta = rawMeta as? NSDictionary {
            var result: [String: Any] = [:]
            for (key, value) in meta {
                guard let key = key as? String else { continue }
                result[key] = value
            }
            return result.isEmpty ? nil : result
        }
        return nil
    }

    private func defaultPairingErrorMessage(code: String) -> String {
        switch code {
        case "PAIRING_CODE_INVALID":
            return "連接碼錯誤，請重新輸入"
        case "PAIRING_CLIENT_BLOCKED":
            return "這支手機已被此電腦封鎖，請在桌面端設定解除封鎖後再試。"
        case "PAIR_TOKEN_INVALID":
            return "連線授權已失效，請重新輸入桌面端連接碼。"
        case "APP_VERSION_INCOMPATIBLE":
            return "手機與桌面 App 版本不相容，請同時更新兩端後再連線。"
        default:
            return "Pairing rejected"
        }
    }

    private func structuredPairingError(
        code: String,
        rawMessage: String,
        meta: [String: Any]?
    ) -> SyncEngineError {
        let message = rawMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        return .structuredPairingError(
            code: code,
            message: message.isEmpty ? defaultPairingErrorMessage(code: code) : message,
            meta: meta
        )
    }

    private func throwIfHelloErrorFrame(type: LMUPMessageType, payload: [String: Any]) throws {
        guard type == .error else { return }
        let rawCode = (payload["code"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let rawMessage = (payload["message"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let message = rawMessage.isEmpty ? "Desktop returned protocol error" : rawMessage
        if let code = structuredPairingErrorCode(rawCode) {
            throw structuredPairingError(
                code: code,
                rawMessage: message,
                meta: pairingErrorMetadata(payload["meta"])
            )
        }
        throw SyncEngineError.networkError(rawCode.isEmpty ? message : "\(rawCode): \(message)")
    }

    private func throwIfIncompatibleDesktopAppVersion(payload: [String: Any]) throws {
        let serverCompatibilityVersion: Int?
        if let value = payload["appCompatibilityVersion"] as? Int {
            serverCompatibilityVersion = value
        } else if let value = payload["appCompatibilityVersion"] as? NSNumber {
            serverCompatibilityVersion = value.intValue
        } else {
            serverCompatibilityVersion = nil
        }

        guard serverCompatibilityVersion == syncFlowAppCompatibilityVersion else {
            throw structuredPairingError(
                code: "APP_VERSION_INCOMPATIBLE",
                rawMessage: "手機與桌面 App 版本不相容，請同時更新兩端後再連線。",
                meta: nil
            )
        }
    }

    private func wakeCapability(fromHelloPayload payload: [String: Any]) -> WakeCapability? {
        let capabilities = payload["serverCapabilities"] as? [String: Any]
        return WakeCapability.fromJSONValue(capabilities?["wake"])
     }

    private func mergeWakeCapability(newWake: WakeCapability?, existingWake: WakeCapability?) -> WakeCapability? {
        return WakeCapability.merge(newWake: newWake, existingWake: existingWake)
    }

    private func wakeCapabilityLogSummary(_ wake: WakeCapability?) -> String {
        guard let wake else {
            return "wake=nil"
        }
        let usableTargets = WakeOnLanService.validTargets(wake.targets).count
        return "wakeSupported=\(wake.supported) wakeTargets=\(wake.targets.count) wakeUsableTargets=\(usableTargets)"
    }

    private func desktopPowerLogSummary(_ power: DesktopPowerSnapshot?) -> String {
        guard let power else {
            return "power=nil"
        }
        let lastResume = power.lastResumeAt.map { ISO8601DateFormatter().string(from: $0) } ?? "nil"
        return "powerState=\(power.state ?? "nil") lastResumeAt=\(lastResume)"
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
                try self.throwIfHelloErrorFrame(type: helloType, payload: helloRes)
                guard helloType == .helloRes else {
                    return
                }
                try self.throwIfIncompatibleDesktopAppVersion(payload: helloRes)
                if let nonce = helloRes["nonce"] as? String {
                    let hmac = transport.computeHMAC(token: token, nonce: nonce)
                    let _ = try? await session.sendAndReceive(type: .authReq, payload: [
                        "clientId": clientId,
                        "auth": hmac,
                    ])
                }
                slog("[SyncEngine] pushed client metadata update to sidecar")
                syncDiagnosticsLog("SyncEngine", "pushed client metadata update to sidecar")
            } catch {
                slog("[SyncEngine] metadata refresh skipped: %@", "\(error)")
                syncDiagnosticsLog("SyncEngine", "metadata refresh skipped: \(error)")
            }
        }
    }

    // MARK: - Background upload wiring (Phase 5)

    /// Called from AppDelegate.didFinishLaunchingWithOptions to wire the
    /// BackgroundUploadService with the stores/services it needs. Safe to
    /// call repeatedly — iOS may cold-relaunch purely to deliver URLSession
    /// events and we want the delegate callbacks to land on fully-wired
    /// collaborators.
    func configureBackgroundUploadService() {
        guard let uploadStore = uploadStore, let historyStore = historyStore else {
            slog("[SyncEngine] configureBackgroundUploadService: stores not ready")
            return
        }
        backgroundUploadService.configureBackgroundUploadService(
            uploadStore: uploadStore,
            historyStore: historyStore,
            bindingService: bindingService,
            exportService: exportService
        )
        backgroundUploadService.syncEngineManager = self
        slog("[SyncEngine] configureBackgroundUploadService: wired")
    }

    // MARK: - Background task accessors (Phase 6)

    /// Upload store handle exposed to BackgroundExecutionService so the
    /// background task handlers can fall back to last_known_binding when
    /// `currentBinding` is not yet populated (cold relaunch for URLSession
    /// events).
    var uploadStoreForBackground: UploadStore? { uploadStore }

    /// Run an incremental photo scan suitable for the BGProcessing task
    /// context. Unlike `scheduleIncrementalQueueRescan`, this bypasses the
    /// `isSyncing` guard (background tasks don't go through startSync) and
    /// still respects the thermal / backgrounded defer rules.
    func performIncrementalPhotoScanIfBackgrounded() async {
        guard let _ = uploadStore else { return }
        let autoUploadActive = autoUploadConfigStore?.getConfig().state == "active"
        guard autoUploadActive else {
            NSLog("[SyncEngine] background task: skipping scan — auto upload not active")
            return
        }
        let thermal = ProcessInfo.processInfo.thermalState
        if thermal == .serious || thermal == .critical {
            NSLog("[SyncEngine] background task: skipping scan — thermal %@", thermalStateLabel(thermal))
            return
        }
        performIncrementalQueueRescanForBackgroundTask()
    }

    private func performIncrementalQueueRescanForBackgroundTask() {
        guard let store = uploadStore else { return }
        let clientId = bindingService.getOrCreateClientId()
        let trackedFileKeys = Set(store.getAutoDiscoveryTrackedFileKeys())
        guard let deltaResults = photoScanner.scanChangedAssets(
            clientId: clientId,
            trackedFileKeys: trackedFileKeys
        ) else {
            return
        }
        if deltaResults.isEmpty { return }
        NSLog("[SyncEngine] background task: delta scan found %d new assets", deltaResults.count)
        let now = ISO8601DateFormatter().string(from: Date())
        let queuedItems = deltaResults.compactMap { asset -> UploadItemRecord? in
            guard let photoAsset = asset.asset else { return nil }
            return UploadItemRecord(
                id: nil,
                assetLocalId: photoAsset.localIdentifier,
                modifiedAt: photoAsset.modificationDate?.iso8601String ?? "",
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
        }
        try? store.upsertUploadItems(queuedItems)
    }

    // MARK: - Cross-protocol reset (DELETE /upload/<cid>/<fkey>)

    /// T6 / M9 — the underlying enum + decision helper live in
    /// `UploadResetStateMachine.swift` (module-level, Foundation-only)
    /// so the state machine can be linked into test harnesses without
    /// dragging UIKit/Photos. Re-export the nested-style names so
    /// existing call sites like `SyncEngineManager.UploadResetResult`
    /// keep compiling by aliasing to the top-level types in this
    /// module.
    typealias UploadResetResult = UploadResetResultT6
    typealias CrossProtocolResetDecision = CrossProtocolResetDecisionT6
    static func decideCrossProtocolReset(_ result: UploadResetResult) -> CrossProtocolResetDecision {
        return decideCrossProtocolResetT6(result)
    }

    private lazy var resetUploadSession: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = Self.crossProtocolResetDeleteTimeoutSeconds
        cfg.timeoutIntervalForResource = Self.crossProtocolResetDeleteTimeoutSeconds
        cfg.waitsForConnectivity = false
        cfg.allowsCellularAccess = true
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: cfg)
    }()

    /// Issue `DELETE /upload/<clientId>/<fileKey>` against the sidecar with
    /// HMAC auth so a row that was last transported via HTTP can be safely
    /// re-opened on the TCP path. This is the cross-protocol handshake: the
    /// sidecar's .part file and committed_bytes are cleared before the TCP
    /// pipeline re-sends FILE_DATA from offset 0.
    ///
    /// Returns:
    ///   - `.reset`          — 200, rows/part cleared
    ///   - `.notFound`       — 404, already clean, proceed
    ///   - `.concurrentTransfer` — 409, another protocol owns the slot
    ///   - `.failed`         — any network / status error (caller should bail)
    private func sidecarResetUpload(
        host: String,
        port: Int,
        clientId: String,
        fileKey: String,
        pairingToken: String
    ) async -> UploadResetResult {
        let scheme = "http"
        let path = "/upload/\(clientId)/\(fileKey)"
        let hostPart = host.contains(":") ? "[\(host)]" : host
        guard let url = URL(string: "\(scheme)://\(hostPart):\(port)\(path)") else {
            return .unknown("invalid_url")
        }

        let timestamp = String(Int64(Date().timeIntervalSince1970))
        let nonce = HMACAuthHelper.randomHexNonce()
        let canonical = HMACAuthHelper.canonicalDELETE(
            path: path,
            clientId: clientId,
            fileKey: fileKey,
            timestamp: timestamp,
            nonce: nonce
        )
        let signature = HMACAuthHelper.hmacSHA256Hex(
            pairingToken: pairingToken,
            canonical: canonical
        )

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue(clientId, forHTTPHeaderField: "X-SyncFlow-Client-Id")
        request.setValue(fileKey, forHTTPHeaderField: "X-SyncFlow-File-Key")
        request.setValue(timestamp, forHTTPHeaderField: "X-SyncFlow-Auth-Timestamp")
        request.setValue(nonce, forHTTPHeaderField: "X-SyncFlow-Auth-Nonce")
        request.setValue(signature, forHTTPHeaderField: "X-SyncFlow-Auth")

        do {
            let (data, response) = try await resetUploadSession.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .unknown("non_http_response")
            }
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            switch http.statusCode {
            case 200:
                return .reset
            case 404:
                return .notFound
            case 409:
                let via = (body?["activeProtocol"] as? String) ?? "unknown"
                return .concurrentTransfer(via: via)
            case 500...599:
                return .serverError(http.statusCode)
            default:
                let status = (body?["status"] as? String) ?? "http_\(http.statusCode)"
                return .unknown(status)
            }
        } catch {
            // M9: classify transport-level errors into timeout vs generic
            // network failure so callers / logs can treat retry budgets
            // differently.
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorTimedOut {
                return .timeout
            }
            if nsError.domain == NSURLErrorDomain {
                return .networkError("\(nsError.code):\(nsError.localizedDescription)")
            }
            // M9: non-NSURLError catches fall through to .unknown — they're
            // not transport-layer failures (those hit the branches above),
            // so classifying them as .networkError would mislead retry logic.
            return .unknown("\(error)")
        }
    }

    /// Persist a binding through UploadStore + last_known_binding snapshot
    /// and update the in-memory `currentBinding` mirror. Single choke point
    /// so the background upload pipeline can always resolve the latest
    /// binding even immediately after pairing and before SQLite has caught
    /// up.
    private func persistBinding(_ binding: BindingRecord) throws {
        try uploadStore?.saveBinding(binding)
        if let sharedFilesDeviceId = sharedFilesReachabilityPayload?["deviceId"] as? String,
           sharedFilesDeviceId != binding.deviceId {
            clearSharedFilesReachability(reason: "binding_changed")
        }
        let stored = StoredBinding(
            serverId: binding.deviceId,
            sidecarHost: binding.host,
            port: binding.port,
            pairingTokenKeychainRef: binding.pairingTokenKeychainRef
        )
        currentBinding = stored
        // Best-effort — last_known_binding is a cache; a write failure just
        // means we fall back to the SQLite binding row on cold relaunch.
        do {
            try uploadStore?.updateLastKnownBinding(stored)
        } catch {
            NSLog("[SyncEngine] updateLastKnownBinding failed: %@", "\(error)")
        }
        // H2 — bump the monotonic binding version so any background
        // URLSession task enqueued after this point carries the new
        // version and any in-flight callback from the previous binding
        // fails the `applyBackgroundCompletion` predicate. Best-effort:
        // a nil return just means no upload store was wired yet (tests).
        if let newVersion = bindingService.bumpBindingVersion() {
            NSLog("[SyncEngine] bindingVersion bumped to %d (persistBinding)", newVersion)
        }
        // H8 Phase 2 (L805-830): a successful re-pair is the only legitimate
        // exit from `needs_repair=true`. Clear the flag + reason only on the
        // actual true→false transition so we don't persist a no-op write and
        // emit a no-op event on every initial pair. The emit is likewise
        // gated — RN's reducer memoises on value equality so a redundant
        // event is harmless, but emitting only on real transitions keeps
        // the native → RN channel noise-free and easier to trace.
        let previousRepair = uploadStore?.getNeedsRepair()
        if previousRepair?.flag == true {
            do {
                try uploadStore?.setNeedsRepair(value: false, reason: nil)
            } catch {
                NSLog("[SyncEngine] clearNeedsRepair (persistBinding) failed: %@", "\(error)")
            }
            NativeSyncEngineModule.shared?.emitRepairStateChanged(
                needsRepair: false,
                reason: nil
            )
        }
    }

    /// Refresh `currentBinding` from the authoritative store. Used after
    /// init and from code paths that go straight to `uploadStore.saveBinding`.
    private func refreshCurrentBindingFromStore() {
        guard let binding = uploadStore?.getBinding(),
              !binding.deviceId.isEmpty else {
            return
        }
        currentBinding = StoredBinding(
            serverId: binding.deviceId,
            sidecarHost: binding.host,
            port: binding.port,
            pairingTokenKeychainRef: binding.pairingTokenKeychainRef
        )
    }

    /// M8 — ref-counted begin. Each call increments the refcount; the
    /// first call acquires the physical UIApplication background task
    /// assertion, subsequent calls are pure increments. Nested callers
    /// (e.g. outer `appDidEnterBackground` + inner
    /// `transitionToBackgroundUpload`) can safely pair begin/end
    /// independently without the inner `end` releasing the outer caller's
    /// assertion. Delegates to `BackgroundTransitionRefCount` (FU5).
    private func beginBackgroundTransitionIfNeeded(reason: String) {
        backgroundTransitionRefCount.begin(reason: reason)
    }

    /// M8 — force-release used by terminal cleanup paths
    /// (stopSyncLifecycle / disconnectAndUnbind / wipeSyncIdentity /
    /// willEnterForeground) that must guarantee the UIApplication
    /// background task is gone no matter what. Clamps the refcount to 0
    /// and releases the physical assertion if any was held. Counterpart
    /// to `endBackgroundTransitionIfNeeded` for sites that historically
    /// relied on the bool-gate semantics "end always wins".
    private func forceEndBackgroundTransition(reason: String) {
        backgroundTransitionRefCount.forceEnd(reason: reason)
    }

    /// M8 — ref-counted end. Decrements the refcount; only releases the
    /// physical UIApplication background task when the count hits zero.
    /// Extra `end` calls (refcount already at zero) are ignored so a
    /// stray double-end can never release a live assertion the outer
    /// caller still needs.
    private func endBackgroundTransitionIfNeeded(reason: String) {
        backgroundTransitionRefCount.end(reason: reason)
    }

    private func stopSyncLifecycle(finalState: SessionService.SyncEngineState) {
        isSyncing = false
        shouldAbortActiveAutoUpload = false
        shouldAbortActiveManualUpload = false
        shouldAbortActiveUploadForBindingChange = false
        didAttemptRemoteHistoryReconciliation = false
        // M8: terminal lifecycle — force-release so any dangling refcount
        // from a backgrounded transition is cleared alongside the sync
        // session.
        forceEndBackgroundTransition(reason: "syncStopped")
        sessionService.endSession(transitionTo: finalState)
    }

    private func interruptActiveSyncForBindingChange(reason: String, interruptCurrentSession: Bool = true) {
        guard isSyncing else { return }

        shouldAbortActiveUploadForBindingChange = true
        photoLibraryChanged = true
        slog("[SyncEngine] interrupting active sync because binding changed: %@", reason)
        syncDiagnosticsLog("SyncEngine", "interrupting active sync because binding changed: \(reason)")
        if interruptCurrentSession {
            interruptActiveUploadResponse(error: SyncEngineError.bindingChanged, reason: reason)
        }
        resumeWatchLoopIfNeeded()
    }

    private func interruptActiveUploadResponse(error: Error, reason: String) {
        if let activeUploadSession {
            activeUploadSession.interruptPendingResponse(error: error)
        } else if !isPairing {
            protocolSession?.interruptPendingResponse(error: error)
        } else {
            syncDiagnosticsLog(
                "SyncEngine",
                "skipped protocolSession interrupt during pairing reason=\(reason)"
            )
        }
    }

    private func throwIfBindingChanged(expectedDeviceId: String? = nil) throws {
        if shouldAbortActiveUploadForBindingChange {
            throw SyncEngineError.bindingChanged
        }
        if let expectedDeviceId {
            guard let currentDeviceId = uploadStore?.getBinding()?.deviceId,
                  currentDeviceId == expectedDeviceId else {
                throw SyncEngineError.bindingChanged
            }
        }
    }

    private func shouldSuppressAutomaticBackgroundResume(reason: String) -> Bool {
        let reconnectExhausted =
            runtimeLastErrorCode == "RECONNECT_EXHAUSTED" ||
            sessionService.state == .pausedNoTarget
        guard reconnectExhausted && bindingConnectionState == .offline else {
            return false
        }
        syncDiagnosticsLog(
            "BackgroundExec",
            "skipping automatic background resume (\(reason)) state=\(sessionService.state.rawValue) connection=\(bindingConnectionState.rawValue) lastError=\(runtimeLastErrorCode ?? "nil")"
        )
        return true
    }

    func resumeSyncFromContinuedBackgroundTask() -> Bool {
        guard !shouldSuppressAutomaticBackgroundResume(reason: "continued_task") else {
            return false
        }
        sessionService.transitionTo(.syncingBackground)
        startSync()
        return true
    }

    func handleContinuedBackgroundTaskExpiration() {
        guard !shouldSuppressAutomaticBackgroundResume(reason: "continued_task_expiration") else {
            return
        }
        sessionService.transitionTo(.idle)
    }

    func resumeSyncFromMaintenanceBackgroundTask() -> Bool {
        guard !shouldSuppressAutomaticBackgroundResume(reason: "maintenance_task") else {
            return false
        }
        startSync()
        return true
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

    private func resolvedUploadTuning(targetDeviceType targetDeviceTypeOverride: String? = nil) -> UploadTuning {
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
        let targetDeviceType = targetDeviceTypeOverride ?? currentUploadTargetDeviceType()

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
        slog("[SyncPerf] %@", message)
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
            case .databaseError, .pairingError, .structuredPairingError, .permissionError, .lowDiskPaused, .storageUnavailable, .reconnectExhausted, .bindingChanged, .autoUploadInterrupted, .manualUploadCancelled:
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

    private func maxUploadReconnectAttempts() -> Int {
        min(
            max(
                syncFlowIntSetting(
                    envKey: "SYNCFLOW_UPLOAD_MAX_RECONNECT_ATTEMPTS",
                    userDefaultsKey: "SyncFlowUploadMaxReconnectAttempts"
                ) ?? 3,
                1
            ),
            10
        )
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
            slog("[SyncEngine] deferring incremental rescan — thermal state %@", thermalStateLabel(thermal))
            pendingRescanAfterThermalRecovery = true
            return
        }
        if isAppBackgrounded() && thermal != .nominal {
            slog("[SyncEngine] deferring incremental rescan — backgrounded + thermal %@", thermalStateLabel(thermal))
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
            slog("[SyncEngine] skipping incremental rescan — auto upload not active (%@)", reason)
            return
        }

        let clientId = bindingService.getOrCreateClientId()
        let trackedFileKeys = Set(store.getAutoDiscoveryTrackedFileKeys())
            .union(activeDeferredAutoExportFailureKeys())

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
                slog("[SyncEngine] incremental delta scan found %d new assets (%@)", deltaResults.count, reason)
                syncDiagnosticsLog("SyncEngine", "incremental delta scan found \(deltaResults.count) new assets (\(reason))")
            }
        } else {
            slog("[SyncEngine] no cached fetchResult — falling back to full scan (%@)", reason)
            untrackedAssets = photoScanner.scanForUntrackedAssets(
                clientId: clientId,
                trackedFileKeys: trackedFileKeys
            )
        }

        guard !untrackedAssets.isEmpty else {
            slog("[SyncEngine] incremental photo rescan found no new assets (%@)", reason)
            syncDiagnosticsLog("SyncEngine", "incremental photo rescan found no new assets (\(reason))")
            return
        }

        let now = ISO8601DateFormatter().string(from: Date())
        for asset in untrackedAssets {
            guard let photoAsset = asset.asset else { continue }
            let item = UploadItemRecord(
                id: nil,
                assetLocalId: photoAsset.localIdentifier,
                modifiedAt: photoAsset.modificationDate?.iso8601String ?? "",
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

        slog(
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
            slog("[SyncEngine] startSync: already syncing — waking watch loop")
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
            slog("[SyncEngine] startSync skipped — auto upload %@, no manual pending", configState)
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
        slog("[SyncEngine] startSync")
        syncDiagnosticsLog("SyncEngine", "startSync")
        sessionService.transitionTo(.scanning)
        backgroundService.submitContinuedTask()

        Task { [weak self] in
            await self?.runStartSyncFlow()
        }
    }

    func resetAllStatus() async throws {
        slog("[SyncEngine] resetAllStatus requested")
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
        shouldAbortActiveManualUpload = false
        runtimeManualUploadCancelled = false
        runtimeLastCompletedTaskSource = nil
        runtimeRoundSource = nil

        // 3. Emit fresh states to JS
        emitQueueToJS()
        NativeSyncEngineModule.shared?.emitHistoryUpdated()
        NativeSyncEngineModule.shared?.emitSyncStateChanged(runtimeSyncOverviewPayload(uploadState: "idle"))

        slog("[SyncEngine] resetAllStatus completed")
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
                maintainConnectedBindingState(reason: "auto_upload_interrupted")
                let clientId = bindingService.getOrCreateClientId()
                sendPresenceHeartbeat(
                    clientId: clientId,
                    successReason: "auto_upload_interrupted_presence_restored",
                    failureReason: "auto_upload_interrupted_presence_failed",
                    updateStateOnFailure: false
                )
                let configState = autoUploadConfigStore?.getConfig().state ?? "disabled"
                if configState == "disabled" {
                    slog("[SyncEngine] sync pipeline stopped because auto upload was disabled")
                    syncDiagnosticsLog("SyncEngine", "sync pipeline stopped because auto upload was disabled")
                    clearRuntimeSyncRoundProgress(uploadState: "idle")
                    let payload = runtimeSyncOverviewPayload(uploadState: "idle")
                    logSyncOverviewEmission("pipeline_auto_disabled", payload: payload)
                    NativeSyncEngineModule.shared?.emitSyncStateChanged(
                        payload
                    )
                    stopSyncLifecycle(finalState: .idle)
                } else {
                    slog("[SyncEngine] sync pipeline interrupted by user")
                    syncDiagnosticsLog("SyncEngine", "sync pipeline interrupted by user")
                    clearRuntimeSyncRoundProgress(uploadState: "paused_auto_upload")
                    let payload = runtimeSyncOverviewPayload(uploadState: "paused_auto_upload")
                    logSyncOverviewEmission("pipeline_auto_interrupted", payload: payload)
                    NativeSyncEngineModule.shared?.emitSyncStateChanged(
                        payload
                    )
                    stopSyncLifecycle(finalState: .interruptedAutoUpload)
                }
            case .manualUploadCancelled:
                slog("[SyncEngine] manual upload cancelled by user")
                syncDiagnosticsLog("SyncEngine", "manual upload cancelled by user")
                maintainConnectedBindingState(reason: "manual_upload_cancelled")
                let clientId = bindingService.getOrCreateClientId()
                sendPresenceHeartbeat(
                    clientId: clientId,
                    successReason: "manual_upload_cancelled_presence_restored",
                    failureReason: "manual_upload_cancelled_presence_failed",
                    updateStateOnFailure: false
                )
                clearRuntimeSyncRoundProgress(uploadState: "idle")
                runtimeManualUploadCancelled = true
                let payload = runtimeSyncOverviewPayload(
                    uploadState: "idle",
                    includePersistedIdleStats: false
                )
                logSyncOverviewEmission("pipeline_manual_cancelled", payload: payload)
                NativeSyncEngineModule.shared?.emitSyncStateChanged(payload)
                stopSyncLifecycle(finalState: .idle)
            case .bindingChanged:
                slog("[SyncEngine] sync pipeline stopped because binding changed")
                syncDiagnosticsLog("SyncEngine", "sync pipeline stopped because binding changed")
                clearRuntimeSyncRoundProgress(uploadState: "idle")
                let payload = runtimeSyncOverviewPayload(
                    uploadState: "idle",
                    includePersistedIdleStats: false
                )
                logSyncOverviewEmission("pipeline_binding_changed", payload: payload)
                NativeSyncEngineModule.shared?.emitSyncStateChanged(payload)
                stopSyncLifecycle(finalState: .idle)
            case .lowDiskPaused(let message):
                slog("[SyncEngine] sync pipeline paused due to low disk: %@", message)
                syncDiagnosticsLog("SyncEngine", "sync pipeline paused due to low disk: \(message)")
                protocolSession?.disconnect()
                protocolSession = nil
                stopSyncLifecycle(finalState: .idle)
                recordRecentError(code: "LOW_DISK_PAUSED", message: message)
                NativeSyncEngineModule.shared?.emitError([
                    "code": "LOW_DISK_PAUSED",
                    "message": message,
                ])
            case .storageUnavailable(let message, let source):
                slog("[SyncEngine] sync pipeline paused because desktop storage is unavailable: %@ source=%@", message, source)
                syncDiagnosticsLog("SyncEngine", "sync pipeline paused because desktop storage is unavailable: \(message) source=\(source)")
                protocolSession?.disconnect()
                protocolSession = nil
                maintainConnectedBindingState(reason: "storage_unavailable")
                let finalUploadState = source == "auto" ? "paused_auto_upload" : "idle"
                let finalSessionState: SessionService.SyncEngineState = source == "auto" ? .interruptedAutoUpload : .idle
                if source == "auto" {
                    persistAutoUploadInterruptedState(reason: "storage_unavailable")
                    setRuntimeReconnectError(code: "STORAGE_UNAVAILABLE", message: message)
                }
                clearRuntimeSyncRoundProgress(uploadState: finalUploadState)
                let payload = runtimeSyncOverviewPayload(uploadState: finalUploadState)
                logSyncOverviewEmission("pipeline_storage_unavailable", payload: payload)
                NativeSyncEngineModule.shared?.emitSyncStateChanged(payload)
                stopSyncLifecycle(finalState: finalSessionState)
                recordRecentError(code: "STORAGE_UNAVAILABLE", message: message)
                NativeSyncEngineModule.shared?.emitError([
                    "code": "STORAGE_UNAVAILABLE",
                    "message": message,
                ])
            case .reconnectExhausted(let message):
                slog("[SyncEngine] sync pipeline paused after reconnect limit: %@", message)
                syncDiagnosticsLog("SyncEngine", "sync pipeline paused after reconnect limit: \(message)")
                protocolSession?.disconnect()
                protocolSession = nil
                clearResolvedSidecarHost()
                if uploadStore?.getBinding() != nil {
                    updateBindingConnectionState(.offline, reason: "upload_reconnect_exhausted")
                }
                setRuntimeReconnectError(code: "RECONNECT_EXHAUSTED", message: message)
                backgroundService.cancelContinuedTask()
                stopSyncLifecycle(finalState: .pausedNoTarget)
            default:
                slog("[SyncEngine] sync pipeline failed: \(error)")
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
            slog("[SyncEngine] sync pipeline failed: \(error)")
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
        slog("[SyncPipeline] START")
        syncDiagnosticsLog("SyncPipeline", "START")

        // 0. Check prerequisites
        guard let binding = uploadStore?.getBinding() else {
            throw SyncEngineError.pairingError("No binding found — pair first")
        }
        guard resolvedPairingToken(for: binding) != nil else {
            slog("[SyncPipeline] pairing token missing — clearing stale binding, need re-pair")
            syncDiagnosticsLog("SyncPipeline", "pairing token missing — clearing stale binding")
            try? uploadStore?.clearBinding()
            currentBinding = nil
            bindingConnectionState = .offline
            clearSharedFilesReachability(reason: "pairing_token_missing")
            stopSyncLifecycle(finalState: .idle)
            NativeSyncEngineModule.shared?.emitBindingStateChanged(nil)
            return
        }

        // 1. Request photo permission only when this round needs PhotoKit.
        // Document-only manual queues come from the system file picker and can
        // upload without photo library access.
        let pendingBeforePermission = uploadStore?.getPendingUploadItemsSorted(limit: nil) ?? []
        let hasPhotoPending = pendingBeforePermission.contains { $0.sourceKind != "document" }
        let needsPhotoAccess = hasPhotoPending || isAutoUploadActiveForDiscovery()
        if needsPhotoAccess {
            let permStatus = await photoScanner.requestPermission()
            guard permStatus == .authorized || permStatus == .limited else {
                slog("[SyncEngine] photo permission denied")
                syncDiagnosticsLog("SyncEngine", "photo permission denied")
                stopSyncLifecycle(finalState: .pausedNoPermission)
                return
            }

            // 2. Start observing photo library for new assets
            photoScanner.startObserving()
        }

        let clientId = bindingService.getOrCreateClientId()

        // 3. Continuous loop: scan → connect → upload → disconnect → wait → repeat
        var roundNumber = 0

        while true {
            roundNumber += 1

            // Re-read binding/token every round. A long-lived pipeline can be
            // woken after the user switches desktops; using the startup binding
            // here would upload the next manual batch to the previous device.
            guard let binding = uploadStore?.getBinding() else {
                throw SyncEngineError.pairingError("No binding found — pair first")
            }
            guard let token = resolvedPairingToken(for: binding) else {
                slog("[SyncPipeline] pairing token missing — clearing stale binding, need re-pair")
                syncDiagnosticsLog("SyncPipeline", "pairing token missing — clearing stale binding")
                try? uploadStore?.clearBinding()
                bindingConnectionState = .offline
                clearSharedFilesReachability(reason: "pairing_token_missing")
                stopSyncLifecycle(finalState: .idle)
                NativeSyncEngineModule.shared?.emitBindingStateChanged(nil)
                return
            }

            // Resolve sidecar IP for HTTP heartbeat (connect TCP briefly).
            if sidecarHost == nil {
                do {
                    try await resolveSidecarHost(binding: binding, token: token, clientId: clientId)
                    try throwIfBindingChanged(expectedDeviceId: binding.deviceId)
                    // Probe succeeded — Mac is reachable and authenticated. Signal connected
                    // so the UI stops showing the 'Connecting to xxx' banner while scanning.
                    updateBindingConnectionState(.connected, reason: "sidecar_probe_success")
                } catch {
                    if let syncError = error as? SyncEngineError,
                       case .bindingChanged = syncError
                    {
                        throw syncError
                    }
                    slog("[SyncPipeline] failed to resolve sidecar host: %@", "\(error)")
                    syncDiagnosticsLog("SyncPipeline", "failed to resolve sidecar host: \(error)")
                }
            }
            try throwIfBindingChanged(expectedDeviceId: binding.deviceId)

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
            var reusableReconciliationScan: [ScannedAsset]?

            if pendingAssets.isEmpty {
                // Scan only when the persisted pending queue is empty. Large historical queues
                // are already stored in upload_items, so rescanning the full library every
                // 200-file batch just burns CPU/PhotoKit and makes the device hotter.
                var trackedKeys = Set(uploadStore?.getAutoDiscoveryTrackedFileKeys() ?? [])
                    .union(activeDeferredAutoExportFailureKeys())
                trackedAssetCount = trackedKeys.count
                if trackedKeys.isEmpty {
                    let reconciliationResult = await restoreCompletedUploadHistoryIfNeeded(
                        clientId: clientId,
                        fallbackHost: binding.host,
                        expectedDeviceId: binding.deviceId
                    )
                    try throwIfBindingChanged(expectedDeviceId: binding.deviceId)
                    reusableReconciliationScan = reconciliationResult.scannedAssets
                    if reconciliationResult.restoredCount > 0 {
                        trackedKeys = Set(uploadStore?.getAutoDiscoveryTrackedFileKeys() ?? [])
                            .union(activeDeferredAutoExportFailureKeys())
                        trackedAssetCount = trackedKeys.count
                        slog(
                            "[SyncPipeline] restored %d historical completed uploads before scan",
                            reconciliationResult.restoredCount
                        )
                        syncDiagnosticsLog("SyncPipeline", "restored \(reconciliationResult.restoredCount) historical completed uploads before scan")
                    }
                }
                // Only auto-scan when auto upload is active (PRD: disabled/interrupted = no auto discovery)
                let autoUploadActive = isAutoUploadActiveForDiscovery()
                if autoUploadActive {
                    if let reusableReconciliationScan {
                        newAssets = reusableReconciliationScan.filter { !trackedKeys.contains($0.fileKey) }
                        slog(
                            "[SyncPipeline] reusing reconciliation photo scan for auto queue (%d scanned, %d new, %d tracked)",
                            reusableReconciliationScan.count,
                            newAssets.count,
                            trackedKeys.count
                        )
                        syncDiagnosticsLog(
                            "SyncPipeline",
                            "reusing reconciliation scan for auto queue scanned=\(reusableReconciliationScan.count) new=\(newAssets.count) tracked=\(trackedKeys.count)"
                        )
                    } else {
                        newAssets = photoScanner.scanForUntrackedAssets(
                            clientId: clientId,
                            trackedFileKeys: trackedKeys
                        ) { [weak self] scanned, total in
                            self?.emitScanningProgress(scanned: scanned, total: total)
                        }
                    }
                    try throwIfBindingChanged(expectedDeviceId: binding.deviceId)
                }

                if !newAssets.isEmpty {
                    if isAutoUploadActiveForDiscovery() {
                        try throwIfBindingChanged(expectedDeviceId: binding.deviceId)
                        let queuePersistStart = CFAbsoluteTimeGetCurrent()
                        let queuedItems = newAssets.compactMap { asset -> UploadItemRecord? in
                            guard let photoAsset = asset.asset else { return nil }
                            return UploadItemRecord(
                                id: nil,
                                assetLocalId: photoAsset.localIdentifier,
                                modifiedAt: photoAsset.modificationDate?.iso8601String ?? "",
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
                        try throwIfBindingChanged(expectedDeviceId: binding.deviceId)
                        try? uploadStore?.upsertUploadItems(queuedItems)
                        slog(
                            "[SyncPipeline] persisted %d queued assets in %d ms",
                            queuedItems.count,
                            Int((CFAbsoluteTimeGetCurrent() - queuePersistStart) * 1000)
                        )
                        syncDiagnosticsLog("SyncPipeline", "persisted \(queuedItems.count) queued assets")
                        emitQueueToJS()
                    } else {
                        slog("[SyncPipeline] discarded %d scanned auto assets because auto upload was interrupted", newAssets.count)
                        syncDiagnosticsLog("SyncPipeline", "discarded \(newAssets.count) scanned auto assets after auto upload interruption")
                        newAssets = []
                    }
                }

                pendingAssets = buildPendingUploadAssets(clientId: clientId, limit: 200)
            } else {
                slog(
                    "[SyncPipeline] round %d reusing persisted pending queue (%d assets in batch), skipping full library scan",
                    roundNumber,
                    pendingAssets.count
                )
                syncDiagnosticsLog(
                    "SyncPipeline",
                    "round \(roundNumber): reusing persisted pending queue (\(pendingAssets.count) assets in batch), skipping full library scan"
                )
            }
            try throwIfBindingChanged(expectedDeviceId: binding.deviceId)

            let stats = uploadStore?.getQueueStats() ?? (totalCount: 0, totalBytes: 0, completedCount: 0, completedBytes: 0)
            slog(
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
                    slog("[SyncPipeline] idle — auto upload interrupted (auto pending: %d)", autoPendingCount)
                    syncDiagnosticsLog("SyncPipeline", "idle — auto interrupted (auto pending: \(autoPendingCount))")
                    sessionService.transitionTo(.interruptedAutoUpload)
                } else if configState == "disabled" {
                    // Disabled: emit idle, NOT completed — page should show "自动上传未开启"
                    let payload = runtimeSyncOverviewPayload(uploadState: "idle")
                    logSyncOverviewEmission("empty_queue_disabled", payload: payload)
                    NativeSyncEngineModule.shared?.emitSyncStateChanged(
                        payload
                    )
                    slog("[SyncPipeline] idle — auto upload disabled")
                    syncDiagnosticsLog("SyncPipeline", "idle — auto upload disabled")
                    sessionService.transitionTo(.idle)
                } else {
                    clearRuntimeCurrentFile()
                    runtimeCurrentSpeedMbps = 0
                    let completedRuntimeRound =
                        runtimeQueueTotalCount > 0 &&
                        runtimeQueueCompletedCount >= runtimeQueueTotalCount &&
                        runtimeRoundSource != nil
                    if completedRuntimeRound {
                        let completedRoundSource = runtimeRoundSource
                        let payload = ([
                            "uploadState": "completed",
                            "progressPercent": 100,
                        ] as [String: Any]).merging(
                            runtimeSyncOverviewPayload(uploadState: "completed", progressPercent: 100)
                        ) { _, new in new }
                        logSyncOverviewEmission("empty_queue_completed", payload: payload)
                        NativeSyncEngineModule.shared?.emitSyncStateChanged(payload)
                        if completedRoundSource == "auto" {
                            clearRuntimeSyncRoundProgress(uploadState: "idle")
                        }

                        slog("[SyncPipeline] idle — upload round completed, waiting for new photos...")
                        syncDiagnosticsLog("SyncPipeline", "idle — upload round completed")
                    } else {
                        let payload = runtimeSyncOverviewPayload(
                            uploadState: "idle",
                            includePersistedIdleStats: false
                        )
                        logSyncOverviewEmission("empty_queue_active_idle", payload: payload)
                        NativeSyncEngineModule.shared?.emitSyncStateChanged(payload)

                        slog("[SyncPipeline] idle — no new auto items, waiting for new photos...")
                        syncDiagnosticsLog("SyncPipeline", "idle — no new auto items")
                    }
                    sessionService.transitionTo(.idle)
                }
                photoLibraryChanged = false

                // Wait loop: send HTTP presence heartbeat every 30s while idle
                while !photoLibraryChanged {
                    verifyPresenceWithRecovery(clientId: clientId)
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
            let manualRoundAssets = manualUploadQueueAssets(from: pendingAssets)
            let manualRoundStats = manualRoundAssets.isEmpty
                ? nil
                : manualRoundAssets.first?.batchId.flatMap { uploadStore?.getManualQueueStats(batchId: $0) }
            let uploadRoundAssets = manualRoundAssets.isEmpty
                ? pendingAssets
                : manualRoundAssets
            let roundTotalCount = manualRoundAssets.isEmpty
                ? stats.totalCount
                : (manualRoundStats?.totalCount ?? uploadRoundAssets.count)
            let roundTotalBytes = manualRoundAssets.isEmpty
                ? stats.totalBytes
                : (manualRoundStats?.totalBytes ?? estimatedTotalBytes(for: uploadRoundAssets))
            let roundCompletedCount = manualRoundAssets.isEmpty
                ? stats.completedCount
                : (manualRoundStats?.completedCount ?? 0)
            let roundCompletedBytes = manualRoundAssets.isEmpty
                ? stats.completedBytes
                : (manualRoundStats?.completedBytes ?? Int64(0))
            var retryAttempt = 0
            let maxReconnectAttempts = maxUploadReconnectAttempts()
            let maxRetryDelay: UInt64 = 30_000_000_000
            var uploaded = false

            while !uploaded {
                do {
                    try await connectAndUpload(
                        binding: binding,
                        token: token,
                        clientId: clientId,
                        assets: uploadRoundAssets,
                        totalCount: roundTotalCount,
                        totalBytes: roundTotalBytes,
                        completedCount: roundCompletedCount,
                        completedBytes: roundCompletedBytes,
                        recoveryMode: retryAttempt > 0
                    )
                    uploaded = true
                    photoLibraryChanged = false // reset after round
                    if !BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
                        isTransitioningToBackground: isTransitioningToBackground,
                        isSilentAudioPlaying: SilentAudioService.shared.isPlaying
                    ) {
                        slog("[SyncPipeline] foreground pipeline paused for background handoff")
                        syncDiagnosticsLog("SyncPipeline", "foreground pipeline paused for background handoff")
                        return
                    }
                } catch {
                    if Task.isCancelled {
                        throw CancellationError()
                    }
                    if !isRetryableSyncError(error) {
                        slog("[SyncPipeline] upload failed with non-retryable error: %@", "\(error)")
                        syncDiagnosticsLog("SyncPipeline", "upload failed with non-retryable error: \(error)")
                        throw error
                    }

                    retryAttempt += 1
                    let delay = min(retryDelayNs(forAttempt: retryAttempt), maxRetryDelay)
                    let delaySeconds = Double(delay) / 1_000_000_000
                    let retryableError = classifyRetryableSyncError(
                        error,
                        targetDeviceType: uploadTargetDeviceType(for: binding)
                    )
                    let exhaustedMessage = "Desktop did not become reachable after \(retryAttempt) reconnect attempts: \(retryableError.message)"

                    clearResolvedSidecarHost()
                    sessionService.transitionTo(.backoffWaiting)
                    setRuntimeReconnectError(
                        code: retryableError.code,
                        message: retryableError.message
                    )
                    if retryAttempt >= maxReconnectAttempts {
                        updateBindingConnectionState(.offline, reason: "upload_reconnect_exhausted")
                        clearRuntimeCurrentFile()
                        runtimeCurrentSpeedMbps = 0
                        setRuntimeReconnectError(
                            code: "RECONNECT_EXHAUSTED",
                            message: exhaustedMessage
                        )
                        slog(
                            "[SyncPipeline] upload reconnect exhausted after %d attempts: %@",
                            retryAttempt,
                            "\(error)"
                        )
                        syncDiagnosticsLog(
                            "SyncPipeline",
                            "upload reconnect exhausted after \(retryAttempt) attempts: \(error)"
                        )
                        recordRecentRetry(error: error, attempt: retryAttempt, delaySeconds: 0)
                        recordRecentError(code: "RECONNECT_EXHAUSTED", message: exhaustedMessage)
                        NativeSyncEngineModule.shared?.emitSyncStateChanged(([
                            "lastErrorCode": "RECONNECT_EXHAUSTED",
                            "lastErrorMessage": exhaustedMessage,
                            "retryAttempt": retryAttempt,
                            "retryLimit": maxReconnectAttempts,
                            "reconnectExhausted": true,
                        ] as [String: Any]).merging(
                            runtimeSyncOverviewPayload(uploadState: "offline")
                        ) { _, new in new })
                        throw SyncEngineError.reconnectExhausted(exhaustedMessage)
                    }
                    updateBindingConnectionState(.connecting, reason: "retryable_upload_failure")
                    slog("[SyncPipeline] upload failed with retryable error: %@ — reconnecting in %.1fs (attempt %d)",
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
                    slog("[SyncPipeline] post-round grace: new pending found after %llu ms", gracedMs)
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
        activeUploadSession = session
        let wasConnectedBeforeUpload = bindingConnectionState == .connected
        let usableBindingHost = SidecarHostResolutionPolicy.usableFallbackHost(binding.host)
        let roundTargetDeviceType = uploadTargetDeviceType(for: binding)
        let hasForcedSidecarTarget = resolvedForcedSidecarTarget() != nil
        let canUseKnownConnectedHost =
            wasConnectedBeforeUpload &&
            usableBindingHost != nil &&
            !hasForcedSidecarTarget
        if !recoveryMode {
            updateBindingConnectionState(.connecting, reason: "connect_and_upload_started")
            sessionService.transitionTo(.preparing)
        }
        beginRuntimeSyncOverview(
            totalCount: totalCount,
            totalBytes: totalBytes,
            completedCount: completedCount,
            completedBytes: completedBytes,
            source: assets.first?.source
        )
        if !recoveryMode {
            NativeSyncEngineModule.shared?.emitSyncStateChanged(
                runtimeSyncOverviewPayload(uploadState: "preparing", progressPercent: 0)
            )
        }
        var activeSessionId: String?
        var uploadRoundCompleted = false
        var uploadRoundPausedForLowDisk = false
        var uploadRoundStorageUnavailable = false
        var uploadRoundInterruptedByUser = false
        var uploadRoundCancelledByUser = false
        var uploadRoundStoppedForBindingChange = false

        defer {
            if let activeSessionId, sessionService.currentSessionId == activeSessionId {
                sessionService.endSession()
            }
            if protocolSession === session {
                protocolSession = nil
            }
            if activeUploadSession === session {
                activeUploadSession = nil
            }
            session.disconnect()
            if uploadRoundInterruptedByUser {
                // User interrupted auto upload — close the TCP session so the
                // sidecar clears its live "syncing" state, but keep the mobile
                // binding state connected. The caller restores desktop presence
                // immediately via a heartbeat.
                maintainConnectedBindingState(reason: "upload_round_interrupted")
            } else if uploadRoundCancelledByUser {
                maintainConnectedBindingState(reason: "upload_round_manual_cancelled")
            } else if uploadRoundStoppedForBindingChange {
                syncDiagnosticsLog("SyncEngine", "upload round stopped after binding changed")
            } else {
                if !uploadRoundCompleted {
                    if uploadRoundPausedForLowDisk {
                        if uploadStore?.getBinding() != nil {
                            updateBindingConnectionState(.connected, reason: "upload_round_paused_low_disk")
                        }
                    } else if uploadRoundStorageUnavailable {
                        maintainConnectedBindingState(reason: "upload_round_storage_unavailable")
                    } else {
                        clearResolvedSidecarHost()
                        syncDiagnosticsLog(
                            "SyncEngine",
                            "upload round ended incomplete; caller will classify retry/offline state"
                        )
                    }
                }
            }
        }

        try throwIfBindingChanged(expectedDeviceId: binding.deviceId)

        // Find target device — only match by the binding's deviceId; do NOT fall back to
        // an arbitrary mDNS device so we never upload to the wrong machine.
        func findDevice() -> DiscoveredDevice? {
            return discoveredDevices[binding.deviceId]
        }

        var targetDevice = findDevice()
        if targetDevice == nil && canUseKnownConnectedHost {
            discoveryService.startBrowsing()
            syncDiagnosticsLog(
                "SyncPipeline",
                "using connected binding host without blocking discovery host=\(usableBindingHost ?? "nil")"
            )
        } else if targetDevice == nil && !hasForcedSidecarTarget {
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
        try throwIfBindingChanged(expectedDeviceId: binding.deviceId)
        sidecarHost = preferredSidecarHost(probedHost: newTransport.remoteHost, device: targetDevice)
            ?? usableBindingHost
        slog("[SyncPipeline] TCP connected to %@", sidecarHost ?? "unknown")
        syncDiagnosticsLog("SyncPipeline", "TCP connected to \(sidecarHost ?? "unknown")")

        let (helloType, helloRes) = try await session.sendAndReceive(
            type: .helloReq,
            payload: await buildClientHelloPayload(clientId: clientId, pairingToken: token)
        )
        try throwIfHelloErrorFrame(type: helloType, payload: helloRes)
        guard helloType == .helloRes else {
            throw SyncEngineError.networkError("Expected HELLO_RES")
        }
        try throwIfIncompatibleDesktopAppVersion(payload: helloRes)
        try throwIfBindingChanged(expectedDeviceId: binding.deviceId)
        refreshBoundServerMetadata(
            expectedDeviceId: binding.deviceId,
            serverName: helloRes["serverName"] as? String,
            shareName: helloRes["serverCapabilities"]
                .flatMap { ($0 as? [String: Any])?["shareName"] as? String },
            host: sidecarHost,
            wake: wakeCapability(fromHelloPayload: helloRes)
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
            slog("[SyncPipeline] auth successful")
            syncDiagnosticsLog("SyncPipeline", "auth successful")
        }
        try throwIfBindingChanged(expectedDeviceId: binding.deviceId)
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
        try throwIfBindingChanged(expectedDeviceId: binding.deviceId)

        slog("[SyncPipeline] uploading %d files", assets.count)
        syncDiagnosticsLog("SyncPipeline", "uploading \(assets.count) files")

        var tuning = resolvedUploadTuning(targetDeviceType: roundTargetDeviceType)
        slog(
            "[SyncPipeline] upload tuning profile=%@ target=%@ chunkMiB=%.1f windowMiB=%.1f pipeline=%d prefetch=%@ throttleMiBps=%.1f",
            tuning.profileLabel,
            roundTargetDeviceType ?? "unknown",
            Double(tuning.chunkSizeBytes) / (1024 * 1024),
            Double(tuning.targetInFlightBytes) / (1024 * 1024),
            tuning.maxPipelineChunks,
            tuning.prefetchNextFile ? "on" : "off",
            Double(tuning.throttleBytesPerSec) / (1024 * 1024)
        )
        syncDiagnosticsLog(
            "SyncPipeline",
            "upload tuning profile=\(tuning.profileLabel) target=\(roundTargetDeviceType ?? "unknown") chunkMiB=\(String(format: "%.1f", Double(tuning.chunkSizeBytes) / (1024 * 1024))) windowMiB=\(String(format: "%.1f", Double(tuning.targetInFlightBytes) / (1024 * 1024))) pipeline=\(tuning.maxPipelineChunks) prefetch=\(tuning.prefetchNextFile ? "on" : "off") throttleMiBps=\(String(format: "%.1f", Double(tuning.throttleBytesPerSec) / (1024 * 1024)))"
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

        func cancelPrefetchAndCleanup() async {
            prefetchTask?.cancel()
            await prefetchTask?.value
            prefetchTask = nil
            if let leakedExport = nextExport {
                exportService.cleanup(tempURL: leakedExport.tempURL)
                nextExport = nil
            }
        }

        if tuning.prefetchNextFile, !assets.isEmpty {
            nextExport = try? await exportAssetForUpload(assets[0])
        }

        for (index, asset) in assets.enumerated() {
            // File boundary: normally yield the TCP loop after a background
            // transition so BackgroundUploadService can take over via
            // URLSession. During the silent-audio keepalive experiment, keep
            // the foreground TCP queue running while the audio session is
            // active.
            if !BackgroundHandoffPolicy.shouldContinueForegroundPipeline(
                isTransitioningToBackground: isTransitioningToBackground,
                isSilentAudioPlaying: SilentAudioService.shared.isPlaying
            ) {
                slog("[SyncPipeline] breaking TCP loop — app backgrounded")
                syncDiagnosticsLog("SyncPipeline", "breaking TCP loop — app backgrounded")
                resumeWatchLoopIfNeeded()
                break
            }

            try throwIfBindingChanged(expectedDeviceId: binding.deviceId)

            if isManualUploadCancelled(fileKey: asset.fileKey, source: asset.source) {
                uploadRoundCancelledByUser = true
                slog("[SyncPipeline] stopping manual upload after cancellation before file %@", asset.fileKey)
                syncDiagnosticsLog("SyncPipeline", "stopping manual upload after cancellation before file \(asset.fileKey)")
                await cancelPrefetchAndCleanup()
                throw SyncEngineError.manualUploadCancelled
            }
            // Between files: skip auto items when interrupted, skip cancelled batch items
            if index > 0 {
                if isAutoUploadInterrupted && asset.source == "auto" {
                    slog("[SyncPipeline] skipping auto item %@ — auto upload interrupted", asset.fileKey)
                    continue
                }
                // Check if this item was cancelled in DB (e.g. manual queue cancel)
                if let item = uploadStore?.getUploadItemByFileKey(asset.fileKey),
                   item.status == "cancelled" {
                    slog("[SyncPipeline] skipping cancelled item %@", asset.fileKey)
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
            tuning = resolvedUploadTuning(targetDeviceType: roundTargetDeviceType)
            if previousProfile != tuning.profileLabel {
                slog("[SyncPipeline] tuning changed mid-batch: %@ -> %@", previousProfile, tuning.profileLabel)
            }

            if !tuning.prefetchNextFile, prefetchTask != nil {
                slog("[SyncPipeline] invalidating prefetch — tuning now %@", tuning.profileLabel)
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
            do {
                if !prefetchInvalidated, let prefetched = nextExport {
                    exported = prefetched
                    nextExport = nil
                } else {
                    prefetchInvalidated = false
                    exported = try await exportAssetForUpload(asset)
                }
            } catch {
                if asset.source == "auto", isPhotoKitExportError(error) {
                    let summary = photoKitExportErrorSummary(error)
                    slog(
                        "[SyncPipeline] deferring auto item %@ after PhotoKit export failure: %@",
                        asset.fileKey,
                        summary
                    )
                    syncDiagnosticsLog(
                        "SyncPipeline",
                        "deferring auto item \(asset.fileKey) after PhotoKit export failure: \(summary)"
                    )
                    deferAutoExportFailure(fileKey: asset.fileKey)
                    try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "failed")
                    runtimeQueueTotalCount = max(runtimeQueueTotalCount - 1, 0)
                    runtimeQueueTotalBytes = max(runtimeQueueTotalBytes - max(asset.estimatedSize, 0), 0)
                    clearRuntimeCurrentFile()
                    runtimeCurrentSpeedMbps = 0
                    emitQueueToJS()
                    continue
                }
                throw error
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
                slog("[SyncPipeline] skipping cancelled item %@ before TCP upload", asset.fileKey)
                exportService.cleanup(tempURL: exported.tempURL)
                continue
            }

            // Phase 3.7 cross-protocol reset: if this row was last
            // transported via HTTP (or is flagged `requires_remote_reset`),
            // ask the sidecar to clear its .part before we restart TCP
            // FILE_DATA from offset 0. Concurrent-transfer / network
            // failures abort the TCP round so we don't race the HTTP path.
            //
            // T6: the classification of the DELETE outcome lives in the
            // pure helper `Self.decideCrossProtocolReset(_:)`. Keeping
            // the decision table there means the state machine is
            // testable in isolation and the pipeline here just applies
            // the resulting side effects.
            var abortRoundForCrossProtocol = false
            if let item = uploadStore?.getUploadItemByFileKey(asset.fileKey),
               item.requiresRemoteReset {
                let pairingToken = resolvedPairingToken(for: binding) ?? token
                let host = sidecarHost ?? binding.host
                let resetResult = await sidecarResetUpload(
                    host: host,
                    port: binding.port,
                    clientId: clientId,
                    fileKey: asset.fileKey,
                    pairingToken: pairingToken
                )
                let decision = Self.decideCrossProtocolReset(resetResult)
                if decision.clearRequiresRemoteReset {
                    try? uploadStore?.setRequiresRemoteReset(fileKey: asset.fileKey, value: false)
                    try? uploadStore?.resetUploadOffset(fileKey: asset.fileKey)
                }
                if decision.abortRound {
                    NSLog(
                        "[SyncPipeline] cross-protocol reset aborted round code=%@ fileKey=%@",
                        decision.diagnosticCode, asset.fileKey
                    )
                    syncDiagnosticsLog(
                        "SyncPipeline",
                        "cross-protocol reset aborted round code=\(decision.diagnosticCode) fileKey=\(asset.fileKey)"
                    )
                    exportService.cleanup(tempURL: exported.tempURL)
                    abortRoundForCrossProtocol = true
                }
                if abortRoundForCrossProtocol {
                    break
                }
            }
            // Row is ours now — advance the transport marker so the
            // history ledger and diagnostics know TCP owns this file.
            try? uploadStore?.updateTransport(fileKey: asset.fileKey, transport: "tcp")

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
                    expectedDeviceId: binding.deviceId,
                    targetDeviceType: roundTargetDeviceType,
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
                            slog("[SyncPipeline] queue head changed (priority preemption) — breaking batch")
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
                   case .bindingChanged = syncError
                {
                    uploadRoundStoppedForBindingChange = true
                    slog("[SyncEngine] stopping upload round because binding changed")
                    syncDiagnosticsLog("SyncEngine", "stopping upload round because binding changed")
                    try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                    clearRuntimeCurrentFile()
                    runtimeCurrentSpeedMbps = 0
                    emitQueueToJS()
                    prefetchTask?.cancel()
                    await prefetchTask?.value
                    if let leakedExport = nextExport {
                        exportService.cleanup(tempURL: leakedExport.tempURL)
                        nextExport = nil
                    }
                    throw syncError
                }
                if let syncError = error as? SyncEngineError,
                   case .manualUploadCancelled = syncError
                {
                    uploadRoundCancelledByUser = true
                    slog("[SyncEngine] manual upload cancelled during file %@", asset.fileKey)
                    syncDiagnosticsLog("SyncEngine", "manual upload cancelled during file \(asset.fileKey)")
                    try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "cancelled")
                    clearRuntimeCurrentFile()
                    runtimeCurrentSpeedMbps = 0
                    emitQueueToJS()
                    await cancelPrefetchAndCleanup()
                    throw syncError
                }
                if let syncError = error as? SyncEngineError,
                   case .autoUploadInterrupted = syncError
                {
                    uploadRoundInterruptedByUser = true
                    slog("[SyncEngine] auto upload interrupted during file %@", asset.fileKey)
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
                    slog("[SyncEngine] low disk paused upload for %@: %@", asset.fileKey, message)
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
                if let syncError = error as? SyncEngineError,
                   case .storageUnavailable(let message, let sourceLabel) = syncError
                {
                    uploadRoundStorageUnavailable = true
                    slog("[SyncEngine] storage unavailable for %@ source=%@: %@", asset.fileKey, sourceLabel, message)
                    syncDiagnosticsLog("SyncEngine", "storage unavailable for \(asset.fileKey) source=\(sourceLabel): \(message)")
                    recordRecentError(code: "STORAGE_UNAVAILABLE", message: message)
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
                    slog("[SyncEngine] retryable upload failure for %@: %@", asset.fileKey, "\(error)")
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

                slog("[SyncEngine] non-retryable upload failure for %@: %@", asset.fileKey, "\(error)")
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
        slog("[SyncPipeline] upload round complete, disconnecting TCP")
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
        expectedDeviceId: String,
        targetDeviceType: String?,
        recoveryMode: Bool
    ) async throws {
        let tuning = resolvedUploadTuning(targetDeviceType: targetDeviceType)
        let fileTransferStart = CFAbsoluteTimeGetCurrent()
        try throwIfBindingChanged(expectedDeviceId: expectedDeviceId)
        try throwIfManualUploadCancelled(fileKey: asset.fileKey, source: asset.source)
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
            try throwIfBindingChanged(expectedDeviceId: expectedDeviceId)
            try throwIfManualUploadCancelled(fileKey: asset.fileKey, source: asset.source)

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
            try throwIfBindingChanged(expectedDeviceId: expectedDeviceId)
            try throwIfManualUploadCancelled(fileKey: asset.fileKey, source: asset.source)

            let action = initRes["action"] as? String ?? "REJECT"

            switch action {
            case "SKIP":
                if tuning.perfLoggingEnabled {
                    perfLog("file=\(asset.fileKey) action=SKIP size=\(exported.fileSize)")
                }
                try throwIfBindingChanged(expectedDeviceId: expectedDeviceId)
                slog("[SyncEngine] SKIP \(exported.originalFilename) (already exists)")
                try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "completed")
                runtimeLastCompletedTaskSource = asset.source
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
                slog("[SyncEngine] REJECT \(exported.originalFilename): \(reason)")
                if reason == "LOW_DISK_PAUSED" {
                    try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                    clearRuntimeCurrentFile()
                    emitQueueToJS()
                    throw SyncEngineError.lowDiskPaused(reason)
                }
                if reason == "STORAGE_UNAVAILABLE" {
                    try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                    clearRuntimeCurrentFile()
                    emitQueueToJS()
                    throw SyncEngineError.storageUnavailable(reason, source: asset.source)
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
                slog("[SyncEngine] RESUME \(exported.originalFilename) from offset \(offset)")
                try await streamFileData(
                    session: session,
                    fileURL: exported.tempURL,
                    fileKey: asset.fileKey,
                    source: asset.source,
                    expectedDeviceId: expectedDeviceId,
                    targetDeviceType: targetDeviceType,
                    startOffset: offset,
                    fileSize: exported.fileSize,
                    recoveryMode: true
                )
            case "UPLOAD":
                if tuning.perfLoggingEnabled {
                    perfLog("file=\(asset.fileKey) action=UPLOAD size=\(exported.fileSize)")
                }
                slog("[SyncEngine] UPLOAD \(exported.originalFilename) (\(exported.fileSize) bytes)")
                try await streamFileData(
                    session: session,
                    fileURL: exported.tempURL,
                    fileKey: asset.fileKey,
                    source: asset.source,
                    expectedDeviceId: expectedDeviceId,
                    targetDeviceType: targetDeviceType,
                    startOffset: 0,
                    fileSize: exported.fileSize,
                    recoveryMode: recoveryMode
                )
            default:
                throw SyncEngineError.networkError("Unknown FILE_INIT action: \(action)")
            }

            try throwIfManualUploadCancelled(fileKey: asset.fileKey, source: asset.source)
            try throwIfBindingChanged(expectedDeviceId: expectedDeviceId)

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

            guard let completedBinding = uploadStore?.getBinding(),
                  completedBinding.deviceId == expectedDeviceId else {
                throw SyncEngineError.bindingChanged
            }

            // Always mark as completed + update history if we got a response
            try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: isOk ? "completed" : "failed")
            emitQueueToJS()

            if isOk {
                runtimeLastCompletedTaskSource = asset.source
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
                let binding = completedBinding
                if binding.deviceId == expectedDeviceId {
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
                        slog("[SyncUpload] [%d/%d] ledger update FAILED: %@", index + 1, total, error.localizedDescription)
                    }
                    NativeSyncEngineModule.shared?.emitHistoryUpdated()
                }
                if tuning.perfLoggingEnabled {
                    let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - fileTransferStart) * 1000)
                    perfLog(
                        "file=\(asset.fileKey) action=COMPLETE size=\(exported.fileSize) endToEndMs=\(elapsedMs) sidecarActiveMs=\(transmissionMs)"
                    )
                }
                slog("[SyncUpload] [%d/%d] completed %@", index + 1, total, exported.originalFilename)
            } else {
                runtimeCurrentSpeedMbps = 0
                if tuning.perfLoggingEnabled {
                    let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - fileTransferStart) * 1000)
                    perfLog("file=\(asset.fileKey) action=FAILED size=\(exported.fileSize) endToEndMs=\(elapsedMs)")
                }
                let reason = endRes["reason"] as? String ?? ""
                if reason == "STORAGE_UNAVAILABLE" {
                    try uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                    clearRuntimeCurrentFile()
                    emitQueueToJS()
                    throw SyncEngineError.storageUnavailable(reason, source: asset.source)
                }
                slog("[SyncUpload] [%d/%d] FILE_END not ok for %@", index + 1, total, exported.originalFilename)
                clearRuntimeCurrentFile()
            }
        } catch {
            if let syncError = error as? SyncEngineError,
               case .bindingChanged = syncError {
                try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "queued")
                clearRuntimeCurrentFile()
                runtimeCurrentSpeedMbps = 0
                emitQueueToJS()
                throw syncError
            }
            if asset.source == "manual" && isManualUploadCancelled(fileKey: asset.fileKey, source: asset.source) {
                shouldAbortActiveManualUpload = false
                try? uploadStore?.updateUploadStatus(fileKey: asset.fileKey, status: "cancelled")
                clearRuntimeCurrentFile()
                runtimeCurrentSpeedMbps = 0
                emitQueueToJS()
                throw SyncEngineError.manualUploadCancelled
            }
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
        session: ProtocolSession,
        fileURL: URL,
        fileKey: String,
        source: String,
        expectedDeviceId: String,
        targetDeviceType: String?,
        startOffset: Int64,
        fileSize: Int64,
        recoveryMode: Bool
    ) async throws {
        struct InFlightChunk {
            let offset: Int64
            let size: Int64
            let sendStartedAt: CFTimeInterval
        }

        let tuning = resolvedUploadTuning(targetDeviceType: targetDeviceType)
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

        func throwIfActiveUploadWasInterrupted() throws {
            try throwIfBindingChanged(expectedDeviceId: expectedDeviceId)
            if source == "manual" && isManualUploadCancelled(fileKey: fileKey, source: source) {
                streamOutcome = "STREAM_INTERRUPTED"
                streamFailure = "manual upload cancelled by user"
                throw SyncEngineError.manualUploadCancelled
            }
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
            try throwIfActiveUploadWasInterrupted()
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
                try throwIfActiveUploadWasInterrupted()
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
                        let resumedProfile = resolvedUploadTuning(targetDeviceType: targetDeviceType).profileLabel
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
                            profileLabel: resolvedUploadTuning(targetDeviceType: targetDeviceType).profileLabel,
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

            try throwIfActiveUploadWasInterrupted()
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
                if errCode == "STORAGE_UNAVAILABLE" {
                    throw SyncEngineError.storageUnavailable(errMsg, source: source)
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

    private func discoveredDevicesSignature(_ devices: [DiscoveredDevice]) -> String {
        devices
            .map {
                [
                    $0.deviceId,
                    $0.name,
                    $0.ip,
                    $0.type,
                    String($0.port),
                    String($0.protoVersion),
                    $0.authMode,
                    $0.shareEnabled ? "1" : "0",
                    $0.shareName ?? "",
                ].joined(separator: "\u{1F}")
            }
            .sorted()
            .joined(separator: "\u{1E}")
    }

    // MARK: - PhotoScannerDelegate

    func photoLibraryDidChange() {
        slog("[SyncEngine] photo library changed — flagging rescan")
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
        slog("[SyncEngine] discoveryDidUpdate called with \(devices.count) devices")
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
        let devicesSignature = discoveredDevicesSignature(devices)
        if devicesSignature == lastEmittedDiscoveredDevicesSignature {
            syncDiagnosticsLog(
                "SyncEngine",
                "skipping unchanged discovered devices emit count=\(mapped.count)"
            )
        } else if let bridge = NativeSyncEngineModule.shared {
            slog("[SyncEngine] emitting \(mapped.count) devices to RN")
            syncDiagnosticsLog("SyncEngine", "emitting \(mapped.count) devices to RN")
            lastEmittedDiscoveredDevicesSignature = devicesSignature
            bridge.emitDiscoveredDevices(mapped)
        } else {
            slog("[SyncEngine] WARNING: NativeSyncEngineModule.shared is nil, cannot emit")
            syncDiagnosticsLog("SyncEngine", "warning: NativeSyncEngineModule.shared is nil, cannot emit")
        }

        // Detect bound device disappearing / reappearing from Bonjour
        if let binding = uploadStore?.getBinding() {
            let boundDevice = devices.first { $0.deviceId == binding.deviceId }
            let boundDeviceVisible = boundDevice != nil
            var boundDeviceHasUsablePresenceHost = false
            if let device = boundDevice {
                let resolvedHost = preferredSidecarHost(probedHost: device.ip, device: device)
                if let resolvedHost, !resolvedHost.isEmpty {
                    if syncFlowIsPrivateLANIPv4(resolvedHost) {
                        boundDeviceHasUsablePresenceHost = true
                        if uploadStore?.getBinding()?.deviceId == binding.deviceId {
                            if sidecarHost != resolvedHost {
                                syncDiagnosticsLog(
                                    "SyncEngine",
                                    "bound device discovery host refreshed \(sidecarHost ?? "nil") -> \(resolvedHost)"
                                )
                            }
                            sidecarHost = resolvedHost
                            refreshBoundServerMetadata(
                                expectedDeviceId: binding.deviceId,
                                serverName: nil,
                                shareName: nil,
                                host: resolvedHost
                            )
                            publishSharedFilesLANReachabilityFromDiscovery(
                                binding: binding,
                                host: resolvedHost,
                                reason: "discovery_lan_probe_success"
                            )
                        } else {
                            syncDiagnosticsLog(
                                "SyncEngine",
                                "ignored bound device discovery host for stale device=\(binding.deviceId)"
                            )
                        }
                    } else {
                        syncDiagnosticsLog(
                            "SyncEngine",
                            "ignored bound device discovery host \(resolvedHost) because it is not a private LAN IPv4"
                        )
                    }
                }
            }
            if !boundDeviceVisible && (bindingConnectionState == .connected || bindingConnectionState == .bound) {
                // Bonjour is unreliable — the device can briefly disappear due to
                // mDNS cache expiry or Wi-Fi transitions. Probe with a heartbeat
                // before going offline; only mark offline if the probe also fails.
                slog("[SyncEngine] bound device %@ disappeared from discovery, verifying via heartbeat", binding.deviceId)
                syncDiagnosticsLog("SyncEngine", "bound device \(binding.deviceId) disappeared from discovery, verifying via heartbeat")
                publishSharedFilesP2PReachabilityAfterLANFailure(
                    reason: "discovery_bound_device_missing"
                )
                let clientId = bindingService.getOrCreateClientId()
                verifyPresenceWithRecovery(clientId: clientId)
            } else if boundDeviceVisible && (bindingConnectionState == .offline || bindingConnectionState == .bound) {
                slog("[SyncEngine] bound device %@ reappeared in discovery, probing connection", binding.deviceId)
                syncDiagnosticsLog("SyncEngine", "bound device \(binding.deviceId) reappeared in discovery, probing connection")
                // Resolve sidecar host from the rediscovered Bonjour entry so the
                // heartbeat has a target, then probe with short retries until the
                // sidecar HTTP API is ready after desktop restart.
                if boundDeviceHasUsablePresenceHost {
                    let clientId = bindingService.getOrCreateClientId()
                    startPresenceRecoveryProbe(clientId: clientId, promoteOfflineToConnecting: true)
                } else {
                    syncDiagnosticsLog(
                        "SyncEngine",
                        "bound device reappeared without a usable private LAN host; keeping \(bindingConnectionState.rawValue)"
                    )
                }
            }
        }
    }

    // MARK: - Discovery

    func startDiscovery() {
        slog("[SyncEngine] startDiscovery - delegate is \(discoveryService.delegate == nil ? "nil" : "set")")
        syncDiagnosticsLog("SyncEngine", "startDiscovery - delegate is \(discoveryService.delegate == nil ? "nil" : "set")")
        syncDiagnosticsLog(
            "SyncEngine",
            "startDiscovery existingDiscoveredDevices=\(discoveredDevices.count)"
        )
        if discoveryService.isBrowsing {
            syncDiagnosticsLog(
                "SyncEngine",
                "startDiscovery no-op: discovery already browsing"
            )
            _ = probeBoundDesktopIfDiscoveryAlreadyBrowsing(reason: "start_discovery_already_browsing")
            return
        }
        discoveryService.startBrowsing()
    }

    func stopDiscovery() {
        slog("[SyncEngine] stopDiscovery")
        syncDiagnosticsLog("SyncEngine", "stopDiscovery")
        syncDiagnosticsLog(
            "SyncEngine",
            "stopDiscovery clearingDiscoveredDevices=\(discoveredDevices.count)"
        )
        discoveryService.stopBrowsing()
        discoveredDevices.removeAll()
        lastEmittedDiscoveredDevicesSignature = nil
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

    func retryLanReconnect(allowWake: Bool) async {
        startDiscovery()
        guard let binding = uploadStore?.getBinding() else {
            syncDiagnosticsLog("SyncEngine", "retryLanReconnect skipped: no binding")
            return
        }

        if let usableBindingHost = SidecarHostResolutionPolicy.usableFallbackHost(binding.host),
           await canReachSharedFilesLANHost(usableBindingHost, timeout: 1.5) {
            sidecarHost = usableBindingHost
            updateBindingConnectionState(.connected, reason: "manual_lan_reconnect_succeeded")
            startSync()
            return
        }

        guard allowWake else {
            syncDiagnosticsLog("SyncEngine", "retryLanReconnect LAN host unavailable; wake disabled")
            return
        }

        if let _ = await attemptSharedFilesLANWakeIfNeeded(binding: binding, reason: "manual_lan_reconnect", allowPublicWake: false),
           let current = uploadStore?.getBinding() {
            sendPresenceHeartbeat(
                clientId: bindingService.getOrCreateClientId(),
                successReason: "manual_lan_reconnect_presence_succeeded",
                failureReason: "manual_lan_reconnect_presence_failed",
                updateStateOnFailure: false
            )
            if current.deviceId == binding.deviceId {
                startSync()
            }
        } else {
            syncDiagnosticsLog("SyncEngine", "retryLanReconnect wake did not recover LAN host")
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
        slog("[SyncEngine] pairDevice: deviceId=\(deviceId) host=\(host) port=\(port)")

        // Guard against concurrent pairing calls (e.g. QR scanner firing onCodeScanned
        // many times before the stale-closure guard takes effect). Only one pairing
        // attempt is allowed at a time.
        guard !isPairing else {
            slog("[SyncEngine] pairDevice: already pairing — ignoring concurrent call")
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

        // 1. Connect TCP — prefer the already-probed IPv4 host over the Bonjour
        // service endpoint. The endpoint's `.local` resolution can lag behind
        // the TXT `ip=` record after a Wi-Fi/DHCP change, which was the root
        // cause of pairing attempts still dialing stale addresses.
        let cachedDevice = discoveredDevices[deviceId]
        let preferredPairHost = preferredSidecarHost(
            probedHost: host,
            device: cachedDevice
        )
        if let forcedTarget = resolvedForcedSidecarTarget() {
            slog("[SyncEngine] connecting via forced host:port")
            try await session.connect(host: forcedTarget.host, port: forcedTarget.port)
        } else if let preferredPairHost, !preferredPairHost.isEmpty {
            slog("[SyncEngine] connecting via resolved host:port")
            try await session.connect(
                host: preferredPairHost,
                port: cachedDevice?.port ?? UInt16(port)
            )
        } else if let endpoint = cachedDevice?.endpoint {
            slog("[SyncEngine] connecting via Bonjour endpoint fallback")
            try await session.connect(endpoint: endpoint)
        } else if !host.isEmpty {
            slog("[SyncEngine] connecting via host:port")
            try await session.connect(host: host, port: UInt16(port))
        } else {
            throw SyncEngineError.networkError("No endpoint or host available for device \(deviceId)")
        }
        let confirmedHost = preferredSidecarHost(
            probedHost: transport.remoteHost,
            device: discoveredDevices[deviceId]
        ) ?? host
        if confirmedHost != host {
            slog("[SyncEngine] pairDevice confirmed host %@ -> %@", host, confirmedHost)
            syncDiagnosticsLog("SyncEngine", "pairDevice confirmed host \(host) -> \(confirmedHost)")
        }

        let clientId = bindingService.getOrCreateClientId()
        let trimmedConnectionCode = connectionCode.trimmingCharacters(in: .whitespacesAndNewlines)

        func resetAutoUploadStateForFreshPairing(reason: String) {
            try? uploadStore?.resetAutoUploadConfig()
            isAutoUploadInterrupted = false
            slog("[SyncEngine] reset auto upload config after pairing: %@", reason)
        }

        // 2. HELLO_REQ → HELLO_RES  (spec Section 7.8)
        // Include any stored pairing token for this server so the server can
        // recognize the client as already bound (authRequired=false) and we
        // skip the connection-code prompt. Powers the "switch device" direct
        // reconnect path; absent/rejected token falls through to PAIR_REQ.
        //
        // If the caller supplied a connection code, treat it as an explicit
        // re-pairing attempt and do not send the stored token. Otherwise a
        // still-valid old token could bypass validation after the desktop code
        // has changed.
        let storedToken: String?
        if trimmedConnectionCode.isEmpty {
            storedToken = bindingService.getPairingToken(
                forKey: pairingTokenKeychainKey(for: deviceId)
            ) ?? bindingService.getPairingToken(forKey: BindingService.legacyPairingTokenKey)
        } else {
            storedToken = nil
        }
        let (helloType, helloRes) = try await session.sendAndReceive(
            type: .helloReq,
            payload: await buildClientHelloPayload(clientId: clientId, pairingToken: storedToken)
        )
        try throwIfHelloErrorFrame(type: helloType, payload: helloRes)
        guard helloType == .helloRes else {
            throw SyncEngineError.pairingError("Expected HELLO_RES, got \(helloType)")
        }
        try throwIfIncompatibleDesktopAppVersion(payload: helloRes)

        let authRequired: Bool
        if let b = helloRes["authRequired"] as? Bool { authRequired = b }
        else if let n = helloRes["authRequired"] as? NSNumber { authRequired = n.boolValue }
        else { authRequired = true }

        guard authRequired else {
            // Already bound on server — ensure we have a local binding record too
            slog("[SyncEngine] already bound on server, ensuring local binding exists")
            let serverId = helloRes["serverId"] as? String ?? deviceId
            if var existingBinding = uploadStore?.getBinding() {
                if existingBinding.deviceId != serverId {
                    interruptActiveSyncForBindingChange(
                        reason: "pair_device_switch_confirmed \(existingBinding.deviceId) -> \(serverId)"
                    )
                    // Switching to a different device — reset queue so it receives all photos,
                    // and overwrite the local binding to point at the new server. The previous
                    // server's pairing token is left in Keychain so the user can switch back
                    // without re-entering its code.
                    slog(
                        "[SyncEngine] device switch detected (authRequired=false): %@ → %@, resetting upload queue",
                        existingBinding.deviceId, serverId
                    )
                    try? uploadStore?.resetUploadQueue()

                    // Reset in-memory runtime counter cache from the previous device's
                    // session so the new device's SyncActivity starts from zero.
                    // runtimeSyncOverviewPayload reads these directly and caches over
                    // the DB; without resetting them the next emit re-reports the
                    // previous device's completed=1/1 progress.
                    // (We don't call resetAllStatus() because it also wipes upload
                    // history, which should be preserved across device switches.)
                    runtimeQueueTotalCount = 0
                    runtimeQueueCompletedCount = 0
                    runtimeQueueTotalBytes = 0
                    runtimeQueueCompletedBytes = 0
                    runtimeRoundBaselineCompletedCount = 0
                    runtimeRoundBaselineCompletedBytes = 0
                    runtimeCurrentFileKey = nil
                    runtimeCurrentFilename = nil
                    runtimeCurrentFileConfirmedBytes = 0
                    runtimeCurrentFileTotalBytes = 0
                    runtimeCurrentSpeedMbps = 0
                    runtimeUploadState = "idle"
                    runtimeLastCompletedTaskSource = nil
                    runtimeRoundSource = nil

                    resetAutoUploadStateForFreshPairing(reason: "device_switch_auth_not_required")
                    didAttemptRemoteHistoryReconciliation = false

                    let serverName = helloRes["serverName"] as? String ?? ""
                    let keychainKey = pairingTokenKeychainKey(for: serverId)
                    let newBinding = BindingRecord(
                        deviceId: serverId,
                        deviceName: serverName,
                        deviceAlias: nil,
                        deviceType: inferredBindingDeviceType(for: deviceId),
                        host: confirmedHost,
                        port: port,
                        pairingId: "",
                        pairingTokenKeychainRef: keychainKey,
                        shareName: helloRes["serverCapabilities"].flatMap { ($0 as? [String: Any])?["shareName"] as? String },
                        lastBoundAt: ISO8601DateFormatter().string(from: Date()),
                        wake: wakeCapability(fromHelloPayload: helloRes)
                    )
                    try uploadStore?.saveBinding(newBinding)
                    if let bonjourDevice = discoveredDevices[deviceId] {
                        discoveredDevices[serverId] = bonjourDevice
                    }
                    slog("[SyncEngine] saved new binding after device switch: \(serverId)")
                } else {
                    // Explicitly entering a connection code is treated as a fresh pairing
                    // session. The sync screen should start from the default "auto upload
                    // not enabled" card instead of inheriting the previous active state.
                    resetAutoUploadStateForFreshPairing(reason: "same_device_repair_auth_not_required")
                }
                if existingBinding.deviceId == serverId && existingBinding.host != confirmedHost {
                    existingBinding.host = confirmedHost
                    existingBinding.wake = mergeWakeCapability(newWake: wakeCapability(fromHelloPayload: helloRes), existingWake: existingBinding.wake)
                    try uploadStore?.saveBinding(existingBinding)
                    syncDiagnosticsLog("SyncEngine", "updated existing binding host after pairing confirmation host=\(confirmedHost)")
                } else if existingBinding.deviceId == serverId,
                          let newWake = wakeCapability(fromHelloPayload: helloRes) {
                    let mergedWake = mergeWakeCapability(newWake: newWake, existingWake: existingBinding.wake)
                    if existingBinding.wake != mergedWake {
                        existingBinding.wake = mergedWake
                        try uploadStore?.saveBinding(existingBinding)
                        syncDiagnosticsLog("SyncEngine", "updated existing binding wake metadata after pairing confirmation")
                    }
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
                    host: confirmedHost,
                    port: port,
                        pairingId: "",
                        pairingTokenKeychainRef: keychainKey,
                        shareName: helloRes["serverCapabilities"].flatMap { ($0 as? [String: Any])?["shareName"] as? String },
                        lastBoundAt: ISO8601DateFormatter().string(from: Date()),
                        wake: wakeCapability(fromHelloPayload: helloRes)
                    )
                try? persistBinding(binding)
                resetAutoUploadStateForFreshPairing(reason: "recreate_local_binding_auth_not_required")
                // Re-index Bonjour entry under the server UUID (only if originally found via Bonjour).
                if let bonjourDevice = discoveredDevices[deviceId] {
                    discoveredDevices[serverId] = bonjourDevice
                }
                slog("[SyncEngine] recreated local binding for \(serverId)")
            }

            // Both sub-branches above (device switch / recreate) just persisted
            // a new binding. Mirror the PAIR_REQ success path's housekeeping so
            // RN learns about the change: cache sidecarHost, mark connected,
            // emit onBindingStateChanged so SyncActivityScreen re-renders, and
            // fire an immediate presence heartbeat so the desktop sees us.
            sidecarHost = confirmedHost
            updateBindingConnectionState(.connected, reason: "auth_not_required_pairing_confirmed")
            if let updatedBinding = uploadStore?.getBinding() {
                NativeSyncEngineModule.shared?.emitBindingStateChanged(bindingStatePayload(binding: updatedBinding))
            }
            // Emit a fresh idle SyncOverview so SyncActivity drops the previous
            // device's progress/completed counters from its UI cache.
            NativeSyncEngineModule.shared?.emitSyncStateChanged(
                runtimeSyncOverviewPayload(uploadState: "idle")
            )
            sendPresenceHeartbeat(clientId: clientId)

            // Sync is no longer triggered automatically after pairing.
            // The user will initiate sync from the album workbench or sync screen.
            return
        }

        // 3. PAIR_REQ → PAIR_RES  (spec Section 7.8)
        var pairPayload: [String: Any] = [
            "clientId": clientId,
            "stableDeviceId": bindingService.getOrCreateStableDeviceId(),
            "clientName": getClientDisplayName(),
            "connectionCode": trimmedConnectionCode,
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
            if let code = structuredPairingErrorCode(pairRes["errorCode"]) {
                throw structuredPairingError(
                    code: code,
                    rawMessage: errMsg,
                    meta: pairingErrorMetadata(pairRes["errorMeta"])
                )
            }
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
        let didSwitchDevice: Bool
        if let existingBinding = uploadStore?.getBinding(), existingBinding.deviceId != serverId {
            didSwitchDevice = true
            interruptActiveSyncForBindingChange(
                reason: "pair_device_switch_confirmed \(existingBinding.deviceId) -> \(serverId)"
            )
            slog(
                "[SyncEngine] device switch detected: %@ → %@, resetting upload queue",
                existingBinding.deviceId, serverId
            )
            try? uploadStore?.resetUploadQueue()
            resetAutoUploadStateForFreshPairing(reason: "device_switch_pair_required")
            didAttemptRemoteHistoryReconciliation = false
            clearRuntimeSyncRoundProgress(uploadState: "idle")
        } else {
            didSwitchDevice = false
            resetAutoUploadStateForFreshPairing(reason: "successful_pairing")
        }

        let binding = BindingRecord(
            deviceId: serverId,
            deviceName: serverInfo["serverName"] as? String ?? "",
            deviceAlias: nil,
            deviceType: inferredBindingDeviceType(for: deviceId),
            host: confirmedHost,
            port: port,
            pairingId: pairRes["pairingId"] as? String ?? "",
            pairingTokenKeychainRef: keychainKey,
            shareName: serverInfo["shareName"] as? String,
            lastBoundAt: ISO8601DateFormatter().string(from: Date()),
            wake: wakeCapability(fromHelloPayload: helloRes)
        )
        try persistBinding(binding)

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
        sidecarHost = confirmedHost
        updateBindingConnectionState(.connected, reason: "pairing_confirmed_reachable")
        NativeSyncEngineModule.shared?.emitBindingStateChanged(bindingStatePayload(binding: binding))
        if didSwitchDevice {
            NativeSyncEngineModule.shared?.emitSyncStateChanged(
                runtimeSyncOverviewPayload(uploadState: "idle")
            )
        }

        // 7. Send a presence heartbeat so the desktop UI shows device as online
        //    immediately after pairing, without waiting for a full sync cycle.
        sendPresenceHeartbeat(clientId: clientId)

        slog("[SyncEngine] pairing successful — sync deferred until user action")
    }

    func disconnectAndUnbind() async throws {
        slog("[SyncEngine] disconnectAndUnbind")
        interruptActiveSyncForBindingChange(reason: "disconnect_and_unbind")
        // Clear the token stored under the binding's per-device key (and the legacy
        // global key for bindings created before per-device storage was introduced).
        if let binding = uploadStore?.getBinding() {
            bindingService.clearPairingToken(forKey: binding.pairingTokenKeychainRef)
        }
        bindingService.clearPairingToken()  // also wipe any legacy single-key token
        try uploadStore?.clearBinding()
        try? uploadStore?.resetUploadQueue()
        currentBinding = nil

        // Reset auto upload config so the next pairing starts with auto upload off.
        // Without this, a stale "active" state from the previous session would cause
        // the sync activity screen to show "auto upload running" immediately after
        // re-pairing, even though the user never enabled it for the new session.
        try? uploadStore?.resetAutoUploadConfig()
        isAutoUploadInterrupted = false
        clearRuntimeSyncRoundProgress(uploadState: "idle")
        runtimeUploadState = "idle"
        runtimeLastCompletedTaskSource = nil
        runtimeRoundSource = nil

        stopPresenceHeartbeatTimer()
        stopP2PTunnel(reason: "disconnectAndUnbind")
        bindingConnectionState = .offline
        clearSharedFilesReachability(reason: "disconnectAndUnbind")
        sidecarHost = nil
        // M8: terminal cleanup — force-release clears any nested refcount.
        forceEndBackgroundTransition(reason: "disconnectAndUnbind")
        isSyncing = false
        protocolSession?.disconnect()
        protocolSession = nil
        transport.disconnect()
        sessionService.endSession()
        NativeSyncEngineModule.shared?.emitBindingStateChanged(nil)
        emitQueueToJS()
        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            runtimeSyncOverviewPayload(uploadState: "idle", includePersistedIdleStats: false)
        )
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
        let normalizedCursor = cursor?.trimmingCharacters(in: .whitespacesAndNewlines)
        let result = historyStore.getDailyLedgers(
            cursor: normalizedCursor?.isEmpty == true ? nil : normalizedCursor
        )
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
                "osVersion": "\(device.systemName) \(device.systemVersion)",
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
            // Current NWPath summary — pivotal for "why did the handset
            // stop discovering the Mac" reports: reveals WiFi/cellular
            // state, interface names, and constrained/expensive flags.
            "networkPath": NetworkPathObserver.shared.snapshot(),
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
            slog("[SyncPipeline] using forced sidecar host: %@:%d", forcedTarget.host, Int(forcedTarget.port))
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
        try throwIfBindingChanged(expectedDeviceId: binding.deviceId)
        sidecarHost = preferredSidecarHost(probedHost: transport.remoteHost, device: targetDevice)
            ?? SidecarHostResolutionPolicy.usableFallbackHost(binding.host)
        slog("[SyncPipeline] resolved sidecar host: %@", sidecarHost ?? "nil")

        // Auth so sidecar registers us as connected
        let (helloType, helloRes) = try await session.sendAndReceive(
            type: .helloReq,
            payload: await buildClientHelloPayload(clientId: clientId, pairingToken: token)
        )
        try throwIfHelloErrorFrame(type: helloType, payload: helloRes)
        try throwIfBindingChanged(expectedDeviceId: binding.deviceId)
        if helloType == .helloRes {
            try throwIfIncompatibleDesktopAppVersion(payload: helloRes)
            refreshBoundServerMetadata(
                expectedDeviceId: binding.deviceId,
                serverName: helloRes["serverName"] as? String,
                shareName: helloRes["serverCapabilities"]
                    .flatMap { ($0 as? [String: Any])?["shareName"] as? String },
                host: sidecarHost,
                wake: wakeCapability(fromHelloPayload: helloRes)
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

    private struct HistoryReconciliationResult {
        let restoredCount: Int
        let scannedAssets: [ScannedAsset]?

        static let skipped = HistoryReconciliationResult(restoredCount: 0, scannedAssets: nil)
    }

    private func restoreCompletedUploadHistoryIfNeeded(
        clientId: String,
        fallbackHost: String,
        expectedDeviceId: String
    ) async -> HistoryReconciliationResult {
        guard !didAttemptRemoteHistoryReconciliation else { return .skipped }
        guard uploadStore?.getBinding()?.deviceId == expectedDeviceId else {
            syncDiagnosticsLog(
                "SyncPipeline",
                "skip history reconciliation for stale device=\(expectedDeviceId)"
            )
            return .skipped
        }

        guard let store = uploadStore else { return .skipped }
        guard store.getTrackedFileKeys().isEmpty else { return .skipped }
        let host = (sidecarHost?.isEmpty == false ? sidecarHost : fallbackHost)
        guard let host, !host.isEmpty else {
            slog("[SyncPipeline] skip history reconciliation: sidecar host unavailable")
            syncDiagnosticsLog("SyncPipeline", "skip history reconciliation: sidecar host unavailable")
            return .skipped
        }
        didAttemptRemoteHistoryReconciliation = true

        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            runtimeSyncOverviewPayload(uploadState: "reconciling")
        )

        do {
            let remoteCompletedFileKeys = try await fetchRemoteExistingFileKeys(clientId: clientId, host: host)
            guard uploadStore?.getBinding()?.deviceId == expectedDeviceId else {
                syncDiagnosticsLog(
                    "SyncPipeline",
                    "discarded history reconciliation result for stale device=\(expectedDeviceId)"
                )
                return .skipped
            }
            guard !remoteCompletedFileKeys.isEmpty else {
                slog("[SyncPipeline] no remote files available on sidecar for reconciliation")
                syncDiagnosticsLog("SyncPipeline", "no remote files available on sidecar for reconciliation")
                return .skipped
            }

            let scannedAssets = photoScanner.scanForUntrackedAssets(clientId: clientId, trackedFileKeys: [])
            guard uploadStore?.getBinding()?.deviceId == expectedDeviceId else {
                syncDiagnosticsLog(
                    "SyncPipeline",
                    "discarded scanned reconciliation assets for stale device=\(expectedDeviceId)"
                )
                return .skipped
            }
            let matchingAssets = scannedAssets.filter { remoteCompletedFileKeys.contains($0.fileKey) }
            guard !matchingAssets.isEmpty else {
                slog(
                    "[SyncPipeline] sidecar existing-file-keys returned %d keys but none match current photo library",
                    remoteCompletedFileKeys.count
                )
                syncDiagnosticsLog(
                    "SyncPipeline",
                    "sidecar existing-file-keys returned \(remoteCompletedFileKeys.count) keys but none match current photo library"
                )
                return HistoryReconciliationResult(restoredCount: 0, scannedAssets: scannedAssets)
            }

            let now = ISO8601DateFormatter().string(from: Date())
            let restoredItems = matchingAssets.compactMap { asset -> UploadItemRecord? in
                guard let photoAsset = asset.asset else { return nil }
                return UploadItemRecord(
                    id: nil,
                    assetLocalId: photoAsset.localIdentifier,
                    modifiedAt: photoAsset.modificationDate?.iso8601String ?? "",
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
            guard uploadStore?.getBinding()?.deviceId == expectedDeviceId else {
                syncDiagnosticsLog(
                    "SyncPipeline",
                    "skipped restoring history for stale device=\(expectedDeviceId)"
                )
                return .skipped
            }
            try store.upsertUploadItems(restoredItems)
            emitQueueToJS()

            slog(
                "[SyncPipeline] restored %d/%d sidecar-confirmed uploads into local history",
                restoredItems.count,
                remoteCompletedFileKeys.count
            )
            syncDiagnosticsLog(
                "SyncPipeline",
                "restored \(restoredItems.count)/\(remoteCompletedFileKeys.count) sidecar-confirmed uploads into local history"
            )
            return HistoryReconciliationResult(restoredCount: restoredItems.count, scannedAssets: scannedAssets)
        } catch {
            slog("[SyncPipeline] history reconciliation failed: %@", "\(error)")
            syncDiagnosticsLog("SyncPipeline", "history reconciliation failed: \(error)")
            return .skipped
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
        guard let expectedDeviceId = uploadStore?.getBinding()?.deviceId,
              let host = currentPresenceHeartbeatHost() else {
            return
        }
        let hostPart = host.contains(":") ? "[\(host)]" : host
        let portPart = 39394
        let usedTunnelRoute = false
        let urlStr = "http://\(hostPart):\(portPart)/presence/\(clientId)"
        guard let url = URL(string: urlStr) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        heartbeatSession.dataTask(with: request) { data, response, error in
            let currentHost = self.currentPresenceHeartbeatHost()
            if currentHost != host {
                syncDiagnosticsLog(
                    "Presence",
                    "heartbeat ignored stale host=\(host) current=\(currentHost ?? "nil") reason=\(failureReason)"
                )
                completion?(false)
                return
            }
            guard self.uploadStore?.getBinding()?.deviceId == expectedDeviceId else {
                syncDiagnosticsLog(
                    "Presence",
                    "heartbeat ignored stale device=\(expectedDeviceId) host=\(host)"
                )
                completion?(false)
                return
            }
            if let error {
                slog("[Presence] heartbeat failed: %@", "\(error)")
                syncDiagnosticsLog("Presence", "heartbeat failed host=\(host) reason=\(failureReason) error=\(error)")
                let sharedFileTunnelState = self.currentSharedFileTunnelOperationState()
                if SharedFilesRoutePolicy.shouldSuppressPresenceTunnelFailure(
                    isTunnelRoute: usedTunnelRoute,
                    activeSharedFileTunnelOperations: sharedFileTunnelState.activeOperations,
                    secondsSinceLastSharedFileTunnelOperation: sharedFileTunnelState.secondsSinceLastOperation
                ) {
                    syncDiagnosticsLog(
                        "Presence",
                        "heartbeat failed on tunnel route near shared file tunnel activity; suppressing tunnel restart reason=\(failureReason) active=\(sharedFileTunnelState.activeOperations) secondsSinceLast=\(sharedFileTunnelState.secondsSinceLastOperation.map { String(format: "%.3f", $0) } ?? "nil")"
                    )
                    self.maintainConnectedBindingState(
                        reason: "\(failureReason)_shared_file_tunnel_active"
                    )
                    completion?(true)
                    return
                }
                if SharedFilesRoutePolicy.shouldInvalidateTunnelAfterRouteFailure(isTunnelRoute: usedTunnelRoute) {
                    syncDiagnosticsLog(
                        "Presence",
                        "heartbeat failed on tunnel route; restarting P2P tunnel reason=\(failureReason)"
                    )
                    self.restartP2PTunnel(reason: "\(failureReason)_tunnel_failed")
                }
                if updateStateOnFailure {
                    self.updateBindingConnectionState(.offline, reason: failureReason)
                }
                completion?(false)
            } else {
                let statusCode = (response as? HTTPURLResponse)?.statusCode
                let payload = data.flatMap {
                    try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
                }
                let responseServerId = payload?["serverId"] as? String
                let responseWake = WakeCapability.fromJSONValue(payload?["wake"])
                let responsePower = DesktopPowerSnapshot.fromJSONValue(payload?["power"])
                let hasWakePayload = payload?["wake"] != nil
                let hasPowerPayload = payload?["power"] != nil
                guard PresenceReconnectPolicy.presenceResponseMatchesBinding(
                    expectedDeviceId: expectedDeviceId,
                    responseServerId: responseServerId
                ) else {
                    syncDiagnosticsLog(
                        "Presence",
                        "heartbeat rejected host=\(host) status=\(statusCode.map(String.init) ?? "nil") expectedServerId=\(expectedDeviceId) responseServerId=\(responseServerId ?? "nil") reason=\(failureReason)_server_mismatch"
                    )
                    if updateStateOnFailure {
                        self.updateBindingConnectionState(.offline, reason: "\(failureReason)_server_mismatch")
                    }
                    completion?(false)
                    return
                }
                if let statusCode {
                    slog("[Presence] heartbeat succeeded: HTTP %d", statusCode)
                    syncDiagnosticsLog(
                        "Presence",
                        "heartbeat succeeded host=\(host) status=\(statusCode) reason=\(successReason) hasWakePayload=\(hasWakePayload) hasPowerPayload=\(hasPowerPayload) \(self.wakeCapabilityLogSummary(responseWake)) \(self.desktopPowerLogSummary(responsePower))"
                    )
                } else {
                    slog("[Presence] heartbeat succeeded")
                    syncDiagnosticsLog(
                        "Presence",
                        "heartbeat succeeded host=\(host) reason=\(successReason) hasWakePayload=\(hasWakePayload) hasPowerPayload=\(hasPowerPayload) \(self.wakeCapabilityLogSummary(responseWake)) \(self.desktopPowerLogSummary(responsePower))"
                    )
                }
                self.refreshBoundServerMetadata(
                    expectedDeviceId: expectedDeviceId,
                    serverName: payload?["serverName"] as? String,
                    shareName: payload?["shareName"] as? String,
                    host: host,
                    wake: responseWake
                )
                self.updateBindingConnectionState(.connected, reason: successReason)
                completion?(true)
            }
        }.resume()
    }

    private func confirmDesktopFullResume(
        host: String,
        expectedDeviceId: String,
        wakeAttemptStartedAt: Date,
        reason: String
    ) async -> Bool {
        let clientId = bindingService.getOrCreateClientId()
        let hostPart = host.contains(":") ? "[\(host)]" : host
        guard let url = URL(string: "http://\(hostPart):39394/presence/\(clientId)") else {
            return false
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 3
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let statusCode = (response as? HTTPURLResponse)?.statusCode
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let responseServerId = payload?["serverId"] as? String
            let power = DesktopPowerSnapshot.fromJSONValue(payload?["power"])
            guard let lastResumeAt = power?.lastResumeAt else {
                syncDiagnosticsLog(
                    "SharedFiles",
                    "wake full resume unconfirmed host=\(host) reason=\(reason) status=\(statusCode.map(String.init) ?? "nil") expectedServerId=\(expectedDeviceId) responseServerId=\(responseServerId ?? "nil") \(desktopPowerLogSummary(power))"
                )
                return false
            }
            let confirmed = SharedFilesRoutePolicy.isFullWakeConfirmed(
                expectedDeviceId: expectedDeviceId,
                responseServerId: responseServerId,
                lastResumeAt: lastResumeAt,
                wakeAttemptStartedAt: wakeAttemptStartedAt
            )
            syncDiagnosticsLog(
                "SharedFiles",
                "wake full resume check host=\(host) reason=\(reason) confirmed=\(confirmed) expectedServerId=\(expectedDeviceId) responseServerId=\(responseServerId ?? "nil") attemptStartedAt=\(ISO8601DateFormatter().string(from: wakeAttemptStartedAt)) \(desktopPowerLogSummary(power))"
            )
            return confirmed
        } catch {
            syncDiagnosticsLog(
                "SharedFiles",
                "wake full resume unconfirmed host=\(host) reason=\(reason) error=\(error)"
            )
            return false
        }
    }

    func getClientDisplayName() -> String {
        let rawName = UIDevice.current.name
        let model = UIDevice.current.model
        let clientId = bindingService.getOrCreateClientId()
        var clearedPersistedName = false
        if let stored = bindingService.getClientDisplayName()?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !stored.isEmpty
        {
            if syncFlowGenericClientName(stored, model: model) ||
                syncFlowLegacyGeneratedClientName(stored, model: model, clientId: clientId)
            {
                bindingService.clearClientDisplayName()
                clearedPersistedName = true
            } else {
                return stored
            }
        }

        let defaults = UserDefaults.standard
        if let legacy = defaults.string(forKey: Self.legacyClientNameKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !legacy.isEmpty
        {
            if !syncFlowGenericClientName(legacy, model: model),
               !syncFlowLegacyGeneratedClientName(legacy, model: model, clientId: clientId)
            {
                bindingService.saveClientDisplayName(legacy)
                defaults.removeObject(forKey: Self.legacyClientNameKey)
                if clearedPersistedName {
                    pushClientMetadataUpdateIfPossible()
                }
                return legacy
            }
            clearedPersistedName = true
        }

        defaults.removeObject(forKey: Self.legacyClientNameKey)
        let resolved = syncFlowResolvedDefaultClientDisplayName(rawName: rawName, model: model)
        if clearedPersistedName {
            pushClientMetadataUpdateIfPossible()
        }
        return resolved
    }

    func getClientId() -> String {
        bindingService.getOrCreateClientId()
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

    private func persistAutoUploadInterruptedState(reason: String) {
        isAutoUploadInterrupted = true

        if var config = autoUploadConfigStore?.getConfig() {
            config.state = "interrupted"
            config.updatedAt = ISO8601DateFormatter().string(from: Date())
            do {
                try autoUploadConfigStore?.saveConfig(config)
            } catch {
                slog("[SyncEngine] WARN: failed to persist interrupted state (%@): %@", reason, "\(error)")
            }
        }
    }

    private func persistAutoUploadDisabledState(reason: String) {
        isAutoUploadInterrupted = false

        if var config = autoUploadConfigStore?.getConfig() {
            config.enabled = false
            config.state = "disabled"
            config.updatedAt = ISO8601DateFormatter().string(from: Date())
            do {
                try autoUploadConfigStore?.saveConfig(config)
            } catch {
                slog("[SyncEngine] WARN: failed to persist disabled state (%@): %@", reason, "\(error)")
            }
        }
    }

    /// Interrupt auto upload: skips auto items in queue, only processes manual items.
    /// Once interrupted, user must explicitly re-enable.
    func interruptAutoUpload() {
        guard !isAutoUploadInterrupted else { return }
        persistAutoUploadInterruptedState(reason: "user_interrupt")
        clearRuntimeReconnectError()

        // Clear pending auto items so they don't block manual uploads
        // (dedup check) and re-enabling auto upload starts a fresh scan.
        do {
            try uploadStore?.cancelPendingAutoItems()
        } catch {
            slog("[SyncEngine] WARN: failed to cancel pending auto items: %@", "\(error)")
        }

        let currentTaskSource = uploadStore?.getCurrentUploadingSource()
        if isSyncing && currentTaskSource == "auto" {
            shouldAbortActiveAutoUpload = true
            clearRuntimeSyncRoundProgress(uploadState: "paused_auto_upload")
            maintainConnectedBindingState(reason: "interrupt_auto_upload_requested")
            syncDiagnosticsLog("SyncEngine", "interrupting in-flight auto upload")
            interruptActiveUploadResponse(
                error: SyncEngineError.autoUploadInterrupted,
                reason: "interrupt_auto_upload_requested"
            )
        } else if currentTaskSource != "manual" &&
                    runtimeLastCompletedTaskSource == "auto" &&
                    runtimeQueueTotalCount > 0 &&
                    runtimeQueueCompletedCount >= runtimeQueueTotalCount {
            clearRuntimeSyncRoundProgress(uploadState: "paused_auto_upload")
        }
        emitQueueToJS()

        slog("[SyncEngine] auto upload interrupted")
        syncDiagnosticsLog("SyncEngine", "auto upload interrupted")
        sessionService.transitionTo(.interruptedAutoUpload)
        let payload = runtimeSyncOverviewPayload(uploadState: "paused_auto_upload")
        logSyncOverviewEmission("interrupt_auto_upload", payload: payload)
        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            payload
        )
    }

    /// Disable auto upload: persists the feature as disabled and stops auto work.
    /// Unlike interruptAutoUpload(), this represents the user turning the feature off.
    func disableAutoUpload() {
        persistAutoUploadDisabledState(reason: "user_disable")
        clearRuntimeReconnectError()

        do {
            try uploadStore?.cancelPendingAutoItems()
        } catch {
            slog("[SyncEngine] WARN: failed to cancel pending auto items while disabling auto upload: %@", "\(error)")
        }

        let currentTaskSource = uploadStore?.getCurrentUploadingSource()
        if isSyncing && currentTaskSource == "auto" {
            shouldAbortActiveAutoUpload = true
            clearRuntimeSyncRoundProgress(uploadState: "idle")
            maintainConnectedBindingState(reason: "disable_auto_upload_requested")
            syncDiagnosticsLog("SyncEngine", "disabling in-flight auto upload")
            interruptActiveUploadResponse(
                error: SyncEngineError.autoUploadInterrupted,
                reason: "disable_auto_upload_requested"
            )
        } else {
            shouldAbortActiveAutoUpload = false
            runtimeLastCompletedTaskSource = nil
            runtimeRoundSource = nil
        }

        emitQueueToJS()

        slog("[SyncEngine] auto upload disabled")
        syncDiagnosticsLog("SyncEngine", "auto upload disabled")
        sessionService.transitionTo(.idle)
        let payload = runtimeSyncOverviewPayload(uploadState: "idle")
        logSyncOverviewEmission("disable_auto_upload", payload: payload)
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
                slog("[SyncEngine] WARN: failed to persist active state: %@", "\(error)")
            }
        }

        slog("[SyncEngine] auto upload re-enabled")
        syncDiagnosticsLog("SyncEngine", "auto upload re-enabled")
        let currentTaskSource = uploadStore?.getCurrentUploadingSource()
        if currentTaskSource == nil &&
            runtimeQueueTotalCount > 0 &&
            runtimeQueueCompletedCount >= runtimeQueueTotalCount {
            clearRuntimeSyncRoundProgress(uploadState: "idle")
        }
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

    /// Cancel remaining items in a manual queue.
    func cancelManualBatch(batchId: String) throws {
        try uploadStore?.cancelManualBatch(batchId: batchId)
        slog("[SyncEngine] cancelled manual queue %@", batchId)
        syncDiagnosticsLog("SyncEngine", "cancelled manual queue \(batchId)")
        emitQueueToJS()
    }

    func cancelAllManualUploads() throws {
        let currentTaskSource = uploadStore?.getCurrentUploadingSource()
        let shouldAbortActiveManual = isSyncing && currentTaskSource == "manual"
        try uploadStore?.cancelAllManualUploads()
        if shouldAbortActiveManual {
            shouldAbortActiveManualUpload = true
            interruptActiveUploadResponse(
                error: SyncEngineError.manualUploadCancelled,
                reason: "cancel_manual_upload_requested"
            )
        }
        clearRuntimeSyncRoundProgress(uploadState: "idle")
        runtimeManualUploadCancelled = true
        clearRuntimeReconnectError()
        photoLibraryChanged = true
        resumeWatchLoopIfNeeded()
        maintainConnectedBindingState(reason: "cancel_manual_upload_requested")
        slog("[SyncEngine] cancelled entire manual upload queue")
        syncDiagnosticsLog("SyncEngine", "cancelled entire manual upload queue")
        emitQueueToJS()
        let payload = runtimeSyncOverviewPayload(
            uploadState: "idle",
            includePersistedIdleStats: false
        )
        logSyncOverviewEmission("cancel_manual_upload", payload: payload)
        NativeSyncEngineModule.shared?.emitSyncStateChanged(payload)
    }

    // MARK: - Album Browser

    private lazy var thumbnailCacheDir: URL = {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("syncflow_album_thumbs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private func runOnAlbumBrowserQueue<T>(_ operation: () -> T) -> T {
        if DispatchQueue.getSpecific(key: albumBrowserQueueKey) != nil {
            return operation()
        }
        return albumBrowserQueue.sync(execute: operation)
    }

    private func canReadPhotoLibrary() -> Bool {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return status == .authorized || status == .limited
    }

    func browseAlbum(
        mediaFilter: String,
        transferFilter: String,
        offset: Int,
        limit: Int,
        collectionId: String? = nil
    ) -> [[String: Any]] {
        runOnAlbumBrowserQueue {
            guard let service = albumBrowserService else { return [] }
            var assets = service.fetchAlbumAssets(
                mediaFilter: mediaFilter,
                transferFilter: transferFilter,
                offset: offset,
                limit: limit,
                collectionId: collectionId
            )

            if assets.isEmpty && offset == 0 && canReadPhotoLibrary() {
                Thread.sleep(forTimeInterval: 0.25)
                assets = service.fetchAlbumAssets(
                    mediaFilter: mediaFilter,
                    transferFilter: transferFilter,
                    offset: offset,
                    limit: limit,
                    collectionId: collectionId
                )
            }

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

        // Generate thumbnail. PhotoKit's backing XPC service can be restarted by
        // iOS under pressure; a short retry avoids transient blank cells.
        var image = service.getThumbnail(assetLocalId: assetLocalId, size: size)
        if image == nil && canReadPhotoLibrary() {
            Thread.sleep(forTimeInterval: 0.15)
            image = service.getThumbnail(assetLocalId: assetLocalId, size: size)
        }
        guard let image,
              let data = image.jpegData(compressionQuality: 0.7) else {
            return ""
        }
        try? data.write(to: thumbFile, options: .atomic)
        return thumbFile.absoluteString
    }

    func getAlbumStats() -> [String: Any] {
        runOnAlbumBrowserQueue {
            guard let service = albumBrowserService else {
                return [
                    "totalCount": 0,
                    "transferredCount": 0,
                    "queuedCount": 0,
                    "pendingCount": 0,
                ]
            }
            var stats = service.getAlbumStats()
            if stats.totalCount == 0 && canReadPhotoLibrary() {
                Thread.sleep(forTimeInterval: 0.25)
                stats = service.getAlbumStats()
            }
            return [
                "totalCount": stats.totalCount,
                "transferredCount": stats.transferredCount,
                "queuedCount": stats.queuedCount,
                "pendingCount": stats.pendingCount,
            ]
        }
    }

    func getAlbumCollections(mediaFilter: String) -> [[String: Any]] {
        runOnAlbumBrowserQueue {
            guard let service = albumBrowserService else { return [] }
            var collections = service.getAlbumCollections(mediaFilter: mediaFilter)
            if collections.isEmpty && canReadPhotoLibrary() {
                Thread.sleep(forTimeInterval: 0.25)
                collections = service.getAlbumCollections(mediaFilter: mediaFilter)
            }
            return collections
        }
    }

    func getAssetPreviewSource(assetLocalId: String) -> [String: Any] {
        runOnAlbumBrowserQueue {
            guard let service = albumBrowserService else {
                return ["uri": "", "mediaType": "image", "error": "not_found"]
            }
            var result = service.getPreviewSource(assetLocalId: assetLocalId)
            if (result["error"] as? String) == "not_found" && canReadPhotoLibrary() {
                Thread.sleep(forTimeInterval: 0.25)
                result = service.getPreviewSource(assetLocalId: assetLocalId)
            }
            return result
        }
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
        if result.queuedCount > 0 {
            runtimeManualUploadCancelled = false
        }

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

    func submitDocumentUploads(fileURLs: [URL]) -> [String: Any] {
        guard let service = manualUploadService else {
            return ["queuedCount": 0, "skippedCount": fileURLs.count, "batchId": "", "files": []]
        }

        let result = service.submitDocumentUploads(fileURLs: fileURLs)
        if result.queuedCount > 0 {
            runtimeManualUploadCancelled = false
        }

        emitQueueToJS()
        NativeSyncEngineModule.shared?.emitSyncStateChanged(runtimeSyncOverviewPayload(uploadState: "idle"))

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
            "files": result.files,
        ]
    }

    // MARK: - Auto Upload Config

    func getAutoUploadConfig() -> [String: Any] {
        guard let configStore = autoUploadConfigStore else {
            return [
                "enabled": false,
                "timeRangeMode": "all",
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
            slog("[SyncEngine] auto-upload enabled — waking scan loop")
            photoLibraryChanged = true
            resumeWatchLoopIfNeeded()
        }

        // Config changed while already active — wake loop to pick up changes
        if newEnabled && currentConfig.state == "active" && isSyncing {
            slog("[SyncEngine] auto-upload config changed — waking scan loop")
            photoLibraryChanged = true
            resumeWatchLoopIfNeeded()
        }
    }

    // MARK: - Shared Files

    private func sharedFilesDiscoveryDevice(for binding: BindingRecord) -> DiscoveredDevice? {
        if let device = discoveredDevices[binding.deviceId] {
            return device
        }

        let candidates = discoveryService.candidateDevicesSnapshot()
        if let exactMatch = candidates.first(where: { $0.deviceId == binding.deviceId }) {
            syncDiagnosticsLog(
                "SharedFiles",
                "using Bonjour candidate for shared files device=\(binding.deviceId) host=\(exactMatch.ip)"
            )
            return exactMatch
        }

        let expectedNames = Set(
            [binding.deviceName, binding.deviceAlias].compactMap {
                $0?.trimmingCharacters(in: .whitespacesAndNewlines)
            }.filter { !$0.isEmpty }
        )
        let nameMatches = candidates.filter { expectedNames.contains($0.name) }
        if nameMatches.count == 1, let matchedDevice = nameMatches.first {
            syncDiagnosticsLog(
                "SharedFiles",
                "using unique Bonjour candidate by name for shared files bindingDevice=\(binding.deviceId) candidateDevice=\(matchedDevice.deviceId) name=\(matchedDevice.name) host=\(matchedDevice.ip)"
            )
            return matchedDevice
        }

        let summary = candidates.map {
            "\($0.name)/\($0.ip.isEmpty ? "no-ip" : $0.ip)/\($0.deviceId)"
        }.joined(separator: ", ")
        syncDiagnosticsLog(
            "SharedFiles",
            "no Bonjour candidate for shared files bindingDevice=\(binding.deviceId) candidates=\(summary.isEmpty ? "none" : summary)"
        )
        return nil
    }

    private func freshSharedFilesLANHost(for binding: BindingRecord) -> String? {
        guard let device = sharedFilesDiscoveryDevice(for: binding) else {
            return nil
        }
        let resolvedHost = preferredSidecarHost(probedHost: device.ip, device: device)
        guard let host = SharedFilesRoutePolicy.freshLANHost(discoveredHost: resolvedHost) else {
            syncDiagnosticsLog(
                "SharedFiles",
                "ignored discovery host for shared files host=\(resolvedHost ?? "nil") device=\(binding.deviceId)"
            )
            return nil
        }

        if sidecarHost != host {
            syncDiagnosticsLog(
                "SharedFiles",
                "shared files LAN host refreshed \(sidecarHost ?? "nil") -> \(host)"
            )
        }
        sidecarHost = host
        refreshBoundServerMetadata(
            expectedDeviceId: binding.deviceId,
            serverName: device.name,
            shareName: device.shareName,
            host: host
        )
        return host
    }

    private func waitForSharedFilesLANHost(
        binding: BindingRecord,
        timeoutNanoseconds: UInt64 = 1_000_000_000
    ) async -> String? {
        let pollInterval: UInt64 = 100_000_000
        var elapsed: UInt64 = 0
        while elapsed < timeoutNanoseconds {
            if let host = freshSharedFilesLANHost(for: binding) {
                return host
            }
            try? await Task.sleep(nanoseconds: pollInterval)
            elapsed += pollInterval
        }
        return freshSharedFilesLANHost(for: binding)
    }

    private func canReachSharedFilesLANHost(_ host: String, timeout: TimeInterval = 1.5) async -> Bool {
        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        components.port = 39394
        components.path = "/health"
        guard let url = components.url else {
            return false
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = timeout

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                syncDiagnosticsLog("SharedFiles", "LAN health probe missing HTTP response host=\(host)")
                return false
            }
            let reachable = (200..<300).contains(httpResponse.statusCode)
            syncDiagnosticsLog("SharedFiles", "LAN health probe host=\(host) status=\(httpResponse.statusCode) reachable=\(reachable)")
            return reachable
        } catch {
            syncDiagnosticsLog("SharedFiles", "LAN health probe failed host=\(host) error=\(error)")
            return false
        }
    }

    private func normalizedICERouteLabel(_ route: String) -> String {
        let normalized = route.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? "unknown" : normalized
    }

    private func canReachSharedFilesTunnelHost(port: UInt16, timeout: TimeInterval = 1.5) async -> Bool {
        var components = URLComponents()
        components.scheme = "http"
        components.host = "127.0.0.1"
        components.port = Int(port)
        components.path = "/health"
        guard let url = components.url else {
            syncDiagnosticsLog("SharedFiles", "tunnel health probe could not build URL port=\(port)")
            return false
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = timeout

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                syncDiagnosticsLog("SharedFiles", "tunnel health probe missing HTTP response port=\(port)")
                return false
            }
            let reachable = (200..<300).contains(httpResponse.statusCode)
            syncDiagnosticsLog("SharedFiles", "tunnel health probe port=\(port) status=\(httpResponse.statusCode) reachable=\(reachable)")
            return reachable
        } catch {
            syncDiagnosticsLog("SharedFiles", "tunnel health probe failed port=\(port) error=\(error)")
            return false
        }
    }

    private func acceptedSharedFilesTunnelHost(
        state: P2PTunnelRouteState,
        hasReachableLANHost: Bool,
        reason: String,
        probeTimeout: TimeInterval = 1.5
    ) async -> String? {
        let selectedRoute = normalizedICERouteLabel(state.selectedICERoute)
        let hasPort = state.port != nil
        guard SharedFilesRoutePolicy.shouldAcceptActiveP2PTunnelRoute(
            isTunnelActive: state.isActive,
            hasTunnelPort: hasPort,
            selectedICERoute: state.selectedICERoute,
            hasReachableLANHost: hasReachableLANHost
        ) else {
            syncDiagnosticsLog(
                "SharedFiles",
                "active P2P tunnel rejected for shared files reason=\(reason) port=\(state.port.map(String.init) ?? "nil") selectedRoute=\(selectedRoute) hasReachableLANHost=\(hasReachableLANHost) policy=not_acceptable"
            )
            return nil
        }

        guard let port = state.port else {
            syncDiagnosticsLog(
                "SharedFiles",
                "active P2P tunnel rejected for shared files reason=\(reason) port=nil selectedRoute=\(selectedRoute) hasReachableLANHost=\(hasReachableLANHost) policy=missing_port"
            )
            return nil
        }

        guard await canReachSharedFilesTunnelHost(port: port, timeout: probeTimeout) else {
            syncDiagnosticsLog(
                "SharedFiles",
                "active P2P tunnel rejected for shared files reason=\(reason) port=\(port) selectedRoute=\(selectedRoute) hasReachableLANHost=\(hasReachableLANHost) health=failed"
            )
            return nil
        }

        syncDiagnosticsLog(
            "SharedFiles",
            "active P2P tunnel accepted for shared files reason=\(reason) port=\(port) selectedRoute=\(selectedRoute) hasReachableLANHost=\(hasReachableLANHost) health=ok"
        )
        return "127.0.0.1:\(port)"
    }

    private func restartRejectedSharedFilesTunnel(
        state: P2PTunnelRouteState,
        reason: String
    ) async {
        guard state.isActive || state.isStarting else {
            return
        }
        syncDiagnosticsLog(
            "SharedFiles",
            "restarting rejected P2P tunnel reason=\(reason) active=\(state.isActive) starting=\(state.isStarting) port=\(state.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(state.selectedICERoute))"
        )
        let nextRouteMode = SharedFilesRoutePolicy.nextP2PTunnelRouteModeAfterRejectedRoute(
            currentRouteMode: state.routeMode,
            selectedICERoute: state.selectedICERoute
        )
        updateSharedFilesReachability(
            .unknown,
            route: sharedFilesReachabilityRoute(forTunnelRouteMode: nextRouteMode),
            reason: "\(reason)_rejected_tunnel_retry_\(nextRouteMode)"
        )
        await restartP2PTunnelAndWait(
            reason: "\(reason)_rejected_tunnel",
            routeMode: nextRouteMode
        )
        if state.routeMode != nextRouteMode {
            syncDiagnosticsLog(
                "SharedFiles",
                "advanced P2P tunnel route mode reason=\(reason) \(state.routeMode)->\(nextRouteMode) selectedRoute=\(normalizedICERouteLabel(state.selectedICERoute))"
            )
        }
    }

    private func applySharedFilesLANRoute(host: String, reason: String) {
        sharedFilesService.sidecarHost = host
        sharedFilesService.useTunnelRoute = false
        updateSharedFilesReachability(
            .available,
            route: .lan,
            reason: reason
        )
    }

    private func applySharedFilesTunnelRoute(reason: String) {
        sharedFilesService.useTunnelRoute = true
        updateSharedFilesReachability(
            .available,
            route: currentSharedFilesTunnelReachabilityRoute(),
            reason: reason
        )
    }

    private func currentSharedFilesTunnelReachabilityRoute() -> SharedFilesReachabilityRoute {
        if localTCPProxy.currentSelectedICERoute() == "turn_relay" {
            return .relay
        }
        return .tunnel
    }

    private func sharedFilesReachabilityRoute(forTunnelRouteMode routeMode: String) -> SharedFilesReachabilityRoute {
        if routeMode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == SharedFilesRoutePolicy.p2pTunnelRouteModeRelay {
            return .relay
        }
        return .tunnel
    }

    private func reachableSharedFilesLANHost(
        for binding: BindingRecord,
        probeTimeout: TimeInterval = 1.0
    ) async -> String? {
        var candidates: [String] = []
        if let freshHost = freshSharedFilesLANHost(for: binding) {
            candidates.append(freshHost)
        }
        if let fallbackHost = SharedFilesRoutePolicy.fallbackDirectHost(
            liveHost: sidecarHost,
            currentBindingHost: currentBinding?.sidecarHost,
            persistedHost: binding.host
        ),
           SharedFilesRoutePolicy.isPrivateLANIPv4(fallbackHost),
           !candidates.contains(fallbackHost)
        {
            candidates.append(fallbackHost)
        }

        for host in candidates {
            if await canReachSharedFilesLANHost(host, timeout: probeTimeout) {
                return host
            }
        }
        return nil
    }

    private func fallbackDirectSharedFilesHost(
        for binding: BindingRecord,
        excluding excludedHost: String?
    ) -> String? {
        var fallbackHost = SharedFilesRoutePolicy.fallbackDirectHost(
            liveHost: sidecarHost,
            currentBindingHost: currentBinding?.sidecarHost,
            persistedHost: binding.host
        )
        if let excludedHost, fallbackHost == excludedHost {
            fallbackHost = nil
        }
        return fallbackHost
    }

    private func reachableFallbackDirectSharedFilesHost(
        for binding: BindingRecord,
        excluding excludedHost: String?,
        probeTimeout: TimeInterval = 1.0
    ) async -> String? {
        guard let host = fallbackDirectSharedFilesHost(for: binding, excluding: excludedHost),
              SharedFilesRoutePolicy.isPrivateLANIPv4(host)
        else {
            return nil
        }
        if await canReachSharedFilesLANHost(host, timeout: probeTimeout) {
            return host
        }
        syncDiagnosticsLog(
            "SharedFiles",
            "cached direct host unavailable for shared files host=\(host)"
        )
        return nil
    }

    private func attemptSharedFilesLANWakeIfNeeded(
        binding: BindingRecord,
        reason: String,
        allowPublicWake: Bool = false
    ) async -> String? {
        syncDiagnosticsLog(
            "SharedFiles",
            "wake candidate reason=\(reason) hasMetadata=\(binding.wake != nil) hasUsableTargets=\(binding.wake?.hasUsableTargets == true) hasPublicTarget=\(binding.wake?.publicTarget != nil) publicTargetEnabled=\(binding.wake?.publicTarget?.enabled == true) \(wakeCapabilityLogSummary(binding.wake))"
        )
        guard let wake = binding.wake,
              wake.hasUsableTargets
        else {
            syncDiagnosticsLog("SharedFiles", "wake skipped reason=\(reason) metadata_missing_or_unusable")
            return nil
        }

        let targets = WakeOnLanService.validTargets(wake.targets)
        syncDiagnosticsLog(
            "SharedFiles",
            "wake target summary reason=\(reason) targets=\(targets.map(describeWakeTarget).joined(separator: "; "))"
        )
        updateSharedFilesReachability(
            .waking,
            route: nil,
            reason: "\(reason)_wake_attempt_started"
        )

        let wakeAttemptStartedAt = Date()
        do {
            let result = try wakeOnLanService.sendWakePackets(
                targets: targets,
                publicTarget: allowPublicWake ? wake.publicTarget : nil
            )
            let failures = result.failures.isEmpty ? "" : " failedDestinations=\(describeWakeFailures(result.failures))"
            syncDiagnosticsLog(
                "SharedFiles",
                "wake packets sent reason=\(reason) targets=\(targets.count) packets=\(result.sentPackets) destinations=\(describeWakeDestinations(result.destinations))\(failures)"
            )
        } catch {
            syncDiagnosticsLog("SharedFiles", "wake packet send failed reason=\(reason) error=\(error)")
            clearSharedFilesReachability(reason: "\(reason)_wake_send_failed")
            return nil
        }

        let deadline = Date().addingTimeInterval(25)
        while Date() < deadline {
            let tunnelState = await p2pTunnelRouteState(startReason: reason)
            if let wokeHost = await acceptedSharedFilesTunnelHost(
                state: tunnelState,
                hasReachableLANHost: false,
                reason: "\(reason)_wake_polling",
                probeTimeout: 1.0
            ) {
                let tunnelReachableReason = SharedFilesRoutePolicy.wakeLANReachableReason(baseReason: reason)
                syncDiagnosticsLog("SharedFiles", "wake early P2P tunnel reachable host=\(wokeHost) reason=\(reason)")
                applySharedFilesTunnelRoute(reason: tunnelReachableReason)
                if bindingConnectionState != .connected {
                    updateBindingConnectionState(.connected, reason: tunnelReachableReason)
                }
                return wokeHost
            }

            if let host = await reachableSharedFilesLANHost(for: binding, probeTimeout: 1.0) {
                let lanReachableReason = SharedFilesRoutePolicy.wakeLANReachableReason(baseReason: reason)
                syncDiagnosticsLog("SharedFiles", "wake LAN reachable host=\(host) reason=\(reason)")
                sidecarHost = host
                applySharedFilesLANRoute(host: host, reason: lanReachableReason)
                if bindingConnectionState != .connected {
                    updateBindingConnectionState(.connected, reason: lanReachableReason)
                }
                if await confirmDesktopFullResume(
                    host: host,
                    expectedDeviceId: binding.deviceId,
                    wakeAttemptStartedAt: wakeAttemptStartedAt,
                    reason: reason
                ) {
                    let fullResumeReason = SharedFilesRoutePolicy.wakeFullResumeConfirmedReason(baseReason: reason)
                    syncDiagnosticsLog("SharedFiles", "wake full resume confirmed host=\(host) reason=\(reason)")
                    updateBindingConnectionState(.connected, reason: fullResumeReason)
                } else {
                    syncDiagnosticsLog("SharedFiles", "LAN reachable but desktop full wake not confirmed host=\(host) reason=\(reason)")
                }
                return host
            }

            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }

        syncDiagnosticsLog("SharedFiles", "wake polling exhausted reason=\(reason)")
        let hasMultiDesktopBindingSource = false
        let hasOnlineViviDropDesktopPeer = false
        if !SharedFilesRoutePolicy.shouldAttemptPeerProxyWake(
            hasMultiDesktopBindingSource: hasMultiDesktopBindingSource,
            hasOnlineViviDropDesktopPeer: hasOnlineViviDropDesktopPeer
        ) {
            for skipReason in SharedFilesRoutePolicy.peerProxySkipReasons(
                hasMultiDesktopBindingSource: hasMultiDesktopBindingSource,
                hasOnlineViviDropDesktopPeer: hasOnlineViviDropDesktopPeer,
                hasThirdPartyHelperConfigured: false
            ) {
                syncDiagnosticsLog("SharedFiles", "peer proxy skipped reason=\(skipReason)")
            }
        }
        clearSharedFilesReachability(reason: "\(reason)_wake_polling_exhausted")
        return nil
    }

    private func describeWakeTarget(_ target: WakeTarget) -> String {
        let ports = target.ports
            .filter { (1...65_535).contains($0) }
            .map(String.init)
            .joined(separator: ",")
        return "interface=\(target.interfaceName) mac=\(maskedWakeMacAddress(target.macAddress)) ipv4=\(target.ipv4Address) broadcast=\(target.broadcastAddress) ports=\(ports)"
    }

    private func describeWakeDestinations(_ destinations: [WakePacketDestination]) -> String {
        destinations
            .map { "\($0.host):\($0.port)" }
            .joined(separator: ",")
    }

    private func describeWakeFailures(_ failures: [WakePacketSendFailure]) -> String {
        failures
            .map { "\($0.destination.host):\($0.destination.port)=\($0.error)" }
            .joined(separator: ",")
    }

    private func maskedWakeMacAddress(_ macAddress: String) -> String {
        let normalized = macAddress
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: ":")
            .lowercased()
        let parts = normalized.split(separator: ":").map(String.init)
        guard parts.count == 6 else { return "<invalid>" }
        return "**:**:**:**:\(parts[4]):\(parts[5])"
    }

    private func refreshSharedFilesWakeMetadataIfNeeded(
        binding: BindingRecord,
        host: String,
        reason: String
    ) {
        guard binding.wake?.hasUsableTargets != true else {
            return
        }
        sidecarHost = host
        syncDiagnosticsLog(
            "SharedFiles",
            "refreshing wake metadata from reachable LAN host=\(host) reason=\(reason)"
        )
        sendPresenceHeartbeat(
            clientId: bindingService.getOrCreateClientId(),
            successReason: "\(reason)_wake_metadata_refresh_succeeded",
            failureReason: "\(reason)_wake_metadata_refresh_failed",
            updateStateOnFailure: false
        )
    }

    private func publishSharedFilesLANReachabilityFromDiscovery(
        binding: BindingRecord,
        host: String,
        reason: String
    ) {
        guard SharedFilesRoutePolicy.shouldPublishLANReachabilityFromDiscovery(
            hasFreshLANHost: SharedFilesRoutePolicy.freshLANHost(discoveredHost: host) != nil
        ) else {
            return
        }
        guard uploadStore?.getBinding()?.deviceId == binding.deviceId else {
            syncDiagnosticsLog(
                "SharedFiles",
                "ignored LAN reachability publish for stale device=\(binding.deviceId)"
            )
            return
        }
        applySharedFilesLANRoute(host: host, reason: reason)
    }

    private func publishSharedFilesP2PReachabilityAfterLANFailure(reason: String) {
        Task { [weak self] in
            await self?.publishSharedFilesP2PReachabilityIfNeeded(reason: reason)
        }
    }

    private func publishSharedFilesP2PReachabilityIfNeeded(reason: String) async {
        guard let binding = uploadStore?.getBinding() else { return }
        let lanHost = await reachableSharedFilesLANHost(for: binding)
        let tunnelState = await p2pTunnelRouteState(startReason: "\(reason)_p2p_route")
        let tunnelHost = await acceptedSharedFilesTunnelHost(
            state: tunnelState,
            hasReachableLANHost: lanHost != nil,
            reason: "\(reason)_reachability_publish",
            probeTimeout: 1.0
        )
        guard tunnelHost != nil,
              SharedFilesRoutePolicy.shouldPublishP2PReachabilityFromTunnel(
                  hasActiveTunnel: tunnelState.isActive,
                  hasReachableLANHost: lanHost != nil
              )
        else {
            syncDiagnosticsLog(
                "SharedFiles",
                "skipped P2P reachability publish reason=\(reason) lanHost=\(lanHost ?? "nil") tunnelActive=\(tunnelState.isActive) port=\(tunnelState.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(tunnelState.selectedICERoute))"
            )
            return
        }
        applySharedFilesTunnelRoute(reason: reason)
    }

    private func prepareSharedFilesRoute(reason: String, allowWake: Bool = false) async throws -> (host: String, isTunnel: Bool) {
        return try await prepareSharedFilesRoute(reason: reason, allowWake: allowWake, allowPublicWake: false)
    }

    private func prepareSharedFilesRoute(
        reason: String,
        allowWake: Bool = false,
        allowPublicWake: Bool = false
    ) async throws -> (host: String, isTunnel: Bool) {
        guard let binding = uploadStore?.getBinding() else {
            sharedFilesService.sidecarHost = nil
            throw SyncEngineError.networkError("No active binding available for shared files")
        }
        syncDiagnosticsLog(
            "SharedFiles",
            "prepare route reason=\(reason) allowWake=\(allowWake) networkPath=\(SharedFilesRoutePolicy.diagnosticNetworkPathSummary(NetworkPathObserver.shared.snapshot())) hasWakeMetadata=\(binding.wake != nil) hasUsableWakeTargets=\(binding.wake?.hasUsableTargets == true) \(wakeCapabilityLogSummary(binding.wake))"
        )

        if !discoveryService.isBrowsing {
            startDiscovery()
        }

        var unreachableLANHost: String?
        if let lanHost = freshSharedFilesLANHost(for: binding) {
            if await canReachSharedFilesLANHost(lanHost),
               SharedFilesRoutePolicy.shouldPreferLANRoute(
                   hasReachableLANHost: true,
                   isTunnelActive: sharedFilesService.isTunnelActive
               )
            {
                sharedFilesService.sidecarHost = lanHost
                sharedFilesService.useTunnelRoute = false
                if allowWake {
                    refreshSharedFilesWakeMetadataIfNeeded(
                        binding: binding,
                        host: lanHost,
                        reason: reason
                    )
                }
                return (lanHost, false)
            }
            unreachableLANHost = lanHost
            syncDiagnosticsLog(
                "SharedFiles",
                "LAN host unavailable for shared files host=\(lanHost); trying P2P tunnel"
            )
        }

        if let directHost = await reachableFallbackDirectSharedFilesHost(for: binding, excluding: unreachableLANHost) {
            syncDiagnosticsLog(
                "SharedFiles",
                "using cached direct LAN host before P2P route state host=\(directHost) reason=\(reason)"
            )
            sidecarHost = directHost
            sharedFilesService.sidecarHost = directHost
            sharedFilesService.useTunnelRoute = false
            return (directHost, false)
        }

        if let discoveredHost = await waitForSharedFilesLANHost(binding: binding),
           await canReachSharedFilesLANHost(discoveredHost),
           SharedFilesRoutePolicy.shouldPreferLANRoute(
               hasReachableLANHost: true,
               isTunnelActive: sharedFilesService.isTunnelActive
           )
        {
            syncDiagnosticsLog(
                "SharedFiles",
                "using discovered LAN host before P2P route state host=\(discoveredHost) reason=\(reason)"
            )
            sidecarHost = discoveredHost
            sharedFilesService.sidecarHost = discoveredHost
            sharedFilesService.useTunnelRoute = false
            return (discoveredHost, false)
        }

        let initialTunnelState = await p2pTunnelRouteState(startReason: reason)
        if let tunnelHost = await acceptedSharedFilesTunnelHost(
            state: initialTunnelState,
            hasReachableLANHost: false,
            reason: "\(reason)_initial",
            probeTimeout: 1.0
        ) {
            syncDiagnosticsLog(
                "SharedFiles",
                "using accepted active P2P tunnel directly, skipping wake reason=\(reason) selectedRoute=\(normalizedICERouteLabel(initialTunnelState.selectedICERoute))"
            )
            sharedFilesService.sidecarHost = tunnelHost
            sharedFilesService.useTunnelRoute = true
            return (tunnelHost, true)
        }
        if initialTunnelState.isActive {
            syncDiagnosticsLog(
                "SharedFiles",
                "deferring rejected active P2P tunnel restart until fallback route is needed reason=\(reason) port=\(initialTunnelState.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(initialTunnelState.selectedICERoute))"
            )
        }

        if SharedFilesRoutePolicy.shouldAttemptWakeBeforeP2PFallback(
            allowWake: allowWake,
            hasActiveTunnel: initialTunnelState.isActive,
            hasTunnelCredentials: initialTunnelState.hasCredentials
        ),
           let wokeHost = await attemptSharedFilesLANWakeIfNeeded(
               binding: binding,
               reason: reason,
               allowPublicWake: allowPublicWake
           ) {
            let isTunnel = wokeHost.contains("127.0.0.1")
            sharedFilesService.sidecarHost = wokeHost
            sharedFilesService.useTunnelRoute = isTunnel
            return (wokeHost, isTunnel)
        }

        let currentTunnelState = await p2pTunnelRouteState(startReason: nil)
        if let tunnelHost = await acceptedSharedFilesTunnelHost(
            state: currentTunnelState,
            hasReachableLANHost: false,
            reason: "\(reason)_post_wake",
            probeTimeout: 1.0
        ) {
            syncDiagnosticsLog(
                "SharedFiles",
                "using accepted P2P tunnel after LAN wake/direct checks reason=\(reason) selectedRoute=\(normalizedICERouteLabel(currentTunnelState.selectedICERoute))"
            )
            sharedFilesService.sidecarHost = tunnelHost
            sharedFilesService.useTunnelRoute = true
            return (tunnelHost, true)
        }
        if currentTunnelState.isActive {
            syncDiagnosticsLog(
                "SharedFiles",
                "deferring rejected post-wake P2P tunnel restart until fallback route is needed reason=\(reason) port=\(currentTunnelState.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(currentTunnelState.selectedICERoute))"
            )
        }

        if SharedFilesRoutePolicy.shouldProbeFallbackDirectLANBeforeP2P(
            hasFreshLANHost: unreachableLANHost != nil
        ),
           let fallbackHost = await reachableFallbackDirectSharedFilesHost(for: binding, excluding: unreachableLANHost)
        {
            syncDiagnosticsLog(
                "SharedFiles",
                "using cached direct LAN host before P2P wait host=\(fallbackHost) reason=\(reason)"
            )
            sidecarHost = fallbackHost
            sharedFilesService.sidecarHost = fallbackHost
            sharedFilesService.useTunnelRoute = false
            return (fallbackHost, false)
        }

        let tunnelStateBeforeWait = await p2pTunnelRouteState(startReason: nil)
        if tunnelStateBeforeWait.isActive {
            await restartRejectedSharedFilesTunnel(
                state: tunnelStateBeforeWait,
                reason: "\(reason)_before_p2p_wait"
            )
        }

        if await waitForP2PTunnelActive(reason: reason) {
            let tunnelState = await p2pTunnelRouteState(startReason: nil)
            if let tunnelHost = await acceptedSharedFilesTunnelHost(
                state: tunnelState,
                hasReachableLANHost: false,
                reason: "\(reason)_wait_completed",
                probeTimeout: 1.0
            ) {
                sharedFilesService.sidecarHost = tunnelHost
                sharedFilesService.useTunnelRoute = true
                return (tunnelHost, true)
            } else {
                syncDiagnosticsLog(
                    "SharedFiles",
                    "P2P tunnel wait completed but route was not acceptable; continuing LAN fallback reason=\(reason) port=\(tunnelState.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(tunnelState.selectedICERoute))"
                )
            }
        }

        if let lanHost = await waitForSharedFilesLANHost(binding: binding) {
            if await canReachSharedFilesLANHost(lanHost) {
                sharedFilesService.sidecarHost = lanHost
                sharedFilesService.useTunnelRoute = false
                return (lanHost, false)
            }
            unreachableLANHost = lanHost
            syncDiagnosticsLog(
                "SharedFiles",
                "waited LAN host is still unavailable for shared files host=\(lanHost)"
            )
        }

        var fallbackHost = fallbackDirectSharedFilesHost(for: binding, excluding: unreachableLANHost)
        if let host = fallbackHost,
           SharedFilesRoutePolicy.isPrivateLANIPv4(host),
           !(await canReachSharedFilesLANHost(host)) {
            syncDiagnosticsLog(
                "SharedFiles",
                "cached direct host unavailable for shared files host=\(host)"
            )
            fallbackHost = nil
        }
        guard SharedFilesRoutePolicy.hasUsableDirectRouteHost(fallbackHost) else {
            sharedFilesService.sidecarHost = nil
            sharedFilesService.useTunnelRoute = false
            syncDiagnosticsLog(
                "SharedFiles",
                "no shared files route available after LAN discovery/tunnel unavailable"
            )
            throw SyncEngineError.networkError("No shared files route available")
        }
        sharedFilesService.sidecarHost = fallbackHost
        sharedFilesService.useTunnelRoute = false
        syncDiagnosticsLog(
            "SharedFiles",
            "shared files falling back to cached direct host=\(fallbackHost ?? "nil") after LAN discovery/tunnel unavailable"
        )
        return (fallbackHost!, false)
    }

    private func recoverSharedFilesTunnelAfterRouteFailure(
        path: String,
        reason: String,
        error: Error
    ) async throws -> (host: String, isTunnel: Bool) {
        syncDiagnosticsLog(
            "SharedFiles",
            "tunnel route failed path=\(path) reason=\(reason) error=\(error); restarting tunnel"
        )
        await restartP2PTunnelAndWait(reason: "\(reason)_tunnel_route_failed")
        return try await prepareSharedFilesRoute(reason: "\(reason)_retry_after_tunnel_restart")
    }

    private func recoverSharedFilesDownloadTunnelAfterRouteFailure(
        path: String,
        reason: String,
        error: Error
    ) async throws -> (host: String, isTunnel: Bool) {
        syncDiagnosticsLog(
            "SharedFiles",
            "download tunnel route failed path=\(path) reason=\(reason) error=\(error); restarting tunnel for tunnel retry"
        )
        await restartP2PTunnelAndWait(reason: "\(reason)_tunnel_route_failed")

        if let binding = uploadStore?.getBinding(),
           let lanHost = await waitForSharedFilesLANHost(binding: binding),
           await canReachSharedFilesLANHost(lanHost),
           SharedFilesRoutePolicy.shouldPreferLANRoute(
               hasReachableLANHost: true,
               isTunnelActive: sharedFilesService.isTunnelActive
           )
        {
            applySharedFilesLANRoute(host: lanHost, reason: "\(reason)_lan_recovered")
            return (lanHost, false)
        }

        if await waitForP2PTunnelActive(reason: "\(reason)_retry_tunnel") {
            let tunnelState = await p2pTunnelRouteState(startReason: nil)
            guard let tunnelHost = await acceptedSharedFilesTunnelHost(
                state: tunnelState,
                hasReachableLANHost: false,
                reason: "\(reason)_retry_tunnel_wait_completed",
                probeTimeout: 1.0
            ) else {
                syncDiagnosticsLog(
                    "SharedFiles",
                    "download retry tunnel wait completed but route was not acceptable path=\(path) reason=\(reason) port=\(tunnelState.port.map(String.init) ?? "nil") selectedRoute=\(normalizedICERouteLabel(tunnelState.selectedICERoute))"
                )
                return try await prepareSharedFilesRoute(reason: "\(reason)_retry_after_tunnel_unacceptable")
            }
            sharedFilesService.sidecarHost = tunnelHost
            sharedFilesService.useTunnelRoute = true
            return (tunnelHost, true)
        }

        syncDiagnosticsLog(
            "SharedFiles",
            "P2P tunnel unavailable for download retry path=\(path) reason=\(reason); falling back to route selection"
        )
        return try await prepareSharedFilesRoute(reason: "\(reason)_retry_after_tunnel_restart")
    }

    private func sharedFileHTTPStatusCode(from error: Error) -> Int? {
        (error as? SharedFileHTTPStatusError)?.statusCode
    }

    private func personalAccessPairingToken(for scope: SharedDirectoryScope) -> String {
        guard scope == .personal,
              let binding = uploadStore?.getBinding(),
              let token = resolvedPairingToken(for: binding) else {
            return ""
        }
        return token
    }

    func browseSharedFiles(scope scopeRaw: String, path: String, accessToken: String) async throws -> [String: Any] {
        let scope = SharedDirectoryScope(rawValue: scopeRaw) ?? .team
        let allowWake = SharedFilesRoutePolicy.shouldAttemptWake(
            scope: scope.rawValue,
            path: path,
            operation: "list"
        )
        syncDiagnosticsLog(
            "SharedFiles",
            "wake decision scope=\(scope.rawValue) path=\(path) operation=list allowWake=\(allowWake) \(wakeCapabilityLogSummary(uploadStore?.getBinding()?.wake))"
        )
        let allowPublicWake = SharedFilesRoutePolicy.shouldAllowPublicWake(
            scope: scope.rawValue,
            path: path,
            operation: "list",
            trigger: "shared_files_root_browse"
        )
        var route = try await prepareSharedFilesRoute(
            reason: "browse_shared_files",
            allowWake: allowWake,
            allowPublicWake: allowPublicWake
        )
        let accessClientID = scope == .personal ? getClientId() : ""
        let accessClientName = scope == .personal ? getClientDisplayName() : ""
        let accessPairingToken = personalAccessPairingToken(for: scope)
        slog("[SharedFiles] browseSharedFiles scope=%@ path=%@ resolved_host=%@ is_tunnel=%@", scope.rawValue, path, route.host, String(route.isTunnel))
        syncDiagnosticsLog("SharedFiles", "browseSharedFiles scope=\(scope.rawValue) path=\(path) resolved_host=\(route.host) is_tunnel=\(route.isTunnel) has_pairing_signature=\(!accessPairingToken.isEmpty)")

        let directory: SharedDirectory
        do {
            directory = try await withSharedFileTunnelOperation(
                path: path,
                reason: "browse_shared_files",
                isTunnelRoute: route.isTunnel
            ) {
                try await sharedFilesService.listSharedFiles(
                    scope: scope,
                    path: path,
                    accessToken: accessToken,
                    pairingToken: accessPairingToken,
                    clientID: accessClientID,
                    clientName: accessClientName
                )
            }
        } catch {
            guard SharedFilesRoutePolicy.shouldInvalidateTunnelAfterRouteFailure(isTunnelRoute: route.isTunnel) else {
                throw error
            }
            route = try await recoverSharedFilesTunnelAfterRouteFailure(
                path: path,
                reason: "browse_shared_files",
                error: error
            )
            slog("[SharedFiles] browseSharedFiles retry scope=%@ path=%@ resolved_host=%@ is_tunnel=%@", scope.rawValue, path, route.host, String(route.isTunnel))
            syncDiagnosticsLog("SharedFiles", "browseSharedFiles retry scope=\(scope.rawValue) path=\(path) resolved_host=\(route.host) is_tunnel=\(route.isTunnel)")
            directory = try await withSharedFileTunnelOperation(
                path: path,
                reason: "browse_shared_files_retry",
                isTunnelRoute: route.isTunnel
            ) {
                try await sharedFilesService.listSharedFiles(
                    scope: scope,
                    path: path,
                    accessToken: accessToken,
                    pairingToken: accessPairingToken,
                    clientID: accessClientID,
                    clientName: accessClientName
                )
            }
        }
        let reachabilityRoute: SharedFilesReachabilityRoute = route.isTunnel ? currentSharedFilesTunnelReachabilityRoute() : .lan
        updateSharedFilesReachability(
            .available,
            route: reachabilityRoute,
            reason: "browse_shared_files_success"
        )
        if !route.isTunnel && bindingConnectionState != .connected {
            updateBindingConnectionState(.connected, reason: "browse_shared_files_success")
        }
        let files: [[String: Any]] = directory.files.map { file in
            var fileDict: [String: Any] = [
                "name": file.name,
                "path": file.path,
                "type": file.type,
                "size": file.size,
                "modifiedAt": file.modifiedAt,
                "isDirectory": file.isDirectory,
            ]
            // Build absolute URLs for thumbnails and video streams.
            let listedThumbnailUrl = file.thumbnailUrl.flatMap { rawUrl in
                sharedFilesService.resolveListedMediaUrl(
                    rawUrl,
                    scope: scope,
                    accessToken: accessToken,
                    pairingToken: accessPairingToken,
                    clientID: accessClientID,
                    clientName: accessClientName
                )
            }
            let fallbackThumbnailUrl: URL?
            if file.type == "image" {
                fallbackThumbnailUrl = sharedFilesService.getThumbnailUrl(
                    scope: scope,
                    path: file.path,
                    accessToken: accessToken,
                    pairingToken: accessPairingToken,
                    clientID: accessClientID,
                    clientName: accessClientName
                )
            } else {
                fallbackThumbnailUrl = nil
            }
            if let thumbUrl = listedThumbnailUrl ?? fallbackThumbnailUrl {
                fileDict["thumbnailUrl"] = thumbUrl.absoluteString
            }
            if file.type == "video", let streamUrl = sharedFilesService.getStreamUrl(
                scope: scope,
                path: file.path,
                accessToken: accessToken,
                pairingToken: accessPairingToken,
                clientID: accessClientID,
                clientName: accessClientName
            ) {
                fileDict["streamUrl"] = streamUrl.absoluteString
            }
            return fileDict
        }
        return [
            "scope": scope.rawValue,
            "path": directory.path,
            "files": files,
            "totalCount": directory.totalCount,
        ]
    }

    func downloadSharedFile(scope scopeRaw: String, path: String, accessToken: String) async throws -> [String: Any] {
        let scope = SharedDirectoryScope(rawValue: scopeRaw) ?? .team
        let allowWake = SharedFilesRoutePolicy.shouldAttemptWake(
            scope: scope.rawValue,
            path: path,
            operation: "download"
        )
        syncDiagnosticsLog(
            "SharedFiles",
            "wake decision scope=\(scope.rawValue) path=\(path) operation=download allowWake=\(allowWake) \(wakeCapabilityLogSummary(uploadStore?.getBinding()?.wake))"
        )
        var route = try await prepareSharedFilesRoute(reason: "download_shared_file", allowWake: allowWake)
        let accessClientID = scope == .personal ? getClientId() : ""
        let accessClientName = scope == .personal ? getClientDisplayName() : ""
        let accessPairingToken = personalAccessPairingToken(for: scope)
        slog("[SharedFiles] downloadSharedFile scope=%@ path=%@ resolved_host=%@ is_tunnel=%@", scope.rawValue, path, route.host, String(route.isTunnel))
        syncDiagnosticsLog("SharedFiles", "downloadSharedFile scope=\(scope.rawValue) path=\(path) resolved_host=\(route.host) is_tunnel=\(route.isTunnel) has_pairing_signature=\(!accessPairingToken.isEmpty)")

        let progressHandler: SharedFileDownloadProgressHandler = { bytesWritten, totalBytes, progress in
            NativeSyncEngineModule.shared?.emitSharedFileDownloadProgress(
                path: path,
                bytesWritten: bytesWritten,
                totalBytes: totalBytes,
                progress: progress
            )
        }
        var result: SharedFilesService.DownloadResult?
        var lastError: Error?
        for attempt in 1...SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts {
            let reason = attempt == 1 ? "download_shared_file" : "download_shared_file_retry"
            do {
                let downloadResult = try await withSharedFileTunnelOperation(
                    path: path,
                    reason: reason,
                    isTunnelRoute: route.isTunnel
                ) {
                    try await sharedFilesService.downloadFile(
                        scope: scope,
                        path: path,
                        accessToken: accessToken,
                        pairingToken: accessPairingToken,
                        clientID: accessClientID,
                        clientName: accessClientName,
                        onProgress: progressHandler
                    )
                }
                result = downloadResult
                syncDiagnosticsLog(
                    "SharedFiles",
                    "downloadSharedFile completed path=\(path) attempt=\(attempt) is_tunnel=\(route.isTunnel) saved_to_photos=\(downloadResult.savedToPhotos) local_path=\(downloadResult.localPath ?? "nil") saved_location=\(downloadResult.savedLocation ?? "nil")"
                )
                break
            } catch {
                lastError = error
                syncDiagnosticsLog(
                    "SharedFiles",
                    "downloadSharedFile attempt failed path=\(path) attempt=\(attempt) max_attempts=\(SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts) is_tunnel=\(route.isTunnel) error=\(error)"
                )
                guard SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(
                    isLocalSaveFailure: error is SharedFileLocalSaveError,
                    httpStatusCode: sharedFileHTTPStatusCode(from: error)
                ) else {
                    syncDiagnosticsLog(
                        "SharedFiles",
                        "downloadSharedFile not retrying path=\(path) attempt=\(attempt) error=\(error)"
                    )
                    throw error
                }
                guard attempt < SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts else {
                    throw error
                }
                if SharedFilesRoutePolicy.shouldRetryDownloadOnTunnelAfterFailure(isTunnelRoute: route.isTunnel) {
                    route = try await recoverSharedFilesDownloadTunnelAfterRouteFailure(
                        path: path,
                        reason: reason,
                        error: error
                    )
                } else {
                    syncDiagnosticsLog(
                        "SharedFiles",
                        "download direct route failed path=\(path) reason=\(reason) error=\(error); reselecting route for retry"
                    )
                    route = try await prepareSharedFilesRoute(reason: "\(reason)_retry_after_direct_route_failure")
                }
                slog("[SharedFiles] downloadSharedFile retry path=%@ attempt=%d resolved_host=%@ is_tunnel=%@", path, attempt + 1, route.host, String(route.isTunnel))
                syncDiagnosticsLog("SharedFiles", "downloadSharedFile retry path=\(path) attempt=\(attempt + 1) resolved_host=\(route.host) is_tunnel=\(route.isTunnel)")
            }
        }
        guard let result else {
            throw lastError ?? SyncEngineError.networkError("Shared file download failed without an error")
        }
        let reachabilityRoute: SharedFilesReachabilityRoute = route.isTunnel ? currentSharedFilesTunnelReachabilityRoute() : .lan
        updateSharedFilesReachability(
            .available,
            route: reachabilityRoute,
            reason: "download_shared_file_success"
        )
        if !route.isTunnel && bindingConnectionState != .connected {
            updateBindingConnectionState(.connected, reason: "download_shared_file_success")
        }
        return [
            "savedToPhotos": result.savedToPhotos,
            "localPath": result.localPath ?? NSNull(),
            "savedLocation": result.savedLocation ?? NSNull(),
        ]
    }

    func listReceivedFiles() async throws -> [[String: Any]] {
        try await listReceivedFiles(
            httpScope: "client",
            diagnosticScope: "client",
            operationName: "listReceivedFiles",
            reason: "list_received_files"
        )
    }

    func listGlobalReceivedFiles() async throws -> [[String: Any]] {
        try await listReceivedFiles(
            httpScope: nil,
            diagnosticScope: "all",
            operationName: "listGlobalReceivedFiles",
            reason: "list_global_received_files"
        )
    }

    private func listReceivedFiles(
        httpScope: String?,
        diagnosticScope: String,
        operationName: String,
        reason: String
    ) async throws -> [[String: Any]] {
        let allowWake = SharedFilesRoutePolicy.shouldAttemptWake(
            scope: SharedDirectoryScope.team.rawValue,
            path: "received",
            operation: "list"
        )
        syncDiagnosticsLog(
            "SharedFiles",
            "wake decision scope=received path=received operation=list received_scope=\(diagnosticScope) allowWake=\(allowWake) \(wakeCapabilityLogSummary(uploadStore?.getBinding()?.wake))"
        )
        var route = try await prepareSharedFilesRoute(reason: reason, allowWake: allowWake)
        slog("[SharedFiles] %@ resolved_host=%@ is_tunnel=%@ scope=%@", operationName, route.host, String(route.isTunnel), diagnosticScope)
        syncDiagnosticsLog("SharedFiles", "\(operationName) resolved_host=\(route.host) is_tunnel=\(route.isTunnel) scope=\(diagnosticScope)")

        let items: [[String: Any]]
        do {
            items = try await withSharedFileTunnelOperation(
                path: "received",
                reason: reason,
                isTunnelRoute: route.isTunnel
            ) {
                try await sharedFilesService.listReceivedFiles(
                    clientId: getClientId(),
                    clientName: getClientDisplayName(),
                    scope: httpScope
                )
            }
        } catch {
            guard SharedFilesRoutePolicy.shouldInvalidateTunnelAfterRouteFailure(isTunnelRoute: route.isTunnel) else {
                throw error
            }
            route = try await recoverSharedFilesTunnelAfterRouteFailure(
                path: "received",
                reason: reason,
                error: error
            )
            slog("[SharedFiles] %@ retry resolved_host=%@ is_tunnel=%@ scope=%@", operationName, route.host, String(route.isTunnel), diagnosticScope)
            syncDiagnosticsLog("SharedFiles", "\(operationName) retry resolved_host=\(route.host) is_tunnel=\(route.isTunnel) scope=\(diagnosticScope)")
            items = try await withSharedFileTunnelOperation(
                path: "received",
                reason: "\(reason)_retry",
                isTunnelRoute: route.isTunnel
            ) {
                try await sharedFilesService.listReceivedFiles(
                    clientId: getClientId(),
                    clientName: getClientDisplayName(),
                    scope: httpScope
                )
            }
        }

        let reachabilityRoute: SharedFilesReachabilityRoute = route.isTunnel ? currentSharedFilesTunnelReachabilityRoute() : .lan
        updateSharedFilesReachability(
            .available,
            route: reachabilityRoute,
            reason: "\(reason)_success"
        )
        if !route.isTunnel && bindingConnectionState != .connected {
            updateBindingConnectionState(.connected, reason: "\(reason)_success")
        }

        let clientId = getClientId()
        let clientName = getClientDisplayName()
        let enrichedItems = items.map { item in
            ReceivedLibraryMediaURLPolicy.enrich(item: item) { fileKey, kind in
                try? sharedFilesService.getReceivedFileMediaUrl(
                    fileKey: fileKey,
                    clientId: clientId,
                    clientName: clientName,
                    kind: kind
                ).absoluteString
            }
        }
        syncDiagnosticsLog(
            "SharedFiles",
            "\(operationName) success scope=\(diagnosticScope) item_count=\(items.count) enriched_item_count=\(enrichedItems.count)"
        )
        return enrichedItems
    }

    func getReceivedFilePreviewUrl(fileKey: String, kind: String) async throws -> String {
        let trimmedFileKey = fileKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedFileKey.isEmpty else {
            throw SyncEngineError.networkError("Received file key is required")
        }
        let normalizedKind = normalizedReceivedPreviewKind(kind)
        let allowWake = SharedFilesRoutePolicy.shouldAttemptWake(
            scope: SharedDirectoryScope.team.rawValue,
            path: trimmedFileKey,
            operation: normalizedKind == "download" ? "download" : "preview"
        )
        syncDiagnosticsLog(
            "SharedFiles",
            "wake decision scope=received path=\(trimmedFileKey) operation=\(normalizedKind) allowWake=\(allowWake) \(wakeCapabilityLogSummary(uploadStore?.getBinding()?.wake))"
        )
        let route = try await prepareSharedFilesRoute(reason: "preview_received_file", allowWake: allowWake)
        slog("[SharedFiles] getReceivedFilePreviewUrl fileKey=%@ kind=%@ resolved_host=%@ is_tunnel=%@", trimmedFileKey, normalizedKind, route.host, String(route.isTunnel))
        syncDiagnosticsLog("SharedFiles", "getReceivedFilePreviewUrl fileKey=\(trimmedFileKey) kind=\(normalizedKind) resolved_host=\(route.host) is_tunnel=\(route.isTunnel)")
        let reachabilityRoute: SharedFilesReachabilityRoute = route.isTunnel ? currentSharedFilesTunnelReachabilityRoute() : .lan
        updateSharedFilesReachability(
            .available,
            route: reachabilityRoute,
            reason: "preview_received_file_route_selected"
        )
        if !route.isTunnel && bindingConnectionState != .connected {
            updateBindingConnectionState(.connected, reason: "preview_received_file_route_selected")
        }
        return try sharedFilesService.getReceivedFileMediaUrl(
            fileKey: trimmedFileKey,
            clientId: getClientId(),
            clientName: getClientDisplayName(),
            kind: normalizedKind
        ).absoluteString
    }

    private func normalizedReceivedPreviewKind(_ kind: String) -> String {
        switch kind.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "preview":
            return "preview"
        case "thumbnail":
            return "thumbnail"
        case "stream":
            return "stream"
        default:
            return "download"
        }
    }

    func downloadReceivedFile(fileKey: String, filename: String, mediaType: String?) async throws -> [String: Any] {
        let trimmedFileKey = fileKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedFileKey.isEmpty else {
            throw SyncEngineError.networkError("Received file key is required")
        }
        let safeFilename = filename.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "remote-file"
            : filename.trimmingCharacters(in: .whitespacesAndNewlines)
        let allowWake = SharedFilesRoutePolicy.shouldAttemptWake(
            scope: SharedDirectoryScope.team.rawValue,
            path: trimmedFileKey,
            operation: "download"
        )
        syncDiagnosticsLog(
            "SharedFiles",
            "wake decision scope=received path=\(trimmedFileKey) operation=download allowWake=\(allowWake) \(wakeCapabilityLogSummary(uploadStore?.getBinding()?.wake))"
        )
        var route = try await prepareSharedFilesRoute(reason: "download_received_file", allowWake: allowWake)
        slog("[SharedFiles] downloadReceivedFile fileKey=%@ resolved_host=%@ is_tunnel=%@", trimmedFileKey, route.host, String(route.isTunnel))
        syncDiagnosticsLog("SharedFiles", "downloadReceivedFile fileKey=\(trimmedFileKey) resolved_host=\(route.host) is_tunnel=\(route.isTunnel)")

        let progressHandler: SharedFileDownloadProgressHandler = { bytesWritten, totalBytes, progress in
            NativeSyncEngineModule.shared?.emitSharedFileDownloadProgress(
                path: trimmedFileKey,
                bytesWritten: bytesWritten,
                totalBytes: totalBytes,
                progress: progress
            )
        }
        var result: SharedFilesService.DownloadResult?
        var lastError: Error?
        for attempt in 1...SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts {
            let reason = attempt == 1 ? "download_received_file" : "download_received_file_retry"
            do {
                let downloadResult = try await withSharedFileTunnelOperation(
                    path: trimmedFileKey,
                    reason: reason,
                    isTunnelRoute: route.isTunnel
                ) {
                    try await sharedFilesService.downloadReceivedFile(
                        fileKey: trimmedFileKey,
                        clientId: getClientId(),
                        clientName: getClientDisplayName(),
                        filename: safeFilename,
                        mediaType: mediaType,
                        onProgress: progressHandler
                    )
                }
                result = downloadResult
                syncDiagnosticsLog(
                    "SharedFiles",
                    "downloadReceivedFile completed fileKey=\(trimmedFileKey) filename=\(safeFilename) media_type=\(mediaType ?? "nil") attempt=\(attempt) is_tunnel=\(route.isTunnel) saved_to_photos=\(downloadResult.savedToPhotos) local_path=\(downloadResult.localPath ?? "nil") saved_location=\(downloadResult.savedLocation ?? "nil")"
                )
                break
            } catch {
                lastError = error
                syncDiagnosticsLog(
                    "SharedFiles",
                    "downloadReceivedFile attempt failed fileKey=\(trimmedFileKey) attempt=\(attempt) max_attempts=\(SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts) is_tunnel=\(route.isTunnel) error=\(error)"
                )
                guard SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(
                    isLocalSaveFailure: error is SharedFileLocalSaveError,
                    httpStatusCode: sharedFileHTTPStatusCode(from: error)
                ) else {
                    syncDiagnosticsLog(
                        "SharedFiles",
                        "downloadReceivedFile not retrying fileKey=\(trimmedFileKey) attempt=\(attempt) error=\(error)"
                    )
                    throw error
                }
                guard attempt < SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts else {
                    throw error
                }
                if SharedFilesRoutePolicy.shouldRetryDownloadOnTunnelAfterFailure(isTunnelRoute: route.isTunnel) {
                    route = try await recoverSharedFilesDownloadTunnelAfterRouteFailure(
                        path: trimmedFileKey,
                        reason: reason,
                        error: error
                    )
                } else {
                    syncDiagnosticsLog(
                        "SharedFiles",
                        "received download direct route failed fileKey=\(trimmedFileKey) reason=\(reason) error=\(error); reselecting route for retry"
                    )
                    route = try await prepareSharedFilesRoute(reason: "\(reason)_retry_after_direct_route_failure")
                }
                slog("[SharedFiles] downloadReceivedFile retry fileKey=%@ attempt=%d resolved_host=%@ is_tunnel=%@", trimmedFileKey, attempt + 1, route.host, String(route.isTunnel))
                syncDiagnosticsLog("SharedFiles", "downloadReceivedFile retry fileKey=\(trimmedFileKey) attempt=\(attempt + 1) resolved_host=\(route.host) is_tunnel=\(route.isTunnel)")
            }
        }
        guard let result else {
            throw lastError ?? SyncEngineError.networkError("Received file download failed without an error")
        }
        let reachabilityRoute: SharedFilesReachabilityRoute = route.isTunnel ? currentSharedFilesTunnelReachabilityRoute() : .lan
        updateSharedFilesReachability(
            .available,
            route: reachabilityRoute,
            reason: "download_received_file_success"
        )
        if !route.isTunnel && bindingConnectionState != .connected {
            updateBindingConnectionState(.connected, reason: "download_received_file_success")
        }
        return [
            "savedToPhotos": result.savedToPhotos,
            "localPath": result.localPath ?? NSNull(),
            "savedLocation": result.savedLocation ?? NSNull(),
        ]
    }

    func getSharedFileStreamUrl(scope scopeRaw: String, path: String, accessToken: String) -> String? {
        let scope = SharedDirectoryScope(rawValue: scopeRaw) ?? .team
        let accessPairingToken = personalAccessPairingToken(for: scope)
        return sharedFilesService.getStreamUrl(
            scope: scope,
            path: path,
            accessToken: accessToken,
            pairingToken: accessPairingToken,
            clientID: scope == .personal ? getClientId() : "",
            clientName: scope == .personal ? getClientDisplayName() : ""
        )?.absoluteString
    }

    func prepareSharedFilePreview(scope scopeRaw: String, path: String, accessToken: String, filename: String) async throws -> String {
        let scope = SharedDirectoryScope(rawValue: scopeRaw) ?? .team
        let allowWake = SharedFilesRoutePolicy.shouldAttemptWake(
            scope: scope.rawValue,
            path: path,
            operation: "preview"
        )
        syncDiagnosticsLog(
            "SharedFiles",
            "wake decision scope=\(scope.rawValue) path=\(path) operation=preview allowWake=\(allowWake) \(wakeCapabilityLogSummary(uploadStore?.getBinding()?.wake))"
        )
        var route = try await prepareSharedFilesRoute(reason: "preview_shared_file", allowWake: allowWake)
        let accessClientID = scope == .personal ? getClientId() : ""
        let accessClientName = scope == .personal ? getClientDisplayName() : ""
        let accessPairingToken = personalAccessPairingToken(for: scope)
        slog("[SharedFiles] prepareSharedFilePreview scope=%@ path=%@ resolved_host=%@ is_tunnel=%@", scope.rawValue, path, route.host, String(route.isTunnel))
        syncDiagnosticsLog("SharedFiles", "prepareSharedFilePreview scope=\(scope.rawValue) path=\(path) resolved_host=\(route.host) is_tunnel=\(route.isTunnel) has_pairing_signature=\(!accessPairingToken.isEmpty)")

        var previewURL: URL?
        var lastError: Error?
        for attempt in 1...SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts {
            let reason = attempt == 1 ? "preview_shared_file" : "preview_shared_file_retry"
            do {
                let downloadedPreviewURL = try await withSharedFileTunnelOperation(
                    path: path,
                    reason: reason,
                    isTunnelRoute: route.isTunnel
                ) {
                    try await sharedFilesService.downloadFileForPreview(
                        scope: scope,
                        path: path,
                        accessToken: accessToken,
                        pairingToken: accessPairingToken,
                        filename: filename,
                        clientID: accessClientID,
                        clientName: accessClientName
                    )
                }
                previewURL = downloadedPreviewURL
                syncDiagnosticsLog(
                    "SharedFiles",
                    "prepareSharedFilePreview completed path=\(path) attempt=\(attempt) is_tunnel=\(route.isTunnel) preview_url=\(downloadedPreviewURL.absoluteString)"
                )
                break
            } catch {
                lastError = error
                syncDiagnosticsLog(
                    "SharedFiles",
                    "prepareSharedFilePreview attempt failed path=\(path) attempt=\(attempt) max_attempts=\(SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts) is_tunnel=\(route.isTunnel) error=\(error)"
                )
                guard SharedFilesRoutePolicy.shouldRetrySharedFileDownloadFailure(
                    isLocalSaveFailure: error is SharedFileLocalSaveError,
                    httpStatusCode: sharedFileHTTPStatusCode(from: error)
                ) else {
                    syncDiagnosticsLog(
                        "SharedFiles",
                        "prepareSharedFilePreview not retrying path=\(path) attempt=\(attempt) error=\(error)"
                    )
                    throw error
                }
                guard attempt < SharedFilesRoutePolicy.sharedFileDownloadMaxAttempts else {
                    throw error
                }
                if SharedFilesRoutePolicy.shouldRetryDownloadOnTunnelAfterFailure(isTunnelRoute: route.isTunnel) {
                    route = try await recoverSharedFilesDownloadTunnelAfterRouteFailure(
                        path: path,
                        reason: reason,
                        error: error
                    )
                } else {
                    syncDiagnosticsLog(
                        "SharedFiles",
                        "preview direct route failed path=\(path) reason=\(reason) error=\(error); reselecting route for retry"
                    )
                    route = try await prepareSharedFilesRoute(reason: "\(reason)_retry_after_direct_route_failure")
                }
                slog("[SharedFiles] prepareSharedFilePreview retry path=%@ attempt=%d resolved_host=%@ is_tunnel=%@", path, attempt + 1, route.host, String(route.isTunnel))
                syncDiagnosticsLog("SharedFiles", "prepareSharedFilePreview retry path=\(path) attempt=\(attempt + 1) resolved_host=\(route.host) is_tunnel=\(route.isTunnel)")
            }
        }
        guard let previewURL else {
            throw lastError ?? SyncEngineError.networkError("Shared file preview failed without an error")
        }
        let reachabilityRoute: SharedFilesReachabilityRoute = route.isTunnel ? currentSharedFilesTunnelReachabilityRoute() : .lan
        updateSharedFilesReachability(
            .available,
            route: reachabilityRoute,
            reason: "preview_shared_file_success"
        )
        if !route.isTunnel && bindingConnectionState != .connected {
            updateBindingConnectionState(.connected, reason: "preview_shared_file_success")
        }
        return previewURL.absoluteString
    }

    // MARK: - Settings

    func renameBoundDeviceAlias(alias: String) async throws {
        slog("[SyncEngine] renameBoundDeviceAlias \(alias)")
        guard var binding = uploadStore?.getBinding() else {
            throw SyncEngineError.pairingError("No active binding to rename")
        }
        binding.deviceAlias = alias
        try persistBinding(binding)
    }

    func savePublicWakeTarget(host: String?, port: Int?, enabled: Bool) async throws {
        slog("[SyncEngine] savePublicWakeTarget host=\(host ?? "nil") port=\(port ?? 0) enabled=\(enabled)")
        if enabled {
            guard let host = host, !host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw SyncEngineError.pairingError("Host cannot be empty when remote wake is enabled")
            }
            guard let port = port, port >= 1 && port <= 65535 else {
                throw SyncEngineError.pairingError("Port must be between 1 and 65535 when remote wake is enabled")
            }
        }
        guard var binding = uploadStore?.getBinding() else {
            throw SyncEngineError.pairingError("No active binding to configure public wake target")
        }

        let target: PublicWakeTarget?
        if let host = host, !host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let port = port {
            target = PublicWakeTarget(
                kind: "router_wan_udp",
                host: host.trimmingCharacters(in: .whitespacesAndNewlines),
                port: port,
                enabled: enabled,
                updatedAt: ISO8601DateFormatter().string(from: Date())
            )
        } else {
            target = nil
        }

        let currentWake = binding.wake ?? WakeCapability(supported: false, targets: [], publicTarget: nil, updatedAt: ISO8601DateFormatter().string(from: Date()))
        binding.wake = WakeCapability(
            supported: currentWake.supported,
            targets: currentWake.targets,
            publicTarget: target,
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )

        try persistBinding(binding)
        NativeSyncEngineModule.shared?.emitBindingStateChanged(bindingStatePayload(binding: binding))
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
        slog("[SyncEngine] wipeSyncIdentity: begin (sentinel set)")
        syncDiagnosticsLog("SyncEngine", "wipeSyncIdentity: begin")

        // 1. Tear down any live networking / timers so we don't race the wipe.
        stopPresenceHeartbeatTimer()
        stopP2PTunnel(reason: "wipeSyncIdentity")
        protocolSession?.disconnect()
        protocolSession = nil
        transport.disconnect()
        sessionService.endSession()
        sidecarHost = nil
        bindingConnectionState = .offline
        isSyncing = false
        isAutoUploadInterrupted = false
        shouldAbortActiveAutoUpload = false
        shouldAbortActiveManualUpload = false
        shouldAbortActiveUploadForBindingChange = false
        runtimeManualUploadCancelled = false
        runtimeLastCompletedTaskSource = nil
        clearRuntimeSyncRoundProgress(uploadState: "idle")
        runtimeUploadState = "idle"
        runtimeLastErrorCode = nil
        runtimeLastErrorMessage = nil
        // M8: full identity wipe — force-release any lingering refcount.
        forceEndBackgroundTransition(reason: "wipeSyncIdentity")

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
            slog("[SyncEngine] wipeSyncIdentity: clearBinding failed: %@", "\(error)")
        }
        currentBinding = nil

        // 3a. Clear auth-repair meta so RN banner doesn't briefly re-appear
        // on the next getRepairState() read before a fresh pair lands.
        do {
            try uploadStore?.setNeedsRepair(value: false, reason: nil)
            NativeSyncEngineModule.shared?.emitRepairStateChanged(
                needsRepair: false,
                reason: nil
            )
        } catch {
            NSLog("[SyncEngine] wipeSyncIdentity: setNeedsRepair clear failed: %@", "\(error)")
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
            slog("[SyncEngine] wipeSyncIdentity: resetAllStatusData failed: %@", "\(error)")
        }

        // 7. Reset auto upload config (persisted enabled flag, timeRangeMode,
        // customTimeFrom, state). Falls back to schema default row on next
        // read.
        do {
            try uploadStore?.resetAutoUploadConfig()
        } catch {
            slog("[SyncEngine] wipeSyncIdentity: resetAutoUploadConfig failed: %@", "\(error)")
        }

        // 8. Forget the previously-recorded owner so we don't false-trigger the
        // owner-mismatch path on the very next login.
        defaults.removeObject(forKey: Self.ownerUserIdKey)

        // 9. Push fresh empty state to JS so any foregrounded UI does not keep
        // rendering stale data (binding card, queue, history).
        clearSharedFilesReachability(reason: "wipeSyncIdentity")
        NativeSyncEngineModule.shared?.emitBindingStateChanged(nil)
        NativeSyncEngineModule.shared?.emitQueueUpdated([])
        NativeSyncEngineModule.shared?.emitHistoryUpdated()
        NativeSyncEngineModule.shared?.emitSyncStateChanged(
            runtimeSyncOverviewPayload(uploadState: "idle")
        )

        // 10. Clear the sentinel last — any crash before this point causes a
        // self-heal retry on next launch.
        defaults.removeObject(forKey: Self.wipeInProgressKey)
        slog("[SyncEngine] wipeSyncIdentity: complete (sentinel cleared)")
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
            slog("[SyncEngine] owner user id set FAILED to flush for %@", id)
        } else {
            slog("[SyncEngine] owner user id set to %@", id)
        }
        return flushed
    }

    func getKnownDeviceIds() -> [String] {
        let keys = bindingService.listStoredKeychainKeys()
        return keys.compactMap { key -> String? in
            for prefix in Self.pairingTokenKeyPrefixes {
                if key.hasPrefix(prefix) { return String(key.dropFirst(prefix.count)) }
            }
            return nil
        }
    }

    // MARK: - H8 Phase 2: needs_repair bridge surface
    //
    // Thin pass-through so the RN bridge doesn't need to reach into the
    // private `uploadStore`. Matches the `(flag, reason)` tuple returned by
    // `UploadStore.getNeedsRepair()` and normalises the "no store wired yet"
    // case (cold boot before `configureStores` finishes) to `(false, nil)` —
    // the banner should stay hidden until we can confirm the flag.

    /// Read the current repair state for the RN bridge. Returns
    /// `(flag: false, reason: nil)` when the upload store isn't ready yet so
    /// JS doesn't flash the banner during the boot window.
    func getRepairStateForBridge() -> (flag: Bool, reason: String?) {
        guard let store = uploadStore else { return (false, nil) }
        return store.getNeedsRepair()
    }
}
