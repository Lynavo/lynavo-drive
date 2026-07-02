import Foundation
import React

@objc(NativeAppRuntimeConfig)
class NativeAppRuntimeConfig: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }

  private func exportedConstants() -> [AnyHashable: Any] {
    var constants: [AnyHashable: Any] = [:]
    let environment = ProcessInfo.processInfo.environment
    [
      "LYNAVO_VISUAL_QA",
      "LYNAVO_VISUAL_QA_HOME_EMPTY",
      "LYNAVO_VISUAL_QA_ROUTE",
      "LYNAVO_VISUAL_QA_SHARED_FILES_PREVIEW",
    ].forEach { key in
      if let value = environment[key] {
        constants[key] = value
      }
    }
    return constants
  }

  @objc
  func constantsToExport() -> [AnyHashable: Any]! {
    return exportedConstants()
  }

  @objc
  func getConstants() -> [AnyHashable: Any]! {
    return exportedConstants()
  }
}
