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
