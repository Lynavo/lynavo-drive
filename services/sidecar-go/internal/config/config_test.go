package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadMissingFileReturnsDefaults(t *testing.T) {
	cfg, err := Load("/tmp/does-not-exist-lynavo.yml")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.HTTPPort != 39594 {
		t.Errorf("HTTPPort = %d, want 39594", cfg.HTTPPort)
	}
	if cfg.TCPPort != 39593 {
		t.Errorf("TCPPort = %d, want 39593", cfg.TCPPort)
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
	cfg := &Config{DataDir: "/tmp/lynavo-test"}
	want := "/tmp/lynavo-test/sidecar.db"
	if got := cfg.DBPath(); got != want {
		t.Errorf("DBPath() = %q, want %q", got, want)
	}
}

func TestStagingDirReturnsCorrectPath(t *testing.T) {
	cfg := &Config{DataDir: "/tmp/lynavo-test"}
	want := "/tmp/lynavo-test/staging"
	if got := cfg.StagingDir(); got != want {
		t.Errorf("StagingDir() = %q, want %q", got, want)
	}
}

func TestStagingDirFollowsCustomReceiveDirVolume(t *testing.T) {
	cfg := &Config{
		DataDir:    filepath.Join("/tmp", "lynavo-test"),
		ReceiveDir: filepath.Join("/tmp", "external", "received"),
	}
	want := filepath.Join("/tmp", "external", "staging")
	if got := cfg.StagingDir(); got != want {
		t.Errorf("StagingDir() = %q, want %q", got, want)
	}
}

func TestManagedLayoutDirsDeriveFromRoot(t *testing.T) {
	root := filepath.Join("/tmp", "lynavo-test")
	cfg := &Config{
		DataDir:    root,
		ReceiveDir: filepath.Join(root, "received"),
	}

	if got := cfg.RootDir(); got != root {
		t.Errorf("RootDir() = %q, want %q", got, root)
	}
	if got := cfg.PersonalDir(); got != filepath.Join(root, "personal") {
		t.Errorf("PersonalDir() = %q", got)
	}
	if got := cfg.SharedDir(); got != filepath.Join(root, "shared") {
		t.Errorf("SharedDir() = %q", got)
	}
	if got := cfg.StagingDir(); got != filepath.Join(root, "staging") {
		t.Errorf("StagingDir() = %q", got)
	}
}

func TestSharedDirUsesRootForManagedReceivePath(t *testing.T) {
	cfg := &Config{
		DataDir:    filepath.Join("/tmp", "lynavo-test"),
		ReceiveDir: filepath.Join("/tmp", "external", "received"),
	}
	want := filepath.Join("/tmp", "external", "shared")
	if got := cfg.SharedDir(); got != want {
		t.Errorf("SharedDir() = %q, want %q", got, want)
	}
}

func TestObsoletePersonalReceiveLayoutDirsDeriveFromOuterRoot(t *testing.T) {
	root := filepath.Join("/tmp", "lynavo-test")
	cfg := &Config{
		DataDir:    root,
		ReceiveDir: filepath.Join(root, "personal", "received"),
	}

	if got := cfg.RootDir(); got != root {
		t.Errorf("RootDir() = %q, want %q", got, root)
	}
	if got := cfg.SharedDir(); got != filepath.Join(root, "shared") {
		t.Errorf("SharedDir() = %q", got)
	}
	if got := cfg.StagingDir(); got != filepath.Join(root, "staging") {
		t.Errorf("StagingDir() = %q", got)
	}
}

func TestPersonalDirIsIndependentFromReceiveDir(t *testing.T) {
	cfg := &Config{
		DataDir:          filepath.Join("/tmp", "lynavo-test"),
		ReceiveDir:       filepath.Join("/tmp", "external", "received"),
		PersonalShareDir: filepath.Join("/tmp", "whole-disk"),
	}
	want := filepath.Join("/tmp", "whole-disk")
	if got := cfg.PersonalDir(); got != want {
		t.Errorf("PersonalDir() = %q, want %q", got, want)
	}

	rel, err := filepath.Rel(cfg.PersonalDir(), cfg.ReceiveDir)
	if err != nil {
		t.Fatalf("Rel(PersonalDir, ReceiveDir): %v", err)
	}
	if rel == "." || (!strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".." && !filepath.IsAbs(rel)) {
		t.Fatalf("ReceiveDir %q should not be implicitly contained in PersonalDir %q", cfg.ReceiveDir, cfg.PersonalDir())
	}
}

func TestDefaultPersonalDirDoesNotExposeManagedReceiveSiblings(t *testing.T) {
	cfg := &Config{
		DataDir:    filepath.Join("/tmp", "lynavo-test"),
		ReceiveDir: filepath.Join("/tmp", "external", "received"),
	}
	siblingPath := filepath.Join(filepath.Dir(cfg.ReceiveDir), "private.txt")
	rel, err := filepath.Rel(cfg.PersonalDir(), siblingPath)
	if err != nil {
		t.Fatalf("Rel(PersonalDir, sibling): %v", err)
	}
	if rel == "." || !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".." && !filepath.IsAbs(rel) {
		t.Fatalf("sibling path %q should not be contained in PersonalDir %q", siblingPath, cfg.PersonalDir())
	}
}

func TestLogDirReturnsCorrectPath(t *testing.T) {
	cfg := &Config{DataDir: "/tmp/lynavo-test"}
	want := "/tmp/lynavo-test/logs"
	if got := cfg.LogDir(); got != want {
		t.Errorf("LogDir() = %q, want %q", got, want)
	}
}

func TestSetDefaultsFillsDataDirReceiveDirDeviceName(t *testing.T) {
	cfg := &Config{}
	cfg.setDefaults()

	expectedDataDir := defaultDataDir()
	if cfg.DataDir != expectedDataDir {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, expectedDataDir)
	}

	expectedReceiveDir := filepath.Join(expectedDataDir, "received")
	if cfg.ReceiveDir != expectedReceiveDir {
		t.Errorf("ReceiveDir = %q, want %q", cfg.ReceiveDir, expectedReceiveDir)
	}
	expectedPersonalShareDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir: %v", err)
	}
	if cfg.PersonalShareDir != expectedPersonalShareDir {
		t.Errorf("PersonalShareDir = %q, want %q", cfg.PersonalShareDir, expectedPersonalShareDir)
	}

	hostname, _ := os.Hostname()
	expectedDeviceName := strings.TrimSuffix(hostname, ".local")
	if cfg.DeviceName != expectedDeviceName {
		t.Errorf("DeviceName = %q, want %q", cfg.DeviceName, expectedDeviceName)
	}
}

func TestDefaultDataDirUsesCurrentBrandDirOnly(t *testing.T) {
	if currentDataDirName != "Lynavo Drive" {
		t.Fatalf("currentDataDirName = %q, want Lynavo Drive", currentDataDirName)
	}

	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(dir, ".config"))

	configDir, err := os.UserConfigDir()
	if err != nil {
		t.Fatalf("UserConfigDir: %v", err)
	}
	want := filepath.Join(configDir, currentDataDirName)
	if got := defaultDataDir(); got != want {
		t.Fatalf("defaultDataDir() = %q, want %q", got, want)
	}
}
