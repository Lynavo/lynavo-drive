package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissingFileReturnsDefaults(t *testing.T) {
	cfg, err := Load("/tmp/does-not-exist-syncflow.yml")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.HTTPPort != 39394 {
		t.Errorf("HTTPPort = %d, want 39394", cfg.HTTPPort)
	}
	if cfg.TCPPort != 39393 {
		t.Errorf("TCPPort = %d, want 39393", cfg.TCPPort)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want \"info\"", cfg.LogLevel)
	}
	if cfg.LowDiskThresholdBytes != 500*1024*1024 {
		t.Errorf("LowDiskThresholdBytes = %d, want %d", cfg.LowDiskThresholdBytes, 500*1024*1024)
	}
}

func TestLoadValidYAMLOverridesValues(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.yml")
	content := []byte(`http_port: 8080
tcp_port: 9090
log_level: "debug"
low_disk_threshold_bytes: 1000000
`)
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.HTTPPort != 8080 {
		t.Errorf("HTTPPort = %d, want 8080", cfg.HTTPPort)
	}
	if cfg.TCPPort != 9090 {
		t.Errorf("TCPPort = %d, want 9090", cfg.TCPPort)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want \"debug\"", cfg.LogLevel)
	}
	if cfg.LowDiskThresholdBytes != 1000000 {
		t.Errorf("LowDiskThresholdBytes = %d, want 1000000", cfg.LowDiskThresholdBytes)
	}
}

func TestDBPathReturnsCorrectPath(t *testing.T) {
	cfg := &Config{DataDir: "/tmp/syncflow-test"}
	want := "/tmp/syncflow-test/sidecar.db"
	if got := cfg.DBPath(); got != want {
		t.Errorf("DBPath() = %q, want %q", got, want)
	}
}

func TestStagingDirReturnsCorrectPath(t *testing.T) {
	cfg := &Config{DataDir: "/tmp/syncflow-test"}
	want := "/tmp/syncflow-test/staging"
	if got := cfg.StagingDir(); got != want {
		t.Errorf("StagingDir() = %q, want %q", got, want)
	}
}

func TestLogDirReturnsCorrectPath(t *testing.T) {
	cfg := &Config{DataDir: "/tmp/syncflow-test"}
	want := "/tmp/syncflow-test/logs"
	if got := cfg.LogDir(); got != want {
		t.Errorf("LogDir() = %q, want %q", got, want)
	}
}

func TestSetDefaultsFillsDataDirReceiveDirDeviceName(t *testing.T) {
	cfg := &Config{}
	cfg.setDefaults()

	home, _ := os.UserHomeDir()
	expectedDataDir := filepath.Join(home, "Library", "Application Support", "SyncFlow")
	if cfg.DataDir != expectedDataDir {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, expectedDataDir)
	}

	expectedReceiveDir := filepath.Join(expectedDataDir, "received")
	if cfg.ReceiveDir != expectedReceiveDir {
		t.Errorf("ReceiveDir = %q, want %q", cfg.ReceiveDir, expectedReceiveDir)
	}

	hostname, _ := os.Hostname()
	if cfg.DeviceName != hostname {
		t.Errorf("DeviceName = %q, want %q", cfg.DeviceName, hostname)
	}
}
