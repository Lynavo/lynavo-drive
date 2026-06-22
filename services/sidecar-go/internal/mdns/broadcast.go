package mdns

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/grandcat/zeroconf"
)

const (
	serviceType     = "_syncflow._tcp"
	serviceDomain   = "local."
	backendDNSSD    = "dns-sd"
	backendZeroconf = "zeroconf"
	dnsSDPathEnv    = "SYNCFLOW_DNSSD_PATH"
)

var (
	lookPath                = exec.LookPath
	executablePath          = os.Executable
	bonjourServiceAvailable = defaultBonjourServiceAvailable
)

// BroadcastConfig holds the parameters for Bonjour/mDNS service registration.
type BroadcastConfig struct {
	DeviceID     string
	DeviceName   string
	DeviceType   string // "mac" | "win" | "linux"
	DeviceIP     string
	TCPPort      int // 39393
	Proto        int // 2
	ShareEnabled bool
	ShareName    string
}

// Broadcaster wraps the active Bonjour publisher for the current platform.
type Broadcaster struct {
	mu          sync.Mutex
	cmd         *exec.Cmd
	server      *zeroconf.Server
	dnssdExited chan struct{} // closed when dns-sd process exits; nil for zeroconf
	done        chan struct{} // closed by Shutdown to stop the watchdog

	// Stored for dns-sd watchdog restarts.
	dnsSDPath string
	cfg       BroadcastConfig
	txt       []string
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

// DeviceTypeForGOOS maps the current runtime to the discovery type consumed by
// the mobile device list.
func DeviceTypeForGOOS(goos string) string {
	if goos == "windows" {
		return "win"
	}
	if goos == "linux" {
		return "linux"
	}
	return "mac"
}

// NewBroadcaster registers a _syncflow._tcp Bonjour service.
// macOS and Windows prefer dns-sd when available for parity with the Apple
// Bonjour stack used by iOS. Platforms without dns-sd fall back to zeroconf.
func NewBroadcaster(cfg BroadcastConfig) (*Broadcaster, error) {
	if cfg.DeviceIP == "" {
		cfg.DeviceIP = CurrentLocalIPv4()
	}
	slog.Info("bonjour broadcaster ip selected",
		"ip", cfg.DeviceIP,
		"platform", runtime.GOOS,
		"iface", PreferredInterfaceName(cfg.DeviceIP),
	)
	bonjourServiceOK := bonjourServiceAvailable()
	txt := BuildTXTRecords(cfg)

	backend, dnsSDPath := selectBroadcasterBackend(runtime.GOOS)
	if backend == backendDNSSD {
		if bonjourServiceOK {
			return newDNSSDBroadcaster(cfg, txt, dnsSDPath)
		}
		slog.Warn(
			"dns-sd binary found but Bonjour Service is not running; falling back to zeroconf",
			"path", dnsSDPath,
			"fix", "start Bonjour Service or reinstall Bonjour for Windows",
		)
	} else if supportsNativeDNSSD(runtime.GOOS) {
		slog.Warn(
			"dns-sd unavailable, falling back to zeroconf",
			"platform", runtime.GOOS,
			"hint", "install Bonjour for Windows or provide SYNCFLOW_DNSSD_PATH for best iOS discovery compatibility",
		)
	}
	return newCrossPlatformBroadcaster(cfg, txt)
}

// CurrentLocalIPv4 returns the best-candidate IPv4 address for LAN discovery
// advertisement. It is exported so the sidecar process can detect Wi-Fi/DHCP
// changes and rebuild the Bonjour TXT record with the new address.
func CurrentLocalIPv4() string {
	return getLocalIPv4()
}

// InterfaceSummary describes a network interface for diagnostic logs.
// Kept flat (no pointers) so slog serialises it as a single JSON object
// per interface without needing a custom LogValuer.
type InterfaceSummary struct {
	Name  string   `json:"name"`
	Up    bool     `json:"up"`
	Mcast bool     `json:"multicast"`
	Loop  bool     `json:"loopback"`
	PtP   bool     `json:"point_to_point"`
	IPv4  []string `json:"ipv4"`
}

// SnapshotInterfacesForLog returns a compact description of every network
// interface with an IPv4 address. It is the primary signal for diagnosing
// "why did sidecar pick the wrong IP" / "why did connection break when WiFi
// flipped" — operators need the full interface list, not just the chosen IP.
func SnapshotInterfacesForLog() []InterfaceSummary {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}

	out := make([]InterfaceSummary, 0, len(ifaces))
	for _, iface := range ifaces {
		addrs, _ := iface.Addrs()
		var ipv4s []string
		for _, addr := range addrs {
			if ipnet, ok := addr.(*net.IPNet); ok {
				if ip4 := ipnet.IP.To4(); ip4 != nil {
					ipv4s = append(ipv4s, ip4.String())
				}
			}
		}
		if len(ipv4s) == 0 && iface.Flags&net.FlagLoopback == 0 {
			// Skip interfaces without IPv4 to keep the log compact, but keep
			// loopback entries so it's obvious the snapshot ran.
			continue
		}
		out = append(out, InterfaceSummary{
			Name:  iface.Name,
			Up:    iface.Flags&net.FlagUp != 0,
			Mcast: iface.Flags&net.FlagMulticast != 0,
			Loop:  iface.Flags&net.FlagLoopback != 0,
			PtP:   iface.Flags&net.FlagPointToPoint != 0,
			IPv4:  ipv4s,
		})
	}
	return out
}

// PreferredInterfaceName returns the name of the interface owning the given
// IPv4 address, or empty string when no interface matches. Used in diagnostic
// logs so operators can tell "en0 → en1" transitions apart from "same NIC
// new DHCP lease" even when the IP itself is unchanged.
func PreferredInterfaceName(ip string) string {
	if ip == "" {
		return ""
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			if ipnet, ok := addr.(*net.IPNet); ok {
				if ip4 := ipnet.IP.To4(); ip4 != nil && ip4.String() == ip {
					return iface.Name
				}
			}
		}
	}
	return ""
}

func newDNSSDBroadcaster(cfg BroadcastConfig, txt []string, dnsSDPath string) (*Broadcaster, error) {
	cmd, exited, err := startDNSSDProcess(cfg, txt, dnsSDPath)
	if err != nil {
		return nil, err
	}

	// dns-sd -R is a long-lived process.  An exit within the grace period
	// means the Bonjour Service is unavailable — fall back to zeroconf.
	select {
	case <-exited:
		slog.Warn("dns-sd exited immediately, falling back to zeroconf",
			"path", dnsSDPath,
			"hint", "ensure Bonjour Service is running",
		)
		return newCrossPlatformBroadcaster(cfg, txt)
	case <-time.After(1 * time.Second):
		// Still running — registration is active
	}

	slog.Info("bonjour broadcasting (dns-sd)",
		"service", serviceType,
		"port", cfg.TCPPort,
		"name", cfg.DeviceName,
		"path", dnsSDPath,
		"txt", strings.Join(txt, ", "),
		"pid", cmd.Process.Pid,
	)

	b := &Broadcaster{
		cmd:         cmd,
		dnssdExited: exited,
		done:        make(chan struct{}),
		dnsSDPath:   dnsSDPath,
		cfg:         cfg,
		txt:         txt,
	}
	go b.watchAndRestart()
	return b, nil
}

// startDNSSDProcess spawns a dns-sd -R process and returns the command, an
// "exited" channel that is closed when the process exits, and any start error.
func startDNSSDProcess(cfg BroadcastConfig, txt []string, dnsSDPath string) (*exec.Cmd, chan struct{}, error) {
	if err := cleanupStaleBroadcastProcesses(); err != nil {
		slog.Warn("failed to clean stale bonjour broadcasts", "err", err)
	}

	args := []string{"-R", cfg.DeviceName, serviceType, serviceDomain, fmt.Sprintf("%d", cfg.TCPPort)}
	args = append(args, txt...)

	cmd := exec.Command(dnsSDPath, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return nil, nil, fmt.Errorf("dns-sd start: %w", err)
	}

	exited := make(chan struct{})
	go func() {
		cmd.Wait()
		close(exited)
	}()

	return cmd, exited, nil
}

// watchAndRestart monitors the dns-sd process and restarts it with exponential
// backoff if it exits unexpectedly (e.g. after macOS sleep/wake or network
// changes).  The loop stops when b.done is closed by Shutdown().
func (b *Broadcaster) watchAndRestart() {
	const (
		initialBackoff = 2 * time.Second
		maxBackoff     = 60 * time.Second
		// If a process survives this long before dying, reset the backoff
		// because the exit is likely a new transient event, not a tight loop.
		healthyThreshold = 30 * time.Second
	)
	backoff := initialBackoff
	startedAt := time.Now()

	for {
		// Wait for the current dns-sd process to exit.
		select {
		case <-b.done:
			return
		case <-b.dnssdExited:
		}

		b.mu.Lock()
		pid := 0
		if b.cmd != nil && b.cmd.Process != nil {
			pid = b.cmd.Process.Pid
		}
		b.mu.Unlock()

		uptime := time.Since(startedAt)
		if uptime >= healthyThreshold {
			backoff = initialBackoff
		}

		slog.Warn("dns-sd broadcast exited, will restart",
			"pid", pid,
			"uptime", uptime.Round(time.Second),
			"backoff", backoff,
		)

		// Wait before restarting.
		select {
		case <-b.done:
			return
		case <-time.After(backoff):
		}

		cmd, exited, err := startDNSSDProcess(b.cfg, b.txt, b.dnsSDPath)
		if err != nil {
			slog.Error("dns-sd restart failed", "err", err, "next_retry", backoff*2)
			backoff = min(backoff*2, maxBackoff)
			// Create a dummy exited channel so the next loop iteration waits
			// for the backoff timer instead of spinning.
			ch := make(chan struct{})
			close(ch)
			b.mu.Lock()
			b.dnssdExited = ch
			b.mu.Unlock()
			continue
		}

		// Check the new process survives the grace period.
		select {
		case <-b.done:
			cmd.Process.Kill()
			return
		case <-exited:
			slog.Warn("dns-sd restarted but exited immediately", "next_retry", backoff*2)
			backoff = min(backoff*2, maxBackoff)
			b.mu.Lock()
			b.dnssdExited = exited
			b.mu.Unlock()
			continue
		case <-time.After(1 * time.Second):
			// Healthy start
		}

		slog.Info("dns-sd broadcast restarted successfully", "pid", cmd.Process.Pid)
		startedAt = time.Now()
		backoff = initialBackoff

		b.mu.Lock()
		b.cmd = cmd
		b.dnssdExited = exited
		b.mu.Unlock()
	}
}

func selectBroadcasterBackend(goos string) (backend string, dnsSDPath string) {
	if !supportsNativeDNSSD(goos) {
		return backendZeroconf, ""
	}

	if path, ok := resolveDNSSDPath(goos); ok {
		return backendDNSSD, path
	}

	return backendZeroconf, ""
}

func supportsNativeDNSSD(goos string) bool {
	return goos == "darwin" || goos == "windows"
}

func resolveDNSSDPath(goos string) (string, bool) {
	if !supportsNativeDNSSD(goos) {
		return "", false
	}

	for _, candidate := range runtimeDNSSDCandidates(goos) {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, true
		}
	}

	if path, err := lookPath("dns-sd"); err == nil {
		return path, true
	}

	for _, candidate := range dnsSDCandidates(goos) {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, true
		}
	}

	return "", false
}

func runtimeDNSSDCandidates(goos string) []string {
	if !supportsNativeDNSSD(goos) {
		return nil
	}

	var candidates []string
	if configuredPath := strings.TrimSpace(os.Getenv(dnsSDPathEnv)); configuredPath != "" {
		candidates = append(candidates, configuredPath)
	}

	if exePath, err := executablePath(); err == nil && strings.TrimSpace(exePath) != "" {
		candidates = append(candidates, filepath.Join(filepath.Dir(exePath), dnsSDExecutableName(goos)))
	}

	return candidates
}

func dnsSDExecutableName(goos string) string {
	if goos == "windows" {
		return "dns-sd.exe"
	}
	return "dns-sd"
}

func dnsSDCandidates(goos string) []string {
	if goos != "windows" {
		return nil
	}

	var candidates []string
	programRoots := []string{
		os.Getenv("ProgramFiles"),
		os.Getenv("ProgramFiles(x86)"),
	}
	for _, root := range programRoots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		candidates = append(candidates,
			filepath.Join(root, "Bonjour", "dns-sd.exe"),
			filepath.Join(root, "Bonjour Print Services", "dns-sd.exe"),
		)
	}
	return candidates
}

func newCrossPlatformBroadcaster(cfg BroadcastConfig, txt []string) (*Broadcaster, error) {
	server, err := registerZeroconfService(cfg, txt)
	if err != nil {
		return nil, fmt.Errorf("zeroconf register: %w", err)
	}

	slog.Info("bonjour broadcasting (zeroconf)",
		"service", serviceType,
		"port", cfg.TCPPort,
		"name", cfg.DeviceName,
		"backend", backendZeroconf,
		"ip", cfg.DeviceIP,
		"host", serviceHostName(cfg),
		"txt", strings.Join(txt, ", "),
	)
	return &Broadcaster{server: server}, nil
}

func registerZeroconfService(cfg BroadcastConfig, txt []string) (*zeroconf.Server, error) {
	return zeroconf.RegisterProxy(
		cfg.DeviceName,
		serviceType,
		serviceDomain,
		cfg.TCPPort,
		serviceHostName(cfg),
		serviceIPs(cfg),
		txt,
		nil,
	)
}

// getLocalIPv4 returns the best-candidate IPv4 address for mDNS advertisement.
//
// Strategy (in order):
//  1. UDP dial trick — ask the OS routing table which source IP it would use
//     to reach an external address.  No packet is actually sent; this reliably
//     returns the IP of the default-route interface (the real LAN adapter)
//     even on machines with many virtual adapters (WSL, Docker, VPN, VMware).
//  2. Scored interface walk — prefer RFC-1918 addresses on physical, multicast-
//     capable interfaces and penalise known virtual adapters.
//  3. Legacy flat scan — simple fallback when net.Interfaces() is unavailable.
func getLocalIPv4() string {
	if ip, ok := routedLocalIPv4(); ok {
		return ip
	}

	ifaces, err := net.Interfaces()
	if err != nil {
		return legacyGetLocalIPv4()
	}

	bestIP := ""
	bestScore := -1000

	for _, iface := range ifaces {
		if !isUsableInterface(iface) {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		ifScore := ifaceScore(iface)
		for _, addr := range addrs {
			ip, ok := addrToIPv4(addr)
			if !ok {
				continue
			}
			score := ifScore + ipAddrScore(ip)
			if score > bestScore {
				bestScore = score
				bestIP = ip.String()
			}
		}
	}

	if bestIP == "" {
		return ""
	}
	if ip := net.ParseIP(bestIP).To4(); ip == nil || !isRFC1918(ip) {
		slog.Debug("getLocalIPv4: rejected non-RFC1918 address", "ip", bestIP)
		return ""
	}

	return bestIP
}

// routedLocalIPv4 asks the OS routing table for the preferred outbound source
// address by performing a UDP "connect" to a well-known external IP.  No
// packet is actually transmitted — the kernel merely selects the source
// interface.  This correctly ignores virtual adapters (WSL, Docker, VMware,
// VPN tunnels) because those are not on the default route.
//
// Results outside RFC-1918 LAN ranges are rejected and cause a fallback to the
// scored interface walk:
//   - 198.18.0.0/15: Apple iCloud Private Relay virtual interface (macOS)
//   - 100.64.0.0/10: CGNAT shared space used by Tailscale, carrier NAT, etc.
func routedLocalIPv4() (string, bool) {
	conn, err := net.Dial("udp4", "8.8.8.8:80")
	if err != nil {
		return "", false
	}
	defer conn.Close()
	addr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok {
		return "", false
	}
	ip4 := addr.IP.To4()
	if ip4 == nil || ip4.IsLoopback() || ip4.IsUnspecified() || ip4.IsLinkLocalUnicast() {
		return "", false
	}
	if isSpecialUseIP(ip4) {
		slog.Debug("routedLocalIPv4: rejected special-use address, falling back to interface walk", "ip", ip4.String())
		return "", false
	}
	if !isRFC1918(ip4) {
		slog.Debug("routedLocalIPv4: rejected non-RFC1918 address, falling back to interface walk", "ip", ip4.String())
		return "", false
	}
	return ip4.String(), true
}

// isSpecialUseIP reports whether ip is in a range that should never be
// advertised as the LAN address for mDNS, even though it may be routable.
//
//	198.18.0.0/15 — RFC 2544 benchmarking; used by Apple iCloud Private Relay
//	100.64.0.0/10 — RFC 6598 shared address space (CGNAT, Tailscale, etc.)
func isSpecialUseIP(ip net.IP) bool {
	for _, block := range []struct {
		network net.IP
		mask    net.IPMask
	}{
		{net.IP{198, 18, 0, 0}, net.IPMask{255, 254, 0, 0}}, // 198.18.0.0/15
		{net.IP{100, 64, 0, 0}, net.IPMask{255, 192, 0, 0}}, // 100.64.0.0/10
	} {
		if ip.Mask(block.mask).Equal(block.network) {
			return true
		}
	}
	return false
}

func isUsableInterface(iface net.Interface) bool {
	return iface.Flags&net.FlagUp != 0 &&
		iface.Flags&net.FlagLoopback == 0 &&
		iface.Flags&net.FlagPointToPoint == 0
}

// ifaceScore returns a score for how suitable an interface is for LAN mDNS.
// Multicast-capable interfaces score higher; known virtual adapters score lower.
func ifaceScore(iface net.Interface) int {
	score := 0
	if iface.Flags&net.FlagMulticast != 0 {
		score += 10
	}
	name := strings.ToLower(iface.Name)
	for _, keyword := range []string{
		"vmware", "virtualbox", "vbox", "docker",
		"vethernet", "hyper-v",
		"utun", "tap", "awdl", "llw",
		"bridge", "pseudo",
	} {
		if strings.Contains(name, keyword) {
			score -= 20
			break
		}
	}
	return score
}

// ipAddrScore prefers RFC-1918 addresses and penalises addresses that iOS ATS
// will not treat as local networking targets for plain HTTP presence checks.
func ipAddrScore(ip net.IP) int {
	if ip.IsLinkLocalUnicast() {
		// 169.254.x.x — APIPA: adapter has no DHCP lease, unreliable for LAN
		return -5
	}
	if isSpecialUseIP(ip) {
		// 198.18/15 (iCloud Private Relay) or 100.64/10 (CGNAT/Tailscale)
		return -10
	}
	if isRFC1918(ip) {
		return 5
	}
	return -20
}

func addrToIPv4(addr net.Addr) (net.IP, bool) {
	ipnet, ok := addr.(*net.IPNet)
	if !ok {
		return nil, false
	}
	ip4 := ipnet.IP.To4()
	if ip4 == nil || ip4.IsLoopback() {
		return nil, false
	}
	return ip4, true
}

func isRFC1918(ip net.IP) bool {
	for _, block := range []struct {
		network net.IP
		mask    net.IPMask
	}{
		{net.IP{10, 0, 0, 0}, net.IPMask{255, 0, 0, 0}},
		{net.IP{172, 16, 0, 0}, net.IPMask{255, 240, 0, 0}},
		{net.IP{192, 168, 0, 0}, net.IPMask{255, 255, 0, 0}},
	} {
		if ip.Mask(block.mask).Equal(block.network) {
			return true
		}
	}
	return false
}

// legacyGetLocalIPv4 is a simple fallback used when net.Interfaces() fails.
func legacyGetLocalIPv4() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		ipnet, ok := addr.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() {
			continue
		}
		if ip4 := ipnet.IP.To4(); ip4 != nil && isRFC1918(ip4) {
			return ip4.String()
		}
	}
	return ""
}

// defaultBonjourServiceAvailable checks whether the Bonjour mDNS responder
// is available on the current platform.  On non-Windows it always returns
// true because macOS ships with mDNSResponder as a system daemon.
// The function is assigned to the bonjourServiceAvailable variable so tests
// can inject a deterministic answer.
func defaultBonjourServiceAvailable() bool {
	if runtime.GOOS != "windows" {
		return true
	}
	out, err := exec.Command("sc", "query", "Bonjour Service").Output()
	if err != nil {
		slog.Debug("windows bonjour service query failed", "err", err)
		return false
	}
	running := strings.Contains(string(out), "RUNNING")
	if !running {
		slog.Warn(
			"Bonjour Service is not running on Windows",
			"fix", "open Services.msc, start 'Bonjour Service', or reinstall Bonjour for Windows",
		)
	}
	return running
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

// Shutdown stops the active Bonjour publisher and its watchdog goroutine.
func (b *Broadcaster) Shutdown() {
	if b == nil {
		return
	}
	// Signal the watchdog to stop before killing the process, so it doesn't
	// attempt a restart while we're shutting down.
	if b.done != nil {
		select {
		case <-b.done:
			// already closed
		default:
			close(b.done)
		}
	}
	if b.server != nil {
		b.server.Shutdown()
	}
	b.mu.Lock()
	cmd := b.cmd
	exited := b.dnssdExited
	b.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		cmd.Process.Kill()
		if exited != nil {
			<-exited
		}
	}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func cleanupStaleBroadcastProcesses() error {
	if runtime.GOOS != "darwin" && runtime.GOOS != "windows" {
		return nil
	}

	out, err := listBroadcastProcesses()
	if err != nil {
		return fmt.Errorf("list processes: %w", err)
	}

	for _, line := range strings.Split(string(out), "\n") {
		pid, ok := parseSyncFlowBroadcastPID(line)
		if !ok {
			continue
		}
		if killErr := terminateBroadcastProcess(pid); killErr != nil {
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
	if !(strings.Contains(command, "dns-sd -R") || strings.Contains(command, "dns-sd.exe -R")) ||
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

func listBroadcastProcesses() ([]byte, error) {
	if runtime.GOOS == "windows" {
		script := `$processes = Get-CimInstance Win32_Process -Filter "Name='dns-sd.exe'" -ErrorAction SilentlyContinue; foreach ($process in $processes) { "$($process.ProcessId) $($process.CommandLine)" }`
		return exec.Command("powershell.exe", "-NoProfile", "-Command", script).Output()
	}

	return exec.Command("ps", "-axo", "pid=,command=").Output()
}

func terminateBroadcastProcess(pid int) error {
	if runtime.GOOS == "windows" {
		return exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F").Run()
	}

	return exec.Command("kill", strconv.Itoa(pid)).Run()
}
