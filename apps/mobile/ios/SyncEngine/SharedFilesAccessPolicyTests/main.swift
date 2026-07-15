import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("SharedFilesAccessPolicyTests failed: \(message)\n", stderr)
        exit(1)
    }
}

func makeDevice(
    deviceId: String,
    name: String = "Studio Mac",
    shareEnabled: Bool
) -> SharedFilesAccessPolicy.DesktopSnapshot {
    SharedFilesAccessPolicy.DesktopSnapshot(
        deviceId: deviceId,
        name: name,
        shareEnabled: shareEnabled
    )
}

let disabledBoundCandidate = makeDevice(
    deviceId: "desktop-1",
    shareEnabled: false
)

expect(
    SharedFilesAccessPolicy.isLocalComputerAccessDisabled(
        scopeRaw: "personal",
        bindingDeviceId: "desktop-1",
        bindingDeviceName: "Studio Mac",
        bindingDeviceAlias: nil,
        discoveredDevice: nil,
        candidateDevices: [disabledBoundCandidate]
    ),
    "personal shared files must be blocked when Bonjour candidate says the bound desktop has share disabled"
)

expect(
    !SharedFilesAccessPolicy.isLocalComputerAccessDisabled(
        scopeRaw: "team",
        bindingDeviceId: "desktop-1",
        bindingDeviceName: "Studio Mac",
        bindingDeviceAlias: nil,
        discoveredDevice: nil,
        candidateDevices: [disabledBoundCandidate]
    ),
    "team shared files must not be blocked by the personal local-computer gate"
)

expect(
    !SharedFilesAccessPolicy.isLocalComputerAccessDisabled(
        scopeRaw: "personal",
        bindingDeviceId: "desktop-1",
        bindingDeviceName: "Studio Mac",
        bindingDeviceAlias: nil,
        discoveredDevice: nil,
        candidateDevices: [
            makeDevice(deviceId: "desktop-2", name: "Other Mac", shareEnabled: false)
        ]
    ),
    "personal shared files must not be blocked by an unrelated desktop candidate"
)

expect(
    SharedFilesAccessPolicy.isLocalComputerAccessDisabled(
        scopeRaw: "personal",
        bindingDeviceId: "desktop-1",
        bindingDeviceName: "Studio Mac",
        bindingDeviceAlias: nil,
        discoveredDevice: nil,
        candidateDevices: [
            makeDevice(deviceId: "bonjour-service-name", name: "Studio Mac", shareEnabled: false)
        ]
    ),
    "personal shared files may use the existing unique Bonjour name fallback to detect disabled local computer access"
)

expect(
    SharedFilesAccessPolicy.isLocalComputerAccessDisabled(
        scopeRaw: "personal",
        bindingDeviceId: "desktop-1",
        bindingDeviceName: "Studio Mac",
        bindingDeviceAlias: nil,
        discoveredDevice: makeDevice(deviceId: "desktop-1", shareEnabled: false),
        candidateDevices: []
    ),
    "personal shared files must be blocked when the reachable discovered bound desktop has share disabled"
)

expect(
    !SharedFilesAccessPolicy.isLocalComputerAccessDisabled(
        scopeRaw: "personal",
        bindingDeviceId: "desktop-1",
        bindingDeviceName: "Studio Mac",
        bindingDeviceAlias: nil,
        discoveredDevice: nil,
        candidateDevices: []
    ),
    "personal shared files must preserve fallback routing when no Bonjour share state is known"
)
