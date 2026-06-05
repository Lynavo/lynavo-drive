package api_test

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nicksyncflow/sidecar/internal/api"
	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/protocol"
	internalserver "github.com/nicksyncflow/sidecar/internal/server"
	"github.com/nicksyncflow/sidecar/internal/store"
)

// testEnv sets up a temporary database, config, and hub for testing.
func testEnv(t *testing.T) (*store.Store, *config.Config, *events.Hub) {
	t.Helper()
	tmpDir := t.TempDir()

	dbPath := filepath.Join(tmpDir, "test.db")
	st, err := store.New(dbPath)
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	receiveDir := filepath.Join(tmpDir, "received")
	os.MkdirAll(receiveDir, 0755)

	cfg := &config.Config{
		HTTPPort:              39394,
		TCPPort:               39393,
		DataDir:               tmpDir,
		ReceiveDir:            receiveDir,
		LogLevel:              "debug",
		DeviceName:            "test-mac",
		LowDiskThresholdBytes: 500 * 1024 * 1024,
	}

	hub := events.NewHub()
	return st, cfg, hub
}

func insertPairedDeviceWithStableID(
	t *testing.T,
	st *store.Store,
	clientID string,
	clientName string,
	receiveDirName string,
	stableDeviceID string,
	lastSeenAt string,
) {
	t.Helper()
	insertPairedDeviceWithOptionalStableID(t, st, clientID, clientName, receiveDirName, &stableDeviceID, lastSeenAt)
}

func insertPairedDeviceWithOptionalStableID(
	t *testing.T,
	st *store.Store,
	clientID string,
	clientName string,
	receiveDirName string,
	stableDeviceID *string,
	lastSeenAt string,
) {
	t.Helper()

	if _, err := st.DB().Exec(`
		INSERT INTO paired_devices (
			client_id, client_name, last_ip, platform, pairing_id, pairing_token_hash,
			created_at, last_seen_at, receive_dir_name, stable_device_id
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		clientID,
		clientName,
		"192.168.1.10",
		"ios",
		"pair-"+clientID,
		"hash-"+clientID,
		lastSeenAt,
		lastSeenAt,
		receiveDirName,
		stableDeviceID,
	); err != nil {
		t.Fatalf("insert paired device %q: %v", clientID, err)
	}
}

type fakeClientStates map[string]string

func (f fakeClientStates) ConnectedClientStates() map[string]string {
	states := make(map[string]string, len(f))
	for clientID, state := range f {
		states[clientID] = state
	}
	return states
}

func fakeAccountJWT(t *testing.T, accountID string) string {
	t.Helper()

	encode := base64.RawURLEncoding.EncodeToString
	header := encode([]byte(`{"alg":"none","typ":"JWT"}`))
	payload := encode([]byte(`{"user_id":"` + accountID + `"}`))
	return header + "." + payload + ".signature"
}

func fakePaddedAccountJWT(t *testing.T, accountID string) string {
	t.Helper()

	encode := base64.URLEncoding.EncodeToString
	header := encode([]byte(`{"alg":"none","typ":"JWT"}`))
	payload := encode([]byte(`{"user_id":"` + accountID + `"}`))
	return header + "." + payload + ".signature"
}

func profileAuthServer(t *testing.T, accountID string) *httptest.Server {
	t.Helper()

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/user/profile" {
			http.NotFound(w, r)
			return
		}
		if strings.TrimSpace(r.Header.Get("Authorization")) == "" {
			http.Error(w, "missing authorization", http.StatusUnauthorized)
			return
		}
		writeTestJSON(t, w, map[string]any{
			"code":    0,
			"message": "success",
			"data": map[string]any{
				"id": accountID,
			},
		})
	}))
}

func writeTestJSON(t *testing.T, w http.ResponseWriter, payload any) {
	t.Helper()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		t.Fatalf("encode json: %v", err)
	}
}

func TestHealthEndpoint(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["ok"] != true {
		t.Errorf("expected ok=true, got %v", body["ok"])
	}
	if body["service"] != "syncflow-sidecar" {
		t.Errorf("expected service=syncflow-sidecar, got %v", body["service"])
	}
	if body["version"] != "0.1.0" {
		t.Errorf("expected version=0.1.0, got %v", body["version"])
	}
	if body["appCompatibilityVersion"] != float64(protocol.AppCompatibilityVersion) {
		t.Errorf(
			"expected appCompatibilityVersion=%d, got %v",
			protocol.AppCompatibilityVersion,
			body["appCompatibilityVersion"],
		)
	}
	capabilities, ok := body["capabilities"].(map[string]any)
	if !ok {
		t.Fatalf("expected capabilities object, got %T", body["capabilities"])
	}
	if capabilities["revokesPairingsOnCodeRotation"] != true {
		t.Errorf("expected revokesPairingsOnCodeRotation=true, got %v", capabilities["revokesPairingsOnCodeRotation"])
	}
}

func TestDashboardSummary(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/dashboard/summary")
	if err != nil {
		t.Fatalf("GET /dashboard/summary: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := body["todayUploadCount"]; !ok {
		t.Error("missing todayUploadCount")
	}
	if _, ok := body["todayOccupiedBytes"]; !ok {
		t.Error("missing todayOccupiedBytes")
	}
	if _, ok := body["remainingBytes"]; !ok {
		t.Error("missing remainingBytes")
	}
	if _, ok := body["isDiskLow"]; !ok {
		t.Error("missing isDiskLow")
	}
}

func TestDashboardDevices(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/dashboard/devices")
	if err != nil {
		t.Fatalf("GET /dashboard/devices: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body []any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Should be an empty array (not null)
	if body == nil {
		t.Error("expected empty array, got nil")
	}
}

func TestSharedDownloadSupportsRangeRequests(t *testing.T) {
	st, cfg, hub := testEnv(t)
	sharedDir := cfg.SharedDir()
	if err := os.MkdirAll(sharedDir, 0755); err != nil {
		t.Fatalf("mkdir shared dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sharedDir, "range.txt"), []byte("0123456789"), 0644); err != nil {
		t.Fatalf("write shared file: %v", err)
	}

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/shared/download/range.txt", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Range", "bytes=4-")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /shared/download/range.txt: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusPartialContent {
		t.Fatalf("expected 206, got %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Content-Range"); got != "bytes 4-9/10" {
		t.Fatalf("expected Content-Range bytes 4-9/10, got %q", got)
	}
	if got := resp.Header.Get("Last-Modified"); got == "" {
		t.Fatalf("expected Last-Modified validator for resumable downloads")
	}
	etag := resp.Header.Get("ETag")
	if etag == "" {
		t.Fatalf("expected ETag validator for resumable downloads")
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(body) != "456789" {
		t.Fatalf("expected resumed body, got %q", string(body))
	}

	matchingReq, err := http.NewRequest(http.MethodGet, srv.URL+"/shared/download/range.txt", nil)
	if err != nil {
		t.Fatalf("new matching request: %v", err)
	}
	matchingReq.Header.Set("Range", "bytes=4-")
	matchingReq.Header.Set("If-Range", etag)

	matchingResp, err := http.DefaultClient.Do(matchingReq)
	if err != nil {
		t.Fatalf("GET /shared/download/range.txt with matching If-Range: %v", err)
	}
	defer matchingResp.Body.Close()

	if matchingResp.StatusCode != http.StatusPartialContent {
		t.Fatalf("expected matching If-Range to return 206, got %d", matchingResp.StatusCode)
	}
	matchingBody, err := io.ReadAll(matchingResp.Body)
	if err != nil {
		t.Fatalf("read matching body: %v", err)
	}
	if string(matchingBody) != "456789" {
		t.Fatalf("expected matching If-Range resumed body, got %q", string(matchingBody))
	}

	staleReq, err := http.NewRequest(http.MethodGet, srv.URL+"/shared/download/range.txt", nil)
	if err != nil {
		t.Fatalf("new stale request: %v", err)
	}
	staleReq.Header.Set("Range", "bytes=4-")
	staleReq.Header.Set("If-Range", `"stale-etag"`)

	staleResp, err := http.DefaultClient.Do(staleReq)
	if err != nil {
		t.Fatalf("GET /shared/download/range.txt with stale If-Range: %v", err)
	}
	defer staleResp.Body.Close()

	if staleResp.StatusCode != http.StatusOK {
		t.Fatalf("expected stale If-Range to return 200, got %d", staleResp.StatusCode)
	}
	staleBody, err := io.ReadAll(staleResp.Body)
	if err != nil {
		t.Fatalf("read stale body: %v", err)
	}
	if string(staleBody) != "0123456789" {
		t.Fatalf("expected stale If-Range full body, got %q", string(staleBody))
	}
}

func TestDashboardDevicesIncludesStableIdentityMetadataWithoutHidingRows(t *testing.T) {
	st, cfg, hub := testEnv(t)

	now := time.Now().UTC()
	oldSeen := now.Add(-2 * time.Hour).Format(time.RFC3339)
	newSeen := now.Format(time.RFC3339)
	stableDeviceID := "physical-phone-1"

	insertPairedDeviceWithStableID(t, st, "client-old", "iPhone wen", "iPhone wen", stableDeviceID, oldSeen)
	insertPairedDeviceWithStableID(t, st, "client-new", "iPhone wen", "iPhone wen 2", stableDeviceID, newSeen)

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/dashboard/devices")
	if err != nil {
		t.Fatalf("GET /dashboard/devices: %v", err)
	}
	defer resp.Body.Close()

	var devices []struct {
		DeviceID       string `json:"deviceId"`
		StableDeviceID string `json:"stableDeviceId,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&devices); err != nil {
		t.Fatalf("decode dashboard devices: %v", err)
	}

	if len(devices) != 2 {
		t.Fatalf("expected API to keep both sync identities, got %d devices: %+v", len(devices), devices)
	}
	if devices[0].DeviceID != "client-new" {
		t.Fatalf("expected newest client-new first, got %q", devices[0].DeviceID)
	}
	if devices[0].StableDeviceID != stableDeviceID || devices[1].StableDeviceID != stableDeviceID {
		t.Fatalf("expected stable device metadata on both rows, got %+v", devices)
	}
}

func TestDashboardDevicesKeepsLegacySameNameRowsForSharedConsumers(t *testing.T) {
	st, cfg, hub := testEnv(t)

	now := time.Now().UTC()
	oldSeen := now.Add(-2 * time.Hour).Format(time.RFC3339)
	newSeen := now.Format(time.RFC3339)
	stableDeviceID := "physical-phone-1"

	insertPairedDeviceWithOptionalStableID(t, st, "client-old", "iPhone wen", "iPhone wen", nil, oldSeen)
	insertPairedDeviceWithStableID(t, st, "client-new", "iPhone wen", "iPhone wen 2", stableDeviceID, newSeen)

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/dashboard/devices")
	if err != nil {
		t.Fatalf("GET /dashboard/devices: %v", err)
	}
	defer resp.Body.Close()

	var devices []struct {
		DeviceID       string `json:"deviceId"`
		StableDeviceID string `json:"stableDeviceId,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&devices); err != nil {
		t.Fatalf("decode dashboard devices: %v", err)
	}

	if len(devices) != 2 {
		t.Fatalf("expected API to keep stable and legacy same-name rows, got %d devices: %+v", len(devices), devices)
	}
	if devices[0].DeviceID != "client-new" {
		t.Fatalf("expected newest stable client-new first, got %q", devices[0].DeviceID)
	}
	if devices[0].StableDeviceID != stableDeviceID {
		t.Fatalf("expected stable metadata on new row, got %+v", devices[0])
	}
	if devices[1].DeviceID != "client-old" || devices[1].StableDeviceID != "" {
		t.Fatalf("expected legacy row to remain without stable metadata, got %+v", devices[1])
	}
}

func TestDashboardDevicesExposeCurrentTransferProgress(t *testing.T) {
	st, cfg, hub := testEnv(t)

	now := time.Now().UTC().Format(time.RFC3339)
	dirName := "Android CDY-TN20"
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "client-active",
		ClientName:       "Android CDY-TN20",
		Platform:         "android",
		PairingID:        "pair-active",
		PairingTokenHash: "hash-active",
		CreatedAt:        now,
		LastSeenAt:       now,
		ReceiveDirName:   &dirName,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	fileKey := "file-active"
	if err := st.UpsertSession(store.Session{
		SessionID:     "session-active",
		ClientID:      "client-active",
		ClientName:    "Android CDY-TN20",
		State:         "transferring",
		ActiveFileKey: &fileKey,
		StartedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("UpsertSession: %v", err)
	}

	sessionID := "session-active"
	if err := st.UpsertUpload(store.Upload{
		FileKey:          fileKey,
		SessionID:        &sessionID,
		ClientID:         "client-active",
		OriginalFilename: "VID_0001.MP4",
		MediaType:        "video/mp4",
		FileSize:         2000,
		Status:           "receiving",
		CommittedBytes:   500,
		UpdatedAt:        now,
	}); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	handler := func() http.Handler {
		_, h := api.NewServer(st, cfg, hub, fakeClientStates{"client-active": "syncing"})
		return h
	}()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/dashboard/devices")
	if err != nil {
		t.Fatalf("GET /dashboard/devices: %v", err)
	}
	defer resp.Body.Close()

	var devices []struct {
		DeviceID    string `json:"deviceId"`
		Status      string `json:"status"`
		CurrentFile *struct {
			Filename string  `json:"filename"`
			Progress float64 `json:"progress"`
			FileSize int64   `json:"fileSize"`
		} `json:"currentFile,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&devices); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected one dashboard device, got %d", len(devices))
	}
	if devices[0].Status != "transferring" {
		t.Fatalf("expected transferring status, got %q", devices[0].Status)
	}
	if devices[0].CurrentFile == nil {
		t.Fatal("expected currentFile")
	}
	if devices[0].CurrentFile.Filename != "VID_0001.MP4" {
		t.Fatalf("expected filename VID_0001.MP4, got %q", devices[0].CurrentFile.Filename)
	}
	if devices[0].CurrentFile.Progress != 25 {
		t.Fatalf("expected progress 25, got %v", devices[0].CurrentFile.Progress)
	}
	if devices[0].CurrentFile.FileSize != 2000 {
		t.Fatalf("expected file size 2000, got %d", devices[0].CurrentFile.FileSize)
	}
}

func TestDashboardStatsIgnoreDeletedFinalFiles(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	now := time.Now()
	today := now.Format("2006-01-02")
	nowText := now.Format(time.RFC3339)
	dirName := "Test iPhone"
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "test-device-1",
		ClientName:       "Test iPhone",
		Platform:         "ios",
		PairingID:        "pair-1",
		PairingTokenHash: "hash-1",
		CreatedAt:        nowText,
		LastSeenAt:       nowText,
		ReceiveDirName:   &dirName,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}
	if err := st.UpsertDailyStats(store.DailyStats{
		StatDate:             today,
		ClientID:             "test-device-1",
		ClientNameSnapshot:   "Test iPhone",
		FileCount:            2,
		TotalBytes:           12,
		ActiveTransmissionMs: 50,
		UpdatedAt:            nowText,
	}); err != nil {
		t.Fatalf("UpsertDailyStats: %v", err)
	}

	dateDir := filepath.Join(cfg.ReceiveDir, dirName, today)
	if err := os.MkdirAll(dateDir, 0o755); err != nil {
		t.Fatalf("mkdir date dir: %v", err)
	}
	existingPath := filepath.Join(dirName, today, "IMG_0001.JPG")
	deletedPath := filepath.Join(dirName, today, "IMG_0002.JPG")
	if err := os.WriteFile(filepath.Join(cfg.ReceiveDir, existingPath), []byte("actual"), 0o644); err != nil {
		t.Fatalf("write existing file: %v", err)
	}
	for _, upload := range []store.Upload{
		{
			FileKey:          "file-existing",
			ClientID:         "test-device-1",
			OriginalFilename: "IMG_0001.JPG",
			MediaType:        "image",
			FileSize:         4,
			Status:           "completed",
			FinalPath:        &existingPath,
			CommittedBytes:   4,
			CompletedAt:      &nowText,
			UpdatedAt:        nowText,
		},
		{
			FileKey:          "file-deleted",
			ClientID:         "test-device-1",
			OriginalFilename: "IMG_0002.JPG",
			MediaType:        "image",
			FileSize:         8,
			Status:           "completed",
			FinalPath:        &deletedPath,
			CommittedBytes:   8,
			CompletedAt:      &nowText,
			UpdatedAt:        nowText,
		},
	} {
		if err := st.UpsertUpload(upload); err != nil {
			t.Fatalf("UpsertUpload %s: %v", upload.FileKey, err)
		}
	}

	resp, err := http.Get(srv.URL + "/dashboard/devices")
	if err != nil {
		t.Fatalf("GET /dashboard/devices: %v", err)
	}
	defer resp.Body.Close()

	var devices []struct {
		DeviceID       string `json:"deviceId"`
		TodayFileCount int    `json:"todayFileCount"`
		TodayBytes     int64  `json:"todayBytes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&devices); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected one dashboard device, got %d", len(devices))
	}
	if devices[0].TodayFileCount != 1 {
		t.Fatalf("expected dashboard device file count 1, got %d", devices[0].TodayFileCount)
	}
	if devices[0].TodayBytes != 6 {
		t.Fatalf("expected dashboard device bytes 6, got %d", devices[0].TodayBytes)
	}

	summaryResp, err := http.Get(srv.URL + "/dashboard/summary")
	if err != nil {
		t.Fatalf("GET /dashboard/summary: %v", err)
	}
	defer summaryResp.Body.Close()

	var summary struct {
		TodayUploadCount   int   `json:"todayUploadCount"`
		TodayOccupiedBytes int64 `json:"todayOccupiedBytes"`
	}
	if err := json.NewDecoder(summaryResp.Body).Decode(&summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary.TodayUploadCount != 1 {
		t.Fatalf("expected summary file count 1, got %d", summary.TodayUploadCount)
	}
	if summary.TodayOccupiedBytes != 6 {
		t.Fatalf("expected summary bytes 6, got %d", summary.TodayOccupiedBytes)
	}

	if err := os.Remove(filepath.Join(cfg.ReceiveDir, existingPath)); err != nil {
		t.Fatalf("remove existing file: %v", err)
	}

	respAfterDelete, err := http.Get(srv.URL + "/dashboard/devices")
	if err != nil {
		t.Fatalf("GET /dashboard/devices after delete: %v", err)
	}
	defer respAfterDelete.Body.Close()

	var devicesAfterDelete []struct {
		TodayFileCount int   `json:"todayFileCount"`
		TodayBytes     int64 `json:"todayBytes"`
	}
	if err := json.NewDecoder(respAfterDelete.Body).Decode(&devicesAfterDelete); err != nil {
		t.Fatalf("decode devices after delete: %v", err)
	}
	if devicesAfterDelete[0].TodayFileCount != 0 {
		t.Fatalf("expected dashboard device file count 0 after deletion, got %d", devicesAfterDelete[0].TodayFileCount)
	}
	if devicesAfterDelete[0].TodayBytes != 0 {
		t.Fatalf("expected dashboard device bytes 0 after deletion, got %d", devicesAfterDelete[0].TodayBytes)
	}

	summaryAfterDeleteResp, err := http.Get(srv.URL + "/dashboard/summary")
	if err != nil {
		t.Fatalf("GET /dashboard/summary after delete: %v", err)
	}
	defer summaryAfterDeleteResp.Body.Close()

	var summaryAfterDelete struct {
		TodayUploadCount   int   `json:"todayUploadCount"`
		TodayOccupiedBytes int64 `json:"todayOccupiedBytes"`
	}
	if err := json.NewDecoder(summaryAfterDeleteResp.Body).Decode(&summaryAfterDelete); err != nil {
		t.Fatalf("decode summary after delete: %v", err)
	}
	if summaryAfterDelete.TodayUploadCount != 0 {
		t.Fatalf("expected summary file count 0 after deletion, got %d", summaryAfterDelete.TodayUploadCount)
	}
	if summaryAfterDelete.TodayOccupiedBytes != 0 {
		t.Fatalf("expected summary bytes 0 after deletion, got %d", summaryAfterDelete.TodayOccupiedBytes)
	}
}

func TestDashboardDevicesIncludeLatestHistoricalStats(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	nowText := time.Now().Format(time.RFC3339)
	dirName := "History iPhone"
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "history-device-1",
		ClientName:       "History iPhone",
		Platform:         "ios",
		PairingID:        "pair-history-1",
		PairingTokenHash: "hash-history-1",
		CreatedAt:        nowText,
		LastSeenAt:       nowText,
		ReceiveDirName:   &dirName,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	latestDate := time.Now().AddDate(0, 0, -3).Format("2006-01-02")
	dateDir := filepath.Join(cfg.ReceiveDir, dirName, latestDate)
	if err := os.MkdirAll(dateDir, 0o755); err != nil {
		t.Fatalf("mkdir latest date dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dateDir, "IMG_0001.JPG"), []byte("history"), 0o644); err != nil {
		t.Fatalf("write latest file: %v", err)
	}

	resp, err := http.Get(srv.URL + "/dashboard/devices")
	if err != nil {
		t.Fatalf("GET /dashboard/devices: %v", err)
	}
	defer resp.Body.Close()

	var devices []struct {
		DeviceID        string `json:"deviceId"`
		TodayFileCount  int    `json:"todayFileCount"`
		TodayBytes      int64  `json:"todayBytes"`
		LatestDate      string `json:"latestDate"`
		LatestFileCount int    `json:"latestFileCount"`
		LatestBytes     int64  `json:"latestBytes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&devices); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected one dashboard device, got %d", len(devices))
	}
	if devices[0].TodayFileCount != 0 || devices[0].TodayBytes != 0 {
		t.Fatalf("expected today stats to stay empty, got %d files/%d bytes", devices[0].TodayFileCount, devices[0].TodayBytes)
	}
	if devices[0].LatestDate != latestDate {
		t.Fatalf("expected latestDate %q, got %q", latestDate, devices[0].LatestDate)
	}
	if devices[0].LatestFileCount != 1 {
		t.Fatalf("expected latestFileCount 1, got %d", devices[0].LatestFileCount)
	}
	if devices[0].LatestBytes != int64(len("history")) {
		t.Fatalf("expected latestBytes %d, got %d", len("history"), devices[0].LatestBytes)
	}
}

func TestPresenceHeartbeatBroadcastsConnectedIdleEvent(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := st.SetDeviceName("Desk Renamed"); err != nil {
		t.Fatalf("SetDeviceName: %v", err)
	}
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events/stream"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	defer conn.Close()

	req, err := http.NewRequest(http.MethodPost, srv.URL+"/presence/client-1", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /presence: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode presence response: %v", err)
	}
	if body["serverName"] != "Desk Renamed" {
		t.Fatalf("expected serverName Desk Renamed, got %v", body["serverName"])
	}

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, message, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ws message: %v", err)
	}

	var event struct {
		Type    string         `json:"type"`
		Payload map[string]any `json:"payload"`
	}
	if err := json.Unmarshal(message, &event); err != nil {
		t.Fatalf("unmarshal event: %v", err)
	}

	if event.Type != "device.state.changed" {
		t.Fatalf("expected device.state.changed, got %q", event.Type)
	}
	if event.Payload["deviceId"] != "client-1" {
		t.Fatalf("expected deviceId client-1, got %v", event.Payload["deviceId"])
	}
	if event.Payload["status"] != "connected_idle" {
		t.Fatalf("expected status connected_idle, got %v", event.Payload["status"])
	}
}

func TestDeviceDetail_NotFound(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/devices/nonexistent")
	if err != nil {
		t.Fatalf("GET /devices/nonexistent: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 404 {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestDeviceDetail_Found(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	// Insert a paired device
	now := time.Now().UTC().Format(time.RFC3339)
	err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "test-device-1",
		ClientName:       "Test iPhone",
		Platform:         "ios",
		PairingID:        "pair-1",
		PairingTokenHash: "hash-1",
		CreatedAt:        now,
		LastSeenAt:       now,
	})
	if err != nil {
		t.Fatalf("insert device: %v", err)
	}

	resp, err := http.Get(srv.URL + "/devices/test-device-1")
	if err != nil {
		t.Fatalf("GET /devices/test-device-1: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["deviceId"] != "test-device-1" {
		t.Errorf("expected deviceId=test-device-1, got %v", body["deviceId"])
	}
}

func TestDeviceFiles(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	today := time.Now().Format("2006-01-02")
	resp, err := http.Get(srv.URL + "/devices/test-device-1/files?date=" + today)
	if err != nil {
		t.Fatalf("GET /devices/.../files: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", body["items"])
	}
	if items == nil {
		t.Error("expected empty array, got nil")
	}
	if body["page"] != float64(1) {
		t.Fatalf("expected page=1, got %v", body["page"])
	}
}

func TestDeviceDates(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/devices/test-device-1/dates")
	if err != nil {
		t.Fatalf("GET /devices/.../dates: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	dates, ok := body["dates"]
	if !ok {
		t.Error("missing dates field")
	}
	// Should be an array (possibly empty)
	if _, ok := dates.([]any); !ok {
		t.Errorf("expected dates to be an array, got %T", dates)
	}
}

func TestDeviceDates_FilesystemFallback(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	now := time.Now().UTC().Format(time.RFC3339)
	err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "test-device-1",
		ClientName:       "Test iPhone",
		Platform:         "ios",
		PairingID:        "pair-1",
		PairingTokenHash: "hash-1",
		CreatedAt:        now,
		LastSeenAt:       now,
	})
	if err != nil {
		t.Fatalf("insert device: %v", err)
	}
	dirName := internalserver.SanitizeDirName("Test iPhone")
	if err := st.UpdateReceiveDirName("test-device-1", dirName); err != nil {
		t.Fatalf("update dir name: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(cfg.ReceiveDir, dirName, "2026-03-22"), 0o755); err != nil {
		t.Fatalf("mkdir fallback date dir: %v", err)
	}

	resp, err := http.Get(srv.URL + "/devices/test-device-1/dates")
	if err != nil {
		t.Fatalf("GET /devices/.../dates: %v", err)
	}
	defer resp.Body.Close()

	var body struct {
		Dates []string `json:"dates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Dates) == 0 || body.Dates[0] != "2026-03-22" {
		t.Fatalf("expected filesystem fallback date, got %v", body.Dates)
	}
}

func TestDeviceFiles_FilesystemFallback(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	now := time.Now().UTC().Format(time.RFC3339)
	err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "test-device-1",
		ClientName:       "Test iPhone",
		Platform:         "ios",
		PairingID:        "pair-1",
		PairingTokenHash: "hash-1",
		CreatedAt:        now,
		LastSeenAt:       now,
	})
	if err != nil {
		t.Fatalf("insert device: %v", err)
	}
	dirName := internalserver.SanitizeDirName("Test iPhone")
	if err := st.UpdateReceiveDirName("test-device-1", dirName); err != nil {
		t.Fatalf("update dir name: %v", err)
	}
	dateDir := filepath.Join(cfg.ReceiveDir, dirName, "2026-03-22")
	if err := os.MkdirAll(dateDir, 0o755); err != nil {
		t.Fatalf("mkdir fallback date dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dateDir, "IMG_0001.JPG"), []byte("demo"), 0o644); err != nil {
		t.Fatalf("write fallback file: %v", err)
	}

	resp, err := http.Get(srv.URL + "/devices/test-device-1/files?date=2026-03-22")
	if err != nil {
		t.Fatalf("GET /devices/.../files: %v", err)
	}
	defer resp.Body.Close()

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", body["items"])
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 fallback file, got %d", len(items))
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected fallback item object, got %T", items[0])
	}
	if item["originalFilename"] != "IMG_0001.JPG" {
		t.Fatalf("expected fallback filename, got %v", item["originalFilename"])
	}
}

func TestDeviceExistingFileKeys(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	finalPathExisting := filepath.Join("Test iPhone", "2026-03-22", "IMG_0001.JPG")
	absoluteExisting := filepath.Join(cfg.ReceiveDir, finalPathExisting)
	if err := os.MkdirAll(filepath.Dir(absoluteExisting), 0o755); err != nil {
		t.Fatalf("mkdir existing file dir: %v", err)
	}
	if err := os.WriteFile(absoluteExisting, []byte("demo"), 0o644); err != nil {
		t.Fatalf("write existing file: %v", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if err := st.UpsertUpload(store.Upload{
		FileKey:          "file-existing",
		ClientID:         "test-device-1",
		OriginalFilename: "IMG_0001.JPG",
		MediaType:        "image",
		FileSize:         4,
		Status:           "completed",
		FinalPath:        &finalPathExisting,
		CommittedBytes:   4,
		CompletedAt:      &now,
		UpdatedAt:        now,
	}); err != nil {
		t.Fatalf("insert existing upload: %v", err)
	}

	finalPathMissing := filepath.Join("Test iPhone", "2026-03-22", "IMG_0002.JPG")
	if err := st.UpsertUpload(store.Upload{
		FileKey:          "file-missing",
		ClientID:         "test-device-1",
		OriginalFilename: "IMG_0002.JPG",
		MediaType:        "image",
		FileSize:         4,
		Status:           "completed",
		FinalPath:        &finalPathMissing,
		CommittedBytes:   4,
		CompletedAt:      &now,
		UpdatedAt:        now,
	}); err != nil {
		t.Fatalf("insert missing upload: %v", err)
	}

	resp, err := http.Get(srv.URL + "/devices/test-device-1/existing-file-keys")
	if err != nil {
		t.Fatalf("GET /devices/.../existing-file-keys: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		FileKeys []string `json:"fileKeys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.FileKeys) != 1 {
		t.Fatalf("expected 1 existing file key, got %v", body.FileKeys)
	}
	if body.FileKeys[0] != "file-existing" {
		t.Fatalf("expected file-existing, got %v", body.FileKeys)
	}
}

func TestDeviceFilesSkipsDeletedFinalFiles(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	now := time.Now().UTC().Format(time.RFC3339)
	finalPathMissing := filepath.Join("Test iPhone", "2026-03-22", "IMG_0002.JPG")
	if err := st.UpsertUpload(store.Upload{
		FileKey:          "file-missing",
		ClientID:         "test-device-1",
		OriginalFilename: "IMG_0002.JPG",
		MediaType:        "image",
		FileSize:         4,
		Status:           "completed",
		FinalPath:        &finalPathMissing,
		CommittedBytes:   4,
		CompletedAt:      &now,
		UpdatedAt:        now,
	}); err != nil {
		t.Fatalf("insert missing upload: %v", err)
	}

	resp, err := http.Get(srv.URL + "/devices/test-device-1/files?date=" + time.Now().Format("2006-01-02"))
	if err != nil {
		t.Fatalf("GET /devices/.../files: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Items      []map[string]any `json:"items"`
		TotalItems int              `json:"totalItems"`
		TotalBytes int64            `json:"totalBytes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if len(body.Items) != 0 {
		t.Fatalf("expected no device files after final file deletion, got %d", len(body.Items))
	}
	if body.TotalItems != 0 {
		t.Fatalf("expected totalItems 0 after final file deletion, got %d", body.TotalItems)
	}
	if body.TotalBytes != 0 {
		t.Fatalf("expected totalBytes 0 after final file deletion, got %d", body.TotalBytes)
	}
}

func TestGetSettings(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/settings")
	if err != nil {
		t.Fatalf("GET /settings: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := body["deviceName"]; !ok {
		t.Error("missing deviceName")
	}
	if _, ok := body["connectionCode"]; !ok {
		t.Error("missing connectionCode")
	}
	if _, ok := body["receivePath"]; !ok {
		t.Error("missing receivePath")
	}
	if _, ok := body["personalPath"]; !ok {
		t.Error("missing personalPath")
	}
	if _, ok := body["shareStatus"]; !ok {
		t.Error("missing shareStatus")
	}
}

func TestGetSettingsDerivesManagedLayoutPaths(t *testing.T) {
	st, cfg, hub := testEnv(t)
	root := t.TempDir()
	personalRoot := filepath.Join(t.TempDir(), "Personal Share")
	cfg.ReceiveDir = filepath.Join(root, "received")
	if err := st.UpdateShareConfig(store.ShareConfig{ReceiveRoot: cfg.ReceiveDir}); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}
	if err := st.SetSetting("personal_share_root", personalRoot); err != nil {
		t.Fatalf("SetSetting(personal_share_root): %v", err)
	}

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/settings")
	if err != nil {
		t.Fatalf("GET /settings: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["rootPath"] != root {
		t.Fatalf("rootPath = %v, want %s", body["rootPath"], root)
	}
	if body["personalPath"] != personalRoot {
		t.Fatalf("personalPath = %v", body["personalPath"])
	}
	if body["sharedPath"] != filepath.Join(root, "shared") {
		t.Fatalf("sharedPath = %v", body["sharedPath"])
	}
	if body["receivePath"] != filepath.Join(root, "received") {
		t.Fatalf("receivePath = %v", body["receivePath"])
	}
}

func TestUpdateSettingsRootPathDerivesReceiveAndSharedWithoutChangingPersonalPath(t *testing.T) {
	st, cfg, hub := testEnv(t)
	personalRoot := filepath.Join(t.TempDir(), "Whole Disk")
	cfg.PersonalShareDir = personalRoot
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	root := filepath.Join(t.TempDir(), "storage")
	reqBody := `{"rootPath":` + strconv.Quote(root) + `}`
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/settings", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT /settings: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["rootPath"] != root {
		t.Fatalf("rootPath = %v, want %s", body["rootPath"], root)
	}
	if body["receivePath"] != filepath.Join(root, "received") {
		t.Fatalf("receivePath = %v", body["receivePath"])
	}
	if body["personalPath"] != personalRoot {
		t.Fatalf("personalPath = %v", body["personalPath"])
	}
	if body["sharedPath"] != filepath.Join(root, "shared") {
		t.Fatalf("sharedPath = %v", body["sharedPath"])
	}
}

func TestUpdateSettingsPersonalPathDoesNotChangeRootReceiveOrSharedPath(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	rootPath := cfg.RootDir()
	receivePath := cfg.ReceiveDir
	sharedPath := cfg.SharedDir()
	personalPath := filepath.Join(t.TempDir(), "Personal Share")

	reqBody := `{"personalPath":` + strconv.Quote(personalPath) + `}`
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/settings", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT /settings: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["rootPath"] != rootPath {
		t.Fatalf("rootPath = %v, want %s", body["rootPath"], rootPath)
	}
	if body["receivePath"] != receivePath {
		t.Fatalf("receivePath = %v, want %s", body["receivePath"], receivePath)
	}
	if body["sharedPath"] != sharedPath {
		t.Fatalf("sharedPath = %v, want %s", body["sharedPath"], sharedPath)
	}
	if body["personalPath"] != personalPath {
		t.Fatalf("personalPath = %v, want %s", body["personalPath"], personalPath)
	}
}

func TestUpdateSettingsRejectsReceivePathWithoutRootPath(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"receivePath":"/tmp/new-receive-path"}`
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/settings", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT /settings: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestSharedListRecreatesDeletedSharedDirectory(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.SharedDir(), 0o755); err != nil {
		t.Fatalf("mkdir shared dir: %v", err)
	}
	if err := os.RemoveAll(cfg.SharedDir()); err != nil {
		t.Fatalf("remove shared dir: %v", err)
	}

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/shared/list")
	if err != nil {
		t.Fatalf("GET /shared/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Files      []map[string]any `json:"files"`
		TotalCount int              `json:"totalCount"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.TotalCount != 0 {
		t.Fatalf("expected empty shared dir, got %d", body.TotalCount)
	}
	if info, err := os.Stat(cfg.SharedDir()); err != nil || !info.IsDir() {
		t.Fatalf("expected shared dir to be recreated, info=%v err=%v", info, err)
	}
}

func TestSharedListRejectsWindowsPathEscapes(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.SharedDir(), 0o755); err != nil {
		t.Fatalf("mkdir shared dir: %v", err)
	}

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	tests := []string{
		"/shared/list/..%5Coutside",
		"/shared/list/C:%5CWindows",
	}
	for _, path := range tests {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("GET %s status = %d, want 400", path, resp.StatusCode)
		}
	}
}

func TestPersonalListRequiresDesktopAccountIdentity(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/personal/list", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestPersonalListUsesAccountContextWithoutTunnelCredentials(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "notes.txt"), []byte("personal"), 0o644); err != nil {
		t.Fatalf("write personal file: %v", err)
	}
	authSrv := profileAuthServer(t, "account-1")
	defer authSrv.Close()

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"authBaseUrl":"` + authSrv.URL + `","accessToken":"token","accountId":"account-1"}`
	resp, err := http.Post(srv.URL+"/account/context", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /account/context: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected account context sync 200, got %d", resp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/personal/list", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d body=%s", resp.StatusCode, string(body))
	}
}

func TestAccountContextClearDisablesPersonalList(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	authSrv := profileAuthServer(t, "account-1")
	defer authSrv.Close()

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"authBaseUrl":"` + authSrv.URL + `","accessToken":"token","accountId":"account-1"}`
	resp, err := http.Post(srv.URL+"/account/context", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /account/context: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected account context sync 200, got %d", resp.StatusCode)
	}

	resp, err = http.Post(srv.URL+"/account/context", "application/json", strings.NewReader(`{"authBaseUrl":"","accessToken":""}`))
	if err != nil {
		t.Fatalf("POST /account/context clear: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected account context clear 200, got %d", resp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/personal/list", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestPersonalListRequiresBearerAccountToken(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	authSrv := profileAuthServer(t, "account-1")
	defer authSrv.Close()

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"signalingUrl":"` + authSrv.URL + `","accessToken":"token","accountId":"account-1","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected credentials sync 200, got %d", resp.StatusCode)
	}

	resp, err = http.Get(srv.URL + "/personal/list")
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestPersonalListUsesAccountIDFromPaddedJWTWhenCredentialsOmitAccountID(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "notes.txt"), []byte("personal"), 0o644); err != nil {
		t.Fatalf("write personal file: %v", err)
	}
	authSrv := profileAuthServer(t, "account-1")
	defer authSrv.Close()

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	desktopToken := fakePaddedAccountJWT(t, "account-1")
	reqBody := `{"signalingUrl":"` + authSrv.URL + `","accessToken":"` + desktopToken + `","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected credentials sync 200, got %d", resp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/personal/list", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d body=%s", resp.StatusCode, string(body))
	}
}

func TestPersonalListRejectsDifferentAccount(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	authSrv := profileAuthServer(t, "mobile-account")
	defer authSrv.Close()

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"signalingUrl":"` + authSrv.URL + `","accessToken":"token","accountId":"desktop-account","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected credentials sync 200, got %d", resp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/personal/list", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "mobile-account"))

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}

func TestPersonalListRejectsTokenWhenServerValidationFails(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	authSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "invalid token", http.StatusUnauthorized)
	}))
	defer authSrv.Close()

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"signalingUrl":"` + authSrv.URL + `","accessToken":"token","accountId":"account-1","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected credentials sync 200, got %d", resp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/personal/list", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestPersonalListRejectsTokenWhenProfileCodeIsNonZero(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	authSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeTestJSON(t, w, map[string]any{
			"code":    1006,
			"message": "invalid token",
			"data":    map[string]any{},
		})
	}))
	defer authSrv.Close()

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"signalingUrl":"` + authSrv.URL + `","accessToken":"token","accountId":"account-1","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected credentials sync 200, got %d", resp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/personal/list", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestPersonalListReturnsSameAccountPersonalDirectory(t *testing.T) {
	st, cfg, hub := testEnv(t)
	cfg.ReceiveDir = filepath.Join(t.TempDir(), "received")
	cfg.PersonalShareDir = filepath.Join(t.TempDir(), "Personal Share")
	personalDir := cfg.PersonalDir()
	if err := os.MkdirAll(personalDir, 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	if err := os.MkdirAll(cfg.ReceiveDir, 0o755); err != nil {
		t.Fatalf("mkdir receive dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(personalDir, "notes.txt"), []byte("personal"), 0o644); err != nil {
		t.Fatalf("write personal file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.ReceiveDir, "IMG_0001.JPG"), []byte("image"), 0o644); err != nil {
		t.Fatalf("write received file: %v", err)
	}
	authSrv := profileAuthServer(t, "account-1")
	defer authSrv.Close()

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"signalingUrl":"` + authSrv.URL + `","accessToken":"token","accountId":"account-1","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected credentials sync 200, got %d", resp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/personal/list", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Scope string `json:"scope"`
		Path  string `json:"path"`
		Files []struct {
			Name         string  `json:"name"`
			Path         string  `json:"path"`
			ThumbnailURL *string `json:"thumbnailUrl,omitempty"`
			IsDirectory  bool    `json:"isDirectory,omitempty"`
		} `json:"files"`
		TotalCount int `json:"totalCount"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Scope != "personal" {
		t.Fatalf("scope=%q, want personal", body.Scope)
	}
	if body.TotalCount != 1 {
		t.Fatalf("expected only notes.txt in personal share root, got %d files: %+v", body.TotalCount, body.Files)
	}
	paths := map[string]bool{}
	for _, file := range body.Files {
		paths[file.Path] = true
	}
	if !paths["notes.txt"] || paths["received"] || paths["IMG_0001.JPG"] {
		t.Fatalf("expected personal root to exclude receive directory contents, got %+v", body.Files)
	}
}

func TestPersonalListUsesConfiguredPersonalSharePathInsteadOfReceivePath(t *testing.T) {
	st, cfg, hub := testEnv(t)
	externalRoot := t.TempDir()
	personalRoot := filepath.Join(t.TempDir(), "Personal Share")
	cfg.ReceiveDir = filepath.Join(externalRoot, "received")
	cfg.PersonalShareDir = personalRoot
	if err := os.MkdirAll(cfg.ReceiveDir, 0o755); err != nil {
		t.Fatalf("mkdir custom receive dir: %v", err)
	}
	if err := os.MkdirAll(personalRoot, 0o755); err != nil {
		t.Fatalf("mkdir personal share dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.ReceiveDir, "photo.jpg"), []byte("image"), 0o644); err != nil {
		t.Fatalf("write personal file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(personalRoot, "notes.txt"), []byte("personal"), 0o644); err != nil {
		t.Fatalf("write personal file: %v", err)
	}
	authSrv := profileAuthServer(t, "account-1")
	defer authSrv.Close()

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"signalingUrl":"` + authSrv.URL + `","accessToken":"token","accountId":"account-1","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected credentials sync 200, got %d", resp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/personal/list", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Files []struct {
			Path string `json:"path"`
		} `json:"files"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	paths := map[string]bool{}
	for _, file := range body.Files {
		paths[file.Path] = true
	}
	if !paths["notes.txt"] {
		t.Fatalf("expected configured personal content in personal listing, got %+v", body.Files)
	}
	if paths["photo.jpg"] || paths["received"] {
		t.Fatalf("personal listing exposed receive path entries: %+v", body.Files)
	}
}

func TestPersonalListRejectsEscapes(t *testing.T) {
	st, cfg, hub := testEnv(t)
	personalDir := cfg.PersonalDir()
	if err := os.MkdirAll(personalDir, 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	authSrv := profileAuthServer(t, "account-1")
	defer authSrv.Close()

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"signalingUrl":"` + authSrv.URL + `","accessToken":"token","accountId":"account-1","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected credentials sync 200, got %d", resp.StatusCode)
	}

	tests := []string{
		"/personal/list/..%5Coutside",
		"/personal/list/C:%5CWindows",
	}
	for _, path := range tests {
		req, err := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		if err != nil {
			t.Fatalf("new request %s: %v", path, err)
		}
		req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("GET %s status = %d, want 400", path, resp.StatusCode)
		}
	}
}

func TestSharedListStaysAccessibleWithoutAccountToken(t *testing.T) {
	st, cfg, hub := testEnv(t)
	sharedDir := cfg.SharedDir()
	if err := os.MkdirAll(sharedDir, 0o755); err != nil {
		t.Fatalf("mkdir shared dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sharedDir, "team.txt"), []byte("team"), 0o644); err != nil {
		t.Fatalf("write shared file: %v", err)
	}

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/shared/list")
	if err != nil {
		t.Fatalf("GET /shared/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestResetState(t *testing.T) {
	st, cfg, hub := testEnv(t)
	cfg.ReceiveDir = filepath.Join(t.TempDir(), "external", "received")
	if err := os.MkdirAll(cfg.ReceiveDir, 0o755); err != nil {
		t.Fatalf("mkdir external receive dir: %v", err)
	}
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	if err := st.SetDeviceName("Desk Lab"); err != nil {
		t.Fatalf("SetDeviceName: %v", err)
	}
	if err := st.SetConnectionCode("482917"); err != nil {
		t.Fatalf("SetConnectionCode: %v", err)
	}

	validatedAt := "2026-03-31T10:00:00Z"
	if err := st.UpdateShareConfig(store.ShareConfig{
		ReceiveRoot:     cfg.ReceiveDir,
		ShareName:       "DeskShare",
		ShareURL:        "smb://desk/DeskShare",
		ShareStatus:     "valid",
		LastValidatedAt: &validatedAt,
	}); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "client-1",
		ClientName:       "Phone",
		Platform:         "ios",
		PairingID:        "pair-1",
		PairingTokenHash: "hash-1",
		CreatedAt:        now,
		LastSeenAt:       now,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}
	if err := st.UpsertSession(store.Session{
		SessionID:  "session-1",
		ClientID:   "client-1",
		ClientName: "Phone",
		State:      "completed",
		StartedAt:  now,
		UpdatedAt:  now,
	}); err != nil {
		t.Fatalf("UpsertSession: %v", err)
	}
	if err := st.UpsertUpload(store.Upload{
		FileKey:          "file-1",
		ClientID:         "client-1",
		OriginalFilename: "IMG_0001.JPG",
		MediaType:        "image",
		FileSize:         4,
		Status:           "completed",
		CommittedBytes:   4,
		UpdatedAt:        now,
	}); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}
	if err := st.UpsertDailyStats(store.DailyStats{
		StatDate:             "2026-03-31",
		ClientID:             "client-1",
		ClientNameSnapshot:   "Phone",
		FileCount:            1,
		TotalBytes:           4,
		ActiveTransmissionMs: 50,
		UpdatedAt:            now,
	}); err != nil {
		t.Fatalf("UpsertDailyStats: %v", err)
	}

	if err := os.MkdirAll(filepath.Join(cfg.ReceiveDir, "Phone", "2026-03-31"), 0o755); err != nil {
		t.Fatalf("mkdir receive path: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.ReceiveDir, "Phone", "2026-03-31", "IMG_0001.JPG"), []byte("demo"), 0o644); err != nil {
		t.Fatalf("write receive file: %v", err)
	}
	if err := os.MkdirAll(cfg.StagingDir(), 0o755); err != nil {
		t.Fatalf("mkdir staging path: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.StagingDir(), "resume.part"), []byte("partial"), 0o644); err != nil {
		t.Fatalf("write staging file: %v", err)
	}
	if cfg.LegacyStagingDir() != cfg.StagingDir() {
		if err := os.MkdirAll(cfg.LegacyStagingDir(), 0o755); err != nil {
			t.Fatalf("mkdir legacy staging path: %v", err)
		}
		if err := os.WriteFile(filepath.Join(cfg.LegacyStagingDir(), "legacy.part"), []byte("legacy partial"), 0o644); err != nil {
			t.Fatalf("write legacy staging file: %v", err)
		}
	}

	resp, err := http.Post(srv.URL+"/settings/reset-state", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST /settings/reset-state: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		OK bool `json:"ok"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode reset response: %v", err)
	}
	if !body.OK {
		t.Fatal("expected ok=true")
	}

	for _, tc := range []struct {
		name  string
		query string
	}{
		{name: "paired_devices", query: "SELECT COUNT(*) FROM paired_devices"},
		{name: "sessions", query: "SELECT COUNT(*) FROM sessions"},
		{name: "uploads", query: "SELECT COUNT(*) FROM uploads"},
		{name: "device_daily_stats", query: "SELECT COUNT(*) FROM device_daily_stats"},
	} {
		var count int
		if err := st.DB().QueryRow(tc.query).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", tc.name, err)
		}
		if count != 0 {
			t.Fatalf("expected %s to be empty, got %d rows", tc.name, count)
		}
	}

	settingsHTTPResp, err := http.Get(srv.URL + "/settings")
	if err != nil {
		t.Fatalf("GET /settings after reset: %v", err)
	}
	defer settingsHTTPResp.Body.Close()

	var settingsBody settingsResp
	if err := json.NewDecoder(settingsHTTPResp.Body).Decode(&settingsBody); err != nil {
		t.Fatalf("decode settings after reset: %v", err)
	}
	if settingsBody.DeviceName != "Desk Lab" {
		t.Fatalf("expected deviceName to be preserved, got %q", settingsBody.DeviceName)
	}
	if settingsBody.ConnectionCode != "482917" {
		t.Fatalf("expected connection code to be preserved, got %q", settingsBody.ConnectionCode)
	}
	if settingsBody.ReceivePath != cfg.ReceiveDir {
		t.Fatalf("expected receive path to be preserved, got %q", settingsBody.ReceivePath)
	}
	if settingsBody.ShareAddress != "smb://desk/DeskShare" {
		t.Fatalf("expected share address to be preserved, got %q", settingsBody.ShareAddress)
	}
	if settingsBody.ShareName != "DeskShare" {
		t.Fatalf("expected share name to be preserved, got %q", settingsBody.ShareName)
	}
	if settingsBody.ShareStatus != "valid" {
		t.Fatalf("expected share status to be preserved, got %q", settingsBody.ShareStatus)
	}

	receiveEntries, err := os.ReadDir(cfg.ReceiveDir)
	if err != nil {
		t.Fatalf("ReadDir receive: %v", err)
	}
	if len(receiveEntries) != 0 {
		t.Fatalf("expected receive dir to be empty, got %d entries", len(receiveEntries))
	}

	stagingEntries, err := os.ReadDir(cfg.StagingDir())
	if err != nil {
		t.Fatalf("ReadDir staging: %v", err)
	}
	if len(stagingEntries) != 0 {
		t.Fatalf("expected staging dir to be empty, got %d entries", len(stagingEntries))
	}

	if cfg.LegacyStagingDir() != cfg.StagingDir() {
		legacyEntries, err := os.ReadDir(cfg.LegacyStagingDir())
		if err != nil {
			t.Fatalf("ReadDir legacy staging: %v", err)
		}
		if len(legacyEntries) != 0 {
			t.Fatalf("expected legacy staging dir to be empty, got %d entries", len(legacyEntries))
		}
	}
}

func TestResetStateReturnsUnavailableWhenStorageParentMissing(t *testing.T) {
	st, cfg, hub := testEnv(t)
	missingMount := filepath.Join(t.TempDir(), "MissingExternalDisk")
	cfg.ReceiveDir = filepath.Join(missingMount, "ViviDrop", "received")

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/settings/reset-state", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST /settings/reset-state: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", resp.StatusCode)
	}
	if _, err := os.Stat(missingMount); !os.IsNotExist(err) {
		t.Fatalf("expected missing mount point not to be created, err=%v", err)
	}
}

func TestResetStateRejectsActiveTransfer(t *testing.T) {
	st, cfg, hub := testEnv(t)
	now := time.Now().UTC().Format(time.RFC3339)
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "client-active",
		ClientName:       "Phone",
		Platform:         "ios",
		PairingID:        "pair-active",
		PairingTokenHash: "hash-active",
		CreatedAt:        now,
		LastSeenAt:       now,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	handler := func() http.Handler {
		_, h := api.NewServer(st, cfg, hub, fakeClientStates{"client-active": "syncing"})
		return h
	}()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/settings/reset-state", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST /settings/reset-state: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409, got %d", resp.StatusCode)
	}

	var count int
	if err := st.DB().QueryRow("SELECT COUNT(*) FROM paired_devices").Scan(&count); err != nil {
		t.Fatalf("count paired_devices: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected paired device to remain after rejected reset, got %d", count)
	}
}

func TestRegenerateCode(t *testing.T) {
	st, cfg, hub := testEnv(t)
	now := time.Now().UTC().Format(time.RFC3339)
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "known-client",
		ClientName:       "Known iPhone",
		Platform:         "ios",
		PairingID:        "pair-known-client",
		PairingTokenHash: "hash-known-client",
		CreatedAt:        now,
		LastSeenAt:       now,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/connection-code/regenerate", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /connection-code/regenerate: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	code := body["code"]
	if len(code) != 6 {
		t.Errorf("expected 6-digit code, got %q", code)
	}
	// Verify it is all digits
	for _, c := range code {
		if c < '0' || c > '9' {
			t.Errorf("code contains non-digit: %c", c)
		}
	}
	// Verify the code is >= 100000
	if code < "100000" {
		t.Errorf("expected code >= 100000, got %s", code)
	}

	device, err := st.GetPairedDevice("known-client")
	if err != nil {
		t.Fatalf("GetPairedDevice after regenerate: %v", err)
	}
	if device.RevokedAt == nil {
		t.Fatal("expected existing paired device to be revoked after connection code regeneration")
	}
}

func TestConnectionCodeAutoRegeneration(t *testing.T) {
	st, cfg, hub := testEnv(t)

	// Verify the migration seeds connection_code as "000000"
	code, err := st.GetConnectionCode()
	if err != nil {
		t.Fatalf("GetConnectionCode: %v", err)
	}
	if code != "000000" {
		t.Fatalf("expected seed code 000000, got %s", code)
	}

	// Simulate bootstrapReconciliation (as main.go does on startup):
	// detect the placeholder and replace it with a real 6-digit code.
	if code == "000000" {
		if err := st.SetConnectionCode("482917"); err != nil {
			t.Fatalf("SetConnectionCode: %v", err)
		}
	}

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	// Step 1: GET /settings should return the bootstrapped (non-"000000") code
	resp, err := http.Get(srv.URL + "/settings")
	if err != nil {
		t.Fatalf("GET /settings: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var settings settingsResp
	if err := json.NewDecoder(resp.Body).Decode(&settings); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	if settings.ConnectionCode == "000000" {
		t.Fatal("expected connection code to have been auto-regenerated, still 000000")
	}
	if len(settings.ConnectionCode) != 6 {
		t.Fatalf("expected 6-digit code, got %q", settings.ConnectionCode)
	}
	oldCode := settings.ConnectionCode

	// Step 2: POST /connection-code/regenerate should return a new code
	resp2, err := http.Post(srv.URL+"/connection-code/regenerate", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /connection-code/regenerate: %v", err)
	}
	defer resp2.Body.Close()

	if resp2.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp2.StatusCode)
	}

	var regenResp map[string]string
	if err := json.NewDecoder(resp2.Body).Decode(&regenResp); err != nil {
		t.Fatalf("decode regenerate: %v", err)
	}
	newCode := regenResp["code"]
	if len(newCode) != 6 {
		t.Fatalf("expected 6-digit code from regenerate, got %q", newCode)
	}
	if newCode < "100000" {
		t.Errorf("expected code >= 100000, got %s", newCode)
	}
	if newCode == oldCode {
		t.Errorf("expected regenerated code to differ from old code %s", oldCode)
	}

	// Step 3: GET /settings should now reflect the regenerated code
	resp3, err := http.Get(srv.URL + "/settings")
	if err != nil {
		t.Fatalf("GET /settings (after regen): %v", err)
	}
	defer resp3.Body.Close()

	if resp3.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp3.StatusCode)
	}

	var updatedSettings settingsResp
	if err := json.NewDecoder(resp3.Body).Decode(&updatedSettings); err != nil {
		t.Fatalf("decode updated settings: %v", err)
	}
	if updatedSettings.ConnectionCode != newCode {
		t.Errorf("GET /settings code = %s, want %s", updatedSettings.ConnectionCode, newCode)
	}
}

// settingsResp mirrors the settings JSON response for test decoding.
type settingsResp struct {
	DeviceName     string `json:"deviceName"`
	ConnectionCode string `json:"connectionCode"`
	ReceivePath    string `json:"receivePath"`
	ShareAddress   string `json:"shareAddress"`
	ShareStatus    string `json:"shareStatus"`
	ShareName      string `json:"shareName"`
}

func TestShareStatus(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/share/status")
	if err != nil {
		t.Fatalf("GET /share/status: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := body["status"]; !ok {
		t.Error("missing status field")
	}
}

func TestShareValidate(t *testing.T) {
	st, cfg, hub := testEnv(t)
	shareStatusChanged := false
	handler := func() http.Handler {
		srv, h := api.NewServer(st, cfg, hub, nil)
		srv.OnShareStatusChanged = func() {
			shareStatusChanged = true
		}
		return h
	}()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/share/validate", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /share/validate: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := body["status"]; !ok {
		t.Error("missing status field")
	}
	if !shareStatusChanged {
		t.Fatal("expected share status changed callback")
	}
}

func TestSyncTunnelCredentials(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"signalingUrl":"https://signaling.example.com","accessToken":"token","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["ok"] != true {
		t.Errorf("expected ok = true, got %v", body["ok"])
	}
}

func TestSyncTunnelCredentialsStartsDesktopSignaling(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithOptionalStableID(t, st, "mobile-123", "iPhone", "iPhone", nil, time.Now().UTC().Format(time.RFC3339))

	registerCh := make(chan map[string]any, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	signalingSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/tunnel/signaling" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("role") != "desktop" {
			http.Error(w, "unexpected role", http.StatusBadRequest)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var payload map[string]any
		if err := json.Unmarshal(msg, &payload); err != nil {
			return
		}
		registerCh <- payload
	}))
	defer signalingSrv.Close()

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	t.Cleanup(func() {
		_, _ = http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(`{"signalingUrl":"","accessToken":"","iceServers":[]}`))
	})

	reqBody := `{"signalingUrl":"` + signalingSrv.URL + `","accessToken":"token","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	select {
	case payload := <-registerCh:
		if payload["type"] != "register_desktop" {
			t.Fatalf("register type=%v, want register_desktop", payload["type"])
		}
		deviceID, err := st.GetDeviceID()
		if err != nil {
			t.Fatalf("GetDeviceID: %v", err)
		}
		if payload["clientId"] != deviceID {
			t.Fatalf("clientId=%v, want %s", payload["clientId"], deviceID)
		}
		paired, ok := payload["pairedDevices"].([]any)
		if !ok || len(paired) != 1 {
			t.Fatalf("pairedDevices=%#v, want one device", payload["pairedDevices"])
		}
		first, ok := paired[0].(map[string]any)
		if !ok {
			t.Fatalf("pairedDevices[0]=%#v", paired[0])
		}
		if first["clientId"] != "mobile-123" {
			t.Fatalf("paired clientId=%v, want mobile-123", first["clientId"])
		}
		if first["pairingToken"] != "hash-mobile-123" {
			t.Fatalf("pairingToken=%v, want stored hash", first["pairingToken"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("desktop signaling registration was not sent")
	}
}

func TestRefreshTunnelPairingsResendsDesktopRegistration(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithOptionalStableID(t, st, "mobile-1", "iPhone", "iPhone", nil, time.Now().UTC().Format(time.RFC3339))

	registerCh := make(chan map[string]any, 2)
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	signalingSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/tunnel/signaling" {
			http.NotFound(w, r)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var payload map[string]any
			if err := json.Unmarshal(msg, &payload); err != nil {
				continue
			}
			if payload["type"] == "register_desktop" {
				registerCh <- payload
			}
		}
	}))
	defer signalingSrv.Close()

	apiSrv, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	t.Cleanup(func() {
		_, _ = http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(`{"signalingUrl":"","accessToken":"","iceServers":[]}`))
	})

	reqBody := `{"signalingUrl":"` + signalingSrv.URL + `","accessToken":"token","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	select {
	case payload := <-registerCh:
		paired, ok := payload["pairedDevices"].([]any)
		if !ok || len(paired) != 1 {
			t.Fatalf("initial pairedDevices=%#v, want one device", payload["pairedDevices"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("initial desktop registration was not sent")
	}

	insertPairedDeviceWithOptionalStableID(t, st, "mobile-2", "iPad", "iPad", nil, time.Now().UTC().Format(time.RFC3339))
	apiSrv.RefreshTunnelPairings("test")

	select {
	case payload := <-registerCh:
		paired, ok := payload["pairedDevices"].([]any)
		if !ok || len(paired) != 2 {
			t.Fatalf("refreshed pairedDevices=%#v, want two devices", payload["pairedDevices"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("refreshed desktop registration was not sent")
	}
}
