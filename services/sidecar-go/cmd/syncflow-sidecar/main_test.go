package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/store"
)

func TestBootstrapReconciliationUpdatesLegacyDefaultReceiveRoot(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "Vivi Drop")
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
	cfg.ReceiveRoot = filepath.Join(dir, "小豹闪传", "received")
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
	if updated.ReceiveRoot != filepath.Join(dataDir, "received") {
		t.Fatalf("ReceiveRoot = %q, want %q", updated.ReceiveRoot, filepath.Join(dataDir, "received"))
	}
	if runtimeConfig.ReceiveDir != filepath.Join(dataDir, "received") {
		t.Fatalf("runtime ReceiveDir = %q, want %q", runtimeConfig.ReceiveDir, filepath.Join(dataDir, "received"))
	}
}

func TestBootstrapReconciliationKeepsCurrentBrandDefaultReceiveRoot(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "Vivi Drop")
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

func TestBootstrapReconciliationMovesObsoletePersonalReceiveRoot(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "Vivi Drop")
	dbPath := filepath.Join(dataDir, "sidecar.db")
	obsoleteReceiveRoot := filepath.Join(dataDir, "personal", "received")
	currentReceiveRoot := filepath.Join(dataDir, "received")

	if err := os.MkdirAll(obsoleteReceiveRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll(obsoleteReceiveRoot): %v", err)
	}
	if err := os.WriteFile(filepath.Join(obsoleteReceiveRoot, "old.txt"), []byte("old"), 0o644); err != nil {
		t.Fatalf("WriteFile obsolete receive file: %v", err)
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
	cfg.ReceiveRoot = obsoleteReceiveRoot
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
		t.Fatalf("expected receive file to move into current receive root: %v", err)
	}
	if _, err := os.Stat(obsoleteReceiveRoot); !os.IsNotExist(err) {
		t.Fatalf("expected obsolete receive root to be removed, err=%v", err)
	}
}

func TestBootstrapReconciliationKeepsCustomReceiveRoot(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "Vivi Drop")
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

func TestEnsureRuntimeDirsCreatesSharedDirAtStartup(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{
		DataDir:    filepath.Join(dir, "Vivi Drop"),
		ReceiveDir: filepath.Join(dir, "Vivi Drop", "received"),
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
		DataDir:    filepath.Join(dir, "Vivi Drop"),
		ReceiveDir: filepath.Join(missingMount, "ViviDrop", "received"),
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
		DataDir:    filepath.Join(dir, "Vivi Drop"),
		ReceiveDir: filepath.Join(missingMount, "ViviDrop", "received"),
		DeviceName: "test-device",
	}

	if ready := ensureStorageDirsAtStartup(cfg); ready {
		t.Fatal("expected unavailable storage to return false")
	}
	if _, err := os.Stat(missingMount); !os.IsNotExist(err) {
		t.Fatalf("expected missing storage root not to be created, err=%v", err)
	}
}

func TestCleanupLegacyStagingDirRemovesObsoletePartFiles(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{
		DataDir:    filepath.Join(dir, "Vivi Drop"),
		ReceiveDir: filepath.Join(dir, "external", "received"),
		DeviceName: "test-device",
	}

	legacyStaging := cfg.LegacyStagingDir()
	if err := os.MkdirAll(legacyStaging, 0o755); err != nil {
		t.Fatalf("MkdirAll(legacyStaging): %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyStaging, "old.part"), []byte("partial"), 0o644); err != nil {
		t.Fatalf("WriteFile(old.part): %v", err)
	}

	if err := ensureRuntimeDirs(cfg); err != nil {
		t.Fatalf("ensureRuntimeDirs: %v", err)
	}
	activeStaging := cfg.StagingDir()
	if activeStaging == legacyStaging {
		t.Fatalf("test setup expected distinct staging dirs")
	}

	if err := cleanupLegacyStagingDir(cfg); err != nil {
		t.Fatalf("cleanupLegacyStagingDir: %v", err)
	}

	if _, err := os.Stat(legacyStaging); !os.IsNotExist(err) {
		t.Fatalf("expected legacy staging to be removed, stat err=%v", err)
	}
	if info, err := os.Stat(activeStaging); err != nil || !info.IsDir() {
		t.Fatalf("expected active staging to remain, info=%v err=%v", info, err)
	}
}

func TestCleanupLegacyStagingDirSkipsActiveStaging(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{
		DataDir:    filepath.Join(dir, "Vivi Drop"),
		ReceiveDir: filepath.Join(dir, "Vivi Drop", "received"),
		DeviceName: "test-device",
	}

	if err := ensureRuntimeDirs(cfg); err != nil {
		t.Fatalf("ensureRuntimeDirs: %v", err)
	}
	partPath := filepath.Join(cfg.StagingDir(), "active.part")
	if err := os.WriteFile(partPath, []byte("partial"), 0o644); err != nil {
		t.Fatalf("WriteFile(active.part): %v", err)
	}

	if err := cleanupLegacyStagingDir(cfg); err != nil {
		t.Fatalf("cleanupLegacyStagingDir: %v", err)
	}

	if _, err := os.Stat(partPath); err != nil {
		t.Fatalf("expected active staging part to remain: %v", err)
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
