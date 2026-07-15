import Foundation

enum SharedFilesAccessPolicy {
    static let legacyLocalComputerAccessDisabledMessage = [
        "remote",
        "access",
        "is",
        "disabled",
    ].joined(separator: " ")

    struct DesktopSnapshot {
        let deviceId: String
        let name: String
        let shareEnabled: Bool
    }

    static func isLocalComputerAccessDisabled(
        scopeRaw: String,
        bindingDeviceId: String,
        bindingDeviceName: String?,
        bindingDeviceAlias: String?,
        discoveredDevice: DesktopSnapshot?,
        candidateDevices: [DesktopSnapshot]
    ) -> Bool {
        guard scopeRaw == "personal" else {
            return false
        }

        if let exactMatch = candidateDevices.first(where: { $0.deviceId == bindingDeviceId }) {
            return !exactMatch.shareEnabled
        }

        let expectedNames = Set(
            [bindingDeviceName, bindingDeviceAlias].compactMap {
                $0?.trimmingCharacters(in: .whitespacesAndNewlines)
            }.filter { !$0.isEmpty }
        )
        guard !expectedNames.isEmpty else {
            return false
        }

        let nameMatches = candidateDevices.filter { expectedNames.contains($0.name) }
        guard nameMatches.count == 1, let matchedDevice = nameMatches.first else {
            if let discoveredDevice,
               discoveredDevice.deviceId == bindingDeviceId,
               !discoveredDevice.shareEnabled
            {
                return true
            }
            return false
        }
        return !matchedDevice.shareEnabled
    }
}
