package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/config"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
)

func TestBootstrapReconciliationKeepsCurrentBrandDefaultReceiveRoot(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "Lynavo Drive")
	dbPath := filepath.Join(dataDir, "sidecar.db")
	currentReceiveRoot := filepath.Join(dataDir, "received")

	if err := os.MkdirAll(currentReceiveRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll(currentReceiveRoot): %v", err)
	}
	if err := os.WriteFile(filepath.Join(currentReceiveRoot, "old.txt"), []byte("old"), 0o644); err != nil {
		t.Fatalf("WriteFile current receive file: %v", err)
	}

	st, err := store.New(dbPath)
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer st.Close()

	cfg, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	cfg.ReceiveRoot = currentReceiveRoot
	if err := st.UpdateShareConfig(*cfg); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}

	runtimeConfig := &config.Config{
		DataDir:    dataDir,
		ReceiveDir: currentReceiveRoot,
		DeviceName: "test-device",
	}

	bootstrapReconciliation(st, runtimeConfig)

	updated, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig(updated): %v", err)
	}
	if updated.ReceiveRoot != currentReceiveRoot {
		t.Fatalf("ReceiveRoot = %q, want %q", updated.ReceiveRoot, currentReceiveRoot)
	}
	if runtimeConfig.ReceiveDir != currentReceiveRoot {
		t.Fatalf("runtime ReceiveDir = %q, want %q", runtimeConfig.ReceiveDir, currentReceiveRoot)
	}
	if _, err := os.Stat(filepath.Join(currentReceiveRoot, "old.txt")); err != nil {
		t.Fatalf("expected receive file to remain in current receive root: %v", err)
	}
}

func TestBootstrapReconciliationKeepsStoredPersonalReceiveRoot(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "Lynavo Drive")
	dbPath := filepath.Join(dataDir, "sidecar.db")
	storedReceiveRoot := filepath.Join(dataDir, "personal", "received")
	currentReceiveRoot := filepath.Join(dataDir, "received")

	if err := os.MkdirAll(storedReceiveRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll(storedReceiveRoot): %v", err)
	}
	if err := os.WriteFile(filepath.Join(storedReceiveRoot, "stored.txt"), []byte("stored"), 0o644); err != nil {
		t.Fatalf("WriteFile stored receive file: %v", err)
	}

	st, err := store.New(dbPath)
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer st.Close()

	cfg, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	cfg.ReceiveRoot = storedReceiveRoot
	if err := st.UpdateShareConfig(*cfg); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}

	runtimeConfig := &config.Config{
		DataDir:    dataDir,
		ReceiveDir: currentReceiveRoot,
		DeviceName: "test-device",
	}

	bootstrapReconciliation(st, runtimeConfig)

	updated, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig(updated): %v", err)
	}
	if updated.ReceiveRoot != storedReceiveRoot {
		t.Fatalf("ReceiveRoot = %q, want %q", updated.ReceiveRoot, storedReceiveRoot)
	}
	if runtimeConfig.ReceiveDir != storedReceiveRoot {
		t.Fatalf("runtime ReceiveDir = %q, want %q", runtimeConfig.ReceiveDir, storedReceiveRoot)
	}
	if _, err := os.Stat(filepath.Join(currentReceiveRoot, "stored.txt")); !os.IsNotExist(err) {
		t.Fatalf("expected stored receive file not to be copied into default receive root, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(storedReceiveRoot, "stored.txt")); err != nil {
		t.Fatalf("expected stored receive root file to remain: %v", err)
	}
}

func TestBootstrapReconciliationKeepsCustomReceiveRoot(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "Lynavo Drive")
	dbPath := filepath.Join(dataDir, "sidecar.db")

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(dataDir): %v", err)
	}

	st, err := store.New(dbPath)
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer st.Close()

	cfg, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	cfg.ReceiveRoot = filepath.Join(dir, "custom-received")
	if err := st.UpdateShareConfig(*cfg); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}

	runtimeConfig := &config.Config{
		DataDir:    dataDir,
		ReceiveDir: filepath.Join(dataDir, "received"),
		DeviceName: "test-device",
	}

	bootstrapReconciliation(st, runtimeConfig)

	updated, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig(updated): %v", err)
	}
	if updated.ReceiveRoot != filepath.Join(dir, "custom-received") {
		t.Fatalf("ReceiveRoot = %q, want %q", updated.ReceiveRoot, filepath.Join(dir, "custom-received"))
	}
	if runtimeConfig.ReceiveDir != filepath.Join(dir, "custom-received") {
		t.Fatalf("runtime ReceiveDir = %q, want %q", runtimeConfig.ReceiveDir, filepath.Join(dir, "custom-received"))
	}
}

func TestBootstrapReconciliationKeepsExternalPersonalReceivedCustomRoot(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "Lynavo Drive")
	dbPath := filepath.Join(dataDir, "sidecar.db")
	customReceiveRoot := filepath.Join(dir, "ExternalMedia", "personal", "received")

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(dataDir): %v", err)
	}
	if err := os.MkdirAll(customReceiveRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll(customReceiveRoot): %v", err)
	}

	st, err := store.New(dbPath)
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer st.Close()

	cfg, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	cfg.ReceiveRoot = customReceiveRoot
	if err := st.UpdateShareConfig(*cfg); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}

	runtimeConfig := &config.Config{
		DataDir:    dataDir,
		ReceiveDir: filepath.Join(dataDir, "received"),
		DeviceName: "test-device",
	}

	bootstrapReconciliation(st, runtimeConfig)

	updated, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig(updated): %v", err)
	}
	if updated.ReceiveRoot != customReceiveRoot {
		t.Fatalf("ReceiveRoot = %q, want custom %q", updated.ReceiveRoot, customReceiveRoot)
	}
	if runtimeConfig.ReceiveDir != customReceiveRoot {
		t.Fatalf("runtime ReceiveDir = %q, want custom %q", runtimeConfig.ReceiveDir, customReceiveRoot)
	}
}

func TestEnsureRuntimeDirsCreatesSharedDirAtStartup(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{
		DataDir:    filepath.Join(dir, "Lynavo Drive"),
		ReceiveDir: filepath.Join(dir, "Lynavo Drive", "received"),
		DeviceName: "test-device",
	}

	if err := ensureRuntimeDirs(cfg); err != nil {
		t.Fatalf("ensureRuntimeDirs: %v", err)
	}

	for _, path := range []string{
		cfg.DataDir,
		cfg.ReceiveDir,
		cfg.PersonalDir(),
		cfg.SharedDir(),
		cfg.StagingDir(),
		cfg.LogDir(),
	} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("Stat(%q): %v", path, err)
		}
		if !info.IsDir() {
			t.Fatalf("%q is not a directory", path)
		}
	}
}

func TestEnsureCoreRuntimeDirsSkipsUnavailableStorageRoot(t *testing.T) {
	dir := t.TempDir()
	missingMount := filepath.Join(dir, "MissingExternalDisk")
	cfg := &config.Config{
		DataDir:    filepath.Join(dir, "Lynavo Drive"),
		ReceiveDir: filepath.Join(missingMount, "LynavoDrive", "received"),
		DeviceName: "test-device",
	}

	if err := ensureCoreRuntimeDirs(cfg); err != nil {
		t.Fatalf("ensureCoreRuntimeDirs: %v", err)
	}

	for _, path := range []string{cfg.DataDir, cfg.LogDir()} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("Stat(%q): %v", path, err)
		}
		if !info.IsDir() {
			t.Fatalf("%q is not a directory", path)
		}
	}
	if _, err := os.Stat(missingMount); !os.IsNotExist(err) {
		t.Fatalf("expected missing storage root not to be created, err=%v", err)
	}
}

func TestBonjourShareMetadataIgnoresRemoteAccessSettingInOSS(t *testing.T) {
	dir := t.TempDir()
	st, err := store.New(filepath.Join(dir, "sidecar.db"))
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer st.Close()

	enabled, shareName := bonjourShareMetadata(st)
	if !enabled {
		t.Fatal("default remote access should advertise share enabled")
	}
	if shareName == "" {
		t.Fatal("expected non-empty share name")
	}
	if shareName != "Lynavo Drive" {
		t.Fatalf("shareName = %q, want Lynavo Drive", shareName)
	}

	shareConfig, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	shareConfig.ShareName = "DeskShare"
	if err := st.UpdateShareConfig(*shareConfig); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}
	_, shareName = bonjourShareMetadata(st)
	if shareName != "DeskShare" {
		t.Fatalf("custom shareName = %q, want DeskShare", shareName)
	}

	if err := st.SetSetting("remote_access_enabled", "false"); err != nil {
		t.Fatalf("SetSetting false: %v", err)
	}
	enabled, _ = bonjourShareMetadata(st)
	if !enabled {
		t.Fatal("local LAN share advertisement must remain enabled when remote access is disabled")
	}

	if err := st.SetSetting("remote_access_enabled", "true"); err != nil {
		t.Fatalf("SetSetting true: %v", err)
	}
	enabled, _ = bonjourShareMetadata(st)
	if !enabled {
		t.Fatal("local LAN share advertisement should remain enabled regardless of remote setting")
	}
}

func TestEnsureStorageDirsAtStartupReturnsFalseForUnavailableStorage(t *testing.T) {
	dir := t.TempDir()
	missingMount := filepath.Join(dir, "MissingExternalDisk")
	cfg := &config.Config{
		DataDir:    filepath.Join(dir, "Lynavo Drive"),
		ReceiveDir: filepath.Join(missingMount, "LynavoDrive", "received"),
		DeviceName: "test-device",
	}

	if ready := ensureStorageDirsAtStartup(cfg); ready {
		t.Fatal("expected unavailable storage to return false")
	}
	if _, err := os.Stat(missingMount); !os.IsNotExist(err) {
		t.Fatalf("expected missing storage root not to be created, err=%v", err)
	}
}

func TestShouldRestartBonjourForIPChange(t *testing.T) {
	tests := []struct {
		name         string
		configuredIP string
		advertisedIP string
		currentIP    string
		want         bool
	}{
		{
			name:         "restarts when auto detected IP changes",
			advertisedIP: "192.168.3.224",
			currentIP:    "192.168.155.71",
			want:         true,
		},
		{
			name:         "does not restart when IP is unchanged",
			advertisedIP: "192.168.155.71",
			currentIP:    "192.168.155.71",
			want:         false,
		},
		{
			name:         "respects explicit configured IP",
			configuredIP: "192.168.3.224",
			advertisedIP: "192.168.3.224",
			currentIP:    "192.168.155.71",
			want:         false,
		},
		{
			name:         "ignores empty current IP",
			advertisedIP: "192.168.3.224",
			currentIP:    "",
			want:         false,
		},
		{
			name:      "restarts when current IP appears after empty advertisement",
			currentIP: "192.168.155.71",
			want:      true,
		},
		{
			name:         "trims whitespace",
			advertisedIP: " 192.168.3.224 ",
			currentIP:    " 192.168.155.71 ",
			want:         true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldRestartBonjourForIPChange(tt.configuredIP, tt.advertisedIP, tt.currentIP)
			if got != tt.want {
				t.Fatalf("shouldRestartBonjourForIPChange() = %v, want %v", got, tt.want)
			}
		})
	}
}
