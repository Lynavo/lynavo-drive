package wake

import (
	"net"
	"testing"
	"time"
)

func TestBroadcastAddress(t *testing.T) {
	ip := net.IPv4(192, 168, 10, 23)
	mask := net.IPv4Mask(255, 255, 255, 0)

	got := broadcastAddress(ip, mask)

	if got != "192.168.10.255" {
		t.Fatalf("broadcastAddress = %q, want 192.168.10.255", got)
	}
}

func TestBroadcastAddressWithTwentyTwoBitMask(t *testing.T) {
	ip := net.IPv4(172, 16, 20, 108)
	mask := net.IPv4Mask(255, 255, 252, 0)

	got := broadcastAddress(ip, mask)

	if got != "172.16.23.255" {
		t.Fatalf("broadcastAddress = %q, want 172.16.23.255", got)
	}
}

func TestMetadataFromInterfacesFiltersInvalidTargets(t *testing.T) {
	now := time.Date(2026, 6, 9, 3, 0, 0, 0, time.UTC)

	got := metadataFromInterfaceSnapshots([]interfaceSnapshot{
		{
			name:         "lo0",
			flags:        net.FlagUp | net.FlagLoopback,
			hardwareAddr: net.HardwareAddr{0, 0, 0, 0, 0, 0},
			addrs: []net.Addr{
				&net.IPNet{IP: net.IPv4(127, 0, 0, 1), Mask: net.IPv4Mask(255, 0, 0, 0)},
			},
		},
		{
			name:         "en0",
			flags:        net.FlagUp | net.FlagMulticast,
			hardwareAddr: net.HardwareAddr{0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff},
			addrs: []net.Addr{
				&net.IPNet{IP: net.IPv4(192, 168, 10, 23), Mask: net.IPv4Mask(255, 255, 255, 0)},
			},
		},
	}, now)

	if !got.Supported {
		t.Fatalf("Supported = false, want true")
	}
	if len(got.Targets) != 1 {
		t.Fatalf("Targets len = %d, want 1", len(got.Targets))
	}
	target := got.Targets[0]
	if target.InterfaceName != "en0" {
		t.Fatalf("InterfaceName = %q, want en0", target.InterfaceName)
	}
	if target.MACAddress != "aa:bb:cc:dd:ee:ff" {
		t.Fatalf("MACAddress = %q, want aa:bb:cc:dd:ee:ff", target.MACAddress)
	}
	if target.BroadcastAddress != "192.168.10.255" {
		t.Fatalf("BroadcastAddress = %q, want 192.168.10.255", target.BroadcastAddress)
	}
	if target.IPv4Address != "192.168.10.23" {
		t.Fatalf("IPv4Address = %q, want 192.168.10.23", target.IPv4Address)
	}
	if len(target.Ports) != 2 || target.Ports[0] != 9 || target.Ports[1] != 7 {
		t.Fatalf("Ports = %v, want [9 7]", target.Ports)
	}
	if got.UpdatedAt != "2026-06-09T03:00:00Z" {
		t.Fatalf("UpdatedAt = %q, want 2026-06-09T03:00:00Z", got.UpdatedAt)
	}
}

func TestMetadataFromInterfacesPrefersEffectiveInterfaceMAC(t *testing.T) {
	now := time.Date(2026, 6, 9, 3, 0, 0, 0, time.UTC)

	hardwareMACs := parseNetworksetupHardwarePortsOutput(`
Hardware Port: Wi-Fi
Device: en1
Ethernet Address: d0:11:e5:e0:a2:94
`)

	got := metadataFromInterfaceSnapshotsWithHardwareMACs([]interfaceSnapshot{
		{
			name:         "en1",
			flags:        net.FlagUp | net.FlagMulticast,
			hardwareAddr: net.HardwareAddr{0x8a, 0x83, 0x3b, 0xf6, 0x3e, 0x91},
			addrs: []net.Addr{
				&net.IPNet{IP: net.IPv4(172, 16, 20, 108), Mask: net.IPv4Mask(255, 255, 252, 0)},
			},
		},
	}, now, hardwareMACs)

	if len(got.Targets) != 1 {
		t.Fatalf("Targets len = %d, want 1", len(got.Targets))
	}
	target := got.Targets[0]
	if target.InterfaceName != "en1" {
		t.Fatalf("InterfaceName = %q, want en1", target.InterfaceName)
	}
	if target.MACAddress != "8a:83:3b:f6:3e:91" {
		t.Fatalf("MACAddress = %q, want effective interface MAC 8a:83:3b:f6:3e:91", target.MACAddress)
	}
	if target.BroadcastAddress != "172.16.23.255" {
		t.Fatalf("BroadcastAddress = %q, want 172.16.23.255", target.BroadcastAddress)
	}
}

func TestMetadataFromInterfacesUsesHardwareMACWhenInterfaceMACIsMissing(t *testing.T) {
	now := time.Date(2026, 6, 9, 3, 0, 0, 0, time.UTC)
	hardwareMACs := map[string]net.HardwareAddr{
		"en1": {0xd0, 0x11, 0xe5, 0xe0, 0xa2, 0x94},
	}

	got := metadataFromInterfaceSnapshotsWithHardwareMACs([]interfaceSnapshot{
		{
			name:         "en1",
			flags:        net.FlagUp | net.FlagMulticast,
			hardwareAddr: nil,
			addrs: []net.Addr{
				&net.IPNet{IP: net.IPv4(172, 16, 20, 108), Mask: net.IPv4Mask(255, 255, 252, 0)},
			},
		},
	}, now, hardwareMACs)

	if len(got.Targets) != 1 {
		t.Fatalf("Targets len = %d, want 1", len(got.Targets))
	}
	if got.Targets[0].MACAddress != "d0:11:e5:e0:a2:94" {
		t.Fatalf("MACAddress = %q, want hardware MAC d0:11:e5:e0:a2:94", got.Targets[0].MACAddress)
	}
}

func TestMetadataFromInterfacesFiltersBridgeAndLinkLocalTargets(t *testing.T) {
	now := time.Date(2026, 6, 9, 3, 0, 0, 0, time.UTC)

	got := metadataFromInterfaceSnapshots([]interfaceSnapshot{
		{
			name:         "bridge100",
			flags:        net.FlagUp | net.FlagMulticast,
			hardwareAddr: net.HardwareAddr{0x02, 0x00, 0x00, 0x00, 0x00, 0x01},
			addrs: []net.Addr{
				&net.IPNet{IP: net.IPv4(192, 168, 64, 1), Mask: net.IPv4Mask(255, 255, 255, 0)},
			},
		},
		{
			name:         "en5",
			flags:        net.FlagUp | net.FlagMulticast,
			hardwareAddr: net.HardwareAddr{0x42, 0x9c, 0xd1, 0x42, 0xf6, 0xa5},
			addrs: []net.Addr{
				&net.IPNet{IP: net.IPv4(169, 254, 10, 20), Mask: net.IPv4Mask(255, 255, 0, 0)},
			},
		},
		{
			name:         "en1",
			flags:        net.FlagUp | net.FlagMulticast,
			hardwareAddr: net.HardwareAddr{0xd0, 0x11, 0xe5, 0xe0, 0xa2, 0x94},
			addrs: []net.Addr{
				&net.IPNet{IP: net.IPv4(172, 16, 20, 108), Mask: net.IPv4Mask(255, 255, 252, 0)},
			},
		},
	}, now)

	if len(got.Targets) != 1 {
		t.Fatalf("Targets len = %d, want 1", len(got.Targets))
	}
	if got.Targets[0].InterfaceName != "en1" {
		t.Fatalf("InterfaceName = %q, want en1", got.Targets[0].InterfaceName)
	}
}

func TestParseNetworksetupHardwarePortsOutput(t *testing.T) {
	got := parseNetworksetupHardwarePortsOutput(`
Hardware Port: Ethernet
Device: en0
Ethernet Address: d0:11:e5:cf:3e:94

Hardware Port: Wi-Fi
Device: en1
Ethernet Address: d0:11:e5:e0:a2:94

Hardware Port: Thunderbolt Bridge
Device: bridge0
Ethernet Address: 36:34:ee:d2:ef:00
`)

	if got["en0"].String() != "d0:11:e5:cf:3e:94" {
		t.Fatalf("en0 MAC = %q, want d0:11:e5:cf:3e:94", got["en0"])
	}
	if got["en1"].String() != "d0:11:e5:e0:a2:94" {
		t.Fatalf("en1 MAC = %q, want d0:11:e5:e0:a2:94", got["en1"])
	}
	if got["bridge0"].String() != "36:34:ee:d2:ef:00" {
		t.Fatalf("bridge0 MAC = %q, want 36:34:ee:d2:ef:00", got["bridge0"])
	}
}

func TestMetadataFromInterfacesReportsUnsupportedWhenNoTargets(t *testing.T) {
	now := time.Date(2026, 6, 9, 3, 0, 0, 0, time.UTC)

	got := metadataFromInterfaceSnapshots([]interfaceSnapshot{
		{
			name:         "lo0",
			flags:        net.FlagUp | net.FlagLoopback,
			hardwareAddr: net.HardwareAddr{0, 0, 0, 0, 0, 0},
			addrs: []net.Addr{
				&net.IPNet{IP: net.IPv4(127, 0, 0, 1), Mask: net.IPv4Mask(255, 0, 0, 0)},
			},
		},
	}, now)

	if got.Supported {
		t.Fatalf("Supported = true, want false")
	}
	if len(got.Targets) != 0 {
		t.Fatalf("Targets len = %d, want 0", len(got.Targets))
	}
}
