package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/api"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
)

func TestManagementDevicesListsBlockStateAndUnblocksDevice(t *testing.T) {
	st, cfg, hub := testEnv(t)
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")

	reason := "wrong_code"
	clientName := "Alice iPhone"
	for i := 0; i < 3; i++ {
		if _, err := st.RecordConnectionAttempt(store.ConnectionAttempt{
			DesktopDeviceID: desktopDeviceID,
			ClientID:        "client-001",
			ClientName:      &clientName,
			Result:          "wrong_code",
			FailureReason:   &reason,
		}); err != nil {
			t.Fatalf("RecordConnectionAttempt #%d: %v", i+1, err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/management/devices")
	if err != nil {
		t.Fatalf("GET /management/devices: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /management/devices status=%d, want 200", resp.StatusCode)
	}

	var listBody struct {
		Items []store.ManagedDevice `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	if len(listBody.Items) != 1 {
		t.Fatalf("expected 1 managed device, got %d", len(listBody.Items))
	}
	if listBody.Items[0].ClientID != "client-001" {
		t.Fatalf("clientId=%q, want client-001", listBody.Items[0].ClientID)
	}
	if listBody.Items[0].BlockStatus != "active" {
		t.Fatalf("blockStatus=%q, want active", listBody.Items[0].BlockStatus)
	}
	if listBody.Items[0].BlockReason == nil || *listBody.Items[0].BlockReason != "too_many_failed_attempts" {
		t.Fatalf("blockReason=%v, want too_many_failed_attempts", listBody.Items[0].BlockReason)
	}

	resp, err = http.Post(srv.URL+"/management/devices/client-001/unblock", "application/json", nil)
	if err != nil {
		t.Fatalf("POST unblock: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST unblock status=%d, want 200", resp.StatusCode)
	}

	state, err := st.GetDeviceBlockState(desktopDeviceID, "client-001")
	if err != nil {
		t.Fatalf("GetDeviceBlockState: %v", err)
	}
	if state.Blocked {
		t.Fatal("expected unblock to clear block state")
	}
	if state.FailedAttemptCount != 0 {
		t.Fatalf("failedAttemptCount=%d, want 0", state.FailedAttemptCount)
	}
}

func TestManagementDevicesDeduplicatesStableDeviceID(t *testing.T) {
	st, cfg, hub := testEnv(t)
	stableDeviceID := "stable-ios-device-001"
	oldSeen := "2026-06-14T08:00:00Z"
	newSeen := "2026-06-14T09:00:00Z"
	insertPairedDeviceWithStableID(t, st, "client-old", "Alice iPhone", "Alice iPhone", stableDeviceID, oldSeen)
	insertPairedDeviceWithStableID(t, st, "client-new", "Alice iPhone", "Alice iPhone", stableDeviceID, newSeen)

	if err := st.UpsertUpload(store.Upload{
		FileKey:              "file-old",
		ClientID:             "client-old",
		OriginalFilename:     "old.jpg",
		MediaType:            "image/jpeg",
		FileSize:             100,
		Status:               "completed",
		CommittedBytes:       100,
		ActiveTransmissionMs: 100,
		CompletedAt:          &oldSeen,
		UpdatedAt:            oldSeen,
	}); err != nil {
		t.Fatalf("UpsertUpload old: %v", err)
	}
	if err := st.UpsertUpload(store.Upload{
		FileKey:              "file-new",
		ClientID:             "client-new",
		OriginalFilename:     "new.jpg",
		MediaType:            "image/jpeg",
		FileSize:             200,
		Status:               "completed",
		CommittedBytes:       200,
		ActiveTransmissionMs: 200,
		CompletedAt:          &newSeen,
		UpdatedAt:            newSeen,
	}); err != nil {
		t.Fatalf("UpsertUpload new: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/management/devices")
	if err != nil {
		t.Fatalf("GET /management/devices: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /management/devices status=%d, want 200", resp.StatusCode)
	}

	var listBody struct {
		Items []store.ManagedDevice `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	if len(listBody.Items) != 1 {
		t.Fatalf("expected one managed device for one stableDeviceId, got %d: %+v", len(listBody.Items), listBody.Items)
	}
	got := listBody.Items[0]
	if got.ClientID != "client-new" {
		t.Fatalf("expected newest client as representative, got %q", got.ClientID)
	}
	if got.StableDeviceID == nil || *got.StableDeviceID != stableDeviceID {
		t.Fatalf("stableDeviceId=%v, want %q", got.StableDeviceID, stableDeviceID)
	}
	if got.TotalFileCount != 2 || got.TotalBytes != 300 {
		t.Fatalf("expected merged totals count=2 bytes=300, got count=%d bytes=%d", got.TotalFileCount, got.TotalBytes)
	}
}

func TestManagementRejectsInvalidClientID(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/management/devices/client$001/unblock", "application/json", bytes.NewReader(nil))
	if err != nil {
		t.Fatalf("POST invalid unblock: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", resp.StatusCode)
	}
}

func TestManagementUnblockUnknownDeviceReturnsNotFound(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/management/devices/unknown-client/unblock", "application/json", nil)
	if err != nil {
		t.Fatalf("POST unknown unblock: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status=%d, want 404", resp.StatusCode)
	}
}

func TestManagementBlockDeviceDisconnectsBlockedClient(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	insertPairedDeviceWithStableID(t, st, "client-002", "Bob Android", "Bob Android", "stable-002", "2026-06-14T08:00:00Z")

	clientStates := &fakeDisconnectingClientStates{
		states: fakeClientStates{
			"client-001": "syncing",
			"client-002": "connected",
		},
	}
	_, handler := api.NewServer(st, cfg, hub, clientStates)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/management/devices/client-001/block", "application/json", nil)
	if err != nil {
		t.Fatalf("POST block: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST block status=%d, want 200", resp.StatusCode)
	}

	if strings.Join(clientStates.disconnected, ",") != "client-001" {
		t.Fatalf("disconnected clients=%v, want [client-001]", clientStates.disconnected)
	}
	if clientStates.reason != "device_blocked" {
		t.Fatalf("disconnect reason=%q, want device_blocked", clientStates.reason)
	}
}

func TestManagementDevicesIncludesBlockedUnpairedClientAndCanUnblock(t *testing.T) {
	st, cfg, hub := testEnv(t)
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	reason := "wrong_code"
	clientName := "Unpaired iPhone"
	for i := 0; i < 3; i++ {
		if _, err := st.RecordConnectionAttempt(store.ConnectionAttempt{
			DesktopDeviceID: desktopDeviceID,
			ClientID:        "blocked-unpaired",
			ClientName:      &clientName,
			Result:          "wrong_code",
			FailureReason:   &reason,
		}); err != nil {
			t.Fatalf("RecordConnectionAttempt #%d: %v", i+1, err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/management/devices")
	if err != nil {
		t.Fatalf("GET /management/devices: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /management/devices status=%d, want 200", resp.StatusCode)
	}

	var listBody struct {
		Items []store.ManagedDevice `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	if len(listBody.Items) != 1 {
		t.Fatalf("expected 1 blocked unpaired device, got %d", len(listBody.Items))
	}
	got := listBody.Items[0]
	if got.ClientID != "blocked-unpaired" || got.DisplayName != clientName {
		t.Fatalf("unexpected blocked device identity: %+v", got)
	}
	if got.AuthorizationStatus != "revoked" || got.BlockStatus != "active" {
		t.Fatalf("unexpected blocked device status: %+v", got)
	}

	resp, err = http.Post(srv.URL+"/management/devices/blocked-unpaired/unblock", "application/json", nil)
	if err != nil {
		t.Fatalf("POST unblock blocked-unpaired: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST unblock blocked-unpaired status=%d, want 200", resp.StatusCode)
	}
	state, err := st.GetDeviceBlockState(desktopDeviceID, "blocked-unpaired")
	if err != nil {
		t.Fatalf("GetDeviceBlockState: %v", err)
	}
	if state.Blocked || state.FailedAttemptCount != 0 {
		t.Fatalf("expected unblock to clear unpaired block, got %+v", state)
	}
}

func TestManagementUnblockKeepsOtherDesktopBlockState(t *testing.T) {
	st, cfg, hub := testEnv(t)
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	otherDesktopID := desktopDeviceID + "-other"
	reason := "wrong_code"
	for i := 0; i < 3; i++ {
		if _, err := st.RecordConnectionAttempt(store.ConnectionAttempt{
			DesktopDeviceID: desktopDeviceID,
			ClientID:        "same-client",
			Result:          "wrong_code",
			FailureReason:   &reason,
		}); err != nil {
			t.Fatalf("RecordConnectionAttempt desktop #%d: %v", i+1, err)
		}
		if _, err := st.RecordConnectionAttempt(store.ConnectionAttempt{
			DesktopDeviceID: otherDesktopID,
			ClientID:        "same-client",
			Result:          "wrong_code",
			FailureReason:   &reason,
		}); err != nil {
			t.Fatalf("RecordConnectionAttempt other desktop #%d: %v", i+1, err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/management/devices/same-client/unblock", "application/json", nil)
	if err != nil {
		t.Fatalf("POST unblock same-client: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST unblock same-client status=%d, want 200", resp.StatusCode)
	}

	currentDesktop, err := st.GetDeviceBlockState(desktopDeviceID, "same-client")
	if err != nil {
		t.Fatalf("GetDeviceBlockState desktop: %v", err)
	}
	if currentDesktop.Blocked {
		t.Fatalf("expected current desktop block cleared, got %+v", currentDesktop)
	}
	otherDesktop, err := st.GetDeviceBlockState(otherDesktopID, "same-client")
	if err != nil {
		t.Fatalf("GetDeviceBlockState other desktop: %v", err)
	}
	if !otherDesktop.Blocked || otherDesktop.FailedAttemptCount != 3 {
		t.Fatalf("expected other desktop block to remain active, got %+v", otherDesktop)
	}
}

func TestManagementRecordsSyncAndAccess(t *testing.T) {
	st, cfg, hub := testEnv(t)
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")

	completedAt := "2026-06-14T09:00:00Z"
	finalPath := filepath.Join("Alice iPhone", "2026-06-14", "photo.jpg")
	absoluteFinalPath := filepath.Join(cfg.ReceiveDir, finalPath)
	if err := os.MkdirAll(filepath.Dir(absoluteFinalPath), 0o755); err != nil {
		t.Fatalf("mkdir final path: %v", err)
	}
	if err := os.WriteFile(absoluteFinalPath, []byte("photo"), 0o644); err != nil {
		t.Fatalf("write final file: %v", err)
	}
	if err := st.UpsertUpload(store.Upload{
		FileKey:              "file-001",
		ClientID:             "client-001",
		OriginalFilename:     "photo.jpg",
		MediaType:            "image",
		FileSize:             1024,
		Status:               "completed",
		FinalPath:            &finalPath,
		CommittedBytes:       1024,
		ActiveTransmissionMs: 200,
		CompletedAt:          &completedAt,
		UpdatedAt:            completedAt,
	}); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	if _, err := st.RecordAccess(store.AccessRecord{
		DesktopDeviceID: desktopDeviceID,
		ClientID:        "client-001",
		ClientName:      "Alice iPhone",
		ResourceID:      "file-001",
		ResourceKind:    "received_file",
		ResourceName:    "photo.jpg",
		Action:          "download",
		Result:          "ok",
		AccessedAt:      "2026-06-14T10:00:00Z",
	}); err != nil {
		t.Fatalf("RecordAccess: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/management/records/sync")
	if err != nil {
		t.Fatalf("GET sync records: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET sync records status=%d, want 200", resp.StatusCode)
	}
	var syncBody struct {
		Items []store.DesktopSyncRecord `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&syncBody); err != nil {
		t.Fatalf("decode sync records: %v", err)
	}
	if len(syncBody.Items) != 1 {
		t.Fatalf("expected 1 sync record, got %d", len(syncBody.Items))
	}
	if syncBody.Items[0].FileKey != "file-001" {
		t.Fatalf("sync record fileKey=%q, want file-001", syncBody.Items[0].FileKey)
	}

	resp, err = http.Get(srv.URL + "/management/records/access?clientId=client-001")
	if err != nil {
		t.Fatalf("GET access records: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET access records status=%d, want 200", resp.StatusCode)
	}
	var accessBody struct {
		Items []store.AccessRecord `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&accessBody); err != nil {
		t.Fatalf("decode access records: %v", err)
	}
	if len(accessBody.Items) != 1 {
		t.Fatalf("expected 1 access record, got %d", len(accessBody.Items))
	}
	if accessBody.Items[0].Action != "download" || accessBody.Items[0].Result != "ok" {
		t.Fatalf("unexpected access action/result: %s/%s", accessBody.Items[0].Action, accessBody.Items[0].Result)
	}
	if accessBody.Items[0].LocalPath == nil || *accessBody.Items[0].LocalPath != absoluteFinalPath {
		t.Fatalf("access localPath=%v, want %s", accessBody.Items[0].LocalPath, absoluteFinalPath)
	}
}

// TestManagementDevicesIncludesPairingBlockedDevice verifies that a device
// blocked via the pairing handshake (wrong connection code >= 3 times, stored
// in blocked_pairing_clients) appears in GET /management/devices and can be
// unblocked via POST /management/devices/{id}/unblock, which clears the
// pairing block so the device can pair again.
func TestManagementDevicesIncludesPairingBlockedDevice(t *testing.T) {
	st, cfg, hub := testEnv(t)
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}

	// Simulate 3 wrong-code attempts via the pairing security path
	// (writes blocked_pairing_clients, NOT device_blocks).
	meta := store.PairingClientMetadata{
		ClientID:        "pairing-blocked-phone",
		DesktopDeviceID: desktopDeviceID,
		ClientName:      "Bob's Android",
	}
	for i := 0; i < 3; i++ {
		if _, err := st.RecordPairingFailure(meta, 3); err != nil {
			t.Fatalf("RecordPairingFailure attempt %d: %v", i+1, err)
		}
	}

	// Verify the pairing block is active.
	block, err := st.GetActivePairingBlock(meta.ClientID, meta.DesktopDeviceID)
	if err != nil || block == nil {
		t.Fatalf("expected active pairing block, got block=%v err=%v", block, err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	// 1. The device should appear in GET /management/devices.
	resp, err := http.Get(srv.URL + "/management/devices")
	if err != nil {
		t.Fatalf("GET /management/devices: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /management/devices status=%d, want 200", resp.StatusCode)
	}
	var listBody struct {
		Items []store.ManagedDevice `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	found := false
	for _, d := range listBody.Items {
		if d.ClientID == meta.ClientID {
			found = true
			if d.BlockStatus != "active" {
				t.Fatalf("pairing-blocked device blockStatus=%q, want active", d.BlockStatus)
			}
			if d.AuthorizationStatus != "revoked" {
				t.Fatalf("pairing-blocked device authorizationStatus=%q, want revoked", d.AuthorizationStatus)
			}
			break
		}
	}
	if !found {
		t.Fatalf("pairing-blocked device %q not found in GET /management/devices (got %d items)", meta.ClientID, len(listBody.Items))
	}

	// 2. POST /management/devices/{id}/unblock should clear the pairing block.
	resp2, err := http.Post(srv.URL+"/management/devices/"+meta.ClientID+"/unblock", "application/json", nil)
	if err != nil {
		t.Fatalf("POST unblock: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("POST unblock status=%d, want 200", resp2.StatusCode)
	}

	// 3. The pairing block should now be gone so the device can pair again.
	block2, err := st.GetActivePairingBlock(meta.ClientID, meta.DesktopDeviceID)
	if err != nil {
		t.Fatalf("GetActivePairingBlock after unblock: %v", err)
	}
	if block2 != nil {
		t.Fatalf("expected pairing block to be cleared after unblock, still active: %+v", block2)
	}
}
