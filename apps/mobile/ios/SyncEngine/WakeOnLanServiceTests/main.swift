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

var sends: [(host: String, port: Int, bytes: Int)] = []
let service = WakeOnLanService { host, port, packet in
    sends.append((host: host, port: port, bytes: packet.count))
}
try! service.sendWakePackets(targets: validTargets)
expect(sends.count == 2, "sendWakePackets must fan out to every target port")
expect(sends[0].host == "192.168.1.255" && sends[0].port == 9, "first wake packet must use the first port")
expect(sends[1].host == "192.168.1.255" && sends[1].port == 7, "second wake packet must use the second port")
expect(sends.allSatisfy { $0.bytes == 102 }, "all wake packets must contain a full magic packet")

expect(
    SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "", operation: "list"),
    "wake should be scoped to opening the personal root listing"
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
    !SharedFilesRoutePolicy.shouldAttemptWake(scope: "personal", path: "", operation: "download"),
    "downloads must not trigger bound desktop wake"
)
