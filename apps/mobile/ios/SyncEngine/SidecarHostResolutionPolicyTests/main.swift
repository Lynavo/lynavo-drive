import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("SidecarHostResolutionPolicyTests failed: \(message)\n", stderr)
        exit(1)
    }
}

expect(
    SidecarHostResolutionPolicy.preferredHost(
        probedHost: "127.0.0.1",
        deviceHost: "172.20.10.2"
    ) == "172.20.10.2",
    "loopback probe must not replace a reachable Windows LAN host"
)

expect(
    SidecarHostResolutionPolicy.preferredHost(
        probedHost: "localhost",
        deviceHost: "192.168.1.20"
    ) == "192.168.1.20",
    "localhost probe must fall back to the discovered device host"
)

expect(
    SidecarHostResolutionPolicy.preferredHost(
        probedHost: nil,
        deviceHost: "127.0.0.1"
    ) == nil,
    "loopback device host from discovery must not be treated as a reachable desktop"
)

expect(
    SidecarHostResolutionPolicy.isLoopbackHost(" [::1] "),
    "bracketed IPv6 loopback should be recognized"
)

expect(
    SidecarHostResolutionPolicy.preferredHost(
        probedHost: "127.0.0.1",
        deviceHost: nil
    ) == nil,
    "loopback probe without another host must not be persisted as the sidecar host"
)

expect(
    SidecarHostResolutionPolicy.preferredHost(
        probedHost: "172.20.10.9",
        deviceHost: "172.20.10.2"
    ) == "172.20.10.9",
    "non-loopback IPv4 probe should win because it is the actual connected endpoint"
)

expect(
    SidecarHostResolutionPolicy.preferredHost(
        probedHost: "fe80::1",
        deviceHost: "172.20.10.2"
    ) == "172.20.10.2",
    "IPv6 probe should not replace a known IPv4 LAN host"
)

expect(
    SidecarHostResolutionPolicy.preferredHost(
        probedHost: "fe80::1",
        deviceHost: nil
    ) == "fe80::1",
    "IPv6 probe may still be used when no better host is known"
)

expect(
    SidecarHostResolutionPolicy.usableFallbackHost(" 172.20.10.2 \n") == "172.20.10.2",
    "fallback host should be trimmed before use"
)

expect(
    SidecarHostResolutionPolicy.usableFallbackHost("   ") == nil,
    "blank fallback host should not be usable"
)

expect(
    SidecarHostResolutionPolicy.usableFallbackHost("127.0.0.1") == nil,
    "loopback fallback host should not be usable for a real device connection"
)

expect(
    SidecarHostResolutionPolicy.usableFallbackHost("localhost") == nil,
    "localhost fallback host should not be usable for a real device connection"
)
