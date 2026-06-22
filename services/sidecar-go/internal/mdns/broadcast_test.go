package mdns

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/grandcat/zeroconf"
)

func testConfig() BroadcastConfig {
	return BroadcastConfig{
		DeviceID:     "mac-7fae12c9",
		DeviceName:   "WorkStation-A",
		DeviceType:   "mac",
		DeviceIP:     "192.168.1.10",
		TCPPort:      39393,
		Proto:        2,
		ShareEnabled: true,
		ShareName:    "SyncFlow",
	}
}

func TestBoolToInt(t *testing.T) {
	if got := boolToInt(true); got != 1 {
		t.Errorf("boolToInt(true) = %d, want 1", got)
	}
	if got := boolToInt(false); got != 0 {
		t.Errorf("boolToInt(false) = %d, want 0", got)
	}
}

func TestBuildTXTRecords(t *testing.T) {
	cfg := testConfig()
	txt := BuildTXTRecords(cfg)

	expected := []string{
		"id=mac-7fae12c9",
		"name=WorkStation-A",
		"type=mac",
		"proto=2",
		"auth=code",
		"share=1",
		"shareName=SyncFlow",
		"ip=192.168.1.10",
	}

	if len(txt) != len(expected) {
		t.Fatalf("TXT record count = %d, want %d", len(txt), len(expected))
	}
	for i, want := range expected {
		if txt[i] != want {
			t.Errorf("TXT[%d] = %q, want %q", i, txt[i], want)
		}
	}
}

func TestBuildTXTRecords_ShareDisabled(t *testing.T) {
	cfg := testConfig()
	cfg.ShareEnabled = false

	txt := BuildTXTRecords(cfg)

	// Find the share entry and verify it is "0".
	found := false
	for _, entry := range txt {
		if entry == "share=0" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected share=0 in TXT records when ShareEnabled is false")
	}
}

func TestDeviceTypeForGOOS(t *testing.T) {
	if got := DeviceTypeForGOOS("windows"); got != "win" {
		t.Fatalf("DeviceTypeForGOOS(windows) = %q, want win", got)
	}
	if got := DeviceTypeForGOOS("darwin"); got != "mac" {
		t.Fatalf("DeviceTypeForGOOS(darwin) = %q, want mac", got)
	}
	if got := DeviceTypeForGOOS("linux"); got != "linux" {
		t.Fatalf("DeviceTypeForGOOS(linux) = %q, want linux", got)
	}
}

func TestNewBroadcaster_ValidConfig(t *testing.T) {
	cfg := testConfig()

	// In CI / test environments the broadcast may fail due to network
	// restrictions, so we only verify it does not panic.  If it succeeds we
	// also exercise Shutdown.
	b, err := NewBroadcaster(cfg)
	if err != nil {
		t.Skipf("mDNS registration unavailable in this environment: %v", err)
	}
	defer b.Shutdown()
}

func TestShutdown_NilCmd(t *testing.T) {
	b := &Broadcaster{cmd: nil, server: nil}
	// Must not panic.
	b.Shutdown()
}

func TestShutdown_NilBroadcaster(t *testing.T) {
	var b *Broadcaster
	// Must not panic.
	b.Shutdown()
}

func TestShutdown_WithDnssdExited(t *testing.T) {
	exited := make(chan struct{})
	close(exited) // simulate already-exited dns-sd process
	b := &Broadcaster{cmd: nil, server: nil, dnssdExited: exited}
	// Must not hang or panic.
	b.Shutdown()
}

func TestBonjourServiceAvailable_NonWindows(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test only applies to non-Windows")
	}
	if !defaultBonjourServiceAvailable() {
		t.Fatal("defaultBonjourServiceAvailable() should return true on non-Windows")
	}
}

func TestSelectBroadcasterBackend(t *testing.T) {
	originalLookPath := lookPath
	defer func() { lookPath = originalLookPath }()

	lookPath = func(file string) (string, error) {
		if file != "dns-sd" {
			t.Fatalf("unexpected lookup target %q", file)
		}
		return `C:\Program Files\Bonjour\dns-sd.exe`, nil
	}

	backend, path := selectBroadcasterBackend("windows")
	if backend != backendDNSSD {
		t.Fatalf("backend = %q, want %q", backend, backendDNSSD)
	}
	if path != `C:\Program Files\Bonjour\dns-sd.exe` {
		t.Fatalf("path = %q, want Bonjour dns-sd.exe", path)
	}
}

func TestSelectBroadcasterBackendFallsBackWhenDNSSDUnavailable(t *testing.T) {
	originalLookPath := lookPath
	defer func() { lookPath = originalLookPath }()

	lookPath = func(string) (string, error) {
		return "", os.ErrNotExist
	}

	backend, path := selectBroadcasterBackend("linux")
	if backend != backendZeroconf {
		t.Fatalf("backend = %q, want %q", backend, backendZeroconf)
	}
	if path != "" {
		t.Fatalf("path = %q, want empty", path)
	}
}

func TestResolveDNSSDPathUsesEnvOverride(t *testing.T) {
	originalLookPath := lookPath
	originalExecutablePath := executablePath
	originalEnv := os.Getenv(dnsSDPathEnv)
	defer func() {
		lookPath = originalLookPath
		executablePath = originalExecutablePath
		_ = os.Setenv(dnsSDPathEnv, originalEnv)
	}()

	tempDir := t.TempDir()
	overridePath := tempDir + `\dns-sd.exe`
	if err := os.WriteFile(overridePath, []byte("test"), 0o644); err != nil {
		t.Fatalf("WriteFile() failed: %v", err)
	}

	lookPath = func(string) (string, error) {
		return "", os.ErrNotExist
	}
	executablePath = func() (string, error) {
		return "", os.ErrNotExist
	}
	if err := os.Setenv(dnsSDPathEnv, overridePath); err != nil {
		t.Fatalf("Setenv() failed: %v", err)
	}

	path, ok := resolveDNSSDPath("windows")
	if !ok {
		t.Fatal("expected env override to resolve dns-sd path")
	}
	if path != overridePath {
		t.Fatalf("path = %q, want %q", path, overridePath)
	}
}

func TestResolveDNSSDPathUsesAdjacentExecutable(t *testing.T) {
	originalLookPath := lookPath
	originalExecutablePath := executablePath
	originalEnv := os.Getenv(dnsSDPathEnv)
	defer func() {
		lookPath = originalLookPath
		executablePath = originalExecutablePath
		_ = os.Setenv(dnsSDPathEnv, originalEnv)
	}()

	tempDir := t.TempDir()
	adjacentPath := filepath.Join(tempDir, "dns-sd.exe")
	if err := os.WriteFile(adjacentPath, []byte("test"), 0o644); err != nil {
		t.Fatalf("WriteFile() failed: %v", err)
	}

	lookPath = func(string) (string, error) {
		return "", os.ErrNotExist
	}
	executablePath = func() (string, error) {
		return filepath.Join(tempDir, "syncflow-sidecar.exe"), nil
	}
	if err := os.Unsetenv(dnsSDPathEnv); err != nil {
		t.Fatalf("Unsetenv() failed: %v", err)
	}

	path, ok := resolveDNSSDPath("windows")
	if !ok {
		t.Fatal("expected adjacent executable directory to resolve dns-sd path")
	}
	if path != adjacentPath {
		t.Fatalf("path = %q, want %q", path, adjacentPath)
	}
}

func TestSupportsNativeDNSSD(t *testing.T) {
	if !supportsNativeDNSSD("darwin") {
		t.Fatal("expected darwin to support dns-sd")
	}
	if !supportsNativeDNSSD("windows") {
		t.Fatal("expected windows to support dns-sd")
	}
	if supportsNativeDNSSD("linux") {
		t.Fatal("expected linux to fall back to zeroconf")
	}
}

func TestServiceHostName(t *testing.T) {
	want := sanitizeHostName(mustHostname(t))
	if got := serviceHostName(BroadcastConfig{
		DeviceID:   "Windows Dev-01",
		DeviceName: "Ignored Name",
	}); got != want {
		t.Fatalf("serviceHostName() = %q, want %q", got, want)
	}
}

func mustHostname(t *testing.T) string {
	t.Helper()
	host, err := os.Hostname()
	if err != nil {
		t.Fatalf("os.Hostname() failed: %v", err)
	}
	return host
}

func sanitizeHostName(base string) string {
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

func TestServiceIPs(t *testing.T) {
	if got := serviceIPs(BroadcastConfig{}); got != nil {
		t.Fatalf("serviceIPs() = %#v, want nil", got)
	}

	got := serviceIPs(BroadcastConfig{DeviceIP: "192.168.1.10"})
	if len(got) != 1 || got[0] != "192.168.1.10" {
		t.Fatalf("serviceIPs() = %#v, want [192.168.1.10]", got)
	}
}

func TestParseSyncFlowBroadcastPID(t *testing.T) {
	pid, ok := parseSyncFlowBroadcastPID("29320 dns-sd -R bloomingdeMacBook-Pro-Online _syncflow._tcp local. 39393 id=abc")
	if !ok {
		t.Fatal("expected syncflow dns-sd process to match")
	}
	if pid != 29320 {
		t.Fatalf("pid = %d, want 29320", pid)
	}
}

func TestParseSyncFlowBroadcastPID_WindowsCommandLine(t *testing.T) {
	line := `6576 C:\dev\SyncFlow\apps\desktop\resources\dns-sd.exe -R PS2021DFYQCEAF _syncflow._tcp local. 39393 id=c16752f3-c01d name=PS2021DFYQCEAF type=win proto=2 auth=code share=0 shareName=SyncFlow ip=192.168.0.1`
	pid, ok := parseSyncFlowBroadcastPID(line)
	if !ok {
		t.Fatal("expected Windows syncflow dns-sd process to match")
	}
	if pid != 6576 {
		t.Fatalf("pid = %d, want 6576", pid)
	}
}

func TestIsRFC1918(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
	}{
		{"10.0.0.1", true},
		{"10.255.255.255", true},
		{"172.16.0.1", true},
		{"172.31.255.255", true},
		{"172.32.0.1", false},
		{"172.168.20.3", false},
		{"192.168.1.100", true},
		{"192.168.255.255", true},
		{"8.8.8.8", false},
		{"169.254.1.1", false},
	}
	for _, tc := range cases {
		ip := net.ParseIP(tc.ip).To4()
		if ip == nil {
			t.Fatalf("invalid IP in test: %s", tc.ip)
		}
		if got := isRFC1918(ip); got != tc.want {
			t.Errorf("isRFC1918(%s) = %v, want %v", tc.ip, got, tc.want)
		}
	}
}

func TestIPAddrScore(t *testing.T) {
	cases := []struct {
		ip        string
		wantAbove int // score must be > wantAbove
	}{
		{"192.168.1.1", 0},  // RFC1918 → positive score
		{"10.0.0.1", 0},     // RFC1918 → positive score
		{"169.254.1.1", -6}, // APIPA → negative score
	}
	for _, tc := range cases {
		ip := net.ParseIP(tc.ip).To4()
		if ip == nil {
			t.Fatalf("invalid IP: %s", tc.ip)
		}
		score := ipAddrScore(ip)
		if score <= tc.wantAbove {
			t.Errorf("ipAddrScore(%s) = %d, want > %d", tc.ip, score, tc.wantAbove)
		}
	}
	// APIPA must score strictly below any RFC1918 address
	apipa := net.ParseIP("169.254.1.1").To4()
	rfc := net.ParseIP("192.168.1.1").To4()
	if ipAddrScore(apipa) >= ipAddrScore(rfc) {
		t.Error("APIPA score must be lower than RFC1918 score")
	}
}

func TestIPAddrScore_PublicAddressPenalised(t *testing.T) {
	publicIP := net.ParseIP("172.168.20.3").To4()
	rfc1918IP := net.ParseIP("172.16.21.43").To4()
	if publicIP == nil || rfc1918IP == nil {
		t.Fatal("invalid IP in test")
	}
	if ipAddrScore(publicIP) >= ipAddrScore(rfc1918IP) {
		t.Fatalf("public address score must be lower than RFC1918")
	}
	if ipAddrScore(publicIP) >= 0 {
		t.Fatalf("public address score must be negative")
	}
}

func TestIsSpecialUseIP(t *testing.T) {
	cases := []struct {
		ip      string
		special bool
	}{
		{"198.18.0.1", true},      // iCloud Private Relay lower bound
		{"198.19.255.255", true},  // iCloud Private Relay upper bound
		{"198.20.0.1", false},     // just outside the block
		{"100.64.0.1", true},      // CGNAT/Tailscale lower bound
		{"100.127.255.255", true}, // CGNAT upper bound
		{"100.128.0.1", false},    // just outside
		{"192.168.1.1", false},    // RFC 1918 — not special-use
		{"10.0.0.1", false},       // RFC 1918 — not special-use
		{"8.8.8.8", false},        // public IP
	}
	for _, tc := range cases {
		ip := net.ParseIP(tc.ip).To4()
		if ip == nil {
			t.Fatalf("invalid IP: %s", tc.ip)
		}
		if got := isSpecialUseIP(ip); got != tc.special {
			t.Errorf("isSpecialUseIP(%s) = %v, want %v", tc.ip, got, tc.special)
		}
	}
}

func TestIPAddrScore_SpecialUsePenalised(t *testing.T) {
	specialIPs := []string{"198.18.0.1", "100.64.0.1"}
	rfc1918IP := net.ParseIP("192.168.1.1").To4()
	for _, s := range specialIPs {
		ip := net.ParseIP(s).To4()
		if ip == nil {
			t.Fatalf("invalid IP: %s", s)
		}
		if ipAddrScore(ip) >= ipAddrScore(rfc1918IP) {
			t.Errorf("special-use %s score must be lower than RFC1918 score", s)
		}
	}
}

func TestIfaceScore_VirtualPenalised(t *testing.T) {
	virtualNames := []string{
		"vEthernet (Default Switch)", // Hyper-V
		"VMware Network Adapter VMnet1",
		"docker0",
		"VirtualBox Host-Only Network",
		"utun0",
		"awdl0",
	}
	for _, name := range virtualNames {
		iface := net.Interface{
			Name:  name,
			Flags: net.FlagUp | net.FlagMulticast,
		}
		if score := ifaceScore(iface); score >= 10 {
			t.Errorf("ifaceScore(%q) = %d, expected < 10 (penalised as virtual)", name, score)
		}
	}
}

func TestIfaceScore_PhysicalFavoured(t *testing.T) {
	physical := net.Interface{
		Name:  "Ethernet",
		Flags: net.FlagUp | net.FlagMulticast,
	}
	if score := ifaceScore(physical); score < 10 {
		t.Errorf("ifaceScore(Ethernet) = %d, expected >= 10", score)
	}
}

func TestGetLocalIPv4_ReturnsNonEmpty(t *testing.T) {
	ip := getLocalIPv4()
	if ip == "" {
		t.Skip("no suitable IPv4 address found in test environment")
	}
	if net.ParseIP(ip) == nil {
		t.Errorf("getLocalIPv4() = %q is not a valid IP", ip)
	}
	if net.ParseIP(ip).IsLoopback() {
		t.Errorf("getLocalIPv4() = %q must not be loopback", ip)
	}
}

// TestRoutedLocalIPv4 verifies that routedLocalIPv4 returns a non-loopback
// IPv4 address.  It is skipped in environments without a default route
// (e.g. some CI containers).
func TestRoutedLocalIPv4(t *testing.T) {
	ip, ok := routedLocalIPv4()
	if !ok {
		t.Skip("no default route available in this environment")
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		t.Fatalf("routedLocalIPv4() = %q is not a valid IP", ip)
	}
	if parsed.IsLoopback() {
		t.Errorf("routedLocalIPv4() = %q must not be loopback", ip)
	}
	if parsed.IsUnspecified() {
		t.Errorf("routedLocalIPv4() = %q must not be unspecified", ip)
	}
}

func TestParseSyncFlowBroadcastPID_IgnoresOtherProcesses(t *testing.T) {
	cases := []string{
		"",
		"29320 /Applications/Other.app/Contents/MacOS/Other",
		"29320 dns-sd -R some-service _other._tcp local. 12345",
		"not-a-pid dns-sd -R bloom _syncflow._tcp local. 39393",
	}

	for _, input := range cases {
		if _, ok := parseSyncFlowBroadcastPID(input); ok {
			t.Fatalf("expected %q to be ignored", input)
		}
	}
}

// ---------------------------------------------------------------------------
// Integration tests — require multicast-capable network; Skip when unavailable
// ---------------------------------------------------------------------------

// TestNewBroadcaster_BonjourServiceDown verifies that when the Bonjour Service
// is reported as not running, NewBroadcaster skips dns-sd entirely and produces
// a working zeroconf broadcaster that is discoverable on the network.
func TestNewBroadcaster_BonjourServiceDown(t *testing.T) {
	origAvail := bonjourServiceAvailable
	origLookPath := lookPath
	origExecPath := executablePath
	origEnv := os.Getenv(dnsSDPathEnv)
	defer func() {
		bonjourServiceAvailable = origAvail
		lookPath = origLookPath
		executablePath = origExecPath
		_ = os.Setenv(dnsSDPathEnv, origEnv)
	}()

	// Simulate: dns-sd binary exists but Bonjour Service is down.
	fakeDir := t.TempDir()
	fakeDNSSD := filepath.Join(fakeDir, dnsSDExecutableName(runtime.GOOS))
	if err := os.WriteFile(fakeDNSSD, []byte("fake"), 0o755); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	_ = os.Setenv(dnsSDPathEnv, fakeDNSSD)
	lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	executablePath = func() (string, error) { return "", os.ErrNotExist }
	bonjourServiceAvailable = func() bool { return false } // Bonjour Service down

	cfg := BroadcastConfig{
		DeviceID:   "test-svc-down",
		DeviceName: "BonjourDownTest",
		DeviceType: "win",
		DeviceIP:   "192.168.1.10",
		TCPPort:    39393,
		Proto:      2,
		ShareName:  "TestDrop",
	}

	b, err := NewBroadcaster(cfg)
	if err != nil {
		t.Skipf("zeroconf unavailable: %v", err)
	}
	defer b.Shutdown()

	// Must use zeroconf, not dns-sd
	if b.server == nil {
		t.Fatal("expected zeroconf server when Bonjour Service is down")
	}
	if b.cmd != nil {
		t.Fatal("expected no dns-sd process when Bonjour Service is down")
	}

	// Service must be discoverable via mDNS browse
	entry := browseForService(t, cfg.DeviceName, 5*time.Second)
	if entry == nil {
		t.Skip("service not discoverable via multicast in this environment")
	}

	// TXT records must be intact
	txtMap := parseTXTMap(entry.Text)
	assertTXT(t, txtMap, "id", cfg.DeviceID)
	assertTXT(t, txtMap, "name", cfg.DeviceName)
	assertTXT(t, txtMap, "type", "win")
	assertTXT(t, txtMap, "ip", cfg.DeviceIP)
	assertTXT(t, txtMap, "proto", "2")
	assertTXT(t, txtMap, "auth", "code")
}

// TestZeroconfBroadcast_Discoverable verifies that RegisterProxy produces a
// service discoverable via mDNS browse with correct TXT records and port.
func TestZeroconfBroadcast_Discoverable(t *testing.T) {
	cfg := BroadcastConfig{
		DeviceID:     "test-discover-id",
		DeviceName:   "DiscoverTest",
		DeviceType:   "win",
		DeviceIP:     "192.168.1.42",
		TCPPort:      39393,
		Proto:        2,
		ShareEnabled: true,
		ShareName:    "TestDrop",
	}
	txt := BuildTXTRecords(cfg)

	b, err := newCrossPlatformBroadcaster(cfg, txt)
	if err != nil {
		t.Skipf("zeroconf registration unavailable: %v", err)
	}
	defer b.Shutdown()

	entry := browseForService(t, cfg.DeviceName, 5*time.Second)
	if entry == nil {
		t.Skip("service not discoverable via multicast in this environment")
	}

	// Port
	if entry.Port != cfg.TCPPort {
		t.Errorf("port = %d, want %d", entry.Port, cfg.TCPPort)
	}

	// All TXT fields
	txtMap := parseTXTMap(entry.Text)
	wantTXT := map[string]string{
		"id":        cfg.DeviceID,
		"name":      cfg.DeviceName,
		"type":      "win",
		"ip":        cfg.DeviceIP,
		"proto":     "2",
		"auth":      "code",
		"share":     "1",
		"shareName": cfg.ShareName,
	}
	for key, want := range wantTXT {
		assertTXT(t, txtMap, key, want)
	}
}

// TestWatchdog_RestartsAfterKill verifies that the watchdog goroutine restarts
// the dns-sd process after it is killed.  This is an integration test that
// requires a real dns-sd binary (macOS or Windows with Bonjour installed).
func TestWatchdog_RestartsAfterKill(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("watchdog integration test requires macOS dns-sd")
	}

	cfg := BroadcastConfig{
		DeviceID:   "watchdog-test",
		DeviceName: "WatchdogTest",
		DeviceType: "mac",
		DeviceIP:   "192.168.1.99",
		TCPPort:    39399, // avoid conflict with a running sidecar
		Proto:      2,
		ShareName:  "WatchdogTest",
	}

	b, err := NewBroadcaster(cfg)
	if err != nil {
		t.Skipf("mDNS registration unavailable: %v", err)
	}
	defer b.Shutdown()

	// Must be a dns-sd broadcaster with a running process.
	b.mu.Lock()
	if b.cmd == nil || b.cmd.Process == nil {
		b.mu.Unlock()
		t.Skip("broadcaster did not use dns-sd backend in this environment")
	}
	originalPID := b.cmd.Process.Pid
	b.mu.Unlock()

	// Kill the dns-sd process to trigger the watchdog.
	if err := b.cmd.Process.Kill(); err != nil {
		t.Fatalf("failed to kill dns-sd: %v", err)
	}

	// Wait for the watchdog to restart (initial backoff is 2s + 1s grace).
	deadline := time.After(10 * time.Second)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	restarted := false
	for !restarted {
		select {
		case <-deadline:
			t.Fatal("watchdog did not restart dns-sd within timeout")
		case <-ticker.C:
			b.mu.Lock()
			if b.cmd != nil && b.cmd.Process != nil && b.cmd.Process.Pid != originalPID {
				restarted = true
			}
			b.mu.Unlock()
		}
	}
}

// TestShutdown_StopsWatchdog verifies that Shutdown stops a running watchdog
// without deadlocking, even when the dns-sd process has already exited.
func TestShutdown_StopsWatchdog(t *testing.T) {
	exited := make(chan struct{})
	close(exited) // simulate an already-exited process

	b := &Broadcaster{
		cmd:         nil,
		dnssdExited: exited,
		done:        make(chan struct{}),
		dnsSDPath:   "/nonexistent",
		cfg:         testConfig(),
		txt:         BuildTXTRecords(testConfig()),
	}

	// Start the watchdog — it will try to restart but fail because the
	// dnsSDPath doesn't exist.  Shutdown must stop it cleanly.
	go b.watchAndRestart()

	// Give the watchdog a moment to enter its loop.
	time.Sleep(100 * time.Millisecond)

	done := make(chan struct{})
	go func() {
		b.Shutdown()
		close(done)
	}()

	select {
	case <-done:
		// Shutdown completed without deadlock
	case <-time.After(5 * time.Second):
		t.Fatal("Shutdown deadlocked with active watchdog")
	}
}

// --- helpers ---------------------------------------------------------------

func browseForService(t *testing.T, instanceName string, timeout time.Duration) *zeroconf.ServiceEntry {
	t.Helper()
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	entries := make(chan *zeroconf.ServiceEntry, 10)
	go func() { _ = resolver.Browse(ctx, serviceType, serviceDomain, entries) }()
	for {
		select {
		case entry := <-entries:
			if entry != nil && entry.Instance == instanceName {
				return entry
			}
		case <-ctx.Done():
			return nil
		}
	}
}

func parseTXTMap(records []string) map[string]string {
	m := make(map[string]string, len(records))
	for _, r := range records {
		if k, v, ok := strings.Cut(r, "="); ok {
			m[k] = v
		}
	}
	return m
}

func assertTXT(t *testing.T, txtMap map[string]string, key, want string) {
	t.Helper()
	if got := txtMap[key]; got != want {
		t.Errorf("TXT[%q] = %q, want %q", key, got, want)
	}
}
