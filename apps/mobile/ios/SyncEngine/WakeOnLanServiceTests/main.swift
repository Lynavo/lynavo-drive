import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("WakeOnLanServiceTests failed: \(message)\n", stderr)
        exit(1)
    }
}

let packet = try! WakeOnLanService.magicPacket(macAddress: "aa:bb:cc:dd:ee:ff")
expect(packet.count == 102, "magic packet must be 102 bytes")
expect(packet.prefix(6).allSatisfy { $0 == 0xff }, "magic packet must start with six 0xff bytes")
let mac = [UInt8](arrayLiteral: 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff)
for index in 0..<16 {
    let offset = 6 + index * 6
    expect(Array(packet[offset..<(offset + 6)]) == mac, "magic packet must repeat the target MAC sixteen times")
}

let targets = [
    WakeTarget(
        interfaceName: "en0",
        macAddress: "aa:bb:cc:dd:ee:ff",
        ipv4Address: "192.168.1.20",
        broadcastAddress: "192.168.1.255",
        ports: [9, 7]
    ),
    WakeTarget(
        interfaceName: "en1",
        macAddress: "00:00:00:00:00:00",
        ipv4Address: "192.168.2.20",
        broadcastAddress: "192.168.2.255",
        ports: [9]
    ),
    WakeTarget(
        interfaceName: "en2",
        macAddress: "aa-bb-cc-dd-ee-11",
        ipv4Address: "192.168.3.20",
        broadcastAddress: "",
        ports: [9]
    ),
]

let validTargets = WakeOnLanService.validTargets(targets)
expect(validTargets.count == 1, "validTargets must require MAC, broadcast address, and port")
expect(validTargets.first?.interfaceName == "en0", "validTargets must keep the usable target")

let destinations = WakeOnLanService.destinations(for: validTargets[0])
expect(
    destinations == [
        WakePacketDestination(host: "192.168.1.255", port: 9),
        WakePacketDestination(host: "192.168.1.255", port: 7),
        WakePacketDestination(host: "255.255.255.255", port: 9),
        WakePacketDestination(host: "255.255.255.255", port: 7),
        WakePacketDestination(host: "192.168.1.20", port: 9),
        WakePacketDestination(host: "192.168.1.20", port: 7),
    ],
    "destinations must include subnet broadcast, limited broadcast, and last known host IP for every port"
)

var sends: [(host: String, port: Int, bytes: Int)] = []
let service = WakeOnLanService(repeatCount: 1) { host, port, packet in
    sends.append((host: host, port: port, bytes: packet.count))
}
let sendResult = try! service.sendWakePackets(targets: validTargets)
expect(sendResult.sentPackets == 6, "sendWakePackets must report the packet count")
expect(sendResult.destinations == destinations, "sendWakePackets must report unique destinations")
expect(sendResult.failures.isEmpty, "sendWakePackets must not report failures when every destination succeeds")
expect(sends.count == 6, "sendWakePackets must fan out to every target destination and port")
expect(sends[0].host == "192.168.1.255" && sends[0].port == 9, "first wake packet must use the first port")
expect(sends[1].host == "192.168.1.255" && sends[1].port == 7, "second wake packet must use the second port")
expect(sends[2].host == "255.255.255.255" && sends[2].port == 9, "third wake packet must use limited broadcast")
expect(sends[4].host == "192.168.1.20" && sends[4].port == 9, "fifth wake packet must use last known host IP")
expect(sends.allSatisfy { $0.bytes == 102 }, "all wake packets must contain a full magic packet")

enum TestWakeSendError: Error, CustomStringConvertible {
    case blockedBroadcast

    var description: String {
        "blockedBroadcast"
    }
}

var partialSends: [(host: String, port: Int)] = []
let partialFailureService = WakeOnLanService(repeatCount: 1) { host, port, _ in
    if host == "255.255.255.255" {
        throw TestWakeSendError.blockedBroadcast
    }
    partialSends.append((host: host, port: port))
}
let partialResult = try! partialFailureService.sendWakePackets(targets: validTargets)
expect(partialResult.sentPackets == 4, "sendWakePackets must continue after one destination fails")
expect(partialResult.failures.count == 2, "sendWakePackets must report each failed destination once")
expect(partialResult.failures.allSatisfy { $0.destination.host == "255.255.255.255" }, "failures must include the failed host")
expect(partialSends.count == 4, "sendWakePackets must still send packets to healthy destinations")

let totalFailureService = WakeOnLanService(repeatCount: 1) { _, _, _ in
    throw TestWakeSendError.blockedBroadcast
}
do {
    _ = try totalFailureService.sendWakePackets(targets: validTargets)
    expect(false, "sendWakePackets must throw when every destination fails")
} catch let error as WakeOnLanError {
    if case .allPacketsFailed(let failures) = error {
        expect(failures.count == 6, "allPacketsFailed must include every failed destination")
    } else {
        expect(false, "sendWakePackets must throw allPacketsFailed for total failure")
    }
} catch {
    expect(false, "sendWakePackets must throw WakeOnLanError for total failure")
}

expect(
    SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "", operation: "list"),
    "wake should be scoped to opening personal listings"
)
expect(
    SharedFilesRoutePolicy.shouldAttemptWake(scope: " personal ", path: " / ", operation: " list "),
    "wake trigger should tolerate whitespace around the personal root listing"
)
expect(
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "team", path: "", operation: "list"),
    "team shared files must not trigger bound desktop wake"
)
expect(
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "Photos", operation: "list"),
    "nested personal folders must not trigger bound desktop wake"
)
expect(
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "Photos/image.jpg", operation: "download"),
    "personal downloads must not trigger bound desktop wake"
)

// Assert DNS resolution works (resolving localhost)
do {
    try WakeOnLanService.sendUDPPacket(host: "localhost", port: 50000, packet: Data([0, 1, 2]))
} catch let error as WakeOnLanError {
    // It's fine if it fails with sendFailed or socketOpenFailed (indicating socket error rather than hostname error)
    switch error {
    case .invalidBroadcastAddress:
        expect(false, "localhost must be resolvable")
    default:
        break
    }
} catch {
    expect(false, "unexpected error type")
}

// Assert legacy public targets are ignored on decode, serialization, and merge.
let existingPT = PublicWakeTarget(kind: "router_wan_udp", host: "my-wan.net", port: 9, enabled: true, updatedAt: "2026-06-11T00:00:00Z")
let existingWake = WakeCapability(supported: true, targets: [], publicTarget: existingPT, updatedAt: "2026-06-11T00:00:00Z")
let payloadWithPublicTarget = existingWake.toPayload()
expect(payloadWithPublicTarget["publicTarget"] is NSNull, "wake payload serialization must clear public target")
let decodedWake = WakeCapability.fromJSONValue([
    "supported": true,
    "updatedAt": "2026-06-11T00:00:00Z",
    "targets": [
        [
            "interfaceName": "en0",
            "macAddress": "aa:bb:cc:dd:ee:ff",
            "ipv4Address": "192.168.1.20",
            "broadcastAddress": "192.168.1.255",
            "ports": [9],
        ],
    ],
    "publicTarget": [
        "kind": "router_wan_udp",
        "host": "my-wan.net",
        "port": 9,
        "enabled": true,
        "updatedAt": "2026-06-11T00:00:00Z",
    ],
])
expect(decodedWake?.publicTarget == nil, "wake metadata decode must ignore legacy public target")
let newWake = WakeCapability(supported: true, targets: [targets[0]], publicTarget: nil, updatedAt: "2026-06-11T01:00:00Z")
let mergedWake = WakeCapability.merge(newWake: newWake, existingWake: existingWake)
expect(mergedWake != nil, "merged capability must not be nil")
expect(mergedWake?.updatedAt == "2026-06-11T01:00:00Z", "merged capability must update timestamp")
expect(mergedWake?.targets.count == 1, "merged capability must update targets")
expect(mergedWake?.publicTarget == nil, "merged capability must clear existing public target")
