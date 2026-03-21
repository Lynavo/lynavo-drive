import Foundation
import Network

protocol DiscoveryServiceDelegate: AnyObject {
    func discoveryDidUpdate(devices: [DiscoveredDevice])
}

struct DiscoveredDevice {
    let deviceId: String
    let name: String
    let type: String  // "mac"
    let ip: String
    let port: UInt16
    let protoVersion: Int
    let authMode: String  // "code"
    let shareEnabled: Bool
    let shareName: String?
    /// The raw NWEndpoint for direct connection (avoids IP resolution issues)
    let endpoint: NWEndpoint?
}

class DiscoveryService {
    private var browser: NWBrowser?
    private let queue = DispatchQueue(label: "com.syncflow.discovery")
    private var devices: [String: DiscoveredDevice] = [:]
    weak var delegate: DiscoveryServiceDelegate?
    var browserState: String = "not_started"

    func startBrowsing() {
        NSLog("[DiscoveryService] startBrowsing called")
        let descriptor = NWBrowser.Descriptor.bonjour(type: "_syncflow._tcp", domain: nil)
        let params = NWParameters()
        params.includePeerToPeer = true
        browser = NWBrowser(for: descriptor, using: params)

        browser?.browseResultsChangedHandler = { [weak self] results, changes in
            NSLog("[DiscoveryService] results changed: \(results.count) results")
            self?.handleResults(results)
        }

        browser?.stateUpdateHandler = { [weak self] state in
            NSLog("[DiscoveryService] state: \(state)")
            self?.browserState = String(describing: state)
        }

        browser?.start(queue: queue)
    }

    func stopBrowsing() {
        browser?.cancel()
        browser = nil
        devices.removeAll()
    }

    /// Resolve a discovered device's endpoint to get its IP address
    func resolveEndpoint(_ device: DiscoveredDevice, completion: @escaping (String?) -> Void) {
        guard let endpoint = device.endpoint else {
            completion(nil)
            return
        }
        // Create a temporary connection to resolve the endpoint to an IP
        let connection = NWConnection(to: endpoint, using: .tcp)
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                // Extract IP from the resolved path
                if let path = connection.currentPath,
                   let remoteEndpoint = path.remoteEndpoint,
                   case .hostPort(let host, _) = remoteEndpoint {
                    let ip = "\(host)"
                    NSLog("[DiscoveryService] resolved IP: \(ip)")
                    connection.cancel()
                    completion(ip)
                } else {
                    connection.cancel()
                    completion(nil)
                }
            case .failed, .cancelled:
                completion(nil)
            default:
                break
            }
        }
        connection.start(queue: queue)
    }

    private func handleResults(_ results: Set<NWBrowser.Result>) {
        var updated: [String: DiscoveredDevice] = [:]

        for result in results {
            if case .service(let name, _, _, _) = result.endpoint {
                var device: DiscoveredDevice

                switch result.metadata {
                case .bonjour(let txtRecord):
                    if let parsed = parseTXTRecord(serviceName: name, txtRecord: txtRecord, endpoint: result.endpoint) {
                        device = parsed
                    } else {
                        device = makeFallbackDevice(name: name, endpoint: result.endpoint)
                    }
                default:
                    device = makeFallbackDevice(name: name, endpoint: result.endpoint)
                }

                updated[device.deviceId] = device
            }
        }

        devices = updated
        delegate?.discoveryDidUpdate(devices: Array(updated.values))
    }

    private func parseTXTRecord(serviceName: String, txtRecord: NWTXTRecord, endpoint: NWEndpoint) -> DiscoveredDevice? {
        guard let id = txtString(from: txtRecord, key: "id"),
              let deviceName = txtString(from: txtRecord, key: "name"),
              let type = txtString(from: txtRecord, key: "type") else {
            return nil
        }

        let proto = Int(txtString(from: txtRecord, key: "proto") ?? "2") ?? 2
        let auth = txtString(from: txtRecord, key: "auth") ?? "code"
        let share = txtString(from: txtRecord, key: "share") == "1"
        let shareName = txtString(from: txtRecord, key: "shareName")

        return DiscoveredDevice(
            deviceId: id,
            name: deviceName,
            type: type,
            ip: "", // Will be resolved on demand
            port: 39393,
            protoVersion: proto,
            authMode: auth,
            shareEnabled: share,
            shareName: shareName,
            endpoint: endpoint
        )
    }

    private func makeFallbackDevice(name: String, endpoint: NWEndpoint) -> DiscoveredDevice {
        DiscoveredDevice(
            deviceId: name, name: name, type: "mac", ip: "",
            port: 39393, protoVersion: 2, authMode: "code",
            shareEnabled: false, shareName: nil, endpoint: endpoint
        )
    }

    private func txtString(from record: NWTXTRecord, key: String) -> String? {
        return record[key]
    }
}
