package config

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
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

	expectedDataDir := defaultDataDir()
	if cfg.DataDir != expectedDataDir {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, expectedDataDir)
	}

	expectedReceiveDir := filepath.Join(expectedDataDir, "received")
	if cfg.ReceiveDir != expectedReceiveDir {
		t.Errorf("ReceiveDir = %q, want %q", cfg.ReceiveDir, expectedReceiveDir)
	}

	hostname, _ := os.Hostname()
	expectedDeviceName := strings.TrimSuffix(hostname, ".local")
	if cfg.DeviceName != expectedDeviceName {
		t.Errorf("DeviceName = %q, want %q", cfg.DeviceName, expectedDeviceName)
	}
}

func TestSelectDataDirPrefersCurrentBrandDir(t *testing.T) {
	dir := t.TempDir()
	preferredPath := filepath.Join(dir, currentDataDirName)
	legacyPath := filepath.Join(dir, legacyDataDirName)

	if err := os.MkdirAll(preferredPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(preferredPath): %v", err)
	}
	if err := os.MkdirAll(legacyPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(legacyPath): %v", err)
	}

	if got := selectDataDir(preferredPath, legacyPath); got != preferredPath {
		t.Errorf("selectDataDir() = %q, want %q", got, preferredPath)
	}
}

func TestSelectDataDirFallsBackToLegacyDir(t *testing.T) {
	dir := t.TempDir()
	preferredPath := filepath.Join(dir, currentDataDirName)
	legacyPath := filepath.Join(dir, legacyDataDirName)

	if err := os.MkdirAll(legacyPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(legacyPath): %v", err)
	}

	if got := selectDataDir(preferredPath, legacyPath); got != preferredPath {
		t.Errorf("selectDataDir() = %q, want %q", got, preferredPath)
	}
	if !isDir(preferredPath) {
		t.Fatalf("expected preferred path to exist after migration")
	}
	if isDir(legacyPath) {
		t.Fatalf("expected legacy path to be moved to preferred path")
	}
}

func TestSelectDataDirPrefersLegacyWhenPreferredHasFreshDB(t *testing.T) {
	dir := t.TempDir()
	preferredPath := filepath.Join(dir, currentDataDirName)
	legacyPath := filepath.Join(dir, legacyDataDirName)

	if err := os.MkdirAll(preferredPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(preferredPath): %v", err)
	}
	if err := os.MkdirAll(legacyPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(legacyPath): %v", err)
	}
	if err := os.WriteFile(filepath.Join(preferredPath, "sidecar.db"), make([]byte, freshDBMaxBytes), 0o644); err != nil {
		t.Fatalf("WriteFile(preferred sidecar.db): %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyPath, "sidecar.db"), make([]byte, freshDBMaxBytes*4), 0o644); err != nil {
		t.Fatalf("WriteFile(legacy sidecar.db): %v", err)
	}

	if got := selectDataDir(preferredPath, legacyPath); got != preferredPath {
		t.Errorf("selectDataDir() = %q, want %q", got, preferredPath)
	}
	if !isDir(preferredPath + ".pre-legacy-migration") {
		t.Fatalf("expected fresh preferred dir to be backed up before migration")
	}
	if isDir(legacyPath) {
		t.Fatalf("expected legacy path to be moved to preferred path")
	}
}

func TestSelectDataDirPrefersLegacyWhenLegacyHasMeaningfulState(t *testing.T) {
	dir := t.TempDir()
	preferredPath := filepath.Join(dir, currentDataDirName)
	legacyPath := filepath.Join(dir, legacyDataDirName)

	writeSQLiteState(t, preferredPath, sqliteState{
		sessions:      0,
		uploads:       0,
		pairedDevices: 0,
		shareStatus:   "unknown",
	})
	writeSQLiteState(t, legacyPath, sqliteState{
		sessions:      2,
		uploads:       5,
		pairedDevices: 1,
		shareStatus:   "share_registered",
	})

	if got := selectDataDir(preferredPath, legacyPath); got != preferredPath {
		t.Errorf("selectDataDir() = %q, want %q", got, preferredPath)
	}
	if !isDir(preferredPath + ".pre-legacy-migration") {
		t.Fatalf("expected placeholder preferred dir to be backed up before migration")
	}
	if isDir(legacyPath) {
		t.Fatalf("expected legacy path to be moved to preferred path")
	}
}

func TestSelectDataDirKeepsPreferredWhenPreferredHasEstablishedDB(t *testing.T) {
	dir := t.TempDir()
	preferredPath := filepath.Join(dir, currentDataDirName)
	legacyPath := filepath.Join(dir, legacyDataDirName)

	if err := os.MkdirAll(preferredPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(preferredPath): %v", err)
	}
	if err := os.MkdirAll(legacyPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(legacyPath): %v", err)
	}
	if err := os.WriteFile(filepath.Join(preferredPath, "sidecar.db"), make([]byte, freshDBMaxBytes*4), 0o644); err != nil {
		t.Fatalf("WriteFile(preferred sidecar.db): %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyPath, "sidecar.db"), make([]byte, freshDBMaxBytes*2), 0o644); err != nil {
		t.Fatalf("WriteFile(legacy sidecar.db): %v", err)
	}

	if got := selectDataDir(preferredPath, legacyPath); got != preferredPath {
		t.Errorf("selectDataDir() = %q, want %q", got, preferredPath)
	}
}

func TestSelectDataDirKeepsPreferredWhenPreferredHasMeaningfulState(t *testing.T) {
	dir := t.TempDir()
	preferredPath := filepath.Join(dir, currentDataDirName)
	legacyPath := filepath.Join(dir, legacyDataDirName)

	writeSQLiteState(t, preferredPath, sqliteState{
		sessions:      4,
		uploads:       8,
		pairedDevices: 1,
		shareStatus:   "ready",
	})
	writeSQLiteState(t, legacyPath, sqliteState{
		sessions:      0,
		uploads:       0,
		pairedDevices: 0,
		shareStatus:   "unknown",
	})

	if got := selectDataDir(preferredPath, legacyPath); got != preferredPath {
		t.Errorf("selectDataDir() = %q, want %q", got, preferredPath)
	}
}

func TestSelectDataDirDefaultsToCurrentBrandDirWhenMissing(t *testing.T) {
	dir := t.TempDir()
	preferredPath := filepath.Join(dir, currentDataDirName)
	legacyPath := filepath.Join(dir, legacyDataDirName)

	if got := selectDataDir(preferredPath, legacyPath); got != preferredPath {
		t.Errorf("selectDataDir() = %q, want %q", got, preferredPath)
	}
}

type sqliteState struct {
	sessions      int
	uploads       int
	pairedDevices int
	shareStatus   string
}

func writeSQLiteState(t *testing.T, dirPath string, state sqliteState) {
	t.Helper()

	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", dirPath, err)
	}

	db, err := sql.Open("sqlite3", filepath.Join(dirPath, "sidecar.db"))
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()

	for _, stmt := range []string{
		`CREATE TABLE sessions (id INTEGER PRIMARY KEY);`,
		`CREATE TABLE uploads (id INTEGER PRIMARY KEY);`,
		`CREATE TABLE paired_devices (id INTEGER PRIMARY KEY);`,
		`CREATE TABLE share_config (id INTEGER PRIMARY KEY, share_status TEXT NOT NULL);`,
		`INSERT INTO share_config (id, share_status) VALUES (1, '` + state.shareStatus + `');`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("db.Exec(%q): %v", stmt, err)
		}
	}

	insertRows := func(table string, count int) {
		t.Helper()
		for i := 0; i < count; i++ {
			if _, err := db.Exec(`INSERT INTO ` + table + ` DEFAULT VALUES;`); err != nil {
				t.Fatalf("insert into %s: %v", table, err)
			}
		}
	}

	insertRows("sessions", state.sessions)
	insertRows("uploads", state.uploads)
	insertRows("paired_devices", state.pairedDevices)
}
