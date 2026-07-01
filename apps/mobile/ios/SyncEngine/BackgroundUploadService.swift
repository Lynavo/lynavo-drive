import Foundation
import CryptoKit
import Photos

/// Minimal interface the background upload service needs from the
/// surrounding `SyncEngineManager`: a live view of the current binding
/// so delegate callbacks can identity-gate before a freshly-pair row
/// has been flushed to SQLite. Extracted to a protocol so test
/// harnesses (T5, T6) can stand in a lightweight fake without pulling
/// UIKit / the rest of the manager into the link graph.
protocol BackgroundUploadBindingSource: AnyObject {
    var currentBinding: StoredBinding? { get }
}

/// Background HTTP upload coordinator.
///
/// Owns a shared `URLSessionConfiguration.background` session so uploads can
/// keep progressing after the app is suspended or killed. The foreground LMUP/2
/// pipeline still handles day-to-day uploads; this service takes over when
/// iOS moves the process to the background and also absorbs the cold relaunch
/// that iOS performs to hand back completed background URLSession events.
///
/// Key invariants (see `docs/architecture/background-upload-plan.md` Phase 2):
///   - Every delegate entry point runs through a hard identity gate before
///     touching `UploadStore` / `HistoryLedgerStore`. Stale tasks (binding
///     switched, fileKey row re-used, local row missing) only emit
///     diagnostics.
///   - Row state transitions happen via compare-and-clear helpers on
///     `UploadStore` keyed on the `BackgroundUploadTaskIdentity` persisted
///     next to the row.
///   - Response bodies are capped at `uploadMaxResponseBodyBytes` (16 KB);
///     anything larger cancels the task and is treated as a 5xx-equivalent
///     retry.
///   - `urlSessionDidFinishEvents(forBackgroundURLSession:)` never invokes
///     the stored completion handler directly — it drains through the
///     `didFinishEventsWhileWorkPending` / `pendingDelegateWorkCount` gate so
///     DB/history writes always land before iOS is told the work is done.
final class BackgroundUploadService: NSObject {

    // MARK: - Constants

    static let shared = BackgroundUploadService()
    static let sessionIdentifier = "com.lynavo.drive.background-upload"

    /// Hard upper bound on response body size accumulated by the delegate.
    /// Sidecar responses are small JSON bodies; anything past this is abuse
    /// or a bug and must not be allowed to spill into on-disk URLSession
    /// buffers during relaunches.
    static let uploadMaxResponseBodyBytes = 16 * 1024

    /// Consecutive 422 failures (body_size_mismatch / body_hash_mismatch /
    /// body_too_large) after which the row is marked `failed` to avoid a
    /// tight retry loop.
    static let consecutive422FailureThreshold = 3

    /// M7 — Spec L48. Consecutive repair-required auth failures
    /// (401 auth_invalid_signature / auth_revoked_device, POST 404
    /// unknown_client / device_not_paired) after which the service flips
    /// `needs_repair = true`. The spec pins this at 1, i.e. flip on the
    /// very first such failure — there is no useful retry for a revoked
    /// or mis-signed token without user re-pair. `handleAuthRepair` reads
    /// a counter seeded at 1 so the `>= threshold` comparison still
    /// evaluates true on the first hit.
    static let consecutiveAuthRepairThreshold: Int = 1

    /// M7 — Spec L49. Delay (seconds) between `appWillEnterForeground`
    /// reading `needs_repair` and surfacing the repair banner. Spec pins
    /// this at 0 — the banner shows immediately.
    static let foregroundBannerForRepairDelaySeconds: TimeInterval = 0

    /// M7 — Spec L52. Budget (seconds) available for the
    /// `appDidEnterBackground` → `transitionToBackgroundUpload()` fast
    /// path to perform export / SHA256 preparation. Spec pins this at 0,
    /// so `transitionToBackgroundUpload` must hand off with
    /// `allowPreparation: false`; any missing temp body defers to the
    /// next BGProcessing wake-up where preparation is actually budgeted.
    static let backgroundTransitionPreparationBudgetSeconds: TimeInterval = 0

    /// Accepted `BackgroundUploadTaskIdentity.schemaVersion`. Decode is
    /// rejected for any other value so a future schema bump cannot be
    /// interpreted as a valid identity on an older binary.
    static let currentIdentitySchemaVersion = 1

    // MARK: - Injected collaborators

    weak var uploadStore: UploadStore?
    weak var historyStore: HistoryLedgerStore?
    weak var bindingService: BindingService?
    weak var exportService: AssetExportService?
    /// Optional live binding source (plan L796-800). When set, takes priority
    /// over UploadStore / last_known_binding in identity gating so a freshly
    /// swapped binding is reflected before it has been flushed to SQLite.
    ///
    /// TODO: Wave 3 will wire this from SyncEngineManager.configureBackgroundUploadService.
    /// Until then this stays nil and resolveCurrentBinding transparently
    /// falls through to the existing UploadStore / last_known_binding path.
    weak var syncEngineManager: BackgroundUploadBindingSource?

    // MARK: - Session + delegate state (locked on `lock`)

    private var backgroundSession: URLSession!
    private var pendingCompletionHandler: (() -> Void)?
    private var responseDataByTaskId: [Int: Data] = [:]
    private var oversizedTaskIds: Set<Int> = []
    private var pendingDelegateWorkCount = 0
    private var didFinishEventsWhileWorkPending = false
    /// Per-fileKey consecutive 422 counter. Reset on 200 / 409 already_completed
    /// / empty queue transitions. Guarded by `lock`.
    private var consecutive422ByFileKey: [String: Int] = [:]
    /// When set, a TCP foreground resume was requested. The service must not
    /// chain a new background task once the current in-flight task completes.
    private var shouldResumeForegroundAfterCurrent = false
    private let lock = NSLock()

    // MARK: - Result enum

    enum EnqueueResult: Equatable {
        case enqueued
        case activeTaskExists
        case emptyQueue
        case queueHeadNotReady
        case missingBinding
        case missingHost
        case missingPairingToken
        case exportFailed(String)
        case queueHeadNeedsPreparation
        case staleTaskCancelled

        static func == (lhs: EnqueueResult, rhs: EnqueueResult) -> Bool {
            switch (lhs, rhs) {
            case (.enqueued, .enqueued),
                 (.activeTaskExists, .activeTaskExists),
                 (.emptyQueue, .emptyQueue),
                 (.queueHeadNotReady, .queueHeadNotReady),
                 (.missingBinding, .missingBinding),
                 (.missingHost, .missingHost),
                 (.missingPairingToken, .missingPairingToken),
                 (.queueHeadNeedsPreparation, .queueHeadNeedsPreparation),
                 (.staleTaskCancelled, .staleTaskCancelled):
                return true
            case let (.exportFailed(a), .exportFailed(b)):
                return a == b
            default:
                return false
            }
        }
    }

    // MARK: - Lifecycle

    override init() {
        super.init()
        // Deliberately do NOT reconnect here. iOS may deliver URLSession
        // delegate callbacks the moment the session is bound; if that happens
        // before `configureBackgroundUploadService(...)` wires `uploadStore`,
        // the identity gate rejects every callback as `store_missing` and the
        // `taskDescription`-driven state recovery (plan Phase 4.2 step 4) is
        // silently lost. Bootstrap order is now strictly:
        //   1. UploadStore.init / migration / sweepOrphanUploadingOnStartup
        //   2. SyncEngineManager.configureBackgroundUploadService() injects deps
        //   3. BackgroundUploadService.reconnectBackgroundSession() binds delegate
        // Both `configureBackgroundUploadService(...)` (step 2/3 fused) and
        // `handleEventsForBackgroundURLSession(...)` (relaunch path) call
        // `reconnectBackgroundSession()` explicitly, and the `backgroundSession
        // != nil` guard keeps it idempotent.
    }

    /// Recreate / adopt the background `URLSession` with `Self.sessionIdentifier`.
    /// Idempotent — callable from both the initial `SyncEngineManager.bootstrap`
    /// path and the URLSession-driven cold relaunch path.
    func reconnectBackgroundSession() {
        if backgroundSession != nil { return }
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.shouldUseExtendedBackgroundIdleMode = true
        // Background sessions manage connectivity waiting themselves.
        config.allowsCellularAccess = true
        // Safer default: HTTP request timeouts apply only to individual
        // headers; rely on iOS for overall retry scheduling.
        backgroundSession = URLSession(
            configuration: config,
            delegate: self,
            delegateQueue: nil
        )
    }

    /// Inject persistent collaborators. Called by `SyncEngineManager` once the
    /// underlying stores are constructed. Safe to call repeatedly — iOS may
    /// cold-relaunch the process purely to deliver URLSession events, and the
    /// app-level bootstrap will re-wire these references.
    func configureBackgroundUploadService(
        uploadStore: UploadStore,
        historyStore: HistoryLedgerStore,
        bindingService: BindingService,
        exportService: AssetExportService
    ) {
        self.uploadStore = uploadStore
        self.historyStore = historyStore
        self.bindingService = bindingService
        self.exportService = exportService
        reconnectBackgroundSession()
    }

    // MARK: - Public API

    /// Returns `true` if the background session has any currently-live
    /// upload task (including `waitingForConnectivity`).
    func hasActiveTask() async -> Bool {
        guard let session = backgroundSession else { return false }
        let tasks = await session.allTasks
        return tasks.contains { $0.state == .running || $0.state == .suspended }
    }

    /// Store the system-provided completion handler and make sure the session
    /// is wired up. Called from `AppDelegate.application(_:handleEventsForBackgroundURLSession:)`.
    func handleEventsForBackgroundURLSession(
        identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard identifier == Self.sessionIdentifier else {
            // Not ours — invoke immediately so iOS knows we're done.
            completionHandler()
            return
        }
        lock.lock()
        // If there is already a pending handler, chain it so none is dropped.
        if let existing = pendingCompletionHandler {
            pendingCompletionHandler = {
                existing()
                completionHandler()
            }
        } else {
            pendingCompletionHandler = completionHandler
        }
        lock.unlock()
        reconnectBackgroundSession()
        tryFlushBackgroundCompletionHandler()
    }

    /// Request that the next `didCompleteWithError` stop chaining new
    /// background tasks so the foreground TCP pipeline can take over.
    func requestForegroundResumeAfterBackgroundTask() {
        lock.lock()
        shouldResumeForegroundAfterCurrent = true
        lock.unlock()
    }

    /// Reset the deferred foreground-resume flag. Callers that drove the
    /// transition back to foreground should clear it once TCP has resumed so
    /// subsequent background transitions can schedule again.
    func clearForegroundResumeRequest() {
        lock.lock()
        shouldResumeForegroundAfterCurrent = false
        lock.unlock()
    }

    /// Compare-and-clear the prepared temp file (path + sha256 + size) for a
    /// given fileKey/identity pair, then unlink the on-disk file. Never clears
    /// unconditionally — an older task completing late must not delete a
    /// freshly-prepared body for the new binding.
    func cleanupTempFile(fileKey: String, identity: BackgroundUploadTaskIdentity) {
        guard let store = uploadStore else { return }
        do {
            let previousPath = try store.clearPreparedTempFile(fileKey: fileKey, identity: identity)
            if let path = previousPath, !path.isEmpty {
                try? FileManager.default.removeItem(atPath: path)
            }
        } catch {
            NSLog(
                "[BackgroundUpload] cleanupTempFile failed fileKey=%@ error=%@",
                fileKey,
                "\(error)"
            )
        }
    }

    // MARK: - Enqueue next file

    /// Core background scheduler: consider the current queue head, reconcile
    /// any stale URLSession tasks, and if nothing is in flight enqueue a
    /// single new background upload task.
    ///
    /// This is deliberately single-shot per call. The completion delegate
    /// invokes it again once a task finishes so background mode stays single
    /// file serial.
    func enqueueNextPendingFileIfIdle(
        binding: StoredBinding,
        clientId: String,
        allowPreparation: Bool
    ) async -> EnqueueResult {
        guard let store = uploadStore else { return .missingBinding }
        guard !binding.serverId.isEmpty else { return .missingBinding }
        guard !binding.sidecarHost.isEmpty else { return .missingHost }
        guard !binding.pairingTokenKeychainRef.isEmpty else {
            return .missingPairingToken
        }

        // --- 1. Reconcile existing background tasks against current binding ---
        let existing = await backgroundSession.allTasks
        var sawActiveForThisBinding = false
        var sawStale = false
        for task in existing {
            let identity = decodeIdentity(from: task.taskDescription)
            let matches = identity.map { id -> Bool in
                id.serverId == binding.serverId && id.clientId == clientId
            } ?? false
            if matches, let id = identity {
                // Active task for current binding — do not cancel even if
                // waitingForConnectivity. iOS will resume when connectivity
                // returns.
                sawActiveForThisBinding = true
                _ = id // silence unused
                continue
            }
            // Stale or unreadable — cancel and try to reset local row iff we
            // can prove the local row still owns this identity.
            task.cancel()
            sawStale = true
            if let id = identity {
                if store.backgroundTaskIdentityMatches(fileKey: id.fileKey, identity: id) {
                    do {
                        try store.updateTransport(fileKey: id.fileKey, transport: nil)
                        try store.updateUploadStatus(fileKey: id.fileKey, status: "queued")
                        try store.resetUploadOffset(fileKey: id.fileKey)
                        try store.setRequiresRemoteReset(fileKey: id.fileKey, value: true)
                        try store.clearBackgroundTaskIdentity(fileKey: id.fileKey, identity: id)
                    } catch {
                        NSLog(
                            "[BackgroundUpload] stale_background_task_cancelled reset failed fileKey=%@ error=%@",
                            id.fileKey,
                            "\(error)"
                        )
                    }
                    syncDiagnostics("stale_background_task_cancelled fileKey=\(id.fileKey) reason=binding_mismatch")
                } else {
                    syncDiagnostics("stale_background_task_cancelled_without_local_match fileKey=\(id.fileKey) reason=binding_mismatch")
                }
            } else {
                syncDiagnostics("stale_background_task_cancelled reason=identity_missing_or_undecodable")
            }
        }

        if sawActiveForThisBinding {
            return .activeTaskExists
        }

        // --- 2. Inspect queue head ---
        guard let head = store.getBackgroundHTTPQueueHead() else {
            // Queue is empty — clear consecutive 422 counters.
            clearAll422Counters()
            return sawStale ? .staleTaskCancelled : .emptyQueue
        }
        guard let fileKey = head.fileKey else {
            return .emptyQueue
        }
        if head.status == "cloud_downloading" {
            return .queueHeadNotReady
        }

        // --- 3. Resolve prepared HTTP body (path + sha + size) ---
        let prepared: (path: String, sha256: String, size: Int64)
        if let existing = store.getPreparedHTTPBody(fileKey: fileKey) {
            prepared = existing
        } else if !allowPreparation {
            return .queueHeadNeedsPreparation
        } else {
            guard let exporter = exportService else {
                return .queueHeadNeedsPreparation
            }
            // Try to resolve a PHAsset for the head — preparation path must
            // produce a temp file + SHA256 before we can proceed.
            let assetResult = PHAsset.fetchAssets(withLocalIdentifiers: [head.assetLocalId], options: nil)
            guard let asset = assetResult.firstObject else {
                return .exportFailed("phasset_not_found")
            }
            do {
                let exported = try await exporter.exportAsset(asset)
                let sha = try Self.sha256Hex(forFileAt: exported.tempURL)
                try store.updatePreparedTempFile(
                    fileKey: fileKey,
                    path: exported.tempURL.path,
                    sha256: sha,
                    size: exported.fileSize
                )
                prepared = (exported.tempURL.path, sha, exported.fileSize)
            } catch {
                return .exportFailed("\(error)")
            }
        }

        // --- 4. Resolve pairing token ---
        guard let bindingSvc = bindingService else { return .missingPairingToken }
        let token = resolvedPairingToken(
            bindingService: bindingSvc,
            keychainRef: binding.pairingTokenKeychainRef
        )
        guard let pairingToken = token, !pairingToken.isEmpty else {
            return .missingPairingToken
        }

        // --- 4.5 Sanitize header values ---
        // S6: HTTP header values must not contain CR/LF/NUL — CFNetwork on
        // older iOS happily splices them in as request smuggling vectors.
        // The values we emit are derived from fileKey / filename / mediaType
        // / timestamps, all of which can in principle come from PHAsset
        // metadata. Reject the whole enqueue attempt if any of them is
        // tainted; caller will retry the queue head later.
        let prospectiveFilename = head.originalFilename ?? head.assetLocalId
        if BackgroundUploadService.containsHeaderControlCharacters(fileKey)
            || BackgroundUploadService.containsHeaderControlCharacters(prospectiveFilename)
            || BackgroundUploadService.containsHeaderControlCharacters(head.mediaType)
            || BackgroundUploadService.containsHeaderControlCharacters(head.modifiedAt) {
            syncDiagnostics("enqueue_header_control_char fileKey=\(fileKey)")
            return .exportFailed("header_control_char")
        }

        // --- 5. Build identity + persist local row state ---
        // H2: tag the identity with the monotonic binding version resolved
        // from BindingService (backed by upload_store_meta). A nil here only
        // happens before the very first pair has completed — in that window
        // no background enqueue should be reachable anyway because the
        // binding guards above already require a non-empty serverId/host/
        // token, but we keep nil as a valid value so COALESCE(-1,-1) matches
        // pre-H2 legacy rows. Non-nil going forward means a post-re-pair
        // callback from a v1 task cannot apply against a v2 row (spec
        // Phase 2 L735-737, Phase 4 L1163-1175).
        let bindingVersion: Int? = bindingService?.currentBindingVersion()
        let identity = BackgroundUploadTaskIdentity(
            serverId: binding.serverId,
            clientId: clientId,
            fileKey: fileKey,
            bindingVersion: bindingVersion
        )

        do {
            // M6: wrap all five row mutations (transport / status /
            // acked_offset / requires_remote_reset / background_task_*)
            // in one SQL transaction so a suspend or crash between writes
            // cannot leave a half-initialised row that neither
            // `applyBackgroundCompletion` nor `rollbackLocalRowAfterEnqueueFailure`
            // can later recover.
            try store.beginBackgroundEnqueue(
                fileKey: fileKey,
                identity: identity,
                initialStatus: "uploading",
                initialOffset: 0,
                requiresRemoteReset: true
            )
        } catch {
            NSLog("[BackgroundUpload] enqueue local row setup failed fileKey=%@ error=%@", fileKey, "\(error)")
            return .exportFailed("\(error)")
        }

        // --- 6. Build URLRequest ---
        let filename = head.originalFilename ?? head.assetLocalId
        let mediaType = head.mediaType
        let fileSize = prepared.size
        let createdAtHeader = "" // queue head does not carry created_at; only optional header
        let modifiedAtHeader = head.modifiedAt

        let filenameB64 = Data(filename.utf8).base64EncodedString()
        // N6: use Int64 so this doesn't silently overflow on 32-bit builds.
        let timestamp = String(Int64(Date().timeIntervalSince1970))
        let nonce = Self.randomHexNonce()

        let path = "/upload/\(clientId)"
        let canonical = Self.canonicalString(
            method: "POST",
            path: path,
            clientId: clientId,
            fileKey: fileKey,
            filenameB64: filenameB64,
            mediaType: mediaType,
            fileSize: fileSize,
            bodySha256Hex: prepared.sha256,
            createdAt: createdAtHeader,
            modifiedAt: modifiedAtHeader,
            timestamp: timestamp,
            nonce: nonce
        )
        let authHex = Self.hmacSHA256Hex(keyPairingToken: pairingToken, canonical: canonical)

        let hostPart = binding.sidecarHost.contains(":") ? "[\(binding.sidecarHost)]" : binding.sidecarHost
        guard let url = URL(string: "http://\(hostPart):\(binding.port)\(path)") else {
            // Roll back — binding produced an invalid URL; free the row.
            rollbackLocalRowAfterEnqueueFailure(fileKey: fileKey, identity: identity)
            return .missingHost
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(fileKey, forHTTPHeaderField: "X-LynavoDrive-File-Key")
        request.setValue(filenameB64, forHTTPHeaderField: "X-LynavoDrive-Filename-B64")
        request.setValue(mediaType, forHTTPHeaderField: "X-LynavoDrive-Media-Type")
        request.setValue(String(fileSize), forHTTPHeaderField: "X-LynavoDrive-File-Size")
        request.setValue(prepared.sha256, forHTTPHeaderField: "X-LynavoDrive-SHA256")
        request.setValue("background_http", forHTTPHeaderField: "X-LynavoDrive-Upload-Mode")
        if !createdAtHeader.isEmpty {
            request.setValue(createdAtHeader, forHTTPHeaderField: "X-LynavoDrive-Created-At")
        }
        if !modifiedAtHeader.isEmpty {
            request.setValue(modifiedAtHeader, forHTTPHeaderField: "X-LynavoDrive-Modified-At")
        }
        request.setValue(authHex, forHTTPHeaderField: "X-LynavoDrive-Auth")
        request.setValue(timestamp, forHTTPHeaderField: "X-LynavoDrive-Auth-Timestamp")
        request.setValue(nonce, forHTTPHeaderField: "X-LynavoDrive-Auth-Nonce")

        // --- 7. Create + describe + resume task ---
        let tempURL = URL(fileURLWithPath: prepared.path)
        let task = backgroundSession.uploadTask(with: request, fromFile: tempURL)
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(identity),
              let descriptor = String(data: data, encoding: .utf8) else {
            task.cancel()
            rollbackLocalRowAfterEnqueueFailure(fileKey: fileKey, identity: identity)
            return .exportFailed("taskDescription_encoding_failed")
        }
        task.taskDescription = descriptor
        task.resume()
        return .enqueued
    }

    // MARK: - Rollback helper

    /// Compare-and-clear local row state if we set it up for a background HTTP
    /// task but failed to actually hand the task to URLSession.
    private func rollbackLocalRowAfterEnqueueFailure(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity
    ) {
        guard let store = uploadStore else { return }
        // Only roll back if the row still carries our identity — otherwise a
        // concurrent binding switch may already have moved on.
        guard store.backgroundTaskIdentityMatches(fileKey: fileKey, identity: identity) else {
            return
        }
        do {
            try store.updateTransport(fileKey: fileKey, transport: nil)
            try store.updateUploadStatus(fileKey: fileKey, status: "queued")
            try store.resetUploadOffset(fileKey: fileKey)
            // S1: we never actually sent a byte to sidecar for this attempt,
            // so leaving requires_remote_reset=1 would only cost the next
            // attempt an unnecessary DELETE round-trip. Clear it here.
            try store.setRequiresRemoteReset(fileKey: fileKey, value: false)
            try store.clearBackgroundTaskIdentity(fileKey: fileKey, identity: identity)
        } catch {
            NSLog(
                "[BackgroundUpload] rollback_local_row_failed fileKey=%@ error=%@",
                fileKey,
                "\(error)"
            )
        }
    }

    // MARK: - Completion handler drain gate

    private func beginDelegateWork() {
        lock.lock()
        pendingDelegateWorkCount += 1
        lock.unlock()
    }

    private func finishDelegateWork() {
        lock.lock()
        pendingDelegateWorkCount -= 1
        let shouldFlush = pendingDelegateWorkCount == 0 && didFinishEventsWhileWorkPending
        lock.unlock()
        if shouldFlush { tryFlushBackgroundCompletionHandler() }
    }

    private func tryFlushBackgroundCompletionHandler() {
        lock.lock()
        guard pendingDelegateWorkCount == 0 && didFinishEventsWhileWorkPending else {
            lock.unlock()
            return
        }
        let handler = pendingCompletionHandler
        pendingCompletionHandler = nil
        didFinishEventsWhileWorkPending = false
        lock.unlock()
        handler?()
    }

    // MARK: - Binding resolution for delegate callbacks

    /// Resolve the current binding for the purpose of identity-gating.
    ///
    /// Priority order (plan L796-800):
    ///   1. `syncEngineManager` (if Wave 3 has wired it) — reflects an
    ///      in-memory binding swap before SQLite catches up.
    ///   2. Live `UploadStore.getBinding()` — the normal hot path.
    ///   3. Persisted `last_known_binding` — covers cold relaunches where
    ///      the full binding row has not been hydrated yet.
    ///
    /// Step (1) is prepared but currently dormant: SyncEngineManager does
    /// not yet expose a `currentBinding` accessor. When Wave 3 lands it,
    /// this method should short-circuit on the manager's snapshot before
    /// falling through to the store.
    private func resolveCurrentBinding() -> (serverId: String, clientId: String)? {
        guard let store = uploadStore, let bindingSvc = bindingService else { return nil }
        let clientId = bindingSvc.getOrCreateClientId()
        // (1) Live snapshot on SyncEngineManager — reflects a just-persisted
        //     pairing before SQLite catches up. Wave 3 wiring.
        if let live = syncEngineManager?.currentBinding, !live.serverId.isEmpty {
            return (live.serverId, clientId)
        }
        if let binding = store.getBinding(), !binding.deviceId.isEmpty {
            return (binding.deviceId, clientId)
        }
        if let lastKnown = store.getLastKnownBinding() {
            return (lastKnown.serverId, clientId)
        }
        return nil
    }

    /// Identity gate — returns the decoded identity iff the task belongs to
    /// the current binding and the local row still owns it. Otherwise returns
    /// `nil` and the caller must emit diagnostics + stop mutating DB state.
    private func identityForCallback(task: URLSessionTask, reason: String) -> BackgroundUploadTaskIdentity? {
        guard let identity = decodeIdentity(from: task.taskDescription) else {
            syncDiagnostics("stale_background_task_completion_ignored reason=identity_undecodable stage=\(reason)")
            return nil
        }
        guard let current = resolveCurrentBinding() else {
            syncDiagnostics("stale_background_task_completion_ignored reason=binding_unresolved stage=\(reason) fileKey=\(identity.fileKey)")
            return nil
        }
        guard identity.serverId == current.serverId, identity.clientId == current.clientId else {
            syncDiagnostics("stale_background_task_completion_ignored reason=binding_mismatch stage=\(reason) fileKey=\(identity.fileKey)")
            return nil
        }
        guard let store = uploadStore else {
            syncDiagnostics("stale_background_task_completion_ignored reason=store_missing stage=\(reason) fileKey=\(identity.fileKey)")
            return nil
        }
        guard store.backgroundTaskIdentityMatches(fileKey: identity.fileKey, identity: identity) else {
            syncDiagnostics("stale_background_task_completion_ignored reason=row_identity_mismatch stage=\(reason) fileKey=\(identity.fileKey)")
            return nil
        }
        return identity
    }

    // MARK: - Helpers

    private func decodeIdentity(from description: String?) -> BackgroundUploadTaskIdentity? {
        guard let description, let data = description.data(using: .utf8) else { return nil }
        guard let identity = try? JSONDecoder().decode(BackgroundUploadTaskIdentity.self, from: data) else {
            return nil
        }
        // Reject unknown schema versions. Older binaries must not interpret
        // future envelopes as valid identities (and vice versa).
        guard identity.schemaVersion == Self.currentIdentitySchemaVersion else {
            return nil
        }
        return identity
    }

    private func resolvedPairingToken(
        bindingService: BindingService,
        keychainRef: String
    ) -> String? {
        if let token = bindingService.getPairingToken(forKey: keychainRef), !token.isEmpty {
            return token
        }
        if keychainRef != BindingService.legacyPairingTokenKey {
            return bindingService.getPairingToken(forKey: BindingService.legacyPairingTokenKey)
        }
        return nil
    }

    private func syncDiagnostics(_ message: String) {
        NSLog("[BackgroundUpload] %@", message)
    }

    // MARK: - Canonical string + HMAC helpers (static)

    /// Produce the canonical string for HMAC signing. All line separators are
    /// literal LF (`0x0A`). The layout must stay byte-identical to the sidecar
    /// implementation.
    static func canonicalString(
        method: String,
        path: String,
        clientId: String,
        fileKey: String,
        filenameB64: String,
        mediaType: String,
        fileSize: Int64,
        bodySha256Hex: String,
        createdAt: String,
        modifiedAt: String,
        timestamp: String,
        nonce: String
    ) -> String {
        var parts: [String] = []
        parts.append(method)
        parts.append(path)
        parts.append(clientId)
        parts.append(fileKey)
        parts.append(filenameB64)
        parts.append(mediaType)
        parts.append(String(fileSize))
        parts.append(bodySha256Hex)
        parts.append(createdAt)
        parts.append(modifiedAt)
        parts.append(timestamp)
        parts.append(nonce)
        return parts.joined(separator: "\n")
    }

    /// HMAC-SHA256 of `canonical` with key = SHA256(pairingToken) (raw 32 bytes).
    static func hmacSHA256Hex(keyPairingToken: String, canonical: String) -> String {
        let tokenData = Data(keyPairingToken.utf8)
        let keyBytes = SHA256.hash(data: tokenData)
        let keyData = Data(keyBytes)
        let symmetric = SymmetricKey(data: keyData)
        let signature = HMAC<SHA256>.authenticationCode(
            for: Data(canonical.utf8),
            using: symmetric
        )
        return Data(signature).map { String(format: "%02x", $0) }.joined()
    }

    /// Streaming SHA256 of a file — avoids loading the whole upload body into
    /// memory so video files don't blow the process budget.
    static func sha256Hex(forFileAt url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        let chunkSize = 256 * 1024
        while autoreleasepool(invoking: { () -> Bool in
            // N1: read(upToCount:) propagates errors instead of silently
            // returning Data() like readData(ofLength:) used to.
            let chunk: Data
            do {
                chunk = try handle.read(upToCount: chunkSize) ?? Data()
            } catch {
                NSLog("[BackgroundUpload] sha256Hex read error at %@: %@", url.path, "\(error)")
                return false
            }
            if chunk.isEmpty { return false }
            hasher.update(data: chunk)
            return true
        }) {}
        let digest = hasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// S6: reject any string that would inject CR/LF/NUL into an HTTP
    /// header value. CFNetwork on older iOS is lenient about these bytes,
    /// so we filter at the enqueue layer instead of relying on URLSession.
    static func containsHeaderControlCharacters(_ s: String) -> Bool {
        return s.contains("\n") || s.contains("\r") || s.contains("\0")
    }

    /// Produce a 128-bit random nonce encoded as lowercase hex.
    static func randomHexNonce() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            // Fallback: low-quality but non-repeating. Background tasks that
            // fail to generate nonces would be unusable, so prefer to proceed.
            for i in 0..<bytes.count {
                bytes[i] = UInt8.random(in: 0...255)
            }
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - 422 counter

    private func incrementAndRead422(fileKey: String) -> Int {
        lock.lock()
        let next = (consecutive422ByFileKey[fileKey] ?? 0) + 1
        consecutive422ByFileKey[fileKey] = next
        lock.unlock()
        return next
    }

    private func reset422Counter(fileKey: String) {
        lock.lock()
        consecutive422ByFileKey.removeValue(forKey: fileKey)
        lock.unlock()
    }

    fileprivate func clearAll422Counters() {
        lock.lock()
        consecutive422ByFileKey.removeAll()
        lock.unlock()
    }

    fileprivate func readShouldResumeForeground() -> Bool {
        lock.lock()
        let v = shouldResumeForegroundAfterCurrent
        lock.unlock()
        return v
    }
}

// MARK: - URLSessionDataDelegate / URLSessionTaskDelegate

extension BackgroundUploadService: URLSessionDataDelegate, URLSessionTaskDelegate {

    // Upload progress. No DB mutation happens until we've passed the identity
    // gate so stale tasks can't clobber the live row's ackedOffset.
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard let identity = identityForCallback(task: task, reason: "didSendBodyData") else {
            return
        }
        guard let store = uploadStore else { return }
        try? store.updateUploadOffset(fileKey: identity.fileKey, offset: totalBytesSent)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        // Identity gate first (plan L819-836): a stale task must not spend
        // more of our response-buffer quota, so drop any accumulated bytes
        // and return before touching the live buffers again.
        guard identityForCallback(task: dataTask, reason: "didReceive") != nil else {
            lock.lock()
            responseDataByTaskId.removeValue(forKey: dataTask.taskIdentifier)
            oversizedTaskIds.remove(dataTask.taskIdentifier)
            lock.unlock()
            return
        }
        // Response-body bookkeeping is independent of DB state — we always
        // enforce the 16 KB cap so relaunch restoration can't fill disk.
        lock.lock()
        let taskId = dataTask.taskIdentifier
        let existing = responseDataByTaskId[taskId]?.count ?? 0
        if existing + data.count > Self.uploadMaxResponseBodyBytes {
            responseDataByTaskId.removeValue(forKey: taskId)
            oversizedTaskIds.insert(taskId)
            lock.unlock()
            dataTask.cancel()
            return
        }
        var buffer = responseDataByTaskId[taskId] ?? Data()
        buffer.append(data)
        responseDataByTaskId[taskId] = buffer
        lock.unlock()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        beginDelegateWork()

        let taskId = task.taskIdentifier
        // Snapshot + drain the task-local buffers synchronously so nothing
        // leaks even when we bail early.
        lock.lock()
        let body = responseDataByTaskId.removeValue(forKey: taskId) ?? Data()
        let wasOversized = oversizedTaskIds.remove(taskId) != nil
        lock.unlock()

        guard let identity = identityForCallback(task: task, reason: "didCompleteWithError") else {
            finishDelegateWork()
            return
        }

        // Kick off the async work inside a Task so we can await DB/export
        // coordinators without blocking the delegate queue.
        Task { [weak self] in
            guard let self else { return }
            await self.finalizeCompletion(
                task: task,
                identity: identity,
                responseBody: body,
                wasOversized: wasOversized,
                error: error
            )
            self.finishDelegateWork()
        }
    }

    /// Identity-gated metrics delegate. Spec Phase 2 verify item #3 requires
    /// every URLSession delegate that can fire after a task has been
    /// superseded to route through `identityForCallback(task:)` so stale
    /// callbacks are dropped. We currently have no metrics consumer; this
    /// stub exists solely so the gate is in place and any future addition
    /// (throughput tracking, diagnostics, etc.) cannot accidentally skip it.
    ///
    /// DO NOT log, persist, or forward `metrics` without first re-confirming
    /// `identity` — a late-arriving metrics callback from a stale task must
    /// not write into the row now owned by a newer enqueue.
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didFinishCollecting metrics: URLSessionTaskMetrics
    ) {
        guard identityForCallback(task: task, reason: "didFinishCollectingMetrics") != nil else {
            return
        }
        // TODO: hook up metrics consumers here. Any code added must assume
        // `identity` is current for THIS task only; do not reach into shared
        // state without the identity predicate.
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        didFinishEventsWhileWorkPending = true
        lock.unlock()
        tryFlushBackgroundCompletionHandler()
    }
}

// MARK: - Completion finalization

// `internal` (not `private`) so the T5 test harness in Tests/main.swift
// can drive each `handleX` disposition directly. The handlers still run
// under the identity gate when reached from the real URLSession
// delegate; exposing them to the module doesn't change production call
// sites, which continue to go through `finalizeCompletion(...)`.
extension BackgroundUploadService {

    /// Apply completion semantics for a single URLSession upload task. All DB
    /// transitions go through compare-and-clear helpers keyed on `identity`.
    func finalizeCompletion(
        task: URLSessionTask,
        identity: BackgroundUploadTaskIdentity,
        responseBody: Data,
        wasOversized: Bool,
        error: Error?
    ) async {
        guard uploadStore != nil else { return }
        let fileKey = identity.fileKey

        // Oversized response from sidecar collapses into a retryable 5xx-style
        // path — clear local transport, keep requires_remote_reset=1.
        if wasOversized {
            let owned = await handleRetryable(
                fileKey: fileKey,
                identity: identity,
                reason: "response_body_too_large"
            )
            if owned {
                await chainNextIfAppropriate()
            }
            return
        }

        let httpResponse = task.response as? HTTPURLResponse
        let status = httpResponse?.statusCode ?? 0
        let parsed = parseJSONStatus(responseBody)

        if let error, httpResponse == nil {
            // URLError / transport error — treat as retryable.
            NSLog("[BackgroundUpload] task error fileKey=%@ error=%@", fileKey, "\(error)")
            let owned = await handleRetryable(
                fileKey: fileKey,
                identity: identity,
                reason: "url_error"
            )
            if owned {
                await chainNextIfAppropriate()
            }
            return
        }

        // Every branch returns an ownership flag: true when the identity
        // predicate still matched (row was legitimately transitioned), false
        // when the callback was stale. Chaining the next task is only safe
        // when we still owned the row — otherwise a newer enqueue already
        // owns the queue head and we'd double-enqueue or fight over state.
        let stillOwned: Bool
        switch status {
        case 200:
            reset422Counter(fileKey: fileKey)
            stillOwned = await handleSuccess(
                fileKey: fileKey,
                identity: identity,
                parsed: parsed,
                alreadyCompleted: false,
                responseBodyForLog: responseBody
            )
        case 409:
            switch parsed.status {
            case "already_completed":
                reset422Counter(fileKey: fileKey)
                stillOwned = await handleSuccess(
                    fileKey: fileKey,
                    identity: identity,
                    parsed: parsed,
                    alreadyCompleted: true,
                    responseBodyForLog: responseBody
                )
            case "concurrent_transfer":
                stillOwned = await handleConcurrentTransfer(fileKey: fileKey, identity: identity)
            default:
                stillOwned = await handleRetryable(
                    fileKey: fileKey,
                    identity: identity,
                    reason: "409_\(parsed.status ?? "unknown")"
                )
            }
        case 401:
            switch parsed.status {
            case "auth_timestamp_out_of_window", "auth_nonce_replay":
                stillOwned = await handleAuthStale(fileKey: fileKey, identity: identity, reason: parsed.status ?? "auth_stale")
            default:
                // auth_invalid_signature / auth_revoked_device -> repair
                stillOwned = await handleAuthRepair(fileKey: fileKey, identity: identity, reason: parsed.status ?? "auth_failed")
            }
        case 403:
            if parsed.status == "file_key_owner_mismatch" {
                stillOwned = await handleFatalOwnerMismatch(fileKey: fileKey, identity: identity)
            } else {
                stillOwned = await handleRetryable(
                    fileKey: fileKey,
                    identity: identity,
                    reason: "403_\(parsed.status ?? "unknown")"
                )
            }
        case 404:
            if parsed.status == "unknown_client" || parsed.status == "device_not_paired" {
                stillOwned = await handleAuthRepair(fileKey: fileKey, identity: identity, reason: parsed.status ?? "repair")
            } else {
                stillOwned = await handleRetryable(
                    fileKey: fileKey,
                    identity: identity,
                    reason: "404_\(parsed.status ?? "unknown")"
                )
            }
        case 422:
            switch parsed.status {
            case "file_size_mismatch", "body_hash_mismatch", "body_too_large":
                stillOwned = await handle422(
                    fileKey: fileKey,
                    identity: identity,
                    reason: parsed.status ?? "422"
                )
            default:
                stillOwned = await handleRetryable(
                    fileKey: fileKey,
                    identity: identity,
                    reason: "422_\(parsed.status ?? "unknown")"
                )
            }
        default:
            // 4xx / 5xx bucket.
            stillOwned = await handleRetryable(
                fileKey: fileKey,
                identity: identity,
                reason: "http_\(status)"
            )
        }

        // Stale callbacks MUST NOT drive task chaining. The row that used to
        // be ours has been taken over by a new enqueue, and that new enqueue
        // is already responsible for scheduling what comes next.
        if stillOwned {
            await chainNextIfAppropriate()
        }
    }

    // MARK: - Completion sub-handlers

    // MARK: - Completion handlers (identity-guarded atomic transitions)
    //
    // Each handler below applies its state transition via
    // `UploadStore.applyBackgroundCompletion(...)` — a single SQL UPDATE
    // guarded by (file_key + background_task_server/client/version). If the
    // UPDATE hits zero rows the completion is stale (a newer enqueue has
    // already taken over the row) and the handler MUST skip every side
    // effect that assumes ownership: temp-file cleanup, history writes,
    // follow-on task chaining. Callers inspect the returned Bool to decide
    // whether to chain.

    /// Apply the compare-and-set patch and diagnose stale callbacks.
    /// Returns true when the identity was still current, false otherwise.
    ///
    /// IMPORTANT: identity is NOT cleared here. `clearPreparedTempFile`
    /// performs its SELECT under the `background_task_*` identity predicate,
    /// so clearing identity in this first UPDATE would null out the columns
    /// before any subsequent temp-file cleanup could find them and the
    /// on-disk body would leak. Callers that terminate the row (success /
    /// fatal / final 422) MUST call `finalizeTerminalCompletion` below,
    /// which orders the steps as: cleanup temp → clear identity. Callers
    /// that leave the row queued for retry MUST call
    /// `clearBackgroundTaskIdentityAfterCompletion` (or retain identity on
    /// purpose — see handleConcurrentTransfer).
    private func applyCompletionOrLogStale(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity,
        status: String,
        requiresRemoteReset: Bool? = nil,
        reason: String
    ) -> Bool {
        guard let store = uploadStore else { return false }
        do {
            let matched = try store.applyBackgroundCompletion(
                fileKey: fileKey,
                identity: identity,
                status: status,
                clearTransport: true,
                requiresRemoteReset: requiresRemoteReset,
                resetOffset: true,
                clearIdentity: false
            )
            if !matched {
                syncDiagnostics(
                    "stale_background_task_completion_ignored reason=\(reason) fileKey=\(fileKey) serverId=\(identity.serverId) clientId=\(identity.clientId)"
                )
            }
            return matched
        } catch {
            NSLog(
                "[BackgroundUpload] applyBackgroundCompletion DB error fileKey=%@ reason=%@ error=%@",
                fileKey,
                reason,
                "\(error)"
            )
            return false
        }
    }

    /// Second-phase identity clear for callers that keep the row queued for
    /// retry (auth_stale, auth_repair, retryable, 422 retry) and for terminal
    /// callers that already ran `cleanupTempFile`. Safe to call any time
    /// after `applyCompletionOrLogStale` returned true.
    private func clearBackgroundTaskIdentityAfterCompletion(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity
    ) {
        guard let store = uploadStore else { return }
        do {
            try store.clearBackgroundTaskIdentity(fileKey: fileKey, identity: identity)
        } catch {
            NSLog(
                "[BackgroundUpload] clearBackgroundTaskIdentity DB error fileKey=%@ error=%@",
                fileKey,
                "\(error)"
            )
        }
    }

    /// Returns true when the handler still owned the row (caller may chain
    /// the next file or write history); false means the callback was stale
    /// and the caller must bail out of all follow-ups.
    @discardableResult
    func handleSuccess(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity,
        parsed: ParsedStatus,
        alreadyCompleted: Bool,
        responseBodyForLog: Data? = nil
    ) async -> Bool {
        // S7: any path that terminates in handleSuccess (200 OK, 409
        // already_completed) is authoritative success from the sidecar —
        // reset the per-fileKey 422 counter here rather than relying on
        // every call site.
        reset422Counter(fileKey: fileKey)
        let matched = applyCompletionOrLogStale(
            fileKey: fileKey,
            identity: identity,
            status: "completed",
            requiresRemoteReset: false,
            reason: alreadyCompleted ? "409_already_completed" : "200_completed"
        )
        guard matched else { return false }
        // Temp-file cleanup must happen BEFORE identity is cleared, because
        // clearPreparedTempFile SELECTs under the identity predicate.
        // applyCompletionOrLogStale deliberately left identity intact so
        // this ordering is safe; we clear identity explicitly below.
        cleanupTempFile(fileKey: fileKey, identity: identity)
        clearBackgroundTaskIdentityAfterCompletion(fileKey: fileKey, identity: identity)
        // History ledger — the "which day does this upload belong to" answer
        // must come from the sidecar / Mac completion day (see CLAUDE.md and
        // plan L280-285). If the sidecar response is missing either
        // ledgerDate or activeTransmissionMs we intentionally SKIP the
        // ledger write rather than inventing local values — the upload row
        // is still marked completed so the queue moves on, but the history
        // surface is left to whichever side holds the canonical timestamp.
        if let ledgerDate = parsed.ledgerDate,
           let transmissionMs = parsed.activeTransmissionMs {
            writeHistoryLedger(
                fileKey: fileKey,
                identity: identity,
                ledgerDate: ledgerDate,
                transmissionMs: transmissionMs
            )
        } else if !alreadyCompleted {
            let bodyPreview = String(data: responseBodyForLog ?? Data(), encoding: .utf8) ?? "<non-utf8>"
            NSLog(
                "[BackgroundUpload] 200 completed but ledger fields missing - upload marked completed but history skipped: fileKey=%@ body=%@",
                fileKey,
                bodyPreview
            )
        }
        return true
    }

    @discardableResult
    func handleConcurrentTransfer(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity
    ) async -> Bool {
        // Keep requires_remote_reset = 1 (server may already hold bytes).
        let matched = applyCompletionOrLogStale(
            fileKey: fileKey,
            identity: identity,
            status: "queued",
            requiresRemoteReset: nil, // don't touch
            reason: "409_concurrent_transfer"
        )
        // Do NOT clean up temp file — still usable for next attempt.
        // Identity is cleared so the next enqueue can take over the row.
        if matched {
            clearBackgroundTaskIdentityAfterCompletion(fileKey: fileKey, identity: identity)
        }
        return matched
    }

    @discardableResult
    func handleAuthStale(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity,
        reason: String
    ) async -> Bool {
        // Keep requires_remote_reset = 1; keep temp + hash.
        let matched = applyCompletionOrLogStale(
            fileKey: fileKey,
            identity: identity,
            status: "queued",
            requiresRemoteReset: nil,
            reason: "auth_stale:\(reason)"
        )
        if matched {
            clearBackgroundTaskIdentityAfterCompletion(fileKey: fileKey, identity: identity)
        }
        syncDiagnostics("background_http_auth_stale reason=\(reason) fileKey=\(fileKey)")
        return matched
    }

    @discardableResult
    func handleAuthRepair(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity,
        reason: String
    ) async -> Bool {
        guard let store = uploadStore else { return false }
        // M7: spec L48 pins the repair threshold at 1 — every
        // repair-required auth failure immediately flips needs_repair.
        // Evaluated as `observedCount >= threshold`; with threshold = 1
        // the comparison is true from the very first failure, matching
        // the existing behaviour. Expressing it this way keeps the
        // counter / threshold wiring explicit so a future spec tweak can
        // bump the constant without re-deriving the branch.
        let observedConsecutiveAuthFailures = 1
        if observedConsecutiveAuthFailures >= Self.consecutiveAuthRepairThreshold {
            // needs_repair is a process-wide flag; set it first regardless
            // of whether we still own this row, so the app still enters
            // repair mode even on a stale callback.
            let persistedReason = "background_http_auth_failed:\(reason)"
            do {
                try store.setNeedsRepair(value: true, reason: persistedReason)
            } catch {
                NSLog("[BackgroundUpload] handleAuthRepair setNeedsRepair error=%@", "\(error)")
            }
            // H8 Phase 2 (L805-830): fan the flip out to RN so the banner +
            // auto-upload gate react without polling. Emit even on the
            // setNeedsRepair error branch above — the process-wide state
            // still transitioned semantically and the UI needs to reflect it.
            // `reason` here is the raw 4-code string
            // (`auth_invalid_signature` / `auth_revoked_device` /
            // `unknown_client` / `device_not_paired`); we forward it to JS
            // so `isAuthRepairRequired` / `AUTH_REPAIR_REASONS` can classify.
            NativeSyncEngineModule.shared?.emitRepairStateChanged(
                needsRepair: true,
                reason: reason
            )
        }
        // Keep requires_remote_reset = 1.
        let matched = applyCompletionOrLogStale(
            fileKey: fileKey,
            identity: identity,
            status: "queued",
            requiresRemoteReset: nil,
            reason: "auth_repair:\(reason)"
        )
        if matched {
            clearBackgroundTaskIdentityAfterCompletion(fileKey: fileKey, identity: identity)
        }
        syncDiagnostics("background_http_auth_repair reason=\(reason) fileKey=\(fileKey)")
        return matched
    }

    @discardableResult
    func handleFatalOwnerMismatch(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity
    ) async -> Bool {
        let matched = applyCompletionOrLogStale(
            fileKey: fileKey,
            identity: identity,
            status: "failed",
            requiresRemoteReset: false,
            reason: "403_file_key_owner_mismatch"
        )
        guard matched else { return false }
        // Temp cleanup BEFORE identity clear (see applyCompletionOrLogStale docs).
        cleanupTempFile(fileKey: fileKey, identity: identity)
        clearBackgroundTaskIdentityAfterCompletion(fileKey: fileKey, identity: identity)
        syncDiagnostics("background_http_fatal_owner_mismatch fileKey=\(fileKey) serverId=\(identity.serverId) clientId=\(identity.clientId)")
        return true
    }

    @discardableResult
    func handleRetryable(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity,
        reason: String
    ) async -> Bool {
        // Keep requires_remote_reset = 1, temp file retained.
        let matched = applyCompletionOrLogStale(
            fileKey: fileKey,
            identity: identity,
            status: "queued",
            requiresRemoteReset: nil,
            reason: "retryable:\(reason)"
        )
        if matched {
            clearBackgroundTaskIdentityAfterCompletion(fileKey: fileKey, identity: identity)
        }
        syncDiagnostics("background_http_retryable reason=\(reason) fileKey=\(fileKey)")
        return matched
    }

    @discardableResult
    func handle422(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity,
        reason: String
    ) async -> Bool {
        let count = incrementAndRead422(fileKey: fileKey)
        if count >= Self.consecutive422FailureThreshold {
            reset422Counter(fileKey: fileKey)
            let matched = applyCompletionOrLogStale(
                fileKey: fileKey,
                identity: identity,
                status: "failed",
                requiresRemoteReset: nil,
                reason: "422_final_fail:\(reason)"
            )
            if matched {
                // Temp cleanup BEFORE identity clear.
                cleanupTempFile(fileKey: fileKey, identity: identity)
                clearBackgroundTaskIdentityAfterCompletion(fileKey: fileKey, identity: identity)
            }
            syncDiagnostics("background_http_422_final_fail reason=\(reason) fileKey=\(fileKey) count=\(count)")
            return matched
        }
        // Keep requires_remote_reset = 1 — sidecar may already hold body.
        let matched = applyCompletionOrLogStale(
            fileKey: fileKey,
            identity: identity,
            status: "queued",
            requiresRemoteReset: nil,
            reason: "422_retry:\(reason)"
        )
        if matched {
            // Clear prepared temp + hash so we re-export next attempt.
            // Temp cleanup BEFORE identity clear.
            cleanupTempFile(fileKey: fileKey, identity: identity)
            clearBackgroundTaskIdentityAfterCompletion(fileKey: fileKey, identity: identity)
        }
        syncDiagnostics("background_http_422_retry reason=\(reason) fileKey=\(fileKey) count=\(count)")
        return matched
    }

    // MARK: - Follow-on task chaining

    /// Decide whether to enqueue the next background HTTP task after a
    /// completion. Respects `shouldResumeForegroundAfterCurrent`, the
    /// persisted `needs_repair` flag (set by auth repair completions),
    /// the presence of an active task (shouldn't be one after completion, but
    /// defensive), and the ability to resolve binding/host/token from the
    /// persisted stores.
    func chainNextIfAppropriate() async {
        if readShouldResumeForeground() { return }

        guard let store = uploadStore else { return }

        // Plan L851-856: once the row has been flipped into needs_repair we
        // must stop queuing new background tasks for this clientId so the
        // BGProcessing quota isn't burned before the user repairs the
        // binding. `needs_repair` is persisted on the DB so this also covers
        // cold relaunches — the flag is cleared by BindingService once the
        // user re-pairs.
        if store.getNeedsRepair().flag {
            syncDiagnostics("chain_skipped_needs_repair")
            return
        }

        guard let bindingSvc = bindingService else { return }

        let clientId = bindingSvc.getOrCreateClientId()
        let storedBinding: StoredBinding
        if let binding = store.getBinding(),
           !binding.deviceId.isEmpty,
           !binding.host.isEmpty,
           !binding.pairingTokenKeychainRef.isEmpty {
            storedBinding = StoredBinding(
                serverId: binding.deviceId,
                sidecarHost: binding.host,
                port: binding.port,
                pairingTokenKeychainRef: binding.pairingTokenKeychainRef
            )
        } else if let lastKnown = store.getLastKnownBinding() {
            storedBinding = lastKnown
        } else {
            return
        }

        _ = await enqueueNextPendingFileIfIdle(
            binding: storedBinding,
            clientId: clientId,
            allowPreparation: false
        )
    }

    // MARK: - Ledger helper

    func writeHistoryLedger(
        fileKey: String,
        identity: BackgroundUploadTaskIdentity,
        ledgerDate: String,
        transmissionMs: Int64
    ) {
        guard let store = uploadStore, let history = historyStore else { return }
        // Resolve binding snapshot for the device_name / device_ip fields.
        let binding = store.getBinding()
        let deviceName = binding?.deviceName ?? identity.serverId
        let deviceIp = (binding?.host.isEmpty == false) ? (binding?.host ?? "") : deviceName
        let deviceId = binding?.deviceId ?? identity.serverId
        // Resolve file size via the upload row so we can still write a
        // faithful ledger entry after the URLSession completed.
        guard let row = store.getUploadItemByFileKey(fileKey),
              let size = row.fileSize else {
            return
        }
        do {
            try history.upsertDailyLedger(
                date: ledgerDate,
                deviceId: deviceId,
                deviceName: deviceName,
                deviceIp: deviceIp,
                fileCount: 1,
                totalBytes: size,
                transmissionMs: max(transmissionMs, 100)
            )
        } catch {
            NSLog("[BackgroundUpload] ledger upsert failed fileKey=%@ error=%@", fileKey, "\(error)")
        }
    }

    static func todayLedgerDate() -> String {
        let fmt = DateFormatter()
        fmt.calendar = Calendar(identifier: .gregorian)
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = TimeZone.current
        return fmt.string(from: Date())
    }

    // MARK: - JSON helpers

    struct ParsedStatus {
        let status: String?
        let ledgerDate: String?
        let activeTransmissionMs: Int64?
    }

    func parseJSONStatus(_ data: Data) -> ParsedStatus {
        guard !data.isEmpty,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ParsedStatus(status: nil, ledgerDate: nil, activeTransmissionMs: nil)
        }
        let status = obj["status"] as? String
        let ledgerDate = obj["ledgerDate"] as? String
        let transmissionMs: Int64?
        if let v = obj["activeTransmissionMs"] as? Int64 {
            transmissionMs = v
        } else if let n = obj["activeTransmissionMs"] as? NSNumber {
            transmissionMs = n.int64Value
        } else if let i = obj["activeTransmissionMs"] as? Int {
            transmissionMs = Int64(i)
        } else {
            transmissionMs = nil
        }
        return ParsedStatus(
            status: status,
            ledgerDate: ledgerDate,
            activeTransmissionMs: transmissionMs
        )
    }
}
