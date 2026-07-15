import Foundation
import UIKit

class BackgroundExecutionService {
    /// Begin transition task — call when app moves to background
    func beginTransitionTask() -> UIBackgroundTaskIdentifier {
        return UIApplication.shared.beginBackgroundTask {
            NSLog("[BackgroundExec] transition task expired")
        }
    }

    func endTransitionTask(_ taskId: UIBackgroundTaskIdentifier) {
        UIApplication.shared.endBackgroundTask(taskId)
    }

}
