package mdns

import (
	"os"
	"strings"
	"testing"
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
	adjacentPath := tempDir + `\dns-sd.exe`
	if err := os.WriteFile(adjacentPath, []byte("test"), 0o644); err != nil {
		t.Fatalf("WriteFile() failed: %v", err)
	}

	lookPath = func(string) (string, error) {
		return "", os.ErrNotExist
	}
	executablePath = func() (string, error) {
		return tempDir + `\syncflow-sidecar.exe`, nil
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
