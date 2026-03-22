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

    private func handleContinuedTask(_ task: BGProcessingTask) {
        NSLog("[BackgroundExec] continued task started — resuming sync")

        task.expirationHandler = { [weak self] in
            NSLog("[BackgroundExec] continued task expiring — saving checkpoint")
            SyncEngineManager.shared.sessionService.transitionTo(.idle)
            self?.submitMaintenanceTask()
        }

        // Resume sync in background
        Task {
            SyncEngineManager.shared.sessionService.transitionTo(.syncingBackground)
            SyncEngineManager.shared.startSync()
            task.setTaskCompleted(success: true)
        }
    }

    private func handleMaintenanceTask(_ task: BGProcessingTask) {
        NSLog("[BackgroundExec] maintenance task started — incremental scan")

        task.expirationHandler = {
            NSLog("[BackgroundExec] maintenance task expiring")
        }

        Task {
            // Run incremental scan + attempt sync if target device found
            SyncEngineManager.shared.startSync()
            task.setTaskCompleted(success: true)
        }
    }
}
