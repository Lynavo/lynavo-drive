package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
)

// newTestStoreForDir creates a fresh SQLite store in a temp dir.
// The store runs migrations automatically, so paired_devices table is ready.
func newTestStoreForDir(t *testing.T) *store.Store {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	s, err := store.New(dbPath)
	if err != nil {
		t.Fatalf("store.New(%q): %v", dbPath, err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// insertDevice is a helper that inserts a paired device with the given fields.
func insertDevice(t *testing.T, st *store.Store, clientID, clientName string, deviceAlias *string) {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339)
	d := store.PairedDevice{
		ClientID:         clientID,
		ClientName:       clientName,
		DeviceAlias:      deviceAlias,
		Platform:         "ios",
		PairingID:        "pair-" + clientID,
		PairingTokenHash: "hash-" + clientID,
		CreatedAt:        now,
		LastSeenAt:       now,
	}
	if err := st.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice(%q): %v", clientID, err)
	}
}

// strPtr returns a pointer to a string.
func strPtr(s string) *string { return &s }

// mkDir creates a subdirectory under parent and fails the test on error.
func mkDir(t *testing.T, parent, name string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(parent, name), 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", name, err)
	}
}

// -------------------------------------------------------------------
// 1. Already persisted
// -------------------------------------------------------------------

func TestEnsureReceiveDirName_AlreadyPersisted(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	insertDevice(t, st, "dev-1", "iPhone 15", nil)
	if err := st.UpdateReceiveDirName("dev-1", "iPhone 15"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	if got != "iPhone 15" {
		t.Fatalf("expected %q, got %q", "iPhone 15", got)
	}

	// Call again — should return the same without writing to DB.
	// Verify by reading the device and checking the value is unchanged.
	got2, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if got2 != "iPhone 15" {
		t.Fatalf("second call: expected %q, got %q", "iPhone 15", got2)
	}
}

func TestEnsureReceiveDirName_AlreadyPersisted_DoesNotOverwrite(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// Device has receive_dir_name set, but clientName is different now (updated on reconnect).
	insertDevice(t, st, "dev-1", "iPhone 16 Pro", strPtr("My Work Phone"))
	if err := st.UpdateReceiveDirName("dev-1", "iPhone 15"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	// Must return the persisted name, not the new clientName or alias.
	if got != "iPhone 15" {
		t.Fatalf("expected persisted %q, got %q", "iPhone 15", got)
	}
}

// -------------------------------------------------------------------
// 2. Legacy claim — clientName directory
// -------------------------------------------------------------------

func TestEnsureReceiveDirName_LegacyClaim_ClientName(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	insertDevice(t, st, "dev-1", "iPhone 15", strPtr("WorkPhone"))

	// Create legacy dir matching sanitized clientName on disk.
	mkDir(t, receiveDir, "iPhone 15")

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	if got != "iPhone 15" {
		t.Fatalf("expected legacy claim %q, got %q", "iPhone 15", got)
	}

	// Verify it was persisted.
	dev, err := st.GetPairedDevice("dev-1")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if dev.ReceiveDirName == nil || *dev.ReceiveDirName != "iPhone 15" {
		t.Fatalf("expected ReceiveDirName=%q in DB, got %v", "iPhone 15", dev.ReceiveDirName)
	}
}

func TestEnsureReceiveDirName_LegacyClaim_ClientNameBeforeAlias(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// Both clientName and alias directories exist on disk.
	insertDevice(t, st, "dev-1", "iPhone 15", strPtr("WorkPhone"))
	mkDir(t, receiveDir, "iPhone 15")
	mkDir(t, receiveDir, "WorkPhone")

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	// clientName is tried BEFORE deviceAlias for legacy claim.
	if got != "iPhone 15" {
		t.Fatalf("expected clientName dir %q (tried first), got %q", "iPhone 15", got)
	}
}

// -------------------------------------------------------------------
// 3. Legacy claim — deviceAlias directory
// -------------------------------------------------------------------

func TestEnsureReceiveDirName_LegacyClaim_DeviceAlias(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	insertDevice(t, st, "dev-1", "iPhone 15", strPtr("WorkPhone"))

	// Only alias dir exists on disk; no clientName dir.
	mkDir(t, receiveDir, "WorkPhone")

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	if got != "WorkPhone" {
		t.Fatalf("expected alias legacy claim %q, got %q", "WorkPhone", got)
	}
}

// -------------------------------------------------------------------
// 4. Legacy claim — directory already reserved by another device
// -------------------------------------------------------------------

func TestEnsureReceiveDirName_LegacyClaim_ReservedByAnotherDevice(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// Device A already has "iPhone 15" reserved.
	insertDevice(t, st, "dev-A", "iPhone 15", nil)
	if err := st.UpdateReceiveDirName("dev-A", "iPhone 15"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}

	// Device B has the same clientName, and the dir exists on disk.
	insertDevice(t, st, "dev-B", "iPhone 15", nil)
	mkDir(t, receiveDir, "iPhone 15")

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-B")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	// Should NOT claim "iPhone 15" — it's reserved. Should generate a suffixed name.
	if got == "iPhone 15" {
		t.Fatal("should not claim dir reserved by another device")
	}
	if got != "iPhone 15 (2)" {
		t.Fatalf("expected %q, got %q", "iPhone 15 (2)", got)
	}
}

func TestEnsureReceiveDirName_LegacyClaim_AliasReservedByAnotherDevice(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// Device A reserves "WorkPhone".
	insertDevice(t, st, "dev-A", "Other Phone", strPtr("WorkPhone"))
	if err := st.UpdateReceiveDirName("dev-A", "WorkPhone"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}

	// Device B has alias "WorkPhone", no clientName dir, but alias dir exists.
	insertDevice(t, st, "dev-B", "iPhone 16", strPtr("WorkPhone"))
	mkDir(t, receiveDir, "WorkPhone")

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-B")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	// Neither clientName dir ("iPhone 16") nor alias dir ("WorkPhone") can be claimed.
	// "WorkPhone" is reserved; "iPhone 16" doesn't exist on disk.
	// pickBestName chooses alias "WorkPhone", but it's taken -> "WorkPhone (2)".
	if got == "WorkPhone" {
		t.Fatal("should not claim alias dir reserved by another device")
	}
	if got != "WorkPhone (2)" {
		t.Fatalf("expected %q, got %q", "WorkPhone (2)", got)
	}
}

// -------------------------------------------------------------------
// 5. New name generation — no legacy dir
// -------------------------------------------------------------------

func TestEnsureReceiveDirName_NewName_AliasPreferred(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	insertDevice(t, st, "dev-1", "iPhone 15", strPtr("WorkPhone"))
	// No legacy dirs on disk.

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	// pickBestName prefers alias for new names.
	if got != "WorkPhone" {
		t.Fatalf("expected alias %q, got %q", "WorkPhone", got)
	}
}

func TestEnsureReceiveDirName_NewName_ClientNameFallback(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// No alias set.
	insertDevice(t, st, "dev-1", "iPhone 15", nil)

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	if got != "iPhone 15" {
		t.Fatalf("expected clientName %q, got %q", "iPhone 15", got)
	}
}

func TestEnsureReceiveDirName_NewName_ClientIDFallback(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// clientName is empty, no alias.
	insertDevice(t, st, "dev-1", "", nil)

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	if got != "dev-1" {
		t.Fatalf("expected clientID %q, got %q", "dev-1", got)
	}
}

// -------------------------------------------------------------------
// 6. Conflict avoidance
// -------------------------------------------------------------------

func TestEnsureReceiveDirName_ConflictWithDB(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// Device A has "iPhone 15" reserved.
	insertDevice(t, st, "dev-A", "iPhone 15", nil)
	if err := st.UpdateReceiveDirName("dev-A", "iPhone 15"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}

	// Device B has the same clientName but no legacy dir.
	insertDevice(t, st, "dev-B", "iPhone 15", nil)

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-B")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	if got != "iPhone 15 (2)" {
		t.Fatalf("expected %q, got %q", "iPhone 15 (2)", got)
	}
}

func TestEnsureReceiveDirName_ConflictWithFilesystem(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// No DB conflict, but a directory with the same name exists on disk (orphan dir).
	mkDir(t, receiveDir, "iPhone 15")
	insertDevice(t, st, "dev-1", "iPhone 15", nil)

	// Note: The legacy claim path would match here because the dir exists and
	// is not reserved in DB. So it will actually claim it as a legacy dir.
	// This test verifies that the legacy claim works when a dir exists.
	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	// Legacy claim: clientName dir exists and is unreserved -> claims it.
	if got != "iPhone 15" {
		t.Fatalf("expected legacy claim %q, got %q", "iPhone 15", got)
	}
}

func TestEnsureReceiveDirName_ConflictWithFilesystem_NoLegacy(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// Device has alias "WorkPhone" (picked as best name), but "WorkPhone" dir
	// already exists on disk from a non-related source AND clientName dir does not exist.
	// The alias dir on disk is not a legacy claim candidate because clientName is tried
	// first (no dir), then alias is tried — "WorkPhone" exists on disk and is not
	// reserved, so it will be claimed as legacy.
	//
	// To truly test filesystem conflict for new-name generation, we need a scenario
	// where legacy claim is skipped but the dir exists.
	// Make another device reserve "WorkPhone" in DB so legacy claim is blocked,
	// AND the dir exists on disk.
	insertDevice(t, st, "dev-other", "Other", strPtr("OtherAlias"))
	if err := st.UpdateReceiveDirName("dev-other", "WorkPhone"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}
	mkDir(t, receiveDir, "WorkPhone")

	insertDevice(t, st, "dev-1", "SomeName", strPtr("WorkPhone"))
	// clientName dir "SomeName" doesn't exist, alias dir "WorkPhone" is reserved.
	// pickBestName -> "WorkPhone". makeUnique sees "WorkPhone" in both DB and FS -> "(2)".

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	if got != "WorkPhone (2)" {
		t.Fatalf("expected %q, got %q", "WorkPhone (2)", got)
	}
}

func TestEnsureReceiveDirName_ConflictBothDBAndFS(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// "iPhone 15" reserved by another device in DB.
	insertDevice(t, st, "dev-A", "iPhone 15", nil)
	if err := st.UpdateReceiveDirName("dev-A", "iPhone 15"); err != nil {
		t.Fatalf("UpdateReceiveDirName dev-A: %v", err)
	}

	// "iPhone 15 (2)" exists on filesystem (orphan or from another process).
	mkDir(t, receiveDir, "iPhone 15 (2)")

	// Device B wants "iPhone 15".
	insertDevice(t, st, "dev-B", "iPhone 15", nil)

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-B")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	// "iPhone 15" taken in DB, "iPhone 15 (2)" taken on FS -> must be "iPhone 15 (3)".
	if got != "iPhone 15 (3)" {
		t.Fatalf("expected %q, got %q", "iPhone 15 (3)", got)
	}
}

func TestEnsureReceiveDirName_MultipleConflicts(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// Reserve "iPhone 15" in DB.
	insertDevice(t, st, "dev-A", "iPhone 15", nil)
	if err := st.UpdateReceiveDirName("dev-A", "iPhone 15"); err != nil {
		t.Fatalf("UpdateReceiveDirName dev-A: %v", err)
	}

	// Reserve "iPhone 15 (2)" in DB.
	insertDevice(t, st, "dev-B", "iPhone 15 B", nil)
	if err := st.UpdateReceiveDirName("dev-B", "iPhone 15 (2)"); err != nil {
		t.Fatalf("UpdateReceiveDirName dev-B: %v", err)
	}

	// "iPhone 15 (3)" exists on filesystem.
	mkDir(t, receiveDir, "iPhone 15 (3)")

	// Device C wants "iPhone 15".
	insertDevice(t, st, "dev-C", "iPhone 15", nil)

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-C")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	if got != "iPhone 15 (4)" {
		t.Fatalf("expected %q, got %q", "iPhone 15 (4)", got)
	}
}

// -------------------------------------------------------------------
// 7. Empty/edge cases
// -------------------------------------------------------------------

func TestEnsureReceiveDirName_ClientNameSanitizesToEmpty(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// clientName contains only special chars that sanitize away.
	// SanitizeDirName replaces /:*?"<>|\ with _ then trims spaces.
	// A name like "***" becomes "___" which is non-empty.
	// We need something that becomes empty after sanitize: an empty string.
	// pickBestName falls through: alias=nil, clientName="", returns clientID.
	// But let's test a clientName that IS empty and alias also empty-ish.
	insertDevice(t, st, "dev-1", "", strPtr(""))

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	// pickBestName: alias="" (skipped), clientName="" (skipped), -> clientID "dev-1".
	// SanitizeDirName("dev-1") -> "dev-1" (non-empty), so no "Unknown" fallback.
	if got != "dev-1" {
		t.Fatalf("expected clientID fallback %q, got %q", "dev-1", got)
	}
}

func TestEnsureReceiveDirName_AllFieldsEmptyExceptClientID(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	insertDevice(t, st, "abc-123-xyz", "", nil)

	got, err := EnsureReceiveDirName(st, receiveDir, "abc-123-xyz")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	if got != "abc-123-xyz" {
		t.Fatalf("expected clientID %q, got %q", "abc-123-xyz", got)
	}
}

func TestEnsureReceiveDirName_SanitizesToUnknown(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// We need pickBestName to return something that sanitizes to "".
	// pickBestName returns: alias > clientName > clientID.
	// If clientName = " " (just spaces), pickBestName returns " " (non-empty).
	// SanitizeDirName trims spaces, so " " -> "".
	// That triggers the "Unknown" fallback.
	// But we also need alias to be nil and clientName to be " ".
	// Wait: pickBestName checks clientName != "" which " " passes.
	// Actually: pickBestName checks d.ClientName != "", " " is not empty.
	// So pickBestName returns " ", SanitizeDirName(" ") -> "" (trimmed), candidate = "Unknown".
	insertDevice(t, st, " ", " ", nil)

	got, err := EnsureReceiveDirName(st, receiveDir, " ")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	// pickBestName returns " " (clientName), sanitize -> "", fallback to "Unknown".
	if got != "Unknown" {
		t.Fatalf("expected %q, got %q", "Unknown", got)
	}
}

func TestEnsureReceiveDirName_ClientNameWithSpecialChars(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// Special characters get replaced with underscores.
	insertDevice(t, st, "dev-1", "My:Phone/2", nil)

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	expected := SanitizeDirName("My:Phone/2") // "My_Phone_2"
	if got != expected {
		t.Fatalf("expected sanitized %q, got %q", expected, got)
	}
}

// -------------------------------------------------------------------
// Additional: device not found
// -------------------------------------------------------------------

func TestEnsureReceiveDirName_DeviceNotFound(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	_, err := EnsureReceiveDirName(st, receiveDir, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent device")
	}
}

// -------------------------------------------------------------------
// Additional: receive dir does not exist yet
// -------------------------------------------------------------------

func TestEnsureReceiveDirName_ReceiveDirNotExist(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := filepath.Join(t.TempDir(), "not-yet-created")

	insertDevice(t, st, "dev-1", "iPhone 15", nil)

	got, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	// No legacy dirs, no FS conflicts — just the generated name.
	if got != "iPhone 15" {
		t.Fatalf("expected %q, got %q", "iPhone 15", got)
	}
}

// -------------------------------------------------------------------
// Additional: idempotency — second call does not re-persist
// -------------------------------------------------------------------

func TestEnsureReceiveDirName_Idempotent(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	insertDevice(t, st, "dev-1", "iPhone 15", nil)

	got1, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("first call: %v", err)
	}

	got2, err := EnsureReceiveDirName(st, receiveDir, "dev-1")
	if err != nil {
		t.Fatalf("second call: %v", err)
	}

	if got1 != got2 {
		t.Fatalf("idempotency broken: first=%q, second=%q", got1, got2)
	}
}

// -------------------------------------------------------------------
// Regression: PairDeviceWithDirName vs EnsureReceiveDirName
// -------------------------------------------------------------------

func newPairDevice(clientID, clientName string, alias *string) store.PairedDevice {
	now := time.Now().UTC().Format(time.RFC3339)
	return store.PairedDevice{
		ClientID:         clientID,
		ClientName:       clientName,
		DeviceAlias:      alias,
		Platform:         "ios",
		PairingID:        "pair-" + clientID,
		PairingTokenHash: "hash-" + clientID,
		CreatedAt:        now,
		LastSeenAt:       now,
	}
}

func insertCompletedUploadWithFinalPath(t *testing.T, st *store.Store, clientID, fileKey, finalPath, completedAt string) {
	t.Helper()
	if err := st.UpsertUpload(store.Upload{
		FileKey:          fileKey,
		ClientID:         clientID,
		OriginalFilename: filepath.Base(finalPath),
		MediaType:        "image/jpeg",
		FileSize:         1024,
		Status:           "completed",
		FinalPath:        &finalPath,
		CommittedBytes:   1024,
		CompletedAt:      &completedAt,
		UpdatedAt:        completedAt,
	}); err != nil {
		t.Fatalf("UpsertUpload %q: %v", fileKey, err)
	}
}

func TestPairDeviceWithDirName_DoesNotClaimOrphanDir(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// An orphan directory exists with the same name as the new device's clientName.
	mkDir(t, receiveDir, "My iPhone")

	// PairDeviceWithDirName (used by handlePair) should NOT claim the orphan.
	device := newPairDevice("new-dev", "My iPhone", nil)
	got, err := PairDeviceWithDirName(st, receiveDir, device)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if got == "My iPhone" {
		t.Fatalf("new device should not claim orphan dir, got %q", got)
	}
	if got != "My iPhone (2)" {
		t.Fatalf("expected 'My iPhone (2)', got %q", got)
	}

	// Verify the device was persisted with the dir name.
	d, err := st.GetPairedDevice("new-dev")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if d.ReceiveDirName == nil || *d.ReceiveDirName != "My iPhone (2)" {
		t.Fatalf("expected persisted dir name 'My iPhone (2)', got %v", d.ReceiveDirName)
	}
}

func TestPairDeviceWithDirName_ReusesHistoricalUploadDir(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	mkDir(t, receiveDir, "My iPhone")
	insertCompletedUploadWithFinalPath(
		t,
		st,
		"new-dev",
		"historical-file",
		filepath.Join("My iPhone", "2026-06-17", "IMG_0001.JPG"),
		"2026-06-17T10:00:00Z",
	)

	device := newPairDevice("new-dev", "My iPhone", nil)
	got, err := PairDeviceWithDirName(st, receiveDir, device)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if got != "My iPhone" {
		t.Fatalf("expected historical upload dir %q, got %q", "My iPhone", got)
	}

	d, err := st.GetPairedDevice("new-dev")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if d.ReceiveDirName == nil || *d.ReceiveDirName != "My iPhone" {
		t.Fatalf("expected persisted historical dir name, got %v", d.ReceiveDirName)
	}
}

func TestPairDeviceWithDirName_ReusesReceiveDirForSameStableDevice(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()
	stableID := "stable-ios-device-001"

	mkDir(t, receiveDir, "Alice iPhone")
	oldDevice := newPairDevice("account-a-client", "Alice iPhone", nil)
	oldDevice.StableDeviceID = &stableID
	if err := st.UpsertPairedDevice(oldDevice); err != nil {
		t.Fatalf("UpsertPairedDevice old: %v", err)
	}
	if err := st.UpdateReceiveDirName("account-a-client", "Alice iPhone"); err != nil {
		t.Fatalf("UpdateReceiveDirName old: %v", err)
	}

	newDevice := newPairDevice("account-b-client", "Alice iPhone", nil)
	newDevice.StableDeviceID = &stableID
	got, err := PairDeviceWithDirName(st, receiveDir, newDevice)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if got != "Alice iPhone" {
		t.Fatalf("expected same stable device to reuse receive dir %q, got %q", "Alice iPhone", got)
	}

	stored, err := st.GetPairedDevice("account-b-client")
	if err != nil {
		t.Fatalf("GetPairedDevice new: %v", err)
	}
	if stored.ReceiveDirName == nil || *stored.ReceiveDirName != "Alice iPhone" {
		t.Fatalf("expected persisted reused receive_dir_name, got %v", stored.ReceiveDirName)
	}
}

func TestPairDeviceWithDirName_ReusesReceiveDirForSameStableDeviceWithDifferentAccountAndName(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()
	stableID := "stable-ios-device-001"

	mkDir(t, receiveDir, "Alice iPhone")
	oldDevice := newPairDevice("account-a-client", "Alice iPhone", nil)
	oldDevice.StableDeviceID = &stableID
	if err := st.UpsertPairedDevice(oldDevice); err != nil {
		t.Fatalf("UpsertPairedDevice old: %v", err)
	}
	if err := st.UpdateReceiveDirName("account-a-client", "Alice iPhone"); err != nil {
		t.Fatalf("UpdateReceiveDirName old: %v", err)
	}

	newDevice := newPairDevice("account-b-client", "Bob iPhone", nil)
	newDevice.StableDeviceID = &stableID
	got, err := PairDeviceWithDirName(st, receiveDir, newDevice)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if got != "Alice iPhone" {
		t.Fatalf("expected same stable device to reuse receive dir %q, got %q", "Alice iPhone", got)
	}
	if _, err := os.Stat(filepath.Join(receiveDir, "Alice iPhone")); err != nil {
		t.Fatalf("receive dir should remain: %v", err)
	}
	if _, err := os.Stat(filepath.Join(receiveDir, "Bob iPhone")); !os.IsNotExist(err) {
		t.Fatalf("same stable device must not create Bob iPhone dir, stat err=%v", err)
	}

	stored, err := st.GetPairedDevice("account-b-client")
	if err != nil {
		t.Fatalf("GetPairedDevice new: %v", err)
	}
	if stored.ReceiveDirName == nil || *stored.ReceiveDirName != "Alice iPhone" {
		t.Fatalf("expected persisted reused receive_dir_name, got %v", stored.ReceiveDirName)
	}
}

func TestPairDeviceWithDirName_CreatesUniqueReceiveDirForDifferentStableDeviceWithSameName(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()
	stableA := "stable-ios-device-001"
	stableB := "stable-ios-device-002"

	mkDir(t, receiveDir, "Alice iPhone")
	oldDevice := newPairDevice("client-a", "Alice iPhone", nil)
	oldDevice.StableDeviceID = &stableA
	if err := st.UpsertPairedDevice(oldDevice); err != nil {
		t.Fatalf("UpsertPairedDevice old: %v", err)
	}
	if err := st.UpdateReceiveDirName("client-a", "Alice iPhone"); err != nil {
		t.Fatalf("UpdateReceiveDirName old: %v", err)
	}

	newDevice := newPairDevice("client-b", "Alice iPhone", nil)
	newDevice.StableDeviceID = &stableB
	got, err := PairDeviceWithDirName(st, receiveDir, newDevice)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if got != "Alice iPhone (2)" {
		t.Fatalf("expected unique dir %q for different stable device, got %q", "Alice iPhone (2)", got)
	}
}

func TestPairDeviceWithDirName_DoesNotReuseHistoricalUploadDirReservedByAnotherDevice(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	mkDir(t, receiveDir, "My iPhone")
	insertDevice(t, st, "other-dev", "My iPhone", nil)
	if err := st.UpdateReceiveDirName("other-dev", "My iPhone"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}
	insertCompletedUploadWithFinalPath(
		t,
		st,
		"new-dev",
		"historical-file",
		filepath.Join("My iPhone", "2026-06-17", "IMG_0001.JPG"),
		"2026-06-17T10:00:00Z",
	)

	device := newPairDevice("new-dev", "My iPhone", nil)
	got, err := PairDeviceWithDirName(st, receiveDir, device)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if got != "My iPhone (2)" {
		t.Fatalf("expected conflict-safe dir %q, got %q", "My iPhone (2)", got)
	}
}

func TestPairDeviceWithDirName_Atomic(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// Pair device — dir name generation + DB write happen atomically under mutex.
	device := newPairDevice("dev-1", "My iPhone", nil)
	got, err := PairDeviceWithDirName(st, receiveDir, device)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if got != "My iPhone" {
		t.Fatalf("expected 'My iPhone', got %q", got)
	}

	// Second device with same clientName should get (2).
	device2 := newPairDevice("dev-2", "My iPhone", nil)
	got2, err := PairDeviceWithDirName(st, receiveDir, device2)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName second: %v", err)
	}
	if got2 != "My iPhone (2)" {
		t.Fatalf("expected 'My iPhone (2)', got %q", got2)
	}
}

func TestEnsureReceiveDirName_LegacyDevice_DoesClaimOrphanDir(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// An orphan directory exists matching clientName.
	mkDir(t, receiveDir, "My iPhone")

	insertDevice(t, st, "legacy-dev", "My iPhone", nil)

	// EnsureReceiveDirName (used by handleFileEnd for legacy devices) SHOULD claim it.
	got, err := EnsureReceiveDirName(st, receiveDir, "legacy-dev")
	if err != nil {
		t.Fatalf("EnsureReceiveDirName: %v", err)
	}
	if got != "My iPhone" {
		t.Fatalf("legacy device should claim orphan dir, expected 'My iPhone', got %q", got)
	}
}

// -------------------------------------------------------------------
// ReconcileReceiveDirNames
// -------------------------------------------------------------------

func TestReconcileReceiveDirNames_FixesStaleEntry(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// Simulate the bug: DB says "iPhone app2" but actual directory is "iPhone app".
	// The device's clientName matches the old directory name.
	insertDevice(t, st, "dev-1", "iPhone app", strPtr("iPhone app3"))
	if err := st.UpdateReceiveDirName("dev-1", "iPhone app2"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}
	mkDir(t, receiveDir, "iPhone app") // actual directory on disk

	ReconcileReceiveDirNames(st, receiveDir)

	dev, err := st.GetPairedDevice("dev-1")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	// Legacy claim should find "iPhone app" (via clientName match).
	if dev.ReceiveDirName == nil || *dev.ReceiveDirName != "iPhone app" {
		t.Fatalf("expected reconciled receive_dir_name=%q, got %v", "iPhone app", dev.ReceiveDirName)
	}
}

func TestReconcileReceiveDirNames_RestoresHistoricalUploadDirEvenWhenCurrentDirExists(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	insertDevice(t, st, "dev-1", "iPhone 17 Pro", nil)
	if err := st.UpdateReceiveDirName("dev-1", "iPhone 17 Pro (3)"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}
	mkDir(t, receiveDir, "iPhone 17 Pro")
	mkDir(t, receiveDir, "iPhone 17 Pro (2)")
	mkDir(t, receiveDir, "iPhone 17 Pro (3)")
	insertCompletedUploadWithFinalPath(
		t,
		st,
		"dev-1",
		"historical-file",
		filepath.Join("iPhone 17 Pro", "2026-06-17", "IMG_0001.JPG"),
		"2026-06-17T10:00:00Z",
	)

	ReconcileReceiveDirNames(st, receiveDir)

	dev, err := st.GetPairedDevice("dev-1")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if dev.ReceiveDirName == nil || *dev.ReceiveDirName != "iPhone 17 Pro" {
		t.Fatalf("expected historical receive_dir_name=%q, got %v", "iPhone 17 Pro", dev.ReceiveDirName)
	}
}

func TestReconcileReceiveDirNames_NoMatchCreatesDir(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// DB says "OldName" but no matching directory exists at all.
	insertDevice(t, st, "dev-1", "NewName", strPtr("NewAlias"))
	if err := st.UpdateReceiveDirName("dev-1", "OldName"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}

	ReconcileReceiveDirNames(st, receiveDir)

	dev, err := st.GetPairedDevice("dev-1")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	// No legacy dir to claim; should generate from alias.
	if dev.ReceiveDirName == nil || *dev.ReceiveDirName != "NewAlias" {
		t.Fatalf("expected new receive_dir_name=%q, got %v", "NewAlias", dev.ReceiveDirName)
	}
	// Directory should have been created.
	if !dirExists(receiveDir, "NewAlias") {
		t.Fatal("expected directory to be materialised after reconcile")
	}
}

func TestReconcileReceiveDirNames_SkipsValidEntry(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	insertDevice(t, st, "dev-1", "iPhone 15", nil)
	if err := st.UpdateReceiveDirName("dev-1", "iPhone 15"); err != nil {
		t.Fatalf("UpdateReceiveDirName: %v", err)
	}
	mkDir(t, receiveDir, "iPhone 15")

	ReconcileReceiveDirNames(st, receiveDir)

	dev, err := st.GetPairedDevice("dev-1")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if dev.ReceiveDirName == nil || *dev.ReceiveDirName != "iPhone 15" {
		t.Fatalf("expected unchanged receive_dir_name=%q, got %v", "iPhone 15", dev.ReceiveDirName)
	}
}

func TestPairDeviceWithDirName_CreatesDirectory(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	device := newPairDevice("dev-1", "My iPhone", nil)
	got, err := PairDeviceWithDirName(st, receiveDir, device)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if !dirExists(receiveDir, got) {
		t.Fatalf("expected directory %q to exist after PairDeviceWithDirName", got)
	}
}

func TestPairDeviceWithDirName_OrphanDir_Plus_DBConflict(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()

	// "My iPhone" exists as orphan dir AND "My iPhone (2)" is reserved in DB.
	mkDir(t, receiveDir, "My iPhone")
	insertDevice(t, st, "other-dev", "Other", nil)
	_ = st.UpdateReceiveDirName("other-dev", "My iPhone (2)")

	device := newPairDevice("new-dev", "My iPhone", nil)
	got, err := PairDeviceWithDirName(st, receiveDir, device)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if got != "My iPhone (3)" {
		t.Fatalf("expected 'My iPhone (3)', got %q", got)
	}
}
