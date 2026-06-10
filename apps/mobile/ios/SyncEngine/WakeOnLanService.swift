import Foundation

struct WakeTarget {
    let interfaceName: String
    let macAddress: String
    let ipv4Address: String
    let broadcastAddress: String
    let ports: [Int]
}

struct WakeOnLanService {
    typealias PacketSender = (_ host: String, _ port: Int, _ packet: Data) throws -> Void

    private let sender: PacketSender

    init(sender: @escaping PacketSender) {
        self.sender = sender
    }

    static func magicPacket(macAddress: String) throws -> Data {
        guard let mac = parseMacAddress(macAddress) else {
            throw WakeOnLanError.invalidMacAddress
        }
        var bytes = Data(repeating: 0xff, count: 6)
        for _ in 0..<16 {
            bytes.append(contentsOf: mac)
        }
        return bytes
    }

    static func validTargets(_ targets: [WakeTarget]) -> [WakeTarget] {
        targets.filter { target in
            parseMacAddress(target.macAddress) != nil &&
                !target.broadcastAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                target.ports.contains(where: { (1...65_535).contains($0) })
        }
    }

    func sendWakePackets(targets: [WakeTarget]) throws {
        for target in targets {
            let packet = try Self.magicPacket(macAddress: target.macAddress)
            for port in target.ports where (1...65_535).contains(port) {
                try sender(target.broadcastAddress.trimmingCharacters(in: .whitespacesAndNewlines), port, packet)
            }
        }
    }

    private static func parseMacAddress(_ macAddress: String) -> [UInt8]? {
        let normalized = macAddress.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "-", with: ":").lowercased()
        let parts = normalized.split(separator: ":")
        guard parts.count == 6 else { return nil }
        var bytes: [UInt8] = []
        bytes.reserveCapacity(6)
        for part in parts {
            guard part.count == 2, let value = UInt8(part, radix: 16) else {
                return nil
            }
            bytes.append(value)
        }
        guard bytes.contains(where: { $0 != 0 }) else { return nil }
        return bytes
    }
}

enum WakeOnLanError: Error {
    case invalidMacAddress
}
