package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/config"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/events"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
)

func TestDeriveDeviceReceiveLocationsFiltersDeduplicatesAndSorts(t *testing.T) {
	receiveDir := filepath.Join(t.TempDir(), "received")
	currentFolder := filepath.Join(receiveDir, "Phone")
	historicalFolder := filepath.Join(t.TempDir(), "Archive", "Old Phone")
	siblingFolder := filepath.Join(receiveDir+"-archive", "Sibling Phone")
	for _, path := range []string{currentFolder, historicalFolder, siblingFolder} {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatalf("MkdirAll(%q): %v", path, err)
		}
	}
	missingFolder := filepath.Join(t.TempDir(), "Missing", "Missing Phone")

	currentOlder := "2026-07-20T09:00:00Z"
	historicalUsedAt := "2026-07-21T15:00:00Z"
	missingUsedAt := "2026-07-23T10:00:00Z"
	siblingUsedAt := "2026-07-22T11:00:00Z"
	invalidTimestamp := "not-rfc3339"
	uploads := []store.CompletedUploadLocation{
		locationUpload(filepath.Join("Phone", "2026-07-22", "one.jpg"), &currentOlder, currentOlder),
		locationUpload(filepath.Join("Phone", "2026-07-22", "two.jpg"), nil, "2026-07-22T12:00:00Z"),
		locationUpload(filepath.Join(historicalFolder, "2026-07-21", "old.jpg"), &historicalUsedAt, historicalUsedAt),
		locationUpload(filepath.Join(missingFolder, "2026-07-23", "missing.jpg"), &missingUsedAt, missingUsedAt),
		locationUpload(filepath.Join(siblingFolder, "2026-07-22", "sibling.jpg"), &siblingUsedAt, siblingUsedAt),
		locationUpload(filepath.Join("Phone", "2026-07-22", "nested", "bad.jpg"), &currentOlder, currentOlder),
		locationUpload(filepath.Join("Phone", "bad-date", "bad.jpg"), &currentOlder, currentOlder),
		locationUpload(filepath.Join("2026-07-22", "root-level.jpg"), &currentOlder, currentOlder),
		locationUpload(filepath.Join("..", "outside", "2026-07-22", "bad.jpg"), &currentOlder, currentOlder),
		locationUpload(".", &currentOlder, currentOlder),
		locationUpload("", &currentOlder, currentOlder),
		locationUpload(filepath.Join(receiveDir, "2026-07-22", "root-device.jpg"), &currentOlder, currentOlder),
		locationUpload(filepath.Join(string(filepath.Separator), "2026-07-22", "root-device.jpg"), &currentOlder, currentOlder),
		locationUpload(filepath.Join(historicalFolder, "2026-07-21", "invalid-time.jpg"), &invalidTimestamp, historicalUsedAt),
		{CompletedAt: &currentOlder, UpdatedAt: currentOlder},
	}

	got := deriveDeviceReceiveLocations(receiveDir, uploads)
	want := []deviceReceiveLocation{
		{Path: currentFolder, Available: true, IsCurrent: true, LastUsedAt: "2026-07-22T12:00:00Z"},
		{Path: missingFolder, Available: false, IsCurrent: false, LastUsedAt: missingUsedAt},
		{Path: siblingFolder, Available: true, IsCurrent: false, LastUsedAt: siblingUsedAt},
		{Path: historicalFolder, Available: true, IsCurrent: false, LastUsedAt: historicalUsedAt},
	}
	assertReceiveLocations(t, got, want)
}

func TestRenderDeviceReceiveLocationsRejectsUnsafeAndInvalidEntries(t *testing.T) {
	receiveDir := filepath.Join(t.TempDir(), "received")
	currentFolder := filepath.Join(receiveDir, "Phone")
	historicalFolder := filepath.Join(t.TempDir(), "Archive", "Phone")
	if err := os.MkdirAll(currentFolder, 0o755); err != nil {
		t.Fatalf("MkdirAll current folder: %v", err)
	}

	stored := []store.DeviceReceiveLocation{
		{Path: currentFolder, LastUsedAt: "2026-07-22T12:00:00Z"},
		{Path: historicalFolder, LastUsedAt: "2026-07-21T12:00:00Z"},
		{Path: "relative/Phone", LastUsedAt: "2026-07-23T12:00:00Z"},
		{Path: receiveDir, LastUsedAt: "2026-07-24T12:00:00Z"},
		{Path: filepath.VolumeName(receiveDir) + string(filepath.Separator), LastUsedAt: "2026-07-25T12:00:00Z"},
		{Path: filepath.Join(t.TempDir(), "Invalid Time"), LastUsedAt: "invalid"},
	}

	got := renderDeviceReceiveLocations(receiveDir, stored)
	want := []deviceReceiveLocation{
		{Path: currentFolder, Available: true, IsCurrent: true, LastUsedAt: "2026-07-22T12:00:00Z"},
		{Path: historicalFolder, Available: false, IsCurrent: false, LastUsedAt: "2026-07-21T12:00:00Z"},
	}
	assertReceiveLocations(t, got, want)
}

func TestReceiveLocationsWindowsPathKeyIsCaseInsensitive(t *testing.T) {
	upper := filepath.Join(string(filepath.Separator), "Archive", "Phone")
	lower := strings.ToLower(upper)
	if got, want := receiveLocationPathKey(upper, "windows"), receiveLocationPathKey(lower, "windows"); got != want {
		t.Fatalf("Windows keys differ: %q != %q", got, want)
	}
	if upper != lower && receiveLocationPathKey(upper, "linux") == receiveLocationPathKey(lower, "linux") {
		t.Fatal("non-Windows path keys unexpectedly ignore case")
	}
}

func TestDeviceReceiveLocationsEndpointBackfillsPersistsAndIsLocalOnly(t *testing.T) {
	st, cfg, hub := newReceiveLocationsTestEnv(t)
	currentFolder := filepath.Join(cfg.ReceiveDir, "Phone")
	if err := os.MkdirAll(currentFolder, 0o755); err != nil {
		t.Fatalf("MkdirAll current folder: %v", err)
	}
	completedAt := "2026-07-22T12:00:00Z"
	insertCompletedLocationUpload(t, st, "target", "client-1", filepath.Join("Phone", "2026-07-22", "photo.jpg"), &completedAt, completedAt)
	insertCompletedLocationUpload(t, st, "other", "client-2", filepath.Join("Other", "2026-07-23", "other.jpg"), &completedAt, completedAt)

	srv, handler := NewServer(st, cfg, hub, nil)
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)

	first := getReceiveLocations(t, httpServer.URL+"/devices/client-1/receive-locations")
	assertReceiveLocations(t, first, []deviceReceiveLocation{{
		Path: currentFolder, Available: true, IsCurrent: true, LastUsedAt: completedAt,
	}})

	if _, err := st.DB().Exec("DELETE FROM uploads"); err != nil {
		t.Fatalf("delete source uploads: %v", err)
	}
	second := getReceiveLocations(t, httpServer.URL+"/devices/client-1/receive-locations")
	assertReceiveLocations(t, second, first)

	empty := getReceiveLocations(t, httpServer.URL+"/devices/empty-client/receive-locations")
	if empty == nil || len(empty) != 0 {
		t.Fatalf("empty response = %#v, want non-nil empty slice", empty)
	}

	remoteReq := httptest.NewRequest(http.MethodGet, "/devices/client-1/receive-locations", nil)
	remoteReq.RemoteAddr = "192.168.1.20:61234"
	remoteResp := httptest.NewRecorder()
	handler.ServeHTTP(remoteResp, remoteReq)
	if remoteResp.Code != http.StatusForbidden {
		t.Fatalf("remote status = %d, want %d body=%s", remoteResp.Code, http.StatusForbidden, remoteResp.Body.String())
	}
	if !strings.Contains(remoteResp.Body.String(), "local access required") {
		t.Fatalf("remote body = %s, want local access error", remoteResp.Body.String())
	}

	missingPathReq := httptest.NewRequest(http.MethodGet, "/", nil)
	missingPathResp := httptest.NewRecorder()
	srv.handleDeviceReceiveLocations(missingPathResp, missingPathReq)
	if missingPathResp.Code != http.StatusBadRequest {
		t.Fatalf("missing path status = %d, want %d", missingPathResp.Code, http.StatusBadRequest)
	}
}

func TestDeviceReceiveLocationsEndpointFiltersInvalidPersistedRows(t *testing.T) {
	st, cfg, hub := newReceiveLocationsTestEnv(t)
	valid := filepath.Join(t.TempDir(), "Archive", "Phone")
	if err := st.CacheDeviceReceiveLocations("client-1", []store.DeviceReceiveLocation{
		{Path: valid, LastUsedAt: "2026-07-22T12:00:00Z"},
		{Path: "relative/Phone", LastUsedAt: "2026-07-23T12:00:00Z"},
		{Path: filepath.Join(t.TempDir(), "Bad Time"), LastUsedAt: "not-rfc3339"},
	}); err != nil {
		t.Fatalf("CacheDeviceReceiveLocations: %v", err)
	}
	_, handler := NewServer(st, cfg, hub, nil)
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)

	got := getReceiveLocations(t, httpServer.URL+"/devices/client-1/receive-locations")
	assertReceiveLocations(t, got, []deviceReceiveLocation{{
		Path: valid, Available: false, IsCurrent: false, LastUsedAt: "2026-07-22T12:00:00Z",
	}})
}

func TestDeviceReceiveLocationsEndpointReturnsInternalErrorWhenStoreReadFails(t *testing.T) {
	st, cfg, hub := newReceiveLocationsTestEnv(t)
	srv := &Server{store: st, config: cfg, hub: hub}
	if err := st.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/devices/client-1/receive-locations", nil)
	req.SetPathValue("deviceId", "client-1")
	resp := httptest.NewRecorder()
	srv.handleDeviceReceiveLocations(resp, req)
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d body=%s", resp.Code, http.StatusInternalServerError, resp.Body.String())
	}
}

func locationUpload(path string, completedAt *string, updatedAt string) store.CompletedUploadLocation {
	return store.CompletedUploadLocation{FinalPath: &path, CompletedAt: completedAt, UpdatedAt: updatedAt}
}

func newReceiveLocationsTestEnv(t *testing.T) (*store.Store, *config.Config, *events.Hub) {
	t.Helper()
	root := t.TempDir()
	st, err := store.New(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	receiveDir := filepath.Join(root, "received")
	if err := os.MkdirAll(receiveDir, 0o755); err != nil {
		t.Fatalf("MkdirAll receive dir: %v", err)
	}
	return st, &config.Config{DataDir: root, ReceiveDir: receiveDir}, events.NewHub()
}

func insertCompletedLocationUpload(
	t *testing.T,
	st *store.Store,
	fileKey string,
	clientID string,
	finalPath string,
	completedAt *string,
	updatedAt string,
) {
	t.Helper()
	if err := st.UpsertUpload(store.Upload{
		FileKey:          fileKey,
		ClientID:         clientID,
		OriginalFilename: filepath.Base(finalPath),
		MediaType:        "image/jpeg",
		FileSize:         1,
		Status:           "completed",
		FinalPath:        &finalPath,
		CompletedAt:      completedAt,
		UpdatedAt:        updatedAt,
	}); err != nil {
		t.Fatalf("UpsertUpload(%q): %v", fileKey, err)
	}
}

func getReceiveLocations(t *testing.T, url string) []deviceReceiveLocation {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s status = %d, want %d", url, resp.StatusCode, http.StatusOK)
	}
	var locations []deviceReceiveLocation
	if err := json.NewDecoder(resp.Body).Decode(&locations); err != nil {
		t.Fatalf("decode receive locations: %v", err)
	}
	return locations
}

func assertReceiveLocations(t *testing.T, got, want []deviceReceiveLocation) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("locations = %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("location[%d] = %#v, want %#v", i, got[i], want[i])
		}
	}
}
