package store_test

import (
	"path/filepath"
	"testing"

	"github.com/nicksyncflow/sidecar/internal/store"
)

func newPairingSecurityStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.New(filepath.Join(t.TempDir(), "sidecar.db"))
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestPairingSecurityMigrationCreatesTablesAndIndexes(t *testing.T) {
	st := newPairingSecurityStore(t)

	for _, tableName := range []string{"pairing_attempts", "pairing_rate_limits", "blocked_pairing_clients"} {
		var count int
		if err := st.DB().QueryRow(
			"SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
			tableName,
		).Scan(&count); err != nil {
			t.Fatalf("query table %s: %v", tableName, err)
		}
		if count != 1 {
			t.Fatalf("expected table %s to exist", tableName)
		}
	}

	for _, indexName := range []string{
		"blocked_pairing_clients_active_unique",
		"pairing_attempts_recent_idx",
		"pairing_attempts_client_desktop_idx",
	} {
		var count int
		if err := st.DB().QueryRow(
			"SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = ?",
			indexName,
		).Scan(&count); err != nil {
			t.Fatalf("query index %s: %v", indexName, err)
		}
		if count != 1 {
			t.Fatalf("expected index %s to exist", indexName)
		}
	}
}

func TestBlockedPairingClientsActiveUniqueAllowsHistoricalClearedRows(t *testing.T) {
	st := newPairingSecurityStore(t)

	insertBlockedClient := func(blockedAt string, clearedAt *string) error {
		t.Helper()
		_, err := st.DB().Exec(
			`INSERT INTO blocked_pairing_clients (
				client_id,
				desktop_device_id,
				client_name,
				device_alias,
				platform,
				stable_device_id,
				last_ip,
				failed_attempts,
				blocked_at,
				last_attempt_at,
				reason,
				cleared_at,
				cleared_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			"client-a",
			"desktop-a",
			"iPhone",
			"Daily Phone",
			"ios",
			"stable-device-a",
			"192.168.1.20",
			5,
			blockedAt,
			blockedAt,
			"wrong_code_limit",
			clearedAt,
			nil,
		)
		return err
	}

	if err := insertBlockedClient("2026-06-10T09:00:00Z", nil); err != nil {
		t.Fatalf("insert active block: %v", err)
	}

	if err := insertBlockedClient("2026-06-10T09:01:00Z", nil); err == nil {
		t.Fatalf("expected duplicate active block to fail")
	}

	clearedAt := "2026-06-10T09:02:00Z"
	if err := insertBlockedClient("2026-06-10T08:00:00Z", &clearedAt); err != nil {
		t.Fatalf("insert historical cleared block: %v", err)
	}
}
