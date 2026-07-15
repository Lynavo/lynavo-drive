package store

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDeviceBlockLifecycle(t *testing.T) {
	s := newTestStore(t)

	state, err := s.RecordConnectionAttempt(ConnectionAttempt{
		DesktopDeviceID: "desktop-1",
		ClientID:        "client-1",
		ClientName:      stringPtr("Alice iPhone"),
		Result:          "wrong_code",
		FailureReason:   stringPtr("invalid_code"),
		AttemptedAt:     time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("RecordConnectionAttempt first wrong_code: %v", err)
	}
	if state.Blocked {
		t.Fatal("expected first wrong_code not to block")
	}
	if state.FailedAttemptCount != 1 {
		t.Fatalf("expected failed count 1, got %d", state.FailedAttemptCount)
	}
	if state.RemainingAttempts != 2 {
		t.Fatalf("expected 2 remaining attempts, got %d", state.RemainingAttempts)
	}

	for i := 0; i < 2; i++ {
		state, err = s.RecordConnectionAttempt(ConnectionAttempt{
			DesktopDeviceID: "desktop-1",
			ClientID:        "client-1",
			Result:          "wrong_code",
			FailureReason:   stringPtr("invalid_code"),
			AttemptedAt:     time.Now().UTC().Format(time.RFC3339),
		})
		if err != nil {
			t.Fatalf("RecordConnectionAttempt wrong_code #%d: %v", i+2, err)
		}
	}
	if !state.Blocked {
		t.Fatal("expected third wrong_code to block")
	}
	if state.FailedAttemptCount != 3 {
		t.Fatalf("expected failed count 3, got %d", state.FailedAttemptCount)
	}
	if state.RemainingAttempts != 0 {
		t.Fatalf("expected 0 remaining attempts, got %d", state.RemainingAttempts)
	}

	got, err := s.GetDeviceBlockState("desktop-1", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState: %v", err)
	}
	if !got.Blocked {
		t.Fatal("expected stored block state to be active")
	}

	got, err = s.RecordConnectionAttempt(ConnectionAttempt{
		DesktopDeviceID: "desktop-1",
		ClientID:        "client-1",
		Result:          "success",
		AttemptedAt:     time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("RecordConnectionAttempt success while blocked: %v", err)
	}
	if !got.Blocked {
		t.Fatal("expected success attempt not to clear active block")
	}

	if err := s.ClearConnectionAttempts("desktop-1", "client-1"); err != nil {
		t.Fatalf("ClearConnectionAttempts while blocked: %v", err)
	}
	got, err = s.GetDeviceBlockState("desktop-1", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState after clear while blocked: %v", err)
	}
	if !got.Blocked {
		t.Fatal("expected ClearConnectionAttempts not to clear active block")
	}
	if got.FailedAttemptCount != 3 {
		t.Fatalf("expected ClearConnectionAttempts to preserve failed count 3 while blocked, got %d", got.FailedAttemptCount)
	}

	if err := s.UnblockDevice("desktop-1", "client-1"); err != nil {
		t.Fatalf("UnblockDevice: %v", err)
	}
	got, err = s.GetDeviceBlockState("desktop-1", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState after unblock: %v", err)
	}
	if got.Blocked {
		t.Fatal("expected unblock to clear active blocked state")
	}
	if got.FailedAttemptCount != 0 {
		t.Fatalf("expected unblock to reset failed count, got %d", got.FailedAttemptCount)
	}
	if got.Reason != nil {
		t.Fatalf("expected unblock to clear stale reason, got %q", *got.Reason)
	}
	got, err = s.RecordConnectionAttempt(ConnectionAttempt{
		DesktopDeviceID: "desktop-1",
		ClientID:        "client-1",
		Result:          "wrong_code",
		FailureReason:   stringPtr("invalid_code"),
		AttemptedAt:     time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("RecordConnectionAttempt after unblock: %v", err)
	}
	if got.Blocked {
		t.Fatal("expected first wrong_code after unblock not to block")
	}
	if got.FailedAttemptCount != 1 {
		t.Fatalf("expected failed count to restart at 1 after unblock, got %d", got.FailedAttemptCount)
	}
	if got.RemainingAttempts != 2 {
		t.Fatalf("expected 2 remaining attempts after unblock, got %d", got.RemainingAttempts)
	}
	payload, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("Marshal DeviceBlockState: %v", err)
	}
	if strings.Contains(string(payload), "manuallyUnblockedAt") {
		t.Fatalf("DeviceBlockState JSON must not expose manuallyUnblockedAt: %s", string(payload))
	}
}

func TestDeviceBlockDesktopIsolation(t *testing.T) {
	s := newTestStore(t)

	for i := 0; i < 3; i++ {
		_, err := s.RecordConnectionAttempt(ConnectionAttempt{
			DesktopDeviceID: "desktop-1",
			ClientID:        "client-1",
			Result:          "wrong_code",
			FailureReason:   stringPtr("invalid_code"),
			AttemptedAt:     time.Now().UTC().Format(time.RFC3339),
		})
		if err != nil {
			t.Fatalf("RecordConnectionAttempt desktop-1 #%d: %v", i+1, err)
		}
	}

	desktopOne, err := s.GetDeviceBlockState("desktop-1", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState desktop-1: %v", err)
	}
	if !desktopOne.Blocked {
		t.Fatal("expected desktop-1/client-1 to be blocked")
	}

	desktopTwo, err := s.GetDeviceBlockState("desktop-2", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState desktop-2: %v", err)
	}
	if desktopTwo.Blocked {
		t.Fatal("expected desktop-2/client-1 to remain unblocked")
	}
	if desktopTwo.FailedAttemptCount != 0 {
		t.Fatalf("expected desktop-2 failed count 0, got %d", desktopTwo.FailedAttemptCount)
	}
}

func TestConcurrentWrongCodeAttemptsReachBlockThreshold(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	seed, err := New(dbPath)
	if err != nil {
		t.Fatalf("New seed store: %v", err)
	}
	t.Cleanup(func() { seed.Close() })

	const attempts = maxWrongConnectionCodeAttempts
	start := make(chan struct{})
	errs := make(chan error, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s, err := New(dbPath)
			if err != nil {
				errs <- err
				return
			}
			defer s.Close()

			<-start
			_, err = s.RecordConnectionAttempt(ConnectionAttempt{
				DesktopDeviceID: "desktop-1",
				ClientID:        "client-1",
				Result:          "wrong_code",
				FailureReason:   stringPtr("invalid_code"),
				AttemptedAt:     time.Now().Add(time.Duration(i) * time.Millisecond).UTC().Format(time.RFC3339),
			})
			errs <- err
		}(i)
	}
	close(start)
	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("RecordConnectionAttempt concurrent wrong_code: %v", err)
		}
	}

	state, err := seed.GetDeviceBlockState("desktop-1", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState: %v", err)
	}
	if !state.Blocked {
		t.Fatal("expected concurrent wrong_code attempts to block device")
	}
	if state.FailedAttemptCount != maxWrongConnectionCodeAttempts {
		t.Fatalf("expected failed count %d, got %d", maxWrongConnectionCodeAttempts, state.FailedAttemptCount)
	}
}

func TestPairingBlockedDeviceAppearsInListManagedDevices(t *testing.T) {
	s := newTestStore(t)
	desktopID, _ := s.GetDeviceID()

	meta := PairingClientMetadata{
		ClientID:        "pairing-blocked-phone",
		DesktopDeviceID: desktopID,
		ClientName:      "Bob's Android",
	}
	for i := 0; i < 3; i++ {
		if _, err := s.RecordPairingFailure(meta, 3); err != nil {
			t.Fatalf("RecordPairingFailure attempt %d: %v", i+1, err)
		}
	}

	// The pairing-blocked device should appear in ListManagedDevices.
	devices, err := s.ListManagedDevices(desktopID)
	if err != nil {
		t.Fatalf("ListManagedDevices: %v", err)
	}
	found := false
	for _, d := range devices {
		if d.ClientID == meta.ClientID {
			found = true
			if d.BlockStatus != "active" {
				t.Fatalf("blockStatus=%q, want active", d.BlockStatus)
			}
			if d.AuthorizationStatus != "revoked" {
				t.Fatalf("authorizationStatus=%q, want revoked", d.AuthorizationStatus)
			}
			if d.BlockReason == nil || *d.BlockReason != "too_many_failed_attempts" {
				t.Fatalf("blockReason=%v, want too_many_failed_attempts", d.BlockReason)
			}
			break
		}
	}
	if !found {
		t.Fatalf("pairing-blocked device not found in ListManagedDevices (got %d items)", len(devices))
	}

	// After UnblockDevice the pairing block should be cleared.
	if err := s.UnblockDevice(desktopID, meta.ClientID); err != nil {
		t.Fatalf("UnblockDevice: %v", err)
	}
	block, err := s.GetActivePairingBlock(meta.ClientID, desktopID)
	if err != nil {
		t.Fatalf("GetActivePairingBlock after unblock: %v", err)
	}
	if block != nil {
		t.Fatalf("expected pairing block cleared, still active: %+v", block)
	}
}

func TestListManagedDevicesDeduplicatesStableDeviceID(t *testing.T) {
	s := newTestStore(t)
	desktopID, err := s.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	stableID := "stable-ios-device-001"
	oldSeen := "2026-06-14T08:00:00Z"
	newSeen := "2026-06-14T09:00:00Z"

	insertManagedDevice(t, s, "client-old", "Alice iPhone", stableID, oldSeen)
	insertManagedDevice(t, s, "client-new", "Alice iPhone", stableID, newSeen)
	insertManagedCompletedUpload(t, s, "file-old", "client-old", 100, oldSeen)
	insertManagedCompletedUpload(t, s, "file-new", "client-new", 200, newSeen)

	devices, err := s.ListManagedDevices(desktopID)
	if err != nil {
		t.Fatalf("ListManagedDevices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected one managed device for one stableDeviceId, got %d: %+v", len(devices), devices)
	}
	got := devices[0]
	if got.ClientID != "client-new" {
		t.Fatalf("expected newest client as representative, got %q", got.ClientID)
	}
	if got.StableDeviceID == nil || *got.StableDeviceID != stableID {
		t.Fatalf("stableDeviceId=%v, want %q", got.StableDeviceID, stableID)
	}
	if got.TotalFileCount != 2 || got.TotalBytes != 300 {
		t.Fatalf("expected merged totals count=2 bytes=300, got count=%d bytes=%d", got.TotalFileCount, got.TotalBytes)
	}
}

func TestListManagedDevicesDoesNotAppendBlockedOldClientForSameStableDeviceID(t *testing.T) {
	s := newTestStore(t)
	desktopID, err := s.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	stableID := "stable-ios-device-001"

	insertManagedDevice(t, s, "client-old", "Alice iPhone", stableID, "2026-06-14T08:00:00Z")
	insertManagedDevice(t, s, "client-new", "Alice iPhone", stableID, "2026-06-14T09:00:00Z")
	if err := s.BlockDevice(desktopID, "client-old"); err != nil {
		t.Fatalf("BlockDevice old client: %v", err)
	}

	devices, err := s.ListManagedDevices(desktopID)
	if err != nil {
		t.Fatalf("ListManagedDevices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected one managed device even with old client block, got %d: %+v", len(devices), devices)
	}
	if devices[0].ClientID != "client-new" {
		t.Fatalf("expected newest client as representative, got %q", devices[0].ClientID)
	}
}

func TestListManagedDevicesKeepsDifferentStableDeviceIDsSeparate(t *testing.T) {
	s := newTestStore(t)
	desktopID, err := s.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}

	insertManagedDevice(t, s, "client-a", "Alice iPhone", "stable-a", "2026-06-14T08:00:00Z")
	insertManagedDevice(t, s, "client-b", "Alice iPhone", "stable-b", "2026-06-14T09:00:00Z")

	devices, err := s.ListManagedDevices(desktopID)
	if err != nil {
		t.Fatalf("ListManagedDevices: %v", err)
	}
	if len(devices) != 2 {
		t.Fatalf("expected two managed devices for different stableDeviceIds, got %d: %+v", len(devices), devices)
	}
}

func insertManagedDevice(t *testing.T, s *Store, clientID string, clientName string, stableDeviceID string, lastSeenAt string) {
	t.Helper()
	device := PairedDevice{
		ClientID:         clientID,
		ClientName:       clientName,
		Platform:         "ios",
		PairingID:        "pair-" + clientID,
		PairingTokenHash: "hash-" + clientID,
		CreatedAt:        lastSeenAt,
		LastSeenAt:       lastSeenAt,
	}
	if strings.TrimSpace(stableDeviceID) != "" {
		device.StableDeviceID = &stableDeviceID
	}
	if err := s.UpsertPairedDevice(device); err != nil {
		t.Fatalf("UpsertPairedDevice %s: %v", clientID, err)
	}
}

func insertManagedCompletedUpload(t *testing.T, s *Store, fileKey string, clientID string, size int64, updatedAt string) {
	t.Helper()
	upload := sampleUpload(fileKey, clientID)
	upload.FileSize = size
	upload.Status = "completed"
	upload.CommittedBytes = size
	upload.CompletedAt = &updatedAt
	upload.UpdatedAt = updatedAt
	if err := s.UpsertUpload(upload); err != nil {
		t.Fatalf("UpsertUpload %s: %v", fileKey, err)
	}
}
