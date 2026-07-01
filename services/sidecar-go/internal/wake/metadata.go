package wake

import (
	"net"
	"sort"
	"strings"
	"time"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/protocol"
)

var wakePorts = []int{9, 7}
var hardwareMACsByInterface = hardwareMACsByInterfaceForPlatform

type interfaceSnapshot struct {
	name         string
	flags        net.Flags
	hardwareAddr net.HardwareAddr
	addrs        []net.Addr
}

type wakeTargetCandidate struct {
	target protocol.WakeTarget
	index  int
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

	return metadataFromInterfaceSnapshotsWithHardwareMACs(
		snapshots,
		time.Now().UTC(),
		hardwareMACsByInterface(),
	)
}

func metadataFromInterfaceSnapshots(
	snapshots []interfaceSnapshot,
	now time.Time,
) *protocol.WakeCapability {
	return metadataFromInterfaceSnapshotsWithHardwareMACs(snapshots, now, nil)
}

func metadataFromInterfaceSnapshotsWithHardwareMACs(
	snapshots []interfaceSnapshot,
	now time.Time,
	hardwareMACs map[string]net.HardwareAddr,
) *protocol.WakeCapability {
	candidates := make([]wakeTargetCandidate, 0, len(snapshots))

	for _, snapshot := range snapshots {
		hardwareAddr := hardwareAddrForSnapshot(snapshot, hardwareMACs)
		if !isWakeCandidate(snapshot, hardwareAddr) {
			continue
		}
		for _, addr := range snapshot.addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ipv4 := ipNet.IP.To4()
			if ipv4 == nil || ipv4.IsLoopback() || ipv4.IsUnspecified() || ipv4.IsLinkLocalUnicast() {
				continue
			}
			broadcast := broadcastAddress(ipv4, ipNet.Mask)
			if broadcast == "" {
				continue
			}
			candidates = append(candidates, wakeTargetCandidate{
				target: protocol.WakeTarget{
					InterfaceName:    snapshot.name,
					MACAddress:       hardwareAddr.String(),
					IPv4Address:      ipv4.String(),
					BroadcastAddress: broadcast,
					Ports:            append([]int(nil), wakePorts...),
				},
				index: len(candidates),
			})
		}
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		left := wakeTargetPriority(candidates[i].target)
		right := wakeTargetPriority(candidates[j].target)
		if left != right {
			return left < right
		}
		return candidates[i].index < candidates[j].index
	})

	targets := make([]protocol.WakeTarget, 0, len(candidates))
	for _, candidate := range candidates {
		targets = append(targets, candidate.target)
	}

	return &protocol.WakeCapability{
		Supported: len(targets) > 0,
		Targets:   targets,
		UpdatedAt: now.UTC().Format(time.RFC3339),
	}
}

func hardwareAddrForSnapshot(
	snapshot interfaceSnapshot,
	hardwareMACs map[string]net.HardwareAddr,
) net.HardwareAddr {
	if isUsableHardwareAddr(snapshot.hardwareAddr) {
		return snapshot.hardwareAddr
	}
	if mac, ok := hardwareMACs[snapshot.name]; ok && isUsableHardwareAddr(mac) {
		return mac
	}
	return snapshot.hardwareAddr
}

func isWakeCandidate(snapshot interfaceSnapshot, hardwareAddr net.HardwareAddr) bool {
	if snapshot.flags&net.FlagUp == 0 {
		return false
	}
	if snapshot.flags&net.FlagLoopback != 0 {
		return false
	}
	if isExcludedInterfaceName(snapshot.name) {
		return false
	}
	return isUsableHardwareAddr(hardwareAddr)
}

func isUsableHardwareAddr(hardwareAddr net.HardwareAddr) bool {
	return len(hardwareAddr) == 6 && !isZeroHardwareAddr(hardwareAddr)
}

func isZeroHardwareAddr(hardwareAddr net.HardwareAddr) bool {
	for _, b := range hardwareAddr {
		if b != 0 {
			return false
		}
	}
	return true
}

func isExcludedInterfaceName(name string) bool {
	lowerName := strings.ToLower(name)
	return strings.HasPrefix(lowerName, "bridge") ||
		strings.HasPrefix(lowerName, "utun") ||
		strings.HasPrefix(lowerName, "awdl") ||
		strings.HasPrefix(lowerName, "llw")
}

func wakeTargetPriority(target protocol.WakeTarget) int {
	ip := net.ParseIP(target.IPv4Address)
	if ip == nil || ip.To4() == nil || ip.IsLinkLocalUnicast() {
		return 30
	}
	if strings.HasPrefix(strings.ToLower(target.InterfaceName), "en") {
		return 0
	}
	return 10
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

func parseNetworksetupHardwarePortsOutput(output string) map[string]net.HardwareAddr {
	result := make(map[string]net.HardwareAddr)
	var device string

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if value, ok := strings.CutPrefix(line, "Device:"); ok {
			device = strings.TrimSpace(value)
			continue
		}

		if value, ok := strings.CutPrefix(line, "Ethernet Address:"); ok && device != "" {
			mac, err := net.ParseMAC(strings.TrimSpace(value))
			if err == nil && len(mac) == 6 && !isZeroHardwareAddr(mac) {
				result[device] = mac
			}
			device = ""
		}
	}

	return result
}
