package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nicksyncflow/sidecar/internal/api"
	"github.com/nicksyncflow/sidecar/internal/store"
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
	for i := 0; i < 5; i++ {
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

func TestManagementDevicesIncludesBlockedUnpairedClientAndCanUnblock(t *testing.T) {
	st, cfg, hub := testEnv(t)
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	reason := "wrong_code"
	clientName := "Unpaired iPhone"
	for i := 0; i < 5; i++ {
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
	for i := 0; i < 5; i++ {
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
	if !otherDesktop.Blocked || otherDesktop.FailedAttemptCount != 5 {
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
	finalPath := "/tmp/photo.jpg"
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
		ResourceID:      "res-001",
		ResourceKind:    "shared_file",
		ResourceName:    "Manual.pdf",
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
}
