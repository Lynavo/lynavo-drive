package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func sampleUpload(fileKey, clientID string) Upload {
	now := time.Now().UTC().Format(time.RFC3339)
	sess := "sess-1"
	return Upload{
		FileKey:          fileKey,
		SessionID:        &sess,
		ClientID:         clientID,
		OriginalFilename: "IMG_001.jpg",
		MediaType:        "image/jpeg",
		FileSize:         1024000,
		Status:           "transferring",
		CommittedBytes:   0,
		UpdatedAt:        now,
	}
}

func TestUpsertGetUpload_Roundtrip(t *testing.T) {
	s := newTestStore(t)
	u := sampleUpload("file-1", "client-1")

	if err := s.UpsertUpload(u); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	got, err := s.GetUpload("file-1")
	if err != nil {
		t.Fatalf("GetUpload: %v", err)
	}
	if got.FileKey != "file-1" {
		t.Errorf("expected file_key 'file-1', got %q", got.FileKey)
	}
	if got.OriginalFilename != "IMG_001.jpg" {
		t.Errorf("expected original_filename 'IMG_001.jpg', got %q", got.OriginalFilename)
	}
	if got.Status != "transferring" {
		t.Errorf("expected status 'transferring', got %q", got.Status)
	}
}

func TestListUploadsByDeviceAndDate(t *testing.T) {
	s := newTestStore(t)
	today := time.Now().Format("2006-01-02") // local date to match DATE(updated_at, 'localtime')

	for _, fk := range []string{"f1", "f2", "f3"} {
		u := sampleUpload(fk, "client-A")
		u.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		u.Status = "completed"
		if err := s.UpsertUpload(u); err != nil {
			t.Fatalf("UpsertUpload: %v", err)
		}
	}

	// Different client
	other := sampleUpload("f4", "client-B")
	other.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	other.Status = "completed"
	if err := s.UpsertUpload(other); err != nil {
		t.Fatalf("UpsertUpload other: %v", err)
	}

	uploads, err := s.ListUploadsByDeviceAndDate("client-A", today)
	if err != nil {
		t.Fatalf("ListUploadsByDeviceAndDate: %v", err)
	}
	if len(uploads) != 3 {
		t.Errorf("expected 3 uploads, got %d", len(uploads))
	}
}

func TestListUploadsPageByDeviceAndDate(t *testing.T) {
	s := newTestStore(t)
	today := time.Now().Format("2006-01-02")

	for i, fk := range []string{"f1", "f2", "f3", "f4", "f5"} {
		u := sampleUpload(fk, "client-A")
		u.OriginalFilename = "file-" + fk
		u.FileSize = int64(1000 + i)
		u.ActiveTransmissionMs = int64(100 + i)
		u.Status = "completed"
		u.UpdatedAt = time.Now().Add(time.Duration(i) * time.Second).UTC().Format(time.RFC3339)
		if err := s.UpsertUpload(u); err != nil {
			t.Fatalf("UpsertUpload: %v", err)
		}
	}

	page, err := s.ListUploadsPageByDeviceAndDate("client-A", today, "completedAt", "desc", 2, 2)
	if err != nil {
		t.Fatalf("ListUploadsPageByDeviceAndDate: %v", err)
	}
	if page.Page != 2 {
		t.Fatalf("expected page=2, got %d", page.Page)
	}
	if page.PageSize != 2 {
		t.Fatalf("expected pageSize=2, got %d", page.PageSize)
	}
	if page.TotalItems != 5 {
		t.Fatalf("expected totalItems=5, got %d", page.TotalItems)
	}
	if len(page.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(page.Items))
	}
}

func TestCompleteUpload(t *testing.T) {
	s := newTestStore(t)
	u := sampleUpload("complete-me", "client-1")

	if err := s.UpsertUpload(u); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	if err := s.CompleteUpload("complete-me", "/final/path.jpg", "abc123hash", 5000); err != nil {
		t.Fatalf("CompleteUpload: %v", err)
	}

	got, err := s.GetUpload("complete-me")
	if err != nil {
		t.Fatalf("GetUpload: %v", err)
	}
	if got.Status != "completed" {
		t.Errorf("expected status 'completed', got %q", got.Status)
	}
	if got.FinalPath == nil || *got.FinalPath != "/final/path.jpg" {
		t.Errorf("expected final_path '/final/path.jpg', got %v", got.FinalPath)
	}
	if got.SHA256 == nil || *got.SHA256 != "abc123hash" {
		t.Errorf("expected sha256 'abc123hash', got %v", got.SHA256)
	}
	if got.ActiveTransmissionMs != 5000 {
		t.Errorf("expected active_transmission_ms 5000, got %d", got.ActiveTransmissionMs)
	}
	if got.CompletedAt == nil {
		t.Error("expected completed_at to be set")
	}
}

func TestListCompletedUploadRootDirs(t *testing.T) {
	s := newTestStore(t)
	receiveDir := t.TempDir()

	olderCompletedAt := "2026-06-16T10:00:00Z"
	newerCompletedAt := "2026-06-17T10:00:00Z"
	for _, fixture := range []struct {
		fileKey     string
		clientID    string
		status      string
		finalPath   *string
		completedAt *string
	}{
		{
			fileKey:     "old-root",
			clientID:    "client-1",
			status:      "completed",
			finalPath:   stringPtr("iPhone 17 Pro/2026-06-16/old.jpg"),
			completedAt: &olderCompletedAt,
		},
		{
			fileKey:     "new-root",
			clientID:    "client-1",
			status:      "completed",
			finalPath:   stringPtr(`iPhone 17 Pro\2026-06-17\new.jpg`),
			completedAt: &newerCompletedAt,
		},
		{
			fileKey:     "other-root",
			clientID:    "client-1",
			status:      "completed",
			finalPath:   stringPtr("Other Phone/2026-06-17/new.jpg"),
			completedAt: &olderCompletedAt,
		},
		{
			fileKey:     "absolute-path",
			clientID:    "client-1",
			status:      "completed",
			finalPath:   stringPtr(filepath.Join(receiveDir, "Absolute Phone", "2026-06-17", "file.jpg")),
			completedAt: &newerCompletedAt,
		},
		{
			fileKey:     "outside-root",
			clientID:    "client-1",
			status:      "completed",
			finalPath:   stringPtr(filepath.Join(t.TempDir(), "Outside Phone", "file.jpg")),
			completedAt: &newerCompletedAt,
		},
		{
			fileKey:     "in-progress",
			clientID:    "client-1",
			status:      "transferring",
			finalPath:   stringPtr("Ignored/2026-06-17/file.jpg"),
			completedAt: &newerCompletedAt,
		},
		{
			fileKey:     "other-client",
			clientID:    "client-2",
			status:      "completed",
			finalPath:   stringPtr("Other Client/2026-06-17/file.jpg"),
			completedAt: &newerCompletedAt,
		},
	} {
		upload := sampleUpload(fixture.fileKey, fixture.clientID)
		upload.Status = fixture.status
		upload.FinalPath = fixture.finalPath
		upload.CompletedAt = fixture.completedAt
		if fixture.completedAt != nil {
			upload.UpdatedAt = *fixture.completedAt
		}
		if err := s.UpsertUpload(upload); err != nil {
			t.Fatalf("UpsertUpload %s: %v", fixture.fileKey, err)
		}
	}

	roots, err := s.ListCompletedUploadRootDirs("client-1", receiveDir)
	if err != nil {
		t.Fatalf("ListCompletedUploadRootDirs: %v", err)
	}
	want := []string{"iPhone 17 Pro", "Absolute Phone", "Other Phone"}
	if len(roots) != len(want) {
		t.Fatalf("roots=%v, want %v", roots, want)
	}
	for i := range want {
		if roots[i] != want[i] {
			t.Fatalf("roots=%v, want %v", roots, want)
		}
	}
}

func TestDeviceReceiveLocationPersistence(t *testing.T) {
	s := newTestStore(t)
	path := filepath.Join(t.TempDir(), "Phone")
	older := "2026-07-18T10:00:00Z"
	newer := "2026-07-19T11:00:00Z"

	if err := s.CacheDeviceReceiveLocations("client-1", []DeviceReceiveLocation{
		{Path: path, LastUsedAt: older},
	}); err != nil {
		t.Fatalf("CacheDeviceReceiveLocations: %v", err)
	}
	if err := s.RecordDeviceReceiveLocation("client-1", path, newer); err != nil {
		t.Fatalf("RecordDeviceReceiveLocation: %v", err)
	}

	locations, backfilled, err := s.ListDeviceReceiveLocations("client-1")
	if err != nil {
		t.Fatalf("ListDeviceReceiveLocations: %v", err)
	}
	if !backfilled {
		t.Fatal("expected device receive locations to be marked backfilled")
	}
	if len(locations) != 1 {
		t.Fatalf("locations=%v, want one location", locations)
	}
	if locations[0].Path != path || locations[0].LastUsedAt != newer {
		t.Fatalf("location=%+v, want path=%q lastUsedAt=%q", locations[0], path, newer)
	}

	for _, object := range []struct {
		objectType string
		name       string
	}{
		{objectType: "table", name: "device_receive_locations"},
		{objectType: "table", name: "device_receive_location_backfills"},
		{objectType: "index", name: "uploads_client_status_completed_idx"},
	} {
		var name string
		if err := s.DB().QueryRow(
			"SELECT name FROM sqlite_master WHERE type = ? AND name = ?",
			object.objectType,
			object.name,
		).Scan(&name); err != nil {
			t.Errorf("%s %q not found: %v", object.objectType, object.name, err)
		}
	}
}

func TestAbsolutizeCompletedUploadFinalPaths(t *testing.T) {
	s := newTestStore(t)
	receiveDir := t.TempDir()
	relativePath := filepath.Join("Phone", "2026-07-18", "photo.jpg")
	resolvedPath := filepath.Join(receiveDir, relativePath)
	if err := os.MkdirAll(filepath.Dir(resolvedPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(resolvedPath, []byte("photo"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	alreadyAbsolute := filepath.Join(t.TempDir(), "Archived Phone", "2026-07-17", "old.jpg")
	completedAt := "2026-07-18T12:00:00Z"

	for _, fixture := range []struct {
		fileKey   string
		finalPath string
	}{
		{fileKey: "relative", finalPath: relativePath},
		{fileKey: "absolute", finalPath: alreadyAbsolute},
	} {
		upload := sampleUpload(fixture.fileKey, "client-1")
		upload.Status = "completed"
		upload.FinalPath = &fixture.finalPath
		upload.CompletedAt = &completedAt
		if err := s.UpsertUpload(upload); err != nil {
			t.Fatalf("UpsertUpload %q: %v", fixture.fileKey, err)
		}
	}

	if err := s.AbsolutizeCompletedUploadFinalPaths(receiveDir, true); err != nil {
		t.Fatalf("AbsolutizeCompletedUploadFinalPaths: %v", err)
	}

	relativeUpload, err := s.GetUpload("relative")
	if err != nil {
		t.Fatalf("GetUpload relative: %v", err)
	}
	if relativeUpload.FinalPath == nil || *relativeUpload.FinalPath != resolvedPath {
		t.Fatalf("relative final path=%v, want %q", relativeUpload.FinalPath, resolvedPath)
	}
	absoluteUpload, err := s.GetUpload("absolute")
	if err != nil {
		t.Fatalf("GetUpload absolute: %v", err)
	}
	if absoluteUpload.FinalPath == nil || *absoluteUpload.FinalPath != alreadyAbsolute {
		t.Fatalf("absolute final path=%v, want %q", absoluteUpload.FinalPath, alreadyAbsolute)
	}

	locations, err := s.ListCompletedUploadLocationsByDevice("client-1")
	if err != nil {
		t.Fatalf("ListCompletedUploadLocationsByDevice: %v", err)
	}
	if len(locations) != 2 {
		t.Fatalf("locations=%v, want two completed uploads", locations)
	}
	if locations[0].FinalPath == nil || locations[0].CompletedAt == nil || locations[0].UpdatedAt == "" {
		t.Fatalf("first completed upload location is incomplete: %+v", locations[0])
	}
}

func TestAbsolutizeCompletedUploadFinalPathsRejectsUnsafePaths(t *testing.T) {
	s := newTestStore(t)
	receiveDir := t.TempDir()
	completedAt := "2026-07-18T12:00:00Z"
	fixtures := []struct {
		fileKey   string
		finalPath string
	}{
		{fileKey: "traversal", finalPath: filepath.Join("..", "..", "outside", "photo.jpg")},
		{fileKey: "windows-absolute", finalPath: `C:\Archive\Phone\2026-07-18\photo.jpg`},
		{fileKey: "unix-absolute", finalPath: "/Volumes/Archive/Phone/2026-07-18/photo.jpg"},
	}

	for _, fixture := range fixtures {
		upload := sampleUpload(fixture.fileKey, "client-1")
		upload.Status = "completed"
		upload.FinalPath = &fixture.finalPath
		upload.CompletedAt = &completedAt
		if err := s.UpsertUpload(upload); err != nil {
			t.Fatalf("UpsertUpload %q: %v", fixture.fileKey, err)
		}
	}

	if err := s.AbsolutizeCompletedUploadFinalPaths(receiveDir, true); err != nil {
		t.Fatalf("AbsolutizeCompletedUploadFinalPaths: %v", err)
	}

	for _, fixture := range fixtures {
		upload, err := s.GetUpload(fixture.fileKey)
		if err != nil {
			t.Fatalf("GetUpload %q: %v", fixture.fileKey, err)
		}
		if upload.FinalPath == nil || *upload.FinalPath != fixture.finalPath {
			t.Errorf("%s final path=%v, want unchanged %q", fixture.fileKey, upload.FinalPath, fixture.finalPath)
		}
	}
}

func TestUpdateUploadProgress(t *testing.T) {
	s := newTestStore(t)
	u := sampleUpload("progress-me", "client-1")

	if err := s.UpsertUpload(u); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	if err := s.UpdateUploadProgress("progress-me", 512000); err != nil {
		t.Fatalf("UpdateUploadProgress: %v", err)
	}

	got, err := s.GetUpload("progress-me")
	if err != nil {
		t.Fatalf("GetUpload: %v", err)
	}
	if got.CommittedBytes != 512000 {
		t.Errorf("expected committed_bytes 512000, got %d", got.CommittedBytes)
	}
}

func TestGetAvailableDates(t *testing.T) {
	s := newTestStore(t)

	dates := []string{"2026-03-20", "2026-03-19", "2026-03-21"}
	for i, d := range dates {
		u := sampleUpload("date-"+d, "client-1")
		u.UpdatedAt = d + "T12:00:00Z"
		u.Status = "completed"
		u.FileKey = u.FileKey + string(rune('a'+i))
		if err := s.UpsertUpload(u); err != nil {
			t.Fatalf("UpsertUpload: %v", err)
		}
	}

	got, err := s.GetAvailableDates("client-1")
	if err != nil {
		t.Fatalf("GetAvailableDates: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 dates, got %d", len(got))
	}
	// Should be descending
	if got[0] != "2026-03-21" {
		t.Errorf("expected first date '2026-03-21', got %q", got[0])
	}
	if got[2] != "2026-03-19" {
		t.Errorf("expected last date '2026-03-19', got %q", got[2])
	}
}

func TestUpsertDailyStats_And_GetDashboardSummary(t *testing.T) {
	s := newTestStore(t)
	today := "2026-03-21"
	now := time.Now().UTC().Format(time.RFC3339)

	stats := []DailyStats{
		{StatDate: today, ClientID: "c1", ClientNameSnapshot: "Phone A", FileCount: 10, TotalBytes: 5000, UpdatedAt: now},
		{StatDate: today, ClientID: "c2", ClientNameSnapshot: "Phone B", FileCount: 5, TotalBytes: 3000, UpdatedAt: now},
		{StatDate: "2026-03-20", ClientID: "c1", ClientNameSnapshot: "Phone A", FileCount: 100, TotalBytes: 99999, UpdatedAt: now},
	}
	for _, stat := range stats {
		if err := s.UpsertDailyStats(stat); err != nil {
			t.Fatalf("UpsertDailyStats: %v", err)
		}
	}

	summary, err := s.GetDashboardSummary(today)
	if err != nil {
		t.Fatalf("GetDashboardSummary: %v", err)
	}
	if summary.TotalFiles != 15 {
		t.Errorf("expected 15 total files, got %d", summary.TotalFiles)
	}
	if summary.TotalBytes != 8000 {
		t.Errorf("expected 8000 total bytes, got %d", summary.TotalBytes)
	}
}

func TestGetDashboardSummary_EmptyDate(t *testing.T) {
	s := newTestStore(t)

	summary, err := s.GetDashboardSummary("2099-01-01")
	if err != nil {
		t.Fatalf("GetDashboardSummary: %v", err)
	}
	if summary.TotalFiles != 0 || summary.TotalBytes != 0 {
		t.Errorf("expected zeros, got files=%d bytes=%d", summary.TotalFiles, summary.TotalBytes)
	}
}

func TestGetDashboardSummary_IncludesLatestCompletedSync(t *testing.T) {
	s := newTestStore(t)
	now := time.Now().UTC()
	alias := "WorkPhone"
	device := PairedDevice{
		ClientID: "c1", ClientName: "iPhone 15", DeviceAlias: &alias,
		Platform: "ios", PairingID: "p1", PairingTokenHash: "h1",
		CreatedAt: now.Format(time.RFC3339), LastSeenAt: now.Format(time.RFC3339),
	}
	if err := s.UpsertPairedDevice(device); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	u := sampleUpload("latest-file", "c1")
	completedAt := now.Add(-5 * time.Minute).Format(time.RFC3339)
	u.Status = "completed"
	u.CompletedAt = &completedAt
	u.UpdatedAt = completedAt
	if err := s.UpsertUpload(u); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	summary, err := s.GetDashboardSummary(now.Format("2006-01-02"))
	if err != nil {
		t.Fatalf("GetDashboardSummary: %v", err)
	}
	if summary.LastSuccessfulSyncAt == nil || *summary.LastSuccessfulSyncAt != completedAt {
		t.Fatalf("expected lastSuccessfulSyncAt %q, got %v", completedAt, summary.LastSuccessfulSyncAt)
	}
	if summary.LastSuccessfulDeviceName == nil || *summary.LastSuccessfulDeviceName != alias {
		t.Fatalf("expected lastSuccessfulDeviceName %q, got %v", alias, summary.LastSuccessfulDeviceName)
	}
}

func TestGetDashboardDevices(t *testing.T) {
	s := newTestStore(t)
	today := "2026-03-21"
	now := time.Now().UTC().Format(time.RFC3339)

	// Insert a paired device
	alias := "WorkPhone"
	ip := "192.168.1.10"
	d := PairedDevice{
		ClientID: "c1", ClientName: "iPhone 15", DeviceAlias: &alias, LastIP: &ip,
		Platform: "ios", PairingID: "p1", PairingTokenHash: "h1",
		CreatedAt: now, LastSeenAt: now,
	}
	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	// Insert daily stats
	stat := DailyStats{StatDate: today, ClientID: "c1", ClientNameSnapshot: "iPhone 15", FileCount: 7, TotalBytes: 2048, UpdatedAt: now}
	if err := s.UpsertDailyStats(stat); err != nil {
		t.Fatalf("UpsertDailyStats: %v", err)
	}

	devices, err := s.GetDashboardDevices(today)
	if err != nil {
		t.Fatalf("GetDashboardDevices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}
	if devices[0].ClientID != "c1" {
		t.Errorf("expected client_id 'c1', got %q", devices[0].ClientID)
	}
	if devices[0].FileCount != 7 {
		t.Errorf("expected 7 files, got %d", devices[0].FileCount)
	}
	if devices[0].TotalBytes != 2048 {
		t.Errorf("expected 2048 bytes, got %d", devices[0].TotalBytes)
	}
}

func TestGetDashboardDevices_IncludesCurrentTransferProgress(t *testing.T) {
	s := newTestStore(t)
	today := "2026-03-21"
	now := time.Now().UTC().Format(time.RFC3339)

	dirName := "Android Phone"
	d := PairedDevice{
		ClientID: "c1", ClientName: "Android Phone", ReceiveDirName: &dirName,
		Platform: "android", PairingID: "p1", PairingTokenHash: "h1",
		CreatedAt: now, LastSeenAt: now,
	}
	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	fileKey := "file-active"
	sess := sampleSession("sess-active", "c1")
	sess.State = "transferring"
	sess.ActiveFileKey = &fileKey
	if err := s.UpsertSession(sess); err != nil {
		t.Fatalf("UpsertSession: %v", err)
	}

	u := sampleUpload(fileKey, "c1")
	u.OriginalFilename = "VID_0001.MP4"
	u.Status = "receiving"
	u.FileSize = 2000
	u.CommittedBytes = 500
	if err := s.UpsertUpload(u); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	devices, err := s.GetDashboardDevices(today)
	if err != nil {
		t.Fatalf("GetDashboardDevices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}
	if devices[0].CurrentFile == nil || *devices[0].CurrentFile != "VID_0001.MP4" {
		t.Fatalf("expected current file VID_0001.MP4, got %v", devices[0].CurrentFile)
	}
	if devices[0].CurrentProgress != 25 {
		t.Fatalf("expected progress 25, got %v", devices[0].CurrentProgress)
	}
	if devices[0].CurrentFileSize != 2000 {
		t.Fatalf("expected file size 2000, got %d", devices[0].CurrentFileSize)
	}
	if devices[0].SessionState == nil || *devices[0].SessionState != "transferring" {
		t.Fatalf("expected transferring session, got %v", devices[0].SessionState)
	}
}

func TestGetDashboardDevices_IgnoresCompletedLatestSessionAsCurrentTransfer(t *testing.T) {
	s := newTestStore(t)
	today := "2026-03-21"
	now := time.Now().UTC().Format(time.RFC3339)

	dirName := "WorkPhone"
	d := PairedDevice{
		ClientID: "c1", ClientName: "iPhone 15", ReceiveDirName: &dirName,
		Platform: "ios", PairingID: "p1", PairingTokenHash: "h1",
		CreatedAt: now, LastSeenAt: now,
	}
	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	fileKey := "file-complete"
	sess := sampleSession("sess-complete", "c1")
	sess.State = "completed"
	sess.ActiveFileKey = &fileKey
	if err := s.UpsertSession(sess); err != nil {
		t.Fatalf("UpsertSession: %v", err)
	}

	u := sampleUpload(fileKey, "c1")
	u.OriginalFilename = "IMG_9999.JPG"
	u.Status = "completed"
	if err := s.UpsertUpload(u); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	devices, err := s.GetDashboardDevices(today)
	if err != nil {
		t.Fatalf("GetDashboardDevices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}
	if devices[0].CurrentFile != nil {
		t.Fatalf("expected no current file for completed session, got %v", *devices[0].CurrentFile)
	}
	if devices[0].SessionState != nil {
		t.Fatalf("expected no session state for completed session, got %v", *devices[0].SessionState)
	}
}
