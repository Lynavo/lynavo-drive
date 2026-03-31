import Foundation
import Network

protocol DiscoveryServiceDelegate: AnyObject {
    func discoveryDidUpdate(devices: [DiscoveredDevice])
}

private func isIPv4Address(_ host: String) -> Bool {
    !host.isEmpty && host.range(of: #"^\d{1,3}(?:\.\d{1,3}){3}$"#, options: .regularExpression) != nil
}

private func preferredDiscoveryHost(advertisedIP: String, probedHost: String) -> String {
    if isIPv4Address(probedHost) {
        return probedHost
    }
    if isIPv4Address(advertisedIP) {
        return advertisedIP
    }
    if !probedHost.isEmpty {
        return probedHost
    }
    return advertisedIP
}

private func endpointDebugDescription(_ endpoint: NWEndpoint?) -> String {
    guard let endpoint else { return "nil" }
    switch endpoint {
    case .hostPort(let host, let port):
        return "\(host):\(port)"
    case .service(let name, let type, let domain, let interface):
        let interfaceName: String
        if let interface {
            interfaceName = interface.debugDescription
        } else {
            interfaceName = "nil"
        }
        return "service(name=\(name), type=\(type), domain=\(domain), interface=\(interfaceName))"
    case .unix(let path):
        return "unix(\(path))"
    case .url(let url):
        return "url(\(url.absoluteString))"
    @unknown default:
        return String(describing: endpoint)
    }
}

struct DiscoveredDevice {
    let deviceId: String
    let name: String
    let type: String
    let ip: String
    let port: UInt16
    let protoVersion: Int
    let authMode: String
    let shareEnabled: Bool
    let shareName: String?
    let endpoint: NWEndpoint?
}

class DiscoveryService {
    private var browser: NWBrowser?
    private let queue = DispatchQueue(label: "com.syncflow.discovery")
    private var devices: [String: DiscoveredDevice] = [:]
    private var reachableDevices: [String: DiscoveredDevice] = [:]
    private var probeConnections: [String: NWConnection] = [:]
    private var probeGeneration: UInt64 = 0
    weak var delegate: DiscoveryServiceDelegate?
    var browserState: String = "not_started"

    func startBrowsing() {
        NSLog("[DiscoveryService] startBrowsing called")
        syncDiagnosticsLog("DiscoveryService", "startBrowsing called")
        let descriptor = NWBrowser.Descriptor.bonjourWithTXTRecord(type: "_syncflow._tcp", domain: nil)
        let params = NWParameters()
        // Prefer infrastructure Wi-Fi / USB network paths for discovery so the
        // surfaced address matches the path used for actual transfer.
        params.includePeerToPeer = false
        syncDiagnosticsLog(
            "DiscoveryService",
            "starting browser type=_syncflow._tcp domain=default includePeerToPeer=\(params.includePeerToPeer)"
        )
        browser = NWBrowser(for: descriptor, using: params)

        browser?.browseResultsChangedHandler = { [weak self] results, _ in
            NSLog("[DiscoveryService] results changed: \(results.count) results")
            syncDiagnosticsLog("DiscoveryService", "results changed: \(results.count) results")
            self?.handleResults(results)
        }

        browser?.stateUpdateHandler = { [weak self] state in
            NSLog("[DiscoveryService] state: \(state)")
            syncDiagnosticsLog("DiscoveryService", "state: \(state)")
            self?.browserState = String(describing: state)
        }

        browser?.start(queue: queue)
    }

    func stopBrowsing() {
        syncDiagnosticsLog(
            "DiscoveryService",
            "stopBrowsing activeDevices=\(devices.count) reachableDevices=\(reachableDevices.count) activeProbes=\(probeConnections.count)"
        )
        browser?.cancel()
        browser = nil
        for connection in probeConnections.values {
            connection.cancel()
        }
        probeConnections.removeAll()
        devices.removeAll()
        reachableDevices.removeAll()
        delegate?.discoveryDidUpdate(devices: [])
    }

    private func handleResults(_ results: Set<NWBrowser.Result>) {
        var updated: [String: DiscoveredDevice] = [:]
        syncDiagnosticsLog(
            "DiscoveryService",
            "handleResults total=\(results.count)"
        )

        for result in results {
            syncDiagnosticsLog(
                "DiscoveryService",
                "handleResult endpoint=\(endpointDebugDescription(result.endpoint)) metadata=\(String(describing: result.metadata))"
            )
            if case .service(let name, _, _, _) = result.endpoint {
                var device: DiscoveredDevice?

                if case .bonjour(let txtRecord) = result.metadata {
                    // Try multiple approaches to read TXT record
                    var txtDict: [String: String] = [:]

                    // Approach 1: .dictionary property
                    let rawDict = txtRecord.dictionary
                    for (k, v) in rawDict {
                        txtDict[k] = v
                    }

                    // Approach 2: getEntry(for:) API if dictionary was empty
                    if txtDict.isEmpty {
                        let keys = ["id", "name", "type", "proto", "auth", "share", "shareName", "ip"]
                        for key in keys {
                            if let entry = txtRecord.getEntry(for: key) {
                                switch entry {
                                case .string(let s):
                                    txtDict[key] = s
                                case .empty:
                                    txtDict[key] = ""
                                @unknown default:
                                    // Try to extract string from unknown entry types
                                    txtDict[key] = "\(entry)"
                                }
                            }
                        }
                    }
                    if let id = txtDict["id"], !id.isEmpty {
                        syncDiagnosticsLog(
                            "DiscoveryService",
                            "bonjour_seen id=\(id) name=\(txtDict["name"] ?? name) advertised_ip=\(txtDict["ip"] ?? "") endpoint=\(endpointDebugDescription(result.endpoint)) txt=\(txtDict)"
                        )
                        device = DiscoveredDevice(
                            deviceId: id,
                            name: txtDict["name"] ?? name,
                            type: txtDict["type"] ?? "mac",
                            ip: txtDict["ip"] ?? "",
                            port: 39393,
                            protoVersion: Int(txtDict["proto"] ?? "2") ?? 2,
                            authMode: txtDict["auth"] ?? "code",
                            shareEnabled: txtDict["share"] == "1",
                            shareName: txtDict["shareName"],
                            endpoint: result.endpoint
                        )
                    }
                }

                // Fallback: use service name as device ID, include debug metadata type
                if device == nil {
                    syncDiagnosticsLog(
                        "DiscoveryService",
                        "bonjour_seen_fallback id=\(name) endpoint=\(endpointDebugDescription(result.endpoint)) metadata=\(String(describing: result.metadata))"
                    )
                    device = DiscoveredDevice(
                        deviceId: name, name: name, type: "mac", ip: "",
                        port: 39393, protoVersion: 2, authMode: "code",
                        shareEnabled: false, shareName: nil, endpoint: result.endpoint
                    )
                }

                if let d = device {
                    updated[d.deviceId] = d
                }
            }
        }

        devices = updated
        probeGeneration &+= 1
        let generation = probeGeneration

        let activeIDs = Set(updated.keys)
        let staleProbeIDs = probeConnections.keys.filter { !activeIDs.contains($0) }
        for deviceID in staleProbeIDs {
            guard let connection = probeConnections[deviceID] else { continue }
            connection.cancel()
            probeConnections.removeValue(forKey: deviceID)
        }
        let staleReachableIDs = reachableDevices.keys.filter { !activeIDs.contains($0) }
        for deviceID in staleReachableIDs {
            reachableDevices.removeValue(forKey: deviceID)
        }
        let removedReachableDevices = !staleReachableIDs.isEmpty
        syncDiagnosticsLog(
            "DiscoveryService",
            "candidate_devices updated=\(updated.count) reachable=\(reachableDevices.count) staleReachable=\(staleReachableIDs.count) generation=\(generation)"
        )

        if updated.isEmpty {
            syncDiagnosticsLog("DiscoveryService", "candidate_devices empty, emitting 0 devices")
            delegate?.discoveryDidUpdate(devices: [])
            return
        }

        if removedReachableDevices {
            emitReachableDevices()
        }
        for device in updated.values {
            probeReachability(for: device, generation: generation)
        }
    }

    private func emitReachableDevices() {
        let sorted = reachableDevices.values.sorted {
            if $0.name == $1.name {
                return $0.deviceId < $1.deviceId
            }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
        let summary = sorted.map { "\($0.name)/\($0.ip)/\($0.deviceId)/\($0.type)" }.joined(separator: ", ")
        syncDiagnosticsLog(
            "DiscoveryService",
            "emitReachableDevices count=\(sorted.count) devices=\(summary.isEmpty ? "none" : summary)"
        )
        delegate?.discoveryDidUpdate(devices: sorted)
    }

    private func probeReachability(for device: DiscoveredDevice, generation: UInt64) {
        guard let endpoint = preferredProbeEndpoint(for: device) else {
            syncDiagnosticsLog(
                "DiscoveryService",
                "probe_skipped id=\(device.deviceId) name=\(device.name) reason=no_endpoint advertised_ip=\(device.ip) endpoint=\(endpointDebugDescription(device.endpoint))"
            )
            if reachableDevices.removeValue(forKey: device.deviceId) != nil {
                emitReachableDevices()
            }
            return
        }

        probeConnections[device.deviceId]?.cancel()

        let tcpOptions = NWProtocolTCP.Options()
        tcpOptions.noDelay = true

        let params = NWParameters(tls: nil, tcp: tcpOptions)
        // Keep probe routing aligned with upload routing to avoid exposing
        // AWDL/link-local IPv6 addresses in the UI and fallback host path.
        params.includePeerToPeer = false

        let connection = NWConnection(to: endpoint, using: params)
        probeConnections[device.deviceId] = connection

        syncDiagnosticsLog(
            "DiscoveryService",
            "probe_started id=\(device.deviceId) name=\(device.name) target=\(endpointDebugDescription(endpoint)) advertised_ip=\(device.ip) generation=\(generation)"
        )

        let timeoutWork = DispatchWorkItem { [weak self, weak connection] in
            guard let self else { return }
            guard generation == self.probeGeneration else { return }
            guard let current = self.probeConnections[device.deviceId],
                  let probedConnection = connection,
                  current === probedConnection
            else { return }
            syncDiagnosticsLog(
                "DiscoveryService",
                "probe_timeout id=\(device.deviceId) name=\(device.name) target=\(endpointDebugDescription(endpoint)) generation=\(generation)"
            )
            current.cancel()
            self.probeConnections.removeValue(forKey: device.deviceId)
            if self.reachableDevices.removeValue(forKey: device.deviceId) != nil {
                self.emitReachableDevices()
            }
        }

        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            guard generation == self.probeGeneration else {
                connection.cancel()
                return
            }

            switch state {
            case .ready:
                timeoutWork.cancel()
                self.probeConnections.removeValue(forKey: device.deviceId)

                var probedHost = ""
                if let remoteEndpoint = connection.currentPath?.remoteEndpoint,
                   case .hostPort(let host, _) = remoteEndpoint
                {
                    probedHost = "\(host)"
                }
                let resolvedIP = preferredDiscoveryHost(advertisedIP: device.ip, probedHost: probedHost)
                NSLog("[DiscoveryService] reachable %@ via %@", device.name, resolvedIP)
                syncDiagnosticsLog(
                    "DiscoveryService",
                    "probe_ready id=\(device.deviceId) name=\(device.name) resolved_ip=\(resolvedIP) advertised_ip=\(device.ip) remote_endpoint=\(endpointDebugDescription(connection.currentPath?.remoteEndpoint))"
                )

                self.reachableDevices[device.deviceId] = DiscoveredDevice(
                    deviceId: device.deviceId,
                    name: device.name,
                    type: device.type,
                    ip: resolvedIP,
                    port: device.port,
                    protoVersion: device.protoVersion,
                    authMode: device.authMode,
                    shareEnabled: device.shareEnabled,
                    shareName: device.shareName,
                    endpoint: device.endpoint
                )
                connection.cancel()
                self.emitReachableDevices()

            case .waiting:
                NSLog("[DiscoveryService] reachability waiting for %@: %@", device.name, "\(state)")
                syncDiagnosticsLog(
                    "DiscoveryService",
                    "probe_waiting id=\(device.deviceId) name=\(device.name) state=\(state) target=\(endpointDebugDescription(endpoint))"
                )

            case .failed, .cancelled:
                timeoutWork.cancel()
                syncDiagnosticsLog(
                    "DiscoveryService",
                    "probe_ended id=\(device.deviceId) name=\(device.name) state=\(state) target=\(endpointDebugDescription(endpoint))"
                )
                let isCurrentProbe = self.probeConnections[device.deviceId].map { $0 === connection } ?? false
                if isCurrentProbe {
                    self.probeConnections.removeValue(forKey: device.deviceId)
                    if self.reachableDevices.removeValue(forKey: device.deviceId) != nil {
                        self.emitReachableDevices()
                    }
                }
                connection.cancel()

            default:
                break
            }
        }

        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + .seconds(2), execute: timeoutWork)
    }

    private func preferredProbeEndpoint(for device: DiscoveredDevice) -> NWEndpoint? {
        if isIPv4Address(device.ip), let port = NWEndpoint.Port(rawValue: device.port) {
            NSLog("[DiscoveryService] probing %@ via advertised IPv4 %@", device.name, device.ip)
            return .hostPort(host: NWEndpoint.Host(device.ip), port: port)
        }
        return device.endpoint
    }
}
