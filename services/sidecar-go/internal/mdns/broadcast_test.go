package mdns

import (
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
	b := &Broadcaster{cmd: nil}
	// Must not panic.
	b.Shutdown()
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
