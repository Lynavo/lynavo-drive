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

        print("[BackgroundExec] registered background tasks")
    }

    /// Submit continued processing task — call when foreground sync starts
    func submitContinuedTask() {
        let request = BGProcessingTaskRequest(identifier: Self.continuedTaskId)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BackgroundExec] submitted continued task")
        } catch {
            print("[BackgroundExec] failed to submit continued task: \(error)")
        }
    }

    /// Submit maintenance task — call when sync ends or continued task expires
    func submitMaintenanceTask() {
        let request = BGProcessingTaskRequest(identifier: Self.maintenanceTaskId)
        request.requiresNetworkConnectivity = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 min from now
        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BackgroundExec] submitted maintenance task")
        } catch {
            print("[BackgroundExec] failed to submit maintenance task: \(error)")
        }
    }

    /// Begin transition task — call when app moves to background
    func beginTransitionTask() -> UIBackgroundTaskIdentifier {
        return UIApplication.shared.beginBackgroundTask {
            print("[BackgroundExec] transition task expired")
        }
    }

    func endTransitionTask(_ taskId: UIBackgroundTaskIdentifier) {
        UIApplication.shared.endBackgroundTask(taskId)
    }

    // MARK: - Task Handlers

    private func handleContinuedTask(_ task: BGProcessingTask) {
        print("[BackgroundExec] continued task started")

        task.expirationHandler = {
            print("[BackgroundExec] continued task expiring")
            // Save checkpoint, submit maintenance task
            self.submitMaintenanceTask()
        }

        // TODO: Resume sync engine here
        // For now just complete
        task.setTaskCompleted(success: true)
    }

    private func handleMaintenanceTask(_ task: BGProcessingTask) {
        print("[BackgroundExec] maintenance task started")

        task.expirationHandler = {
            print("[BackgroundExec] maintenance task expiring")
        }

        // TODO: Run incremental scan + attempt sync
        task.setTaskCompleted(success: true)
    }
}
