import Foundation
import Darwin

struct WakeTarget: Codable, Equatable {
    let interfaceName: String
    let macAddress: String
    let ipv4Address: String
    let broadcastAddress: String
    let ports: [Int]
}

struct WakePacketDestination: Equatable, Hashable {
    let host: String
    let port: Int
}

struct WakePacketSendFailure: Equatable {
    let destination: WakePacketDestination
    let error: String
}

struct WakeOnLanSendResult: Equatable {
    let sentPackets: Int
    let destinations: [WakePacketDestination]
    let failures: [WakePacketSendFailure]
}

struct WakeOnLanService {
    typealias PacketSender = (_ host: String, _ port: Int, _ packet: Data) throws -> Void

    private let sender: PacketSender
    private let repeatCount: Int
    private let repeatDelayMicroseconds: useconds_t

    init() {
        self.sender = Self.sendUDPPacket(host:port:packet:)
        self.repeatCount = 3
        self.repeatDelayMicroseconds = 250_000
    }

    init(repeatCount: Int = 3, repeatDelayMicroseconds: useconds_t = 250_000, sender: @escaping PacketSender) {
        self.sender = sender
        self.repeatCount = max(1, repeatCount)
        self.repeatDelayMicroseconds = repeatDelayMicroseconds
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

    static func destinations(for target: WakeTarget) -> [WakePacketDestination] {
        let hosts = [
            target.broadcastAddress,
            "255.255.255.255",
            target.ipv4Address,
        ]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        var seenHosts = Set<String>()
        let uniqueHosts = hosts.filter { seenHosts.insert($0).inserted }

        var seenPorts = Set<Int>()
        let ports = target.ports
            .filter { (1...65_535).contains($0) }
            .filter { seenPorts.insert($0).inserted }

        return uniqueHosts.flatMap { host in
            ports.map { port in
                WakePacketDestination(host: host, port: port)
            }
        }
    }

    func sendWakePackets(targets: [WakeTarget]) throws -> WakeOnLanSendResult {
        var sentPackets = 0
        var destinations: [WakePacketDestination] = []
        var failures: [WakePacketSendFailure] = []
        var seenFailures = Set<String>()
        for target in targets {
            let packet = try Self.magicPacket(macAddress: target.macAddress)
            let targetDestinations = Self.destinations(for: target)
            destinations.append(contentsOf: targetDestinations)
            for round in 0..<repeatCount {
                for destination in targetDestinations {
                    do {
                        try sender(destination.host, destination.port, packet)
                        sentPackets += 1
                    } catch {
                        let errorDescription = String(describing: error)
                        let failureKey = "\(destination.host):\(destination.port):\(errorDescription)"
                        if seenFailures.insert(failureKey).inserted {
                            failures.append(WakePacketSendFailure(destination: destination, error: errorDescription))
                        }
                    }
                }
                if round < repeatCount - 1, repeatDelayMicroseconds > 0 {
                    usleep(repeatDelayMicroseconds)
                }
            }
        }
        if sentPackets == 0 {
            throw WakeOnLanError.allPacketsFailed(failures: failures)
        }
        return WakeOnLanSendResult(sentPackets: sentPackets, destinations: destinations, failures: failures)
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
    case invalidBroadcastAddress(host: String)
    case socketOpenFailed(errno: Int32)
    case socketOptionFailed(errno: Int32)
    case sendFailed(host: String, port: Int, sent: Int, errno: Int32)
    case allPacketsFailed(failures: [WakePacketSendFailure])
}

extension WakeOnLanError: CustomStringConvertible {
    var description: String {
        switch self {
        case .invalidMacAddress:
            return "invalidMacAddress"
        case .invalidBroadcastAddress(let host):
            return "invalidBroadcastAddress(host=\(host))"
        case .socketOpenFailed(let errno):
            return "socketOpenFailed(errno=\(errno))"
        case .socketOptionFailed(let errno):
            return "socketOptionFailed(errno=\(errno))"
        case .sendFailed(let host, let port, let sent, let errno):
            return "sendFailed(host=\(host),port=\(port),sent=\(sent),errno=\(errno))"
        case .allPacketsFailed(let failures):
            let details = failures
                .map { "\($0.destination.host):\($0.destination.port)=\($0.error)" }
                .joined(separator: ",")
            return "allPacketsFailed(failures=\(details))"
        }
    }
}

extension WakeOnLanService {
    static func sendUDPPacket(host: String, port: Int, packet: Data) throws {
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian

        if inet_pton(AF_INET, host, &address.sin_addr) != 1 {
            var hints = addrinfo()
            hints.ai_family = AF_INET
            hints.ai_socktype = SOCK_DGRAM
            var res: UnsafeMutablePointer<addrinfo>? = nil
            let status = getaddrinfo(host, nil, &hints, &res)
            guard status == 0, let first = res else {
                throw WakeOnLanError.invalidBroadcastAddress(host: host)
            }
            defer { freeaddrinfo(res) }

            guard let addrPointer = first.pointee.ai_addr else {
                throw WakeOnLanError.invalidBroadcastAddress(host: host)
            }
            let resolvedAddr = addrPointer.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
            address.sin_addr = resolvedAddr.sin_addr
        }

        let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard fd >= 0 else {
            throw WakeOnLanError.socketOpenFailed(errno: errno)
        }
        defer { close(fd) }

        var broadcast: Int32 = 1
        guard setsockopt(
            fd,
            SOL_SOCKET,
            SO_BROADCAST,
            &broadcast,
            socklen_t(MemoryLayout<Int32>.size)
        ) == 0 else {
            throw WakeOnLanError.socketOptionFailed(errno: errno)
        }

        let sent = packet.withUnsafeBytes { packetBytes -> ssize_t in
            var target = address
            return withUnsafePointer(to: &target) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                    sendto(
                        fd,
                        packetBytes.baseAddress,
                        packet.count,
                        0,
                        sockaddrPointer,
                        socklen_t(MemoryLayout<sockaddr_in>.size)
                    )
                }
            }
        }
        guard sent == packet.count else {
            throw WakeOnLanError.sendFailed(host: host, port: port, sent: sent, errno: errno)
        }
    }
}
