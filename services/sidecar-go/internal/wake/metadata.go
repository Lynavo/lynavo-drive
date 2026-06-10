package wake

import (
	"net"
	"time"

	"github.com/nicksyncflow/sidecar/internal/protocol"
)

var wakePorts = []int{9, 7}

type interfaceSnapshot struct {
	name         string
	flags        net.Flags
	hardwareAddr net.HardwareAddr
	addrs        []net.Addr
}

func Metadata() *protocol.WakeCapability {
	ifaces, err := net.Interfaces()
	if err != nil {
		return &protocol.WakeCapability{
			Supported: false,
			Targets:   []protocol.WakeTarget{},
			UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		}
	}

	snapshots := make([]interfaceSnapshot, 0, len(ifaces))
	for _, iface := range ifaces {
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		snapshots = append(snapshots, interfaceSnapshot{
			name:         iface.Name,
			flags:        iface.Flags,
			hardwareAddr: iface.HardwareAddr,
			addrs:        addrs,
		})
	}

	return metadataFromInterfaceSnapshots(snapshots, time.Now().UTC())
}

func metadataFromInterfaceSnapshots(
	snapshots []interfaceSnapshot,
	now time.Time,
) *protocol.WakeCapability {
	targets := make([]protocol.WakeTarget, 0, len(snapshots))

	for _, snapshot := range snapshots {
		if !isWakeCandidate(snapshot) {
			continue
		}
		for _, addr := range snapshot.addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ipv4 := ipNet.IP.To4()
			if ipv4 == nil || ipv4.IsLoopback() || ipv4.IsUnspecified() {
				continue
			}
			broadcast := broadcastAddress(ipv4, ipNet.Mask)
			if broadcast == "" {
				continue
			}
			targets = append(targets, protocol.WakeTarget{
				InterfaceName:    snapshot.name,
				MACAddress:       snapshot.hardwareAddr.String(),
				IPv4Address:      ipv4.String(),
				BroadcastAddress: broadcast,
				Ports:            append([]int(nil), wakePorts...),
			})
		}
	}

	return &protocol.WakeCapability{
		Supported: len(targets) > 0,
		Targets:   targets,
		UpdatedAt: now.UTC().Format(time.RFC3339),
	}
}

func isWakeCandidate(snapshot interfaceSnapshot) bool {
	if snapshot.flags&net.FlagUp == 0 {
		return false
	}
	if snapshot.flags&net.FlagLoopback != 0 {
		return false
	}
	if len(snapshot.hardwareAddr) != 6 {
		return false
	}
	for _, b := range snapshot.hardwareAddr {
		if b != 0 {
			return true
		}
	}
	return false
}

func broadcastAddress(ip net.IP, mask net.IPMask) string {
	ipv4 := ip.To4()
	if ipv4 == nil || len(mask) != net.IPv4len {
		return ""
	}

	broadcast := make(net.IP, net.IPv4len)
	for i := 0; i < net.IPv4len; i++ {
		broadcast[i] = ipv4[i] | ^mask[i]
	}
	return broadcast.String()
}
