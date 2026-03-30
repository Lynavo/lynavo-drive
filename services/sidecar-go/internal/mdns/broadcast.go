package mdns

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/grandcat/zeroconf"
)

const (
	serviceType   = "_syncflow._tcp"
	serviceDomain = "local."
)

// BroadcastConfig holds the parameters for Bonjour/mDNS service registration.
type BroadcastConfig struct {
	DeviceID     string
	DeviceName   string
	DeviceType   string // "mac"
	DeviceIP     string
	TCPPort      int // 39393
	Proto        int // 2
	ShareEnabled bool
	ShareName    string
}

// Broadcaster wraps the active Bonjour publisher for the current platform.
type Broadcaster struct {
	cmd    *exec.Cmd
	server *zeroconf.Server
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

// NewBroadcaster registers a _syncflow._tcp Bonjour service.
// macOS keeps using dns-sd for parity with production; other platforms use a
// pure-Go mDNS responder so Windows dev builds remain discoverable.
func NewBroadcaster(cfg BroadcastConfig) (*Broadcaster, error) {
	if cfg.DeviceIP == "" {
		cfg.DeviceIP = getLocalIPv4()
	}
	txt := BuildTXTRecords(cfg)

	if runtime.GOOS != "darwin" {
		return newCrossPlatformBroadcaster(cfg, txt)
	}

	if err := cleanupStaleBroadcastProcesses(); err != nil {
		slog.Warn("failed to clean stale bonjour broadcasts", "err", err)
	}

	// Build dns-sd command: dns-sd -R <name> <type> <domain> <port> [TXT key=value ...]
	args := []string{"-R", cfg.DeviceName, serviceType, serviceDomain, fmt.Sprintf("%d", cfg.TCPPort)}
	args = append(args, txt...)

	cmd := exec.Command("dns-sd", args...)
	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("dns-sd start: %w", err)
	}

	slog.Info("bonjour broadcasting (dns-sd)",
		"service", serviceType,
		"port", cfg.TCPPort,
		"name", cfg.DeviceName,
		"txt", strings.Join(txt, ", "),
		"pid", cmd.Process.Pid,
	)
	return &Broadcaster{cmd: cmd}, nil
}

func newCrossPlatformBroadcaster(cfg BroadcastConfig, txt []string) (*Broadcaster, error) {
	server, err := zeroconf.RegisterProxy(
		cfg.DeviceName,
		serviceType,
		serviceDomain,
		cfg.TCPPort,
		serviceHostName(cfg),
		serviceIPs(cfg),
		txt,
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("zeroconf register: %w", err)
	}

	slog.Info("bonjour broadcasting (zeroconf)",
		"service", serviceType,
		"port", cfg.TCPPort,
		"name", cfg.DeviceName,
		"host", serviceHostName(cfg),
		"ip", cfg.DeviceIP,
		"txt", strings.Join(txt, ", "),
	)
	return &Broadcaster{server: server}, nil
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

func serviceHostName(cfg BroadcastConfig) string {
	base, err := os.Hostname()
	if err != nil || strings.TrimSpace(base) == "" {
		base = cfg.DeviceName
	}
	if strings.TrimSpace(base) == "" {
		base = "syncflow-sidecar"
	}

	var builder strings.Builder
	lastWasHyphen := false
	for _, r := range strings.ToLower(strings.TrimSpace(base)) {
		isAlphaNum := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if isAlphaNum {
			builder.WriteRune(r)
			lastWasHyphen = false
			continue
		}
		if !lastWasHyphen {
			builder.WriteByte('-')
			lastWasHyphen = true
		}
	}

	host := strings.Trim(builder.String(), "-")
	if host == "" {
		host = "syncflow-sidecar"
	}
	return host
}

func serviceIPs(cfg BroadcastConfig) []string {
	if strings.TrimSpace(cfg.DeviceIP) == "" {
		return nil
	}
	return []string{cfg.DeviceIP}
}

// Shutdown stops the active Bonjour publisher.
func (b *Broadcaster) Shutdown() {
	if b != nil && b.server != nil {
		b.server.Shutdown()
	}
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
	if runtime.GOOS != "darwin" {
		return nil
	}

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
