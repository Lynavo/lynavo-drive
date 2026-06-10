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
