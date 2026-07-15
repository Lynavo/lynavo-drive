import Foundation

struct WakeCapability: Codable, Equatable {
    let supported: Bool
    let targets: [WakeTarget]
    let updatedAt: String

    var hasUsableTargets: Bool {
        supported && !WakeOnLanService.validTargets(targets).isEmpty
    }

    func toPayload() -> [String: Any] {
        [
            "supported": supported,
            "targets": targets.map { target in
                [
                    "interfaceName": target.interfaceName,
                    "macAddress": target.macAddress,
                    "ipv4Address": target.ipv4Address,
                    "broadcastAddress": target.broadcastAddress,
                    "ports": target.ports,
                ]
            },
            "updatedAt": updatedAt,
        ]
    }

    static func fromJSONValue(_ value: Any?) -> WakeCapability? {
        guard let object = value as? [String: Any] else { return nil }
        let supported = (object["supported"] as? Bool) ?? false
        let updatedAt = (object["updatedAt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let rawTargets = object["targets"] as? [[String: Any]] ?? []
        let targets = rawTargets.compactMap { raw -> WakeTarget? in
            let ports: [Int]?
            if let rawPorts = raw["ports"] as? [Int] {
                ports = rawPorts
            } else if let rawPorts = raw["ports"] as? [NSNumber] {
                ports = rawPorts.map(\.intValue)
            } else {
                ports = nil
            }
            guard let ports else {
                return nil
            }
            return WakeTarget(
                interfaceName: (raw["interfaceName"] as? String) ?? "",
                macAddress: (raw["macAddress"] as? String) ?? "",
                ipv4Address: (raw["ipv4Address"] as? String) ?? "",
                broadcastAddress: (raw["broadcastAddress"] as? String) ?? "",
                ports: ports
            )
        }

        return WakeCapability(
            supported: supported,
            targets: targets,
            updatedAt: updatedAt?.isEmpty == false ? updatedAt! : ISO8601DateFormatter().string(from: Date())
        )
    }

    static func decodeJSONString(_ raw: String?) -> WakeCapability? {
        guard let raw,
              let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data)
        else {
            return nil
        }
        return fromJSONValue(object)
    }

    func encodeJSONString() -> String? {
        let payload = toPayload()
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload)
        else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    static func merge(newWake: WakeCapability?, existingWake: WakeCapability?) -> WakeCapability? {
        guard let newWake else {
            guard let existingWake else {
                return nil
            }
            return WakeCapability(
                supported: existingWake.supported,
                targets: existingWake.targets,
                updatedAt: existingWake.updatedAt
            )
        }
        return WakeCapability(
            supported: newWake.supported,
            targets: newWake.targets,
            updatedAt: newWake.updatedAt
        )
    }
}
