package store_test

import (
	"path/filepath"
	"testing"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
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

func TestRecordPairingFailureBlocksOnThirdWrongCode(t *testing.T) {
	st := newPairingSecurityStore(t)
	meta := store.PairingClientMetadata{
		ClientID:        "phone-a",
		DesktopDeviceID: "desktop-1",
		ClientName:      "Nick iPhone",
		Platform:        "ios",
		IP:              "192.168.1.20",
	}

	for attempt := 1; attempt <= 2; attempt++ {
		result, err := st.RecordPairingFailure(meta, 3)
		if err != nil {
			t.Fatalf("RecordPairingFailure attempt %d: %v", attempt, err)
		}
		if result.Blocked {
			t.Fatalf("attempt %d should not block", attempt)
		}
		if result.FailedAttempts != attempt {
			t.Fatalf("attempt %d failed count = %d", attempt, result.FailedAttempts)
		}
		if result.RemainingAttempts != 3-attempt {
			t.Fatalf("attempt %d remaining = %d", attempt, result.RemainingAttempts)
		}
	}

	result, err := st.RecordPairingFailure(meta, 3)
	if err != nil {
		t.Fatalf("RecordPairingFailure third: %v", err)
	}
	if !result.Blocked || result.FailedAttempts != 3 || result.RemainingAttempts != 0 {
		t.Fatalf("unexpected third result: %+v", result)
	}

	block, err := st.GetActivePairingBlock("phone-a", "desktop-1")
	if err != nil {
		t.Fatalf("GetActivePairingBlock: %v", err)
	}
	if block == nil || block.FailedAttempts != 3 || block.Reason != "wrong_connection_code_limit" {
		t.Fatalf("unexpected block: %+v", block)
	}
}

func TestRecordPairingFailureRejectsNonPositiveMaxAttemptsWithoutSideEffects(t *testing.T) {
	st := newPairingSecurityStore(t)
	meta := store.PairingClientMetadata{
		ClientID:        "phone-a",
		DesktopDeviceID: "desktop-1",
		ClientName:      "Nick iPhone",
		Platform:        "ios",
		IP:              "192.168.1.20",
	}

	if _, err := st.RecordPairingFailure(meta, 0); err == nil {
		t.Fatal("expected RecordPairingFailure to reject non-positive max attempts")
	}

	block, err := st.GetActivePairingBlock("phone-a", "desktop-1")
	if err != nil {
		t.Fatalf("GetActivePairingBlock: %v", err)
	}
	if block != nil {
		t.Fatalf("expected no active block, got %+v", block)
	}

	for tableName, query := range map[string]string{
		"pairing_attempts":    "SELECT count(*) FROM pairing_attempts WHERE client_id = ? AND desktop_device_id = ?",
		"pairing_rate_limits": "SELECT count(*) FROM pairing_rate_limits WHERE client_id = ? AND desktop_device_id = ?",
	} {
		var count int
		if err := st.DB().QueryRow(query, "phone-a", "desktop-1").Scan(&count); err != nil {
			t.Fatalf("count %s: %v", tableName, err)
		}
		if count != 0 {
			t.Fatalf("expected no %s side effects, got %d row(s)", tableName, count)
		}
	}
}

func TestPairingBlockScopeIsClientAndDesktop(t *testing.T) {
	st := newPairingSecurityStore(t)
	for i := 0; i < 3; i++ {
		_, err := st.RecordPairingFailure(store.PairingClientMetadata{
			ClientID:        "phone-a",
			DesktopDeviceID: "desktop-1",
			ClientName:      "Nick iPhone",
			Platform:        "ios",
		}, 3)
		if err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	if block, _ := st.GetActivePairingBlock("phone-a", "desktop-1"); block == nil {
		t.Fatal("expected phone-a to be blocked on desktop-1")
	}
	if block, _ := st.GetActivePairingBlock("phone-a", "desktop-2"); block != nil {
		t.Fatal("did not expect phone-a to be blocked on desktop-2")
	}
	if block, _ := st.GetActivePairingBlock("phone-b", "desktop-1"); block != nil {
		t.Fatal("did not expect phone-b to be blocked on desktop-1")
	}
}

func TestClearPairingBlockClearsRateLimitButDoesNotAuthorize(t *testing.T) {
	st := newPairingSecurityStore(t)
	meta := store.PairingClientMetadata{ClientID: "phone-a", DesktopDeviceID: "desktop-1", ClientName: "Nick iPhone"}
	for i := 0; i < 3; i++ {
		if _, err := st.RecordPairingFailure(meta, 3); err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	if err := st.ClearPairingBlock("phone-a", "desktop-1"); err != nil {
		t.Fatalf("ClearPairingBlock: %v", err)
	}
	if block, _ := st.GetActivePairingBlock("phone-a", "desktop-1"); block != nil {
		t.Fatal("expected active block to be cleared")
	}

	result, err := st.RecordPairingFailure(meta, 3)
	if err != nil {
		t.Fatalf("RecordPairingFailure after clear: %v", err)
	}
	if result.FailedAttempts != 1 || result.Blocked {
		t.Fatalf("expected rate limit to restart after clear, got %+v", result)
	}

	if _, err := st.GetPairedDevice("phone-a"); err == nil {
		t.Fatal("clearing a block must not authorize a device")
	}
}

func TestPairingManagementListsActiveRowsAndRecentAttempts(t *testing.T) {
	st := newPairingSecurityStore(t)
	now := "2026-06-10T01:00:00Z"
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "phone-a",
		ClientName:       "Nick iPhone",
		Platform:         "ios",
		PairingID:        "pairing-a",
		PairingTokenHash: "hash-a",
		CreatedAt:        now,
		LastSeenAt:       now,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "phone-c",
		ClientName:       "Recent iPhone",
		Platform:         "ios",
		PairingID:        "pairing-c",
		PairingTokenHash: "hash-c",
		CreatedAt:        "2026-06-10T01:30:00Z",
		LastSeenAt:       "2026-06-10T02:00:00Z",
	}); err != nil {
		t.Fatalf("UpsertPairedDevice recent: %v", err)
	}
	revokedAt := "2026-06-10T03:00:00Z"
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "phone-revoked",
		ClientName:       "Revoked Phone",
		Platform:         "ios",
		PairingID:        "pairing-revoked",
		PairingTokenHash: "hash-revoked",
		CreatedAt:        "2026-06-10T01:45:00Z",
		LastSeenAt:       "2026-06-10T03:00:00Z",
		RevokedAt:        &revokedAt,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice revoked: %v", err)
	}
	if err := st.RecordPairingAttempt(store.PairingClientMetadata{
		ClientID:        "phone-b",
		DesktopDeviceID: "desktop-1",
		ClientName:      "Blocked Phone",
		Platform:        "android",
		IP:              "192.168.1.30",
	}, store.PairingAttemptBlocked, "PAIRING_CLIENT_BLOCKED"); err != nil {
		t.Fatalf("RecordPairingAttempt: %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := st.RecordPairingFailure(store.PairingClientMetadata{
			ClientID:        "phone-b",
			DesktopDeviceID: "desktop-1",
			ClientName:      "Blocked Phone",
			Platform:        "android",
			IP:              "192.168.1.30",
		}, 3); err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	authorized, err := st.ListAuthorizedDevices()
	if err != nil {
		t.Fatalf("ListAuthorizedDevices: %v", err)
	}
	if len(authorized) != 2 {
		t.Fatalf("unexpected authorized list: %+v", authorized)
	}
	if authorized[0].ClientID != "phone-c" || authorized[1].ClientID != "phone-a" {
		t.Fatalf("authorized devices are not ordered by last_seen_at DESC: %+v", authorized)
	}
	for _, device := range authorized {
		if device.ClientID == "phone-revoked" {
			t.Fatalf("authorized devices must not include revoked devices: %+v", authorized)
		}
	}

	blocked, err := st.ListBlockedPairingClients()
	if err != nil {
		t.Fatalf("ListBlockedPairingClients: %v", err)
	}
	if len(blocked) != 1 || blocked[0].ClientID != "phone-b" {
		t.Fatalf("unexpected blocked list: %+v", blocked)
	}

	attemptsStore := newPairingSecurityStore(t)
	insertAttempt := func(clientID string, clientName *string, createdAt string) {
		t.Helper()
		var name any
		if clientName != nil {
			name = *clientName
		}
		if _, err := attemptsStore.DB().Exec(
			`INSERT INTO pairing_attempts (
				client_id,
				desktop_device_id,
				client_name,
				device_alias,
				platform,
				stable_device_id,
				ip,
				result,
				failure_reason,
				created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			clientID,
			"desktop-1",
			name,
			nil,
			nil,
			nil,
			nil,
			store.PairingAttemptWrongCode,
			nil,
			createdAt,
		); err != nil {
			t.Fatalf("insert pairing attempt %s: %v", clientID, err)
		}
	}

	newerName := "Newest Phone"
	sameTimestampName := "Same Timestamp Phone"
	insertAttempt("phone-old", nil, "2026-06-10T00:00:00Z")
	insertAttempt("phone-same-time", &sameTimestampName, "2026-06-10T01:00:00Z")
	insertAttempt("phone-newest", &newerName, "2026-06-10T01:00:00Z")

	attempts, err := attemptsStore.ListRecentPairingAttempts(50)
	if err != nil {
		t.Fatalf("ListRecentPairingAttempts: %v", err)
	}
	if len(attempts) != 3 {
		t.Fatalf("expected recent attempts, got %+v", attempts)
	}
	if attempts[0].ClientID != "phone-newest" || attempts[1].ClientID != "phone-same-time" || attempts[2].ClientID != "phone-old" {
		t.Fatalf("recent attempts are not ordered by created_at DESC, id DESC: %+v", attempts)
	}
	if attempts[0].ClientName == nil || *attempts[0].ClientName != "Newest Phone" {
		t.Fatalf("expected nullable client_name to scan, got %+v", attempts[0].ClientName)
	}
	if attempts[2].ClientName != nil {
		t.Fatalf("expected empty metadata to scan as nil, got %+v", attempts[2].ClientName)
	}

	limitedAttempts, err := attemptsStore.ListRecentPairingAttempts(1)
	if err != nil {
		t.Fatalf("ListRecentPairingAttempts limit 1: %v", err)
	}
	if len(limitedAttempts) != 1 || limitedAttempts[0].ClientID != "phone-newest" {
		t.Fatalf("expected limit 1 to return newest attempt, got %+v", limitedAttempts)
	}

	defaultLimitAttempts, err := attemptsStore.ListRecentPairingAttempts(0)
	if err != nil {
		t.Fatalf("ListRecentPairingAttempts default limit: %v", err)
	}
	if len(defaultLimitAttempts) != 3 {
		t.Fatalf("expected default limit to include available attempts, got %+v", defaultLimitAttempts)
	}
}
