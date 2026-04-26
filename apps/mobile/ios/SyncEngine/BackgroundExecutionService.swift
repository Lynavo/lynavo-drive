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

        slog("[BackgroundExec] registered background tasks")
    }

    /// Submit continued processing task — call when foreground sync starts
    func submitContinuedTask() {
        let request = BGProcessingTaskRequest(identifier: Self.continuedTaskId)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        do {
            try BGTaskScheduler.shared.submit(request)
            slog("[BackgroundExec] submitted continued task")
        } catch {
            slog("[BackgroundExec] failed to submit continued task: %@", "\(error)")
        }
    }

    func cancelContinuedTask() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.continuedTaskId)
        slog("[BackgroundExec] cancelled continued task")
    }

    /// Submit maintenance task — call when sync ends or continued task expires
    func submitMaintenanceTask() {
        let request = BGProcessingTaskRequest(identifier: Self.maintenanceTaskId)
        request.requiresNetworkConnectivity = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 min from now
        do {
            try BGTaskScheduler.shared.submit(request)
            slog("[BackgroundExec] submitted maintenance task")
        } catch {
            slog("[BackgroundExec] failed to submit maintenance task: %@", "\(error)")
        }
    }

    /// Begin transition task — call when app moves to background
    func beginTransitionTask() -> UIBackgroundTaskIdentifier {
        return UIApplication.shared.beginBackgroundTask {
            slog("[BackgroundExec] transition task expired")
        }
    }

    func endTransitionTask(_ taskId: UIBackgroundTaskIdentifier) {
        UIApplication.shared.endBackgroundTask(taskId)
    }

    // MARK: - Task Handlers

    private func handleContinuedTask(_ task: BGProcessingTask) {
        slog("[BackgroundExec] continued task started — resuming sync")

        task.expirationHandler = { [weak self] in
            slog("[BackgroundExec] continued task expiring — saving checkpoint")
            SyncEngineManager.shared.handleContinuedBackgroundTaskExpiration()
            self?.submitMaintenanceTask()
        }

        Task {
            _ = SyncEngineManager.shared.resumeSyncFromContinuedBackgroundTask()
            task.setTaskCompleted(success: true)
        }
    }

    private func handleMaintenanceTask(_ task: BGProcessingTask) {
        slog("[BackgroundExec] maintenance task started — incremental scan")

        task.expirationHandler = {
            slog("[BackgroundExec] maintenance task expiring")
        }

        Task {
            // Run incremental scan + attempt sync if target device found
            _ = SyncEngineManager.shared.resumeSyncFromMaintenanceBackgroundTask()
            task.setTaskCompleted(success: true)
        }
    }
}
