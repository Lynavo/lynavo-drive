import Foundation
import UIKit
import BackgroundTasks

class BackgroundExecutionService {
    static let continuedTaskId = "com.syncflow.sync.continued"
    static let maintenanceTaskId = "com.syncflow.sync.maintenance"

    /// Register background task handlers — call in AppDelegate didFinishLaunchingWithOptions
    func registerBackgroundTasks() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.continuedTaskId, using: nil) { task in
            self.handleContinuedTask(task as! BGProcessingTask)
        }

        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.maintenanceTaskId, using: nil) { task in
            self.handleMaintenanceTask(task as! BGProcessingTask)
        }

        NSLog("[BackgroundExec] registered background tasks")
    }

    /// Submit continued processing task — call when foreground sync starts
    func submitContinuedTask() {
        let request = BGProcessingTaskRequest(identifier: Self.continuedTaskId)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        do {
            try BGTaskScheduler.shared.submit(request)
            NSLog("[BackgroundExec] submitted continued task")
        } catch {
            NSLog("[BackgroundExec] failed to submit continued task: %@", "\(error)")
        }
    }

    func cancelContinuedTask() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.continuedTaskId)
        NSLog("[BackgroundExec] cancelled continued task")
    }

    /// Submit maintenance task — call when sync ends or continued task expires
    func submitMaintenanceTask() {
        let request = BGProcessingTaskRequest(identifier: Self.maintenanceTaskId)
        request.requiresNetworkConnectivity = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 min from now
        do {
            try BGTaskScheduler.shared.submit(request)
            NSLog("[BackgroundExec] submitted maintenance task")
        } catch {
            NSLog("[BackgroundExec] failed to submit maintenance task: %@", "\(error)")
        }
    }

    /// Begin transition task — call when app moves to background
    func beginTransitionTask() -> UIBackgroundTaskIdentifier {
        return UIApplication.shared.beginBackgroundTask {
            NSLog("[BackgroundExec] transition task expired")
        }
    }

    func endTransitionTask(_ taskId: UIBackgroundTaskIdentifier) {
        UIApplication.shared.endBackgroundTask(taskId)
    }

    // MARK: - Task Handlers

    /// Continued processing task: called while the app is backgrounded and
    /// the last foreground session still has pending uploads. We DO NOT call
    /// `startSync()` (that would relight the TCP pipeline in background
    /// without URLSession's resume-friendly lifecycle). Instead:
    ///
    /// 1. incremental photo scan to pick up new assets the library
    ///    observer missed while the app was suspended
    /// 2. resolve the live or last-known binding
    /// 3. enqueue a single URLSession background upload for the current
    ///    queue head (allowPreparation=true because the foreground loop
    ///    may not have had a chance to export the file yet)
    /// 4. classify the EnqueueResult into
    ///    setTaskCompleted + optional submitMaintenanceTask() per the plan
    private func handleContinuedTask(_ task: BGProcessingTask) {
        NSLog("[BackgroundExec] continued task started")

        task.expirationHandler = { [weak self] in
            NSLog("[BackgroundExec] continued task expiring")
            SyncEngineManager.shared.sessionService.transitionTo(.idle)
            self?.submitMaintenanceTask()
        }

        Task { [weak self] in
            guard let self else {
                task.setTaskCompleted(success: false)
                return
            }
            // Best-effort incremental scan; failure here doesn't block the
            // enqueue attempt — there may still be queued items from the
            // foreground session.
            await SyncEngineManager.shared.performIncrementalPhotoScanIfBackgrounded()
            await self.runBackgroundEnqueue(task: task, allowPreparation: true)
        }
    }

    private func handleMaintenanceTask(_ task: BGProcessingTask) {
        NSLog("[BackgroundExec] maintenance task started")

        task.expirationHandler = {
            NSLog("[BackgroundExec] maintenance task expiring")
        }

        Task { [weak self] in
            guard let self else {
                task.setTaskCompleted(success: false)
                return
            }
            await SyncEngineManager.shared.performIncrementalPhotoScanIfBackgrounded()
            await self.runBackgroundEnqueue(task: task, allowPreparation: true)
        }
    }

    /// Shared body for continued / maintenance task handlers. Resolves the
    /// binding, hands off to BackgroundUploadService, and decides how to
    /// complete the task + whether to submit the next maintenance task.
    private func runBackgroundEnqueue(
        task: BGProcessingTask,
        allowPreparation: Bool
    ) async {
        guard let binding = resolveBinding() else {
            NSLog("[BackgroundExec] no binding — completing task without enqueue")
            handleEnqueueResult(.missingBinding, task: task)
            return
        }
        let clientId = SyncEngineManager.shared.bindingService.getOrCreateClientId()

        let result = await BackgroundUploadService.shared.enqueueNextPendingFileIfIdle(
            binding: binding,
            clientId: clientId,
            allowPreparation: allowPreparation
        )
        NSLog("[BackgroundExec] enqueue result=%@", "\(result)")
        handleEnqueueResult(result, task: task)
    }

    /// Resolve the binding to use for a background task. Prefers the live
    /// in-memory `SyncEngineManager.currentBinding`; falls back to
    /// `last_known_binding` + the keychain-stored pairing token so cold
    /// relaunches (iOS starts the process purely to deliver URLSession
    /// events) can still proceed.
    private func resolveBinding() -> StoredBinding? {
        if let live = SyncEngineManager.shared.currentBinding,
           !live.serverId.isEmpty,
           !live.sidecarHost.isEmpty,
           !live.pairingTokenKeychainRef.isEmpty {
            return live
        }
        // Fallback — compose from the cache table + keychain. If any piece
        // is missing we bail so the background task completes as "missing
        // binding" and iOS doesn't burn our BGProcessing budget.
        guard let store = SyncEngineManager.shared.uploadStoreForBackground else {
            return nil
        }
        guard let lastKnown = store.getLastKnownBinding() else { return nil }
        let token = SyncEngineManager.shared.bindingService.getPairingToken(
            forKey: lastKnown.pairingTokenKeychainRef
        )
        guard let token, !token.isEmpty else { return nil }
        _ = token // validated above; the pairing token itself isn't part of StoredBinding
        return lastKnown
    }

    private func handleEnqueueResult(
        _ result: BackgroundUploadService.EnqueueResult,
        task: BGProcessingTask
    ) {
        switch result {
        case .enqueued:
            task.setTaskCompleted(success: true)
            submitMaintenanceTask()
        case .activeTaskExists:
            task.setTaskCompleted(success: true)
            // Don't submit next — the active task's completion delegate
            // will drive the chain.
        case .emptyQueue:
            task.setTaskCompleted(success: true)
            // Nothing to do, nothing to reschedule for.
        case .queueHeadNotReady,
             .missingHost,
             .exportFailed,
             .queueHeadNeedsPreparation,
             .staleTaskCancelled:
            task.setTaskCompleted(success: true)
            submitMaintenanceTask()
        case .missingBinding, .missingPairingToken:
            // Needs user re-pairing — don't burn BGProcessing budget.
            task.setTaskCompleted(success: false)
        }
    }
}
