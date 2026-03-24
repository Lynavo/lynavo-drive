package mdns

import (
	"fmt"
	"log/slog"
	"net"
	"os/exec"
	"strconv"
	"strings"
)

// BroadcastConfig holds the parameters for Bonjour/mDNS service registration.
type BroadcastConfig struct {
	DeviceID     string
	DeviceName   string
	DeviceType   string // "mac"
	DeviceIP     string
	TCPPort      int    // 39393
	Proto        int    // 2
	ShareEnabled bool
	ShareName    string
}

// Broadcaster wraps a dns-sd process that advertises _syncflow._tcp via macOS native Bonjour.
type Broadcaster struct {
	cmd *exec.Cmd
}

// BuildTXTRecords constructs the TXT record key-value pairs from config.
func BuildTXTRecords(cfg BroadcastConfig) []string {
	txt := []string{
		fmt.Sprintf("id=%s", cfg.DeviceID),
		fmt.Sprintf("name=%s", cfg.DeviceName),
		fmt.Sprintf("type=%s", cfg.DeviceType),
		fmt.Sprintf("proto=%d", cfg.Proto),
		"auth=code",
		fmt.Sprintf("share=%d", boolToInt(cfg.ShareEnabled)),
		fmt.Sprintf("shareName=%s", cfg.ShareName),
	}
	if cfg.DeviceIP != "" {
		txt = append(txt, fmt.Sprintf("ip=%s", cfg.DeviceIP))
	}
	return txt
}

// NewBroadcaster registers a _syncflow._tcp Bonjour service using macOS native dns-sd command.
// This is guaranteed compatible with Apple's NWBrowser on iOS.
func NewBroadcaster(cfg BroadcastConfig) (*Broadcaster, error) {
	if cfg.DeviceIP == "" {
		cfg.DeviceIP = getLocalIPv4()
	}
	txt := BuildTXTRecords(cfg)

	if err := cleanupStaleBroadcastProcesses(); err != nil {
		slog.Warn("failed to clean stale bonjour broadcasts", "err", err)
	}

	// Build dns-sd command: dns-sd -R <name> <type> <domain> <port> [TXT key=value ...]
	args := []string{"-R", cfg.DeviceName, "_syncflow._tcp", "local.", fmt.Sprintf("%d", cfg.TCPPort)}
	args = append(args, txt...)

	cmd := exec.Command("dns-sd", args...)
	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("dns-sd start: %w", err)
	}

	slog.Info("bonjour broadcasting (dns-sd)",
		"service", "_syncflow._tcp",
		"port", cfg.TCPPort,
		"name", cfg.DeviceName,
		"txt", strings.Join(txt, ", "),
		"pid", cmd.Process.Pid,
	)
	return &Broadcaster{cmd: cmd}, nil
}

func getLocalIPv4() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		ipnet, ok := addr.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() {
			continue
		}
		if ip4 := ipnet.IP.To4(); ip4 != nil {
			return ip4.String()
		}
	}
	return ""
}

// Shutdown stops the dns-sd process.
func (b *Broadcaster) Shutdown() {
	if b != nil && b.cmd != nil && b.cmd.Process != nil {
		b.cmd.Process.Kill()
		b.cmd.Wait()
	}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func cleanupStaleBroadcastProcesses() error {
	out, err := exec.Command("ps", "-axo", "pid=,command=").Output()
	if err != nil {
		return fmt.Errorf("list processes: %w", err)
	}

	for _, line := range strings.Split(string(out), "\n") {
		pid, ok := parseSyncFlowBroadcastPID(line)
		if !ok {
			continue
		}
		if killErr := exec.Command("kill", strconv.Itoa(pid)).Run(); killErr != nil {
			slog.Warn("failed to terminate stale dns-sd broadcast", "pid", pid, "err", killErr)
			continue
		}
		slog.Info("terminated stale dns-sd broadcast", "pid", pid)
	}

	return nil
}

func parseSyncFlowBroadcastPID(line string) (int, bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return 0, false
	}

	fields := strings.Fields(trimmed)
	if len(fields) < 2 {
		return 0, false
	}

	command := strings.Join(fields[1:], " ")
	if !strings.Contains(command, "dns-sd -R") ||
		!strings.Contains(command, "_syncflow._tcp") ||
		!strings.Contains(command, "local.") {
		return 0, false
	}

	pid, err := strconv.Atoi(fields[0])
	if err != nil {
		return 0, false
	}
	return pid, true
}
