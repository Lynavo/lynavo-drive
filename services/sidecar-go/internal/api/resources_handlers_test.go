package api_test

import (
	"bytes"
	"encoding/json"
	"image"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
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
	receivedRelPath := filepath.Join("Alice iPhone", "2026-06-14", "photo.jpg")
	receivedAbsPath := filepath.Join(cfg.ReceiveDir, receivedRelPath)
	if err := os.MkdirAll(filepath.Dir(receivedAbsPath), 0o755); err != nil {
		t.Fatalf("mkdir received path: %v", err)
	}
	writeJPEGFixture(t, receivedAbsPath, 640, 480)
	info, err := os.Stat(receivedAbsPath)
	if err != nil {
		t.Fatalf("stat received image: %v", err)
	}
	if err := st.UpsertUpload(store.Upload{
		FileKey:              "file-001",
		ClientID:             "client-001",
		OriginalFilename:     "photo.jpg",
		MediaType:            "image",
		FileSize:             info.Size(),
		Status:               "completed",
		FinalPath:            &receivedRelPath,
		CommittedBytes:       info.Size(),
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
	if !strings.HasPrefix(receivedBody.Items[0].ThumbnailURL, "/resources/received/thumbnail?") {
		t.Fatalf("thumbnailUrl=%q, want desktop received thumbnail URL", receivedBody.Items[0].ThumbnailURL)
	}
	thumbnailURL, err := url.Parse(receivedBody.Items[0].ThumbnailURL)
	if err != nil {
		t.Fatalf("parse thumbnail URL: %v", err)
	}
	if thumbnailURL.Query().Get("fileKey") != "file-001" || thumbnailURL.Query().Get("v") == "" {
		t.Fatalf("thumbnailUrl query=%v, want fileKey and version", thumbnailURL.Query())
	}
	if got := regularFilesUnder(t, filepath.Join(cfg.DataDir, "thumbnail-cache")); len(got) != 0 {
		t.Fatalf("received library list generated thumbnail cache files: %+v", got)
	}
}

func TestResourcesReceivedLibraryListSupportsPagination(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	insertPairedDeviceWithStableID(t, st, "client-002", "Bob Android", "Bob Android", "stable-002", "2026-06-14T08:00:00Z")

	uploads := []struct {
		fileKey     string
		clientID    string
		filename    string
		mediaType   string
		size        int64
		completedAt string
	}{
		{"file-001", "client-001", "old.pdf", "application/pdf", 100, "2026-06-14T09:00:00Z"},
		{"file-002", "client-001", "middle.jpg", "image/jpeg", 200, "2026-06-14T10:00:00Z"},
		{"file-003", "client-002", "new.mov", "video/quicktime", 300, "2026-06-14T11:00:00Z"},
	}
	for _, upload := range uploads {
		if err := st.UpsertUpload(store.Upload{
			FileKey:              upload.fileKey,
			ClientID:             upload.clientID,
			OriginalFilename:     upload.filename,
			MediaType:            upload.mediaType,
			FileSize:             upload.size,
			Status:               "completed",
			CommittedBytes:       upload.size,
			ActiveTransmissionMs: 250,
			CompletedAt:          &upload.completedAt,
			UpdatedAt:            upload.completedAt,
		}); err != nil {
			t.Fatalf("UpsertUpload %s: %v", upload.fileKey, err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/received?page=2&pageSize=2")
	if err != nil {
		t.Fatalf("GET /resources/received paged: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /resources/received paged status=%d, want 200", resp.StatusCode)
	}

	var body struct {
		Items       []store.ReceivedLibraryItem       `json:"items"`
		Page        int                               `json:"page"`
		PageSize    int                               `json:"pageSize"`
		TotalItems  int                               `json:"totalItems"`
		TotalBytes  int64                             `json:"totalBytes"`
		DeviceStats []store.ReceivedLibraryDeviceStat `json:"deviceStats"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode paged received library: %v", err)
	}
	if body.Page != 2 || body.PageSize != 2 || body.TotalItems != 3 || body.TotalBytes != 600 {
		t.Fatalf("unexpected page metadata: page=%d pageSize=%d totalItems=%d totalBytes=%d", body.Page, body.PageSize, body.TotalItems, body.TotalBytes)
	}
	if len(body.Items) != 1 || body.Items[0].FileKey != "file-001" {
		t.Fatalf("expected second page to contain oldest file-001 only, got %+v", body.Items)
	}
	statsByClient := map[string]store.ReceivedLibraryDeviceStat{}
	for _, stat := range body.DeviceStats {
		statsByClient[stat.ClientID] = stat
	}
	if statsByClient["client-001"].PhotoCount != 1 || statsByClient["client-001"].FileCount != 1 || statsByClient["client-001"].TotalBytes != 300 {
		t.Fatalf("unexpected client-001 stats: %+v", statsByClient["client-001"])
	}
	if statsByClient["client-002"].PhotoCount != 1 || statsByClient["client-002"].FileCount != 0 || statsByClient["client-002"].TotalBytes != 300 {
		t.Fatalf("unexpected client-002 stats: %+v", statsByClient["client-002"])
	}
}

func TestResourcesReceivedFileThumbnailGeneratesSmallCachedJPEG(t *testing.T) {
	st, cfg, hub := testEnv(t)
	completedAt := "2026-06-14T09:00:00Z"
	receivedRelPath := filepath.Join("Alice iPhone", "2026-06-14", "wide.jpg")
	receivedAbsPath := filepath.Join(cfg.ReceiveDir, receivedRelPath)
	if err := os.MkdirAll(filepath.Dir(receivedAbsPath), 0o755); err != nil {
		t.Fatalf("mkdir received path: %v", err)
	}
	writeJPEGFixture(t, receivedAbsPath, 640, 480)
	info, err := os.Stat(receivedAbsPath)
	if err != nil {
		t.Fatalf("stat received image: %v", err)
	}
	if err := st.UpsertUpload(store.Upload{
		FileKey:              "desktop-wide-photo",
		ClientID:             "client-001",
		OriginalFilename:     "wide.jpg",
		MediaType:            "image",
		FileSize:             info.Size(),
		Status:               "completed",
		FinalPath:            &receivedRelPath,
		CommittedBytes:       info.Size(),
		ActiveTransmissionMs: 250,
		CompletedAt:          &completedAt,
		UpdatedAt:            completedAt,
	}); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	thumbnailURL := srv.URL + "/resources/received/thumbnail?fileKey=desktop-wide-photo"
	resp, err := http.Get(thumbnailURL)
	if err != nil {
		t.Fatalf("GET received thumbnail: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("received thumbnail status=%d, want 200", resp.StatusCode)
	}
	if contentType := resp.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "image/jpeg") {
		t.Fatalf("thumbnail content-type=%q, want image/jpeg", contentType)
	}
	thumbnail, format, err := image.Decode(resp.Body)
	if err != nil {
		t.Fatalf("decode thumbnail: %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("thumbnail format=%q, want jpeg", format)
	}
	bounds := thumbnail.Bounds()
	if bounds.Dx() > 256 || bounds.Dy() > 256 {
		t.Fatalf("thumbnail size=%dx%d, want max edge <= 256", bounds.Dx(), bounds.Dy())
	}

	cacheDir := filepath.Join(cfg.DataDir, "thumbnail-cache")
	cacheFiles := regularFilesUnder(t, cacheDir)
	if len(cacheFiles) != 1 {
		t.Fatalf("cache files=%+v, want exactly one cached thumbnail", cacheFiles)
	}
	firstInfo, err := os.Stat(cacheFiles[0])
	if err != nil {
		t.Fatalf("stat first cache file: %v", err)
	}

	secondResp, err := http.Get(thumbnailURL)
	if err != nil {
		t.Fatalf("GET received thumbnail second time: %v", err)
	}
	io.Copy(io.Discard, secondResp.Body)
	secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("second thumbnail status=%d, want 200", secondResp.StatusCode)
	}
	secondInfo, err := os.Stat(cacheFiles[0])
	if err != nil {
		t.Fatalf("stat second cache file: %v", err)
	}
	if !secondInfo.ModTime().Equal(firstInfo.ModTime()) {
		t.Fatalf("cache mtime changed on cache hit: first=%s second=%s", firstInfo.ModTime(), secondInfo.ModTime())
	}
}

func TestMobileResourcesListDownloadAndAccessRecords(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
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
	foundManual := false
	foundVirtual := false
	for _, item := range sharedBody.Items {
		if item.ResourceID == resource.ResourceID {
			foundManual = true
		}
		if item.ResourceID == "user_home" || strings.HasPrefix(item.ResourceID, "drive_") {
			foundVirtual = true
		}
	}
	if !foundManual {
		t.Fatalf("manual resource not found in mobile shared list: %+v", sharedBody.Items)
	}
	if !foundVirtual {
		t.Fatalf("virtual default resource (user_home or drive) not found in mobile shared list: %+v", sharedBody.Items)
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

func TestMobileSharedFolderRootListing(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	sharedRoot := t.TempDir()
	readmePath := filepath.Join(sharedRoot, "Readme.txt")
	if err := os.WriteFile(readmePath, []byte("hello"), 0o644); err != nil {
		t.Fatalf("write shared file: %v", err)
	}
	if err := os.Mkdir(filepath.Join(sharedRoot, "Designs"), 0o755); err != nil {
		t.Fatalf("mkdir nested folder: %v", err)
	}
	resource, err := st.AddSharedResource(store.SharedResourceInput{
		DesktopDeviceID: desktopDeviceID,
		Kind:            "shared_folder",
		DisplayName:     "Project Files",
		LocalPath:       &sharedRoot,
		Status:          "available",
	})
	if err != nil {
		t.Fatalf("AddSharedResource folder: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/shared/" + resource.ResourceID + "/list?clientId=client-001&clientName=Alice%20iPhone")
	if err != nil {
		t.Fatalf("GET mobile shared folder root list: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET mobile shared folder root list status=%d, want 200", resp.StatusCode)
	}
	var body mobileDirectoryListingResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode mobile shared folder root list: %v", err)
	}
	if body.Path != "" || body.TotalCount != 2 {
		t.Fatalf("unexpected root listing metadata: %+v", body)
	}
	files := directoryFilesByName(body.Files)
	if files["Readme.txt"].Path != "Readme.txt" || files["Readme.txt"].Type != "document" || files["Readme.txt"].IsDirectory {
		t.Fatalf("unexpected file entry: %+v", files["Readme.txt"])
	}
	if files["Designs"].Path != "Designs" || files["Designs"].Type != "other" || !files["Designs"].IsDirectory {
		t.Fatalf("unexpected folder entry: %+v", files["Designs"])
	}

	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 list access record, got %d", len(records))
	}
	if records[0].ResourceID != resource.ResourceID || records[0].ResourceKind != "shared_folder" || records[0].ResourceName != "Project Files" || records[0].Action != "list" || records[0].Result != "ok" {
		t.Fatalf("unexpected list access record: %+v", records[0])
	}
}

func TestMobileSharedFolderNestedListing(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	sharedRoot := t.TempDir()
	nestedDir := filepath.Join(sharedRoot, "Designs", "Screens")
	if err := os.MkdirAll(nestedDir, 0o755); err != nil {
		t.Fatalf("mkdir nested folder: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nestedDir, "Home.png"), []byte("png"), 0o644); err != nil {
		t.Fatalf("write nested file: %v", err)
	}
	resource, err := st.AddSharedResource(store.SharedResourceInput{
		DesktopDeviceID: desktopDeviceID,
		Kind:            "shared_folder",
		DisplayName:     "Project Files",
		LocalPath:       &sharedRoot,
		Status:          "available",
	})
	if err != nil {
		t.Fatalf("AddSharedResource folder: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/shared/" + resource.ResourceID + "/list/Designs/Screens?clientId=client-001")
	if err != nil {
		t.Fatalf("GET mobile shared folder nested list: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET mobile shared folder nested list status=%d, want 200", resp.StatusCode)
	}
	var body mobileDirectoryListingResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode mobile shared folder nested list: %v", err)
	}
	if body.Path != "Designs/Screens" || body.TotalCount != 1 {
		t.Fatalf("unexpected nested listing metadata: %+v", body)
	}
	files := directoryFilesByName(body.Files)
	if files["Home.png"].Path != "Designs/Screens/Home.png" || files["Home.png"].Type != "image" || files["Home.png"].IsDirectory {
		t.Fatalf("unexpected nested image entry: %+v", files["Home.png"])
	}

	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	if len(records) != 1 || records[0].ResourceID != resource.ResourceID || records[0].Action != "list" || records[0].Result != "ok" {
		t.Fatalf("unexpected nested list access records: %+v", records)
	}
}

func TestMobileSharedFolderListingRejectsPathTraversal(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	sharedRoot := t.TempDir()
	resource, err := st.AddSharedResource(store.SharedResourceInput{
		DesktopDeviceID: desktopDeviceID,
		Kind:            "shared_folder",
		DisplayName:     "Project Files",
		LocalPath:       &sharedRoot,
		Status:          "available",
	})
	if err != nil {
		t.Fatalf("AddSharedResource folder: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/shared/" + resource.ResourceID + "/list/%2e%2e?clientId=client-001")
	if err != nil {
		t.Fatalf("GET mobile shared folder traversal list: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("GET mobile shared folder traversal list status=%d, want 400", resp.StatusCode)
	}
	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("path traversal must not create access record, got %+v", records)
	}
}

func TestMobileSharedFolderListingRejectsSharedFileResource(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	sharedPath := filepath.Join(t.TempDir(), "Manual.pdf")
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
		t.Fatalf("AddSharedResource file: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/shared/" + resource.ResourceID + "/list?clientId=client-001")
	if err != nil {
		t.Fatalf("GET mobile shared file list: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("GET mobile shared file list status=%d, want 400", resp.StatusCode)
	}
	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("shared_file listing must not create access record, got %+v", records)
	}
}

func TestMobileResourceAccessNormalizesLegacyResourceKind(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	insertPairedDeviceWithStableID(t, st, "legacy-client", "Legacy Client", "Legacy Client", "stable-legacy", "2026-06-14T08:00:00Z")
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
	foundLegacy := false
	for _, item := range sharedBody.Items {
		if item.ResourceID == resource.ResourceID {
			foundLegacy = true
			if item.Kind != "shared_file" {
				t.Fatalf("expected legacy shared resource kind to normalize to shared_file, got %q", item.Kind)
			}
		}
	}
	if !foundLegacy {
		t.Fatalf("legacy resource not found in response, got %+v", sharedBody.Items)
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
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	completedAt := "2026-06-14T09:00:00Z"
	for _, upload := range []store.Upload{
		{
			FileKey:              "client-001-photo",
			ClientID:             "client-001",
			OriginalFilename:     "client-001.jpg",
			MediaType:            "image",
			FileSize:             2048,
			Status:               "completed",
			CommittedBytes:       2048,
			ActiveTransmissionMs: 250,
			CompletedAt:          &completedAt,
			UpdatedAt:            completedAt,
		},
		{
			FileKey:              "other-client-photo",
			ClientID:             "other-client",
			OriginalFilename:     "other-client.jpg",
			MediaType:            "image",
			FileSize:             4096,
			Status:               "completed",
			CommittedBytes:       4096,
			ActiveTransmissionMs: 300,
			CompletedAt:          &completedAt,
			UpdatedAt:            completedAt,
		},
		{
			FileKey:              "2026/06/14/client-001-notes.pdf",
			ClientID:             "client-001",
			OriginalFilename:     "notes.pdf",
			MediaType:            "document",
			FileSize:             1024,
			Status:               "completed",
			CommittedBytes:       1024,
			ActiveTransmissionMs: 220,
			CompletedAt:          &completedAt,
			UpdatedAt:            completedAt,
		},
	} {
		if err := st.UpsertUpload(upload); err != nil {
			t.Fatalf("UpsertUpload %s: %v", upload.FileKey, err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone")
	if err != nil {
		t.Fatalf("GET /resources/mobile/received: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET mobile received status=%d, want 200", resp.StatusCode)
	}
	var receivedBody struct {
		Items []store.ReceivedLibraryItem `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&receivedBody); err != nil {
		t.Fatalf("decode mobile received: %v", err)
	}
	if err := resp.Body.Close(); err != nil {
		t.Fatalf("close mobile received body: %v", err)
	}
	if len(receivedBody.Items) != 3 {
		t.Fatalf("default mobile received endpoint should preserve legacy all-client library, got %+v", receivedBody.Items)
	}

	scopedResp, err := http.Get(srv.URL + "/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone&scope=client")
	if err != nil {
		t.Fatalf("GET /resources/mobile/received scoped: %v", err)
	}
	if scopedResp.StatusCode != http.StatusOK {
		t.Fatalf("GET scoped mobile received status=%d, want 200", scopedResp.StatusCode)
	}
	var scopedBody struct {
		Items []store.ReceivedLibraryItem `json:"items"`
	}
	if err := json.NewDecoder(scopedResp.Body).Decode(&scopedBody); err != nil {
		t.Fatalf("decode scoped mobile received: %v", err)
	}
	if err := scopedResp.Body.Close(); err != nil {
		t.Fatalf("close scoped mobile received body: %v", err)
	}
	if len(scopedBody.Items) != 2 {
		t.Fatalf("scoped mobile received endpoint should include current client only, got %+v", scopedBody.Items)
	}
	scopedByName := make(map[string]store.ReceivedLibraryItem, len(scopedBody.Items))
	for _, item := range scopedBody.Items {
		scopedByName[item.Filename] = item
	}
	if scopedByName["client-001.jpg"].ClientID != "client-001" ||
		!strings.Contains(scopedByName["client-001.jpg"].PreviewURL, "/resources/mobile/received/preview?") {
		t.Fatalf("scoped mobile received endpoint returned wrong image item: %+v", scopedByName["client-001.jpg"])
	}
	if scopedByName["notes.pdf"].ClientID != "client-001" ||
		!strings.Contains(scopedByName["notes.pdf"].PreviewURL, "/resources/mobile/received/download?") {
		t.Fatalf("scoped mobile received endpoint should use download url for documents: %+v", scopedByName["notes.pdf"])
	}

	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("expected 2 access records, got %d", len(records))
	}
	for _, record := range records {
		if record.ResourceID != "received_library" || record.ResourceKind != "received_file" || record.Action != "list" || record.Result != "ok" {
			t.Fatalf("unexpected access record: %+v", record)
		}
	}
}

func TestMobileReceivedResourcesSupportsScopedPagination(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	insertPairedDeviceWithStableID(t, st, "other-client", "Bob iPhone", "Bob iPhone", "stable-002", "2026-06-14T08:00:00Z")
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	for _, upload := range []store.Upload{
		{
			FileKey:              "client-001-photo-new",
			ClientID:             "client-001",
			OriginalFilename:     "photo-new.jpg",
			MediaType:            "image",
			FileSize:             2048,
			Status:               "completed",
			CommittedBytes:       2048,
			ActiveTransmissionMs: 250,
			CompletedAt:          &[]string{"2026-06-14T09:03:00Z"}[0],
			UpdatedAt:            "2026-06-14T09:03:00Z",
		},
		{
			FileKey:              "client-001-video-mid",
			ClientID:             "client-001",
			OriginalFilename:     "video-mid.mov",
			MediaType:            "video",
			FileSize:             4096,
			Status:               "completed",
			CommittedBytes:       4096,
			ActiveTransmissionMs: 300,
			CompletedAt:          &[]string{"2026-06-14T09:02:00Z"}[0],
			UpdatedAt:            "2026-06-14T09:02:00Z",
		},
		{
			FileKey:              "2026/06/14/client-001-notes.pdf",
			ClientID:             "client-001",
			OriginalFilename:     "notes.pdf",
			MediaType:            "document",
			FileSize:             1024,
			Status:               "completed",
			CommittedBytes:       1024,
			ActiveTransmissionMs: 220,
			CompletedAt:          &[]string{"2026-06-14T09:01:00Z"}[0],
			UpdatedAt:            "2026-06-14T09:01:00Z",
		},
		{
			FileKey:              "other-client-photo",
			ClientID:             "other-client",
			OriginalFilename:     "other-client.jpg",
			MediaType:            "image",
			FileSize:             8192,
			Status:               "completed",
			CommittedBytes:       8192,
			ActiveTransmissionMs: 300,
			CompletedAt:          &[]string{"2026-06-14T09:04:00Z"}[0],
			UpdatedAt:            "2026-06-14T09:04:00Z",
		},
	} {
		if err := st.UpsertUpload(upload); err != nil {
			t.Fatalf("UpsertUpload %s: %v", upload.FileKey, err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone&scope=client&page=2&pageSize=2")
	if err != nil {
		t.Fatalf("GET paged mobile received: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET paged mobile received status=%d, want 200", resp.StatusCode)
	}
	var body store.ReceivedLibraryPage
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode paged mobile received: %v", err)
	}
	if err := resp.Body.Close(); err != nil {
		t.Fatalf("close paged mobile received body: %v", err)
	}

	if body.Page != 2 || body.PageSize != 2 || body.TotalItems != 3 || body.TotalBytes != 7168 {
		t.Fatalf("unexpected page metadata: %+v", body)
	}
	if len(body.Items) != 1 || body.Items[0].FileKey != "2026/06/14/client-001-notes.pdf" {
		t.Fatalf("expected second page to contain only the client document, got %+v", body.Items)
	}
	if body.Items[0].ClientID != "client-001" ||
		!strings.Contains(body.Items[0].PreviewURL, "/resources/mobile/received/download?") {
		t.Fatalf("paged scoped item should be current-client enriched download url, got %+v", body.Items[0])
	}
	if len(body.DeviceStats) != 1 ||
		body.DeviceStats[0].ClientID != "client-001" ||
		body.DeviceStats[0].PhotoCount != 2 ||
		body.DeviceStats[0].FileCount != 1 ||
		body.DeviceStats[0].TotalBytes != 7168 {
		t.Fatalf("unexpected scoped device stats: %+v", body.DeviceStats)
	}

	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 access record, got %d", len(records))
	}
}

func TestMobileReceivedFilePreviewByFileKeyIsScopedToCurrentClient(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	insertPairedDeviceWithStableID(t, st, "other-client", "Bob iPhone", "Bob iPhone", "stable-002", "2026-06-14T08:00:00Z")
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	completedAt := "2026-06-14T09:00:00Z"
	receivedRelPath := filepath.Join("Alice iPhone", "2026-06-14", "photo.jpg")
	receivedAbsPath := filepath.Join(cfg.ReceiveDir, receivedRelPath)
	if err := os.MkdirAll(filepath.Dir(receivedAbsPath), 0o755); err != nil {
		t.Fatalf("mkdir received path: %v", err)
	}
	if err := os.WriteFile(receivedAbsPath, []byte("image bytes"), 0o644); err != nil {
		t.Fatalf("write received file: %v", err)
	}
	for _, upload := range []store.Upload{
		{
			FileKey:              "client-001-photo",
			ClientID:             "client-001",
			OriginalFilename:     "photo.jpg",
			MediaType:            "image",
			FileSize:             11,
			Status:               "completed",
			FinalPath:            &receivedRelPath,
			CommittedBytes:       11,
			ActiveTransmissionMs: 250,
			CompletedAt:          &completedAt,
			UpdatedAt:            completedAt,
		},
		{
			FileKey:              "other-client-photo",
			ClientID:             "other-client",
			OriginalFilename:     "other.jpg",
			MediaType:            "image",
			FileSize:             11,
			Status:               "completed",
			FinalPath:            &receivedRelPath,
			CommittedBytes:       11,
			ActiveTransmissionMs: 250,
			CompletedAt:          &completedAt,
			UpdatedAt:            completedAt,
		},
	} {
		if err := st.UpsertUpload(upload); err != nil {
			t.Fatalf("UpsertUpload %s: %v", upload.FileKey, err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=client-001-photo")
	if err != nil {
		t.Fatalf("GET received preview: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("received preview status=%d, want 200", resp.StatusCode)
	}
	if contentDisposition := resp.Header.Get("Content-Disposition"); strings.Contains(contentDisposition, "attachment") {
		t.Fatalf("preview should not be served as attachment, got %q", contentDisposition)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read preview body: %v", err)
	}
	if string(body) != "image bytes" {
		t.Fatalf("preview body=%q, want image bytes", string(body))
	}

	otherResp, err := http.Get(srv.URL + "/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=other-client-photo")
	if err != nil {
		t.Fatalf("GET other client received preview: %v", err)
	}
	defer otherResp.Body.Close()
	if otherResp.StatusCode != http.StatusNotFound {
		t.Fatalf("other client preview status=%d, want 404", otherResp.StatusCode)
	}

	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	seenView := false
	for _, record := range records {
		if record.ResourceID == "client-001-photo" && record.ResourceKind == "received_file" && record.Action == "view" && record.Result == "ok" {
			seenView = true
		}
	}
	if !seenView {
		t.Fatalf("expected received preview to create a view access record, got %+v", records)
	}
}

func TestMobileReceivedFileThumbnailGeneratesSmallCachedJPEG(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	completedAt := "2026-06-14T09:00:00Z"
	receivedRelPath := filepath.Join("Alice iPhone", "2026-06-14", "wide.jpg")
	receivedAbsPath := filepath.Join(cfg.ReceiveDir, receivedRelPath)
	if err := os.MkdirAll(filepath.Dir(receivedAbsPath), 0o755); err != nil {
		t.Fatalf("mkdir received path: %v", err)
	}
	writeJPEGFixture(t, receivedAbsPath, 640, 480)
	info, err := os.Stat(receivedAbsPath)
	if err != nil {
		t.Fatalf("stat received image: %v", err)
	}
	if err := st.UpsertUpload(store.Upload{
		FileKey:              "client-001-wide-photo",
		ClientID:             "client-001",
		OriginalFilename:     "wide.jpg",
		MediaType:            "image",
		FileSize:             info.Size(),
		Status:               "completed",
		FinalPath:            &receivedRelPath,
		CommittedBytes:       info.Size(),
		ActiveTransmissionMs: 250,
		CompletedAt:          &completedAt,
		UpdatedAt:            completedAt,
	}); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	thumbnailURL := srv.URL + "/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=client-001-wide-photo"
	resp, err := http.Get(thumbnailURL)
	if err != nil {
		t.Fatalf("GET received thumbnail: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("received thumbnail status=%d, want 200", resp.StatusCode)
	}
	if contentType := resp.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "image/jpeg") {
		t.Fatalf("thumbnail content-type=%q, want image/jpeg", contentType)
	}
	thumbnail, format, err := image.Decode(resp.Body)
	if err != nil {
		t.Fatalf("decode thumbnail: %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("thumbnail format=%q, want jpeg", format)
	}
	bounds := thumbnail.Bounds()
	if bounds.Dx() > 256 || bounds.Dy() > 256 {
		t.Fatalf("thumbnail size=%dx%d, want max edge <= 256", bounds.Dx(), bounds.Dy())
	}

	cacheDir := filepath.Join(cfg.DataDir, "thumbnail-cache")
	cacheFiles := regularFilesUnder(t, cacheDir)
	if len(cacheFiles) != 1 {
		t.Fatalf("cache files=%+v, want exactly one cached thumbnail", cacheFiles)
	}
	firstInfo, err := os.Stat(cacheFiles[0])
	if err != nil {
		t.Fatalf("stat first cache file: %v", err)
	}

	secondResp, err := http.Get(thumbnailURL)
	if err != nil {
		t.Fatalf("GET received thumbnail second time: %v", err)
	}
	io.Copy(io.Discard, secondResp.Body)
	secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("second thumbnail status=%d, want 200", secondResp.StatusCode)
	}
	secondInfo, err := os.Stat(cacheFiles[0])
	if err != nil {
		t.Fatalf("stat second cache file: %v", err)
	}
	if !secondInfo.ModTime().Equal(firstInfo.ModTime()) {
		t.Fatalf("cache mtime changed on cache hit: first=%s second=%s", firstInfo.ModTime(), secondInfo.ModTime())
	}
}

func TestMobileReceivedFileDownloadByFileKeyServesDocuments(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(t, st, "client-001", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	completedAt := "2026-06-14T09:00:00Z"
	receivedRelPath := filepath.Join("Alice iPhone", "2026-06-14", "notes.pdf")
	receivedAbsPath := filepath.Join(cfg.ReceiveDir, receivedRelPath)
	if err := os.MkdirAll(filepath.Dir(receivedAbsPath), 0o755); err != nil {
		t.Fatalf("mkdir received path: %v", err)
	}
	if err := os.WriteFile(receivedAbsPath, []byte("document bytes"), 0o644); err != nil {
		t.Fatalf("write received file: %v", err)
	}
	for _, upload := range []store.Upload{
		{
			FileKey:              "2026/06/14/client-001-doc.pdf",
			ClientID:             "client-001",
			OriginalFilename:     "notes.pdf",
			MediaType:            "document",
			FileSize:             14,
			Status:               "completed",
			FinalPath:            &receivedRelPath,
			CommittedBytes:       14,
			ActiveTransmissionMs: 250,
			CompletedAt:          &completedAt,
			UpdatedAt:            completedAt,
		},
		{
			FileKey:              "2026/06/14/other-client-doc.pdf",
			ClientID:             "other-client",
			OriginalFilename:     "other.pdf",
			MediaType:            "document",
			FileSize:             14,
			Status:               "completed",
			FinalPath:            &receivedRelPath,
			CommittedBytes:       14,
			ActiveTransmissionMs: 250,
			CompletedAt:          &completedAt,
			UpdatedAt:            completedAt,
		},
	} {
		if err := st.UpsertUpload(upload); err != nil {
			t.Fatalf("UpsertUpload %s: %v", upload.FileKey, err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/resources/mobile/received/download?clientId=client-001&clientName=Alice%20iPhone&fileKey=" + url.QueryEscape("2026/06/14/client-001-doc.pdf"))
	if err != nil {
		t.Fatalf("GET received download: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("received download status=%d, want 200", resp.StatusCode)
	}
	if contentDisposition := resp.Header.Get("Content-Disposition"); !strings.Contains(contentDisposition, "attachment") {
		t.Fatalf("download should be served as attachment, got %q", contentDisposition)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read download body: %v", err)
	}
	if string(body) != "document bytes" {
		t.Fatalf("download body=%q, want document bytes", string(body))
	}

	otherResp, err := http.Get(srv.URL + "/resources/mobile/received/download?clientId=client-001&clientName=Alice%20iPhone&fileKey=" + url.QueryEscape("2026/06/14/other-client-doc.pdf"))
	if err != nil {
		t.Fatalf("GET other client received download: %v", err)
	}
	defer otherResp.Body.Close()
	if otherResp.StatusCode != http.StatusNotFound {
		t.Fatalf("other client download status=%d, want 404", otherResp.StatusCode)
	}

	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	seenDownload := false
	for _, record := range records {
		if record.ResourceID == "2026/06/14/client-001-doc.pdf" && record.ResourceKind == "received_file" && record.Action == "download" && record.Result == "ok" {
			seenDownload = true
		}
	}
	if !seenDownload {
		t.Fatalf("expected received download to create a download access record, got %+v", records)
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

type mobileDirectoryListingResponse struct {
	Path       string                            `json:"path"`
	Files      []mobileDirectoryListingFileEntry `json:"files"`
	TotalCount int                               `json:"totalCount"`
}

type mobileDirectoryListingFileEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Type        string `json:"type"`
	IsDirectory bool   `json:"isDirectory,omitempty"`
}

func directoryFilesByName(files []mobileDirectoryListingFileEntry) map[string]mobileDirectoryListingFileEntry {
	byName := make(map[string]mobileDirectoryListingFileEntry, len(files))
	for _, file := range files {
		byName[file.Name] = file
	}
	return byName
}
