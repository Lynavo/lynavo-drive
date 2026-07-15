package store

import (
	"os"
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("New(%q): %v", dbPath, err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestNew_CreatesDB(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Close()

	// DB file should exist on disk
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Fatal("expected db file to exist")
	}
}

func TestNew_AllTablesExist(t *testing.T) {
	s := newTestStore(t)

	expectedTables := []string{
		"settings",
		"paired_devices",
		"sessions",
		"uploads",
		"device_daily_stats",
		"share_config",
		"device_blocks",
		"connection_attempts",
		"shared_resources",
		"access_records",
	}

	for _, table := range expectedTables {
		var name string
		err := s.db.QueryRow(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?", table,
		).Scan(&name)
		if err != nil {
			t.Errorf("table %q not found: %v", table, err)
		}
	}
}

func TestNew_SeedsExist(t *testing.T) {
	s := newTestStore(t)

	// connection_code should be seeded
	code, err := s.GetConnectionCode()
	if err != nil {
		t.Fatalf("GetConnectionCode: %v", err)
	}
	if code != "000000" {
		t.Errorf("expected connection_code '000000', got %q", code)
	}

	// device_id should be seeded (non-empty, pattern like xxxx-xxxx)
	id, err := s.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	if len(id) == 0 {
		t.Error("expected device_id to be non-empty")
	}

	// share_config should be seeded
	cfg, err := s.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	if cfg.ShareName != "Lynavo Drive" {
		t.Errorf("expected share_name 'Lynavo Drive', got %q", cfg.ShareName)
	}
	if cfg.ShareStatus != "unknown" {
		t.Errorf("expected share_status 'unknown', got %q", cfg.ShareStatus)
	}
}

func TestClose(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}
