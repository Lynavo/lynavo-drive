package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nicksyncflow/sidecar/internal/api"
	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
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
	if _, ok := body["shareStatus"]; !ok {
		t.Error("missing shareStatus")
	}
}

func TestUpdateSettings(t *testing.T) {
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

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["receivePath"] != "/tmp/new-receive-path" {
		t.Errorf("expected updated receivePath, got %v", body["receivePath"])
	}
}

func TestRegenerateCode(t *testing.T) {
	st, cfg, hub := testEnv(t)
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
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
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
}
