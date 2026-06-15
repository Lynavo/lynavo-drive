package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/nicksyncflow/sidecar/internal/api"
	"github.com/nicksyncflow/sidecar/internal/store"
)

func TestResourcesSharedListAddAndRemove(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	body := bytes.NewBufferString(`{
		"kind": "shared_file",
		"displayName": "Manual.pdf",
		"localPath": "/tmp/Manual.pdf",
		"fileSize": 1234,
		"mediaType": "application/pdf"
	}`)
	resp, err := http.Post(srv.URL+"/resources/shared", "application/json", body)
	if err != nil {
		t.Fatalf("POST /resources/shared: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /resources/shared status=%d, want 201", resp.StatusCode)
	}

	var created store.SharedResource
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode created resource: %v", err)
	}
	if created.ResourceID == "" {
		t.Fatal("resourceId is empty")
	}
	if created.Kind != "shared_file" || created.DisplayName != "Manual.pdf" || created.Status != "available" {
		t.Fatalf("unexpected created resource: %+v", created)
	}

	resp, err = http.Get(srv.URL + "/resources/shared")
	if err != nil {
		t.Fatalf("GET /resources/shared: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /resources/shared status=%d, want 200", resp.StatusCode)
	}
	var listBody struct {
		Items []store.SharedResource `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listBody.Items) != 1 || listBody.Items[0].ResourceID != created.ResourceID {
		t.Fatalf("unexpected shared resources list: %+v", listBody.Items)
	}

	req, err := http.NewRequest(http.MethodDelete, srv.URL+"/resources/shared/"+created.ResourceID, nil)
	if err != nil {
		t.Fatalf("NewRequest DELETE: %v", err)
	}
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE /resources/shared/{id}: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE status=%d, want 200", resp.StatusCode)
	}

	resp, err = http.Get(srv.URL + "/resources/shared")
	if err != nil {
		t.Fatalf("GET /resources/shared after delete: %v", err)
	}
	defer resp.Body.Close()
	var afterDelete struct {
		Items []store.SharedResource `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&afterDelete); err != nil {
		t.Fatalf("decode after delete: %v", err)
	}
	if len(afterDelete.Items) != 0 {
		t.Fatalf("expected removed resource hidden, got %+v", afterDelete.Items)
	}
}

func TestResourcesReceivedLibraryList(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	completedAt := "2026-06-14T09:00:00Z"
	finalPath := filepath.Join(t.TempDir(), "photo.jpg")
	if err := st.UpsertUpload(store.Upload{
		FileKey:              "file-001",
		ClientID:             "client-001",
		OriginalFilename:     "photo.jpg",
		MediaType:            "image",
		FileSize:             2048,
		Status:               "completed",
		FinalPath:            &finalPath,
		CommittedBytes:       2048,
		ActiveTransmissionMs: 250,
		CompletedAt:          &completedAt,
		UpdatedAt:            completedAt,
	}); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/received")
	if err != nil {
		t.Fatalf("GET /resources/received: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /resources/received status=%d, want 200", resp.StatusCode)
	}
	var receivedBody struct {
		Items []store.ReceivedLibraryItem `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&receivedBody); err != nil {
		t.Fatalf("decode received library: %v", err)
	}
	if len(receivedBody.Items) != 1 {
		t.Fatalf("expected 1 received item, got %d", len(receivedBody.Items))
	}
	if receivedBody.Items[0].FileKey != "file-001" || receivedBody.Items[0].ShareStatus != "not_shared" {
		t.Fatalf("unexpected received item: %+v", receivedBody.Items[0])
	}
}

func TestMobileResourcesListDownloadAndAccessRecords(t *testing.T) {
	st, cfg, hub := testEnv(t)
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	sharedDir := t.TempDir()
	sharedPath := filepath.Join(sharedDir, "Manual.pdf")
	if err := os.WriteFile(sharedPath, []byte("manual bytes"), 0o644); err != nil {
		t.Fatalf("write shared file: %v", err)
	}
	resource, err := st.AddSharedResource(store.SharedResourceInput{
		DesktopDeviceID: desktopDeviceID,
		Kind:            "shared_file",
		DisplayName:     "Manual.pdf",
		LocalPath:       &sharedPath,
		Status:          "available",
	})
	if err != nil {
		t.Fatalf("AddSharedResource: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/shared?clientId=client-001&clientName=Alice%20iPhone")
	if err != nil {
		t.Fatalf("GET /resources/mobile/shared: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET mobile shared status=%d, want 200", resp.StatusCode)
	}
	var sharedBody struct {
		Items []store.SharedResource `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&sharedBody); err != nil {
		t.Fatalf("decode mobile shared: %v", err)
	}
	if len(sharedBody.Items) != 1 || sharedBody.Items[0].ResourceID != resource.ResourceID {
		t.Fatalf("unexpected mobile shared list: %+v", sharedBody.Items)
	}

	resp, err = http.Get(srv.URL + "/resources/mobile/download/unknown-resource?clientId=client-001")
	if err != nil {
		t.Fatalf("GET unknown download: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown download status=%d, want 404", resp.StatusCode)
	}
	recordsAfterUnknown, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords after unknown download: %v", err)
	}
	if len(recordsAfterUnknown) != 1 {
		t.Fatalf("unknown resource download must not create fake access record, got %d records", len(recordsAfterUnknown))
	}

	resp, err = http.Post(srv.URL+"/resources/mobile/view/"+resource.ResourceID+"?clientId=client-001&clientName=Alice%20iPhone", "application/json", nil)
	if err != nil {
		t.Fatalf("POST mobile view: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("view status=%d, want 200", resp.StatusCode)
	}

	resp, err = http.Get(srv.URL + "/resources/mobile/download/" + resource.ResourceID + "?clientId=client-001&clientName=Alice%20iPhone")
	if err != nil {
		t.Fatalf("GET mobile download: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("download status=%d, want 200", resp.StatusCode)
	}
	downloaded, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read download: %v", err)
	}
	if string(downloaded) != "manual bytes" {
		t.Fatalf("download body=%q, want manual bytes", string(downloaded))
	}

	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	if len(records) != 3 {
		t.Fatalf("expected 3 access records for list, view, download; got %d", len(records))
	}
	actions := map[string]bool{}
	results := map[string]bool{}
	kinds := map[string]bool{}
	for _, record := range records {
		actions[record.Action] = true
		results[record.Result] = true
		kinds[record.ResourceKind] = true
		if !isContractAccessAction(record.Action) {
			t.Fatalf("access record action must match contracts enum, got %+v", record)
		}
		if !isContractAccessResult(record.Result) {
			t.Fatalf("access record result must match contracts enum, got %+v", record)
		}
		if !isContractResourceKind(record.ResourceKind) {
			t.Fatalf("access record resource kind must match contracts enum, got %+v", record)
		}
	}
	if !actions["list"] || !actions["view"] || !actions["download"] {
		t.Fatalf("expected list and download access actions, got %+v", actions)
	}
	if !results["ok"] || results["not_found"] {
		t.Fatalf("expected only contract-compatible ok results, got %+v", results)
	}
	if !kinds["shared_file"] {
		t.Fatalf("expected contract-compatible resource kind shared_file, got %+v", kinds)
	}
}

func TestMobileResourceAccessNormalizesLegacyResourceKind(t *testing.T) {
	st, cfg, hub := testEnv(t)
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	sharedPath := filepath.Join(t.TempDir(), "Legacy.pdf")
	if err := os.WriteFile(sharedPath, []byte("legacy bytes"), 0o644); err != nil {
		t.Fatalf("write legacy shared file: %v", err)
	}
	resource, err := st.AddSharedResource(store.SharedResourceInput{
		DesktopDeviceID: desktopDeviceID,
		Kind:            "file",
		DisplayName:     "Legacy.pdf",
		LocalPath:       &sharedPath,
		Status:          "available",
	})
	if err != nil {
		t.Fatalf("AddSharedResource legacy file: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/shared?clientId=legacy-client")
	if err != nil {
		t.Fatalf("GET legacy mobile shared: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET legacy mobile shared status=%d, want 200", resp.StatusCode)
	}
	var sharedBody struct {
		Items []store.SharedResource `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&sharedBody); err != nil {
		t.Fatalf("decode legacy mobile shared: %v", err)
	}
	if len(sharedBody.Items) != 1 || sharedBody.Items[0].Kind != "shared_file" {
		t.Fatalf("expected legacy shared resource kind to normalize in response, got %+v", sharedBody.Items)
	}

	resp, err = http.Post(srv.URL+"/resources/mobile/view/"+resource.ResourceID+"?clientId=legacy-client", "application/json", nil)
	if err != nil {
		t.Fatalf("POST legacy view: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST legacy view status=%d, want 200", resp.StatusCode)
	}

	resp, err = http.Get(srv.URL + "/resources/mobile/download/" + resource.ResourceID + "?clientId=legacy-client")
	if err != nil {
		t.Fatalf("GET legacy download: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET legacy download status=%d, want 200", resp.StatusCode)
	}

	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"legacy-client"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords legacy: %v", err)
	}
	if len(records) != 3 {
		t.Fatalf("expected 3 legacy access records, got %d", len(records))
	}
	for _, record := range records {
		if record.ResourceKind != "shared_file" {
			t.Fatalf("expected legacy access record kind shared_file, got %+v", record)
		}
		if !isContractAccessAction(record.Action) || !isContractAccessResult(record.Result) {
			t.Fatalf("legacy access record must match contracts enums, got %+v", record)
		}
	}
}

func TestMobileReceivedResourcesCreatesAccessRecord(t *testing.T) {
	st, cfg, hub := testEnv(t)
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone")
	if err != nil {
		t.Fatalf("GET /resources/mobile/received: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET mobile received status=%d, want 200", resp.StatusCode)
	}

	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 access record, got %d", len(records))
	}
	if records[0].ResourceID != "received_library" || records[0].ResourceKind != "received_file" || records[0].Action != "list" || records[0].Result != "ok" {
		t.Fatalf("unexpected access record: %+v", records[0])
	}
}

func isContractResourceKind(kind string) bool {
	switch kind {
	case "shared_file", "shared_folder", "received_file":
		return true
	default:
		return false
	}
}

func isContractAccessAction(action string) bool {
	switch action {
	case "list", "view", "download", "error":
		return true
	default:
		return false
	}
}

func isContractAccessResult(result string) bool {
	switch result {
	case "ok", "denied", "missing", "error":
		return true
	default:
		return false
	}
}
