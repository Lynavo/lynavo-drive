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

func TestStagingDirFollowsCustomReceiveDirVolume(t *testing.T) {
	cfg := &Config{
		DataDir:    filepath.Join("/tmp", "syncflow-test"),
		ReceiveDir: filepath.Join("/tmp", "external", "received"),
	}
	want := filepath.Join("/tmp", "external", "staging")
	if got := cfg.StagingDir(); got != want {
		t.Errorf("StagingDir() = %q, want %q", got, want)
	}
}

func TestManagedLayoutDirsDeriveFromRoot(t *testing.T) {
	root := filepath.Join("/tmp", "syncflow-test")
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
		DataDir:    filepath.Join("/tmp", "syncflow-test"),
		ReceiveDir: filepath.Join("/tmp", "external", "received"),
	}
	want := filepath.Join("/tmp", "external", "shared")
	if got := cfg.SharedDir(); got != want {
		t.Errorf("SharedDir() = %q, want %q", got, want)
	}
}

func TestObsoletePersonalReceiveLayoutDirsDeriveFromOuterRoot(t *testing.T) {
	root := filepath.Join("/tmp", "syncflow-test")
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
		DataDir:          filepath.Join("/tmp", "syncflow-test"),
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
		DataDir:    filepath.Join("/tmp", "syncflow-test"),
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

func TestLegacyStagingDirReturnsDataDirStaging(t *testing.T) {
	cfg := &Config{
		DataDir:    filepath.Join("/tmp", "syncflow-test"),
		ReceiveDir: filepath.Join("/tmp", "external", "received"),
	}
	want := filepath.Join("/tmp", "syncflow-test", "staging")
	if got := cfg.LegacyStagingDir(); got != want {
		t.Errorf("LegacyStagingDir() = %q, want %q", got, want)
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
	if cfg.PersonalShareDir != filepath.Join(expectedDataDir, "personal") {
		t.Errorf("PersonalShareDir = %q, want %q", cfg.PersonalShareDir, filepath.Join(expectedDataDir, "personal"))
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
