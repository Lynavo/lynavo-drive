import Foundation
import Network

/// Passive observer that records NWPathMonitor state transitions into
/// `SyncDiagnosticsLogStore` so the diagnostic bundle can explain
/// "why did sync break when the user walked between WiFi networks".
///
/// Intentionally observation-only:
///   • Does NOT trigger reconnect, discovery restart, or state machine change
///   • Does NOT call into DiscoveryService / TcpTransport / SyncEngineManager
///   • Removing this class entirely would not affect any protocol behaviour
///
/// Records two kinds of events:
///   • `net.path.changed`  — every path update (status, interfaces, flags)
///   • `net.path.snapshot` — a human-readable summary for diagnostic export
///
/// Caller owns the lifecycle; call `start()` once at app launch and
/// `stop()` on teardown (practical tests may never need to stop).
final class NetworkPathObserver {
    static let shared = NetworkPathObserver()

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.syncflow.network-path-observer", qos: .utility)
    private var lastPathDescription: String = ""
    private var isRunning = false
    private let lock = NSLock()

    private init() {}

    func start() {
        lock.lock()
        defer { lock.unlock() }
        guard !isRunning else { return }
        isRunning = true

        monitor.pathUpdateHandler = { [weak self] path in
            self?.handlePathUpdate(path)
        }
        monitor.start(queue: queue)
        syncDiagnosticsLog("NetworkPath", "observer started")
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }
        guard isRunning else { return }
        isRunning = false
        monitor.cancel()
        syncDiagnosticsLog("NetworkPath", "observer stopped")
    }

    /// Returns a compact snapshot suitable for embedding in the diagnostics
    /// JSON payload — no side effects.
    func snapshot() -> [String: Any] {
        let path = monitor.currentPath
        return Self.describe(path: path)
    }

    private func handlePathUpdate(_ path: NWPath) {
        let summary = Self.summary(for: path)
        lock.lock()
        let previous = lastPathDescription
        lastPathDescription = summary
        lock.unlock()

        if previous == summary {
            // NWPathMonitor occasionally fires duplicate callbacks for the
            // same path (e.g. interface up -> still up). Collapse them to
            // keep the diagnostic log scannable.
            return
        }

        syncDiagnosticsLog("NetworkPath", "changed \(summary) previous=[\(previous.isEmpty ? "<none>" : previous)]")
    }

    // MARK: - Formatting

    private static func summary(for path: NWPath) -> String {
        var parts: [String] = []
        parts.append("status=\(describe(status: path.status))")

        let activeInterfaces = path.availableInterfaces
            .map { "\($0.name)(\(describe(type: $0.type)))" }
            .joined(separator: ",")
        parts.append("interfaces=[\(activeInterfaces)]")

        parts.append("wifi=\(path.usesInterfaceType(.wifi))")
        parts.append("cellular=\(path.usesInterfaceType(.cellular))")
        parts.append("wired=\(path.usesInterfaceType(.wiredEthernet))")
        parts.append("expensive=\(path.isExpensive)")
        parts.append("constrained=\(path.isConstrained)")
        parts.append("supportsIPv4=\(path.supportsIPv4)")
        parts.append("supportsIPv6=\(path.supportsIPv6)")
        parts.append("supportsDNS=\(path.supportsDNS)")
        return parts.joined(separator: " ")
    }

    private static func describe(path: NWPath) -> [String: Any] {
        var interfaces: [[String: Any]] = []
        for iface in path.availableInterfaces {
            interfaces.append([
                "name": iface.name,
                "type": describe(type: iface.type),
                "index": iface.index,
            ])
        }
        return [
            "status": describe(status: path.status),
            "interfaces": interfaces,
            "usesWiFi": path.usesInterfaceType(.wifi),
            "usesCellular": path.usesInterfaceType(.cellular),
            "usesWiredEthernet": path.usesInterfaceType(.wiredEthernet),
            "isExpensive": path.isExpensive,
            "isConstrained": path.isConstrained,
            "supportsIPv4": path.supportsIPv4,
            "supportsIPv6": path.supportsIPv6,
            "supportsDNS": path.supportsDNS,
        ]
    }

    private static func describe(status: NWPath.Status) -> String {
        switch status {
        case .satisfied:
            return "satisfied"
        case .unsatisfied:
            return "unsatisfied"
        case .requiresConnection:
            return "requiresConnection"
        @unknown default:
            return "unknown"
        }
    }

    private static func describe(type: NWInterface.InterfaceType) -> String {
        switch type {
        case .wifi:
            return "wifi"
        case .cellular:
            return "cellular"
        case .wiredEthernet:
            return "wiredEthernet"
        case .loopback:
            return "loopback"
        case .other:
            return "other"
        @unknown default:
            return "unknown"
        }
    }
}
