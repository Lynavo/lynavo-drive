package api_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
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

const (
	directoryThumbnailMaxEdge     = 256
	directoryThumbnailJPEGQuality = 80
)

type videoThumbnailRequestEvent struct {
	Type    string `json:"type"`
	Payload struct {
		RequestID     string `json:"requestId"`
		SourcePath    string `json:"sourcePath"`
		CachePath     string `json:"cachePath"`
		SourceVersion string `json:"sourceVersion"`
		MaxEdge       int    `json:"maxEdge"`
		Quality       int    `json:"quality"`
	} `json:"payload"`
}

func readVideoThumbnailRequestEvent(t *testing.T, conn *websocket.Conn, timeout time.Duration) videoThumbnailRequestEvent {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(timeout))
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read video thumbnail event: %v", err)
		}
		var event videoThumbnailRequestEvent
		if err := json.Unmarshal(msg, &event); err != nil {
			t.Fatalf("unmarshal video thumbnail event: %v", err)
		}
		if event.Type == "video.thumbnail.request" {
			return event
		}
	}
}

func drainVideoThumbnailRequestEvents(t *testing.T, conn *websocket.Conn, timeout time.Duration) int {
	t.Helper()
	deadline := time.Now().Add(timeout)
	count := 0
	for {
		conn.SetReadDeadline(deadline)
		_, msg, err := conn.ReadMessage()
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				return count
			}
			t.Fatalf("drain video thumbnail events: %v", err)
		}
		var event videoThumbnailRequestEvent
		if err := json.Unmarshal(msg, &event); err != nil {
			t.Fatalf("unmarshal drained event: %v", err)
		}
		if event.Type == "video.thumbnail.request" {
			count++
		}
	}
}

func writeJPEGFixture(t *testing.T, path string, width int, height int) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{
				R: uint8((x * 255) / width),
				G: uint8((y * 255) / height),
				B: 160,
				A: 255,
			})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create jpeg fixture: %v", err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode jpeg fixture: %v", err)
	}
}

func authenticatePersonalAPITestServer(
	t *testing.T,
	st *store.Store,
	cfg *config.Config,
	hub *events.Hub,
) *httptest.Server {
	t.Helper()
	authSrv := profileAuthServer(t, "account-1")
	t.Cleanup(authSrv.Close)

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	reqBody := `{"signalingUrl":"` + authSrv.URL + `","accessToken":"token","accountId":"account-1","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected credentials sync 200, got %d", resp.StatusCode)
	}

	return srv
}

func authorizedPersonalGET(t *testing.T, srv *httptest.Server, path string) *http.Response {
	return authorizedPersonalGETPath(t, srv, withPersonalClientQuery(path))
}

func authorizedPersonalGETWithoutClient(t *testing.T, srv *httptest.Server, path string) *http.Response {
	return authorizedPersonalGETPath(t, srv, path)
}

func authorizedPersonalGETPath(t *testing.T, srv *httptest.Server, path string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, srv.URL+path, nil)
	if err != nil {
		t.Fatalf("new personal request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	return resp
}

func withPersonalClientQuery(path string) string {
	if strings.Contains(path, "clientId=") {
		return path
	}
	separator := "?"
	if strings.Contains(path, "?") {
		separator = "&"
	}
	return path + separator + "clientId=test-client&clientName=Test%20Phone"
}

func regularFilesUnder(t *testing.T, dir string) []string {
	t.Helper()
	paths := []string{}
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return paths
	} else if err != nil {
		t.Fatalf("stat cache dir: %v", err)
	}
	if err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			paths = append(paths, path)
		}
		return nil
	}); err != nil {
		t.Fatalf("walk cache dir: %v", err)
	}
	return paths
}

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

func insertHMACPairedDevice(t *testing.T, st *store.Store, clientID, clientName, pairingToken string) {
	t.Helper()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	tokenHash := sha256.Sum256([]byte(pairingToken))
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         clientID,
		ClientName:       clientName,
		Platform:         "ios",
		PairingID:        "pair-" + clientID,
		PairingTokenHash: hex.EncodeToString(tokenHash[:]),
		CreatedAt:        now,
		LastSeenAt:       now,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice(%q): %v", clientID, err)
	}
}

func signedPersonalGET(t *testing.T, srv *httptest.Server, path, clientID, clientName, pairingToken string) *http.Response {
	t.Helper()

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClient(path, clientID, clientName), nil)
	if err != nil {
		t.Fatalf("new signed personal request: %v", err)
	}
	addSignedPersonalHeaders(t, req, clientID, pairingToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET signed personal %s: %v", path, err)
	}
	return resp
}

func signedPersonalGETWithQuery(t *testing.T, srv *httptest.Server, path, clientID, clientName, pairingToken string) *http.Response {
	t.Helper()

	signedURL := signedPersonalURLWithQuery(t, srv, path, clientID, clientName, pairingToken)

	resp, err := http.Get(signedURL)
	if err != nil {
		t.Fatalf("GET signed personal query %s: %v", path, err)
	}
	return resp
}

func signedPersonalURLWithQuery(t *testing.T, srv *httptest.Server, path, clientID, clientName, pairingToken string) string {
	t.Helper()

	requestURL := srv.URL + withPersonalClient(path, clientID, clientName)
	parsed, err := url.Parse(requestURL)
	if err != nil {
		t.Fatalf("parse personal request URL: %v", err)
	}
	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	nonce := "test-nonce-query"
	signature := personalAccessSignature(t, http.MethodGet, parsed.EscapedPath(), clientID, timestamp, nonce, pairingToken)
	query := parsed.Query()
	query.Set("X-SyncFlow-Auth", signature)
	query.Set("X-SyncFlow-Auth-Timestamp", timestamp)
	query.Set("X-SyncFlow-Auth-Nonce", nonce)
	parsed.RawQuery = query.Encode()

	return parsed.String()
}

func addSignedPersonalHeaders(t *testing.T, req *http.Request, clientID, pairingToken string) {
	t.Helper()

	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	nonce := "test-nonce-header"
	signature := personalAccessSignature(t, req.Method, req.URL.EscapedPath(), clientID, timestamp, nonce, pairingToken)
	req.Header.Set("X-SyncFlow-Auth", signature)
	req.Header.Set("X-SyncFlow-Auth-Timestamp", timestamp)
	req.Header.Set("X-SyncFlow-Auth-Nonce", nonce)
}

func personalAccessSignature(t *testing.T, method, escapedPath, clientID, timestamp, nonce, pairingToken string) string {
	t.Helper()

	tokenHash := sha256.Sum256([]byte(pairingToken))
	mac := hmac.New(sha256.New, tokenHash[:])
	_, _ = mac.Write([]byte(strings.Join([]string{
		strings.ToUpper(method),
		escapedPath,
		clientID,
		timestamp,
		nonce,
	}, "\n")))
	return hex.EncodeToString(mac.Sum(nil))
}

func withPersonalClient(path, clientID, clientName string) string {
	separator := "?"
	if strings.Contains(path, "?") {
		separator = "&"
	}
	query := url.Values{}
	query.Set("clientId", clientID)
	query.Set("clientName", clientName)
	return path + separator + query.Encode()
}

type fakeClientStates map[string]string

func (f fakeClientStates) ConnectedClientStates() map[string]string {
	states := make(map[string]string, len(f))
	for clientID, state := range f {
		states[clientID] = state
	}
	return states
}

type fixedWakeProvider struct {
	capability *protocol.WakeCapability
}

func (f fixedWakeProvider) WakeCapability() *protocol.WakeCapability {
	return f.capability
}

func testWakeCapability() *protocol.WakeCapability {
	return &protocol.WakeCapability{
		Supported: true,
		UpdatedAt: "2026-06-09T03:00:00Z",
		Targets: []protocol.WakeTarget{
			{
				InterfaceName:    "en0",
				MACAddress:       "aa:bb:cc:dd:ee:ff",
				IPv4Address:      "192.168.1.20",
				BroadcastAddress: "192.168.1.255",
				Ports:            []int{9, 7},
			},
		},
	}
}

type fixedProxyWakeTargetProvider struct {
	targets map[string][]protocol.WakeTarget
}

func (f fixedProxyWakeTargetProvider) ProxyWakeTargets(accountID string) []protocol.WakeTarget {
	targets := f.targets[accountID]
	return append([]protocol.WakeTarget(nil), targets...)
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
	handler := func() http.Handler {
		srv, h := api.NewServer(st, cfg, hub, nil)
		srv.SetWakeProvider(fixedWakeProvider{capability: testWakeCapability()})
		return h
	}()
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
	if capabilities["revokesPairingsOnCodeRotation"] == true {
		t.Fatal("health must not advertise revocation on code rotation")
	}
	if capabilities["connectionDeviceManagement"] != true {
		t.Fatalf("expected connectionDeviceManagement=true, got %v", capabilities["connectionDeviceManagement"])
	}
	if capabilities["wakeOnLanSupported"] != true {
		t.Errorf("expected wakeOnLanSupported=true, got %v", capabilities["wakeOnLanSupported"])
	}
	if _, ok := capabilities["wake"]; ok {
		t.Fatal("health must not expose full wake metadata")
	}
}

func TestHealthEndpointExposesTunnelCredentialRefreshRequired(t *testing.T) {
	st, cfg, hub := testEnv(t)
	signalingSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/tunnel/signaling" {
			http.NotFound(w, r)
			return
		}
		http.Error(w, `{"error":"invalid signaling token"}`, http.StatusUnauthorized)
	}))
	defer signalingSrv.Close()

	apiSrv, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	t.Cleanup(func() {
		_, _ = http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(`{"signalingUrl":"","accessToken":"","iceServers":[]}`))
	})

	reqBody := `{"signalingUrl":"` + signalingSrv.URL + `","accessToken":"expired-token","iceServers":[]}`
	resp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	deadline := time.After(2 * time.Second)
	for {
		resp, err := http.Get(srv.URL + "/health")
		if err != nil {
			t.Fatalf("GET /health: %v", err)
		}
		var body map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			resp.Body.Close()
			t.Fatalf("decode health: %v", err)
		}
		resp.Body.Close()

		tunnel, ok := body["tunnel"].(map[string]any)
		if ok && tunnel["signalingAuthState"] == "refresh_required" {
			if tunnel["credentialRefreshRequired"] != true {
				t.Fatalf("expected credentialRefreshRequired=true, got %v", tunnel["credentialRefreshRequired"])
			}
			if apiSrv == nil {
				t.Fatal("api server should remain available")
			}
			return
		}

		select {
		case <-deadline:
			t.Fatalf("expected tunnel signalingAuthState=refresh_required, got %#v", body["tunnel"])
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestPresenceIncludesWakeMetadataOnlyForPairedClient(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(
		t,
		st,
		"client-1",
		"iPhone",
		"iphone",
		"stable-1",
		time.Now().UTC().Format(time.RFC3339),
	)
	handler := func() http.Handler {
		srv, h := api.NewServer(st, cfg, hub, nil)
		srv.SetWakeProvider(fixedWakeProvider{capability: testWakeCapability()})
		return h
	}()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	req, err := http.NewRequest(http.MethodPost, srv.URL+"/presence/client-1", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("new paired request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST paired presence: %v", err)
	}
	defer resp.Body.Close()

	var pairedBody map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&pairedBody); err != nil {
		t.Fatalf("decode paired presence: %v", err)
	}
	wake, ok := pairedBody["wake"].(map[string]any)
	if !ok {
		t.Fatalf("expected paired presence wake object, got %T", pairedBody["wake"])
	}
	targets := wake["targets"].([]any)
	target := targets[0].(map[string]any)
	if target["macAddress"] != "aa:bb:cc:dd:ee:ff" {
		t.Fatalf("macAddress = %v, want aa:bb:cc:dd:ee:ff", target["macAddress"])
	}

	req, err = http.NewRequest(http.MethodPost, srv.URL+"/presence/unpaired", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("new unpaired request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST unpaired presence: %v", err)
	}
	defer resp.Body.Close()

	var unpairedBody map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&unpairedBody); err != nil {
		t.Fatalf("decode unpaired presence: %v", err)
	}
	if _, ok := unpairedBody["wake"]; ok {
		t.Fatal("unpaired presence must not expose full wake metadata")
	}
}

func TestPresenceIncludesPowerSnapshotOnlyForPairedClient(t *testing.T) {
	st, cfg, hub := testEnv(t)
	insertPairedDeviceWithStableID(
		t,
		st,
		"client-1",
		"iPhone",
		"iphone",
		"stable-1",
		time.Now().UTC().Format(time.RFC3339),
	)
	srv, handler := api.NewServer(st, cfg, hub, nil)
	srv.UpdatePowerSnapshot(api.PowerEventSnapshot{
		Event:        "resume",
		State:        "awake",
		LastResumeAt: "2026-06-11T03:50:00Z",
		UpdatedAt:    "2026-06-11T03:50:00Z",
	})
	httpSrv := httptest.NewServer(handler)
	defer httpSrv.Close()

	req, err := http.NewRequest(http.MethodPost, httpSrv.URL+"/presence/client-1", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("new paired request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST paired presence: %v", err)
	}
	defer resp.Body.Close()

	var pairedBody map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&pairedBody); err != nil {
		t.Fatalf("decode paired presence: %v", err)
	}
	power, ok := pairedBody["power"].(map[string]any)
	if !ok {
		t.Fatalf("expected paired presence power object, got %T", pairedBody["power"])
	}
	if power["lastResumeAt"] != "2026-06-11T03:50:00Z" {
		t.Fatalf("lastResumeAt = %v, want 2026-06-11T03:50:00Z", power["lastResumeAt"])
	}

	req, err = http.NewRequest(http.MethodPost, httpSrv.URL+"/presence/unpaired", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("new unpaired request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST unpaired presence: %v", err)
	}
	defer resp.Body.Close()

	var unpairedBody map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&unpairedBody); err != nil {
		t.Fatalf("decode unpaired presence: %v", err)
	}
	if _, ok := unpairedBody["power"]; ok {
		t.Fatal("unpaired presence must not expose power metadata")
	}
}

func TestProxyWakeRequiresAccountAuthorization(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/wake/proxy", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401", resp.StatusCode)
	}
}

func TestProxyWakeRejectsPairedDeviceHMACWithoutAccountBearer(t *testing.T) {
	st, cfg, hub := testEnv(t)
	const (
		clientID     = "mobile-hmac-wake"
		clientName   = "HMAC Wake Phone"
		pairingToken = "pairing-token-secret"
	)
	insertHMACPairedDevice(t, st, clientID, clientName, pairingToken)
	apiSrv, handler := api.NewServer(st, cfg, hub, nil)
	apiSrv.SetWakeProvider(fixedWakeProvider{capability: testWakeCapability()})
	sender := &recordingWakePacketSender{}
	apiSrv.SetWakePacketSender(sender)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	reqBody := `{"clientId":"mobile-hmac-wake","macAddress":"aa:bb:cc:dd:ee:ff","broadcastAddress":"192.168.1.255","ports":[9]}`
	req, err := http.NewRequest(
		http.MethodPost,
		srv.URL+withPersonalClient("/wake/proxy", clientID, clientName),
		strings.NewReader(reqBody),
	)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	addSignedPersonalHeaders(t, req, clientID, pairingToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status=%d, want 401 body=%s", resp.StatusCode, string(body))
	}
	if got := len(sender.packets); got != 0 {
		t.Fatalf("sent packets=%d, want 0", got)
	}
}

func TestProxyWakeRejectsUnpairedClient(t *testing.T) {
	st, cfg, hub := testEnv(t)
	authSrv := profileAuthServer(t, "acct-1")
	defer authSrv.Close()
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "acct-1")

	reqBody := `{"clientId":"unknown-mobile","macAddress":"aa:bb:cc:dd:ee:ff","broadcastAddress":"192.168.1.255","ports":[9]}`
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/wake/proxy", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "acct-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status=%d, want 403", resp.StatusCode)
	}
}

func TestProxyWakeRejectsUnsafeTarget(t *testing.T) {
	st, cfg, hub := testEnv(t)
	authSrv := profileAuthServer(t, "acct-1")
	defer authSrv.Close()
	insertPairedDeviceWithStableID(t, st, "mobile-1", "Phone", "phone", "stable-mobile-1", time.Now().UTC().Format(time.RFC3339Nano))
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "acct-1")

	reqBody := `{"clientId":"mobile-1","macAddress":"aa:bb:cc:dd:ee:ff","broadcastAddress":"8.8.8.8","ports":[53]}`
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/wake/proxy", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "acct-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", resp.StatusCode)
	}
}

func TestProxyWakeSendsMagicPacketForPairedClient(t *testing.T) {
	st, cfg, hub := testEnv(t)
	authSrv := profileAuthServer(t, "acct-1")
	defer authSrv.Close()
	insertPairedDeviceWithStableID(t, st, "mobile-1", "Phone", "phone", "stable-mobile-1", time.Now().UTC().Format(time.RFC3339Nano))
	apiSrv, handler := api.NewServer(st, cfg, hub, nil)
	apiSrv.SetWakeProvider(fixedWakeProvider{capability: testWakeCapability()})
	sender := &recordingWakePacketSender{}
	apiSrv.SetWakePacketSender(sender)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "acct-1")

	reqBody := `{"clientId":"mobile-1","macAddress":"aa:bb:cc:dd:ee:ff","broadcastAddress":"192.168.1.255","ports":[9,7]}`
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/wake/proxy", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "acct-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status=%d, want 200 body=%s", resp.StatusCode, string(body))
	}
	if got := len(sender.packets); got != 2 {
		t.Fatalf("sent packets=%d, want 2", got)
	}
	if sender.packets[0].addr != "192.168.1.255:9" {
		t.Fatalf("first addr=%q, want 192.168.1.255:9", sender.packets[0].addr)
	}
	if len(sender.packets[0].packet) != 102 {
		t.Fatalf("packet length=%d, want 102", len(sender.packets[0].packet))
	}
}

func TestProxyWakeRejectsUnknownPrivateBroadcastTarget(t *testing.T) {
	st, cfg, hub := testEnv(t)
	authSrv := profileAuthServer(t, "acct-1")
	defer authSrv.Close()
	insertPairedDeviceWithStableID(t, st, "mobile-1", "Phone", "phone", "stable-mobile-1", time.Now().UTC().Format(time.RFC3339Nano))
	apiSrv, handler := api.NewServer(st, cfg, hub, nil)
	apiSrv.SetWakeProvider(fixedWakeProvider{capability: testWakeCapability()})
	sender := &recordingWakePacketSender{}
	apiSrv.SetWakePacketSender(sender)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "acct-1")

	reqBody := `{"clientId":"mobile-1","macAddress":"aa:bb:cc:dd:ee:ff","broadcastAddress":"192.168.99.255","ports":[9]}`
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/wake/proxy", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "acct-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", resp.StatusCode)
	}
	if got := len(sender.packets); got != 0 {
		t.Fatalf("sent packets=%d, want 0", got)
	}
}

func TestProxyWakeRejectsInvalidMACAddress(t *testing.T) {
	st, cfg, hub := testEnv(t)
	authSrv := profileAuthServer(t, "acct-1")
	defer authSrv.Close()
	insertPairedDeviceWithStableID(t, st, "mobile-1", "Phone", "phone", "stable-mobile-1", time.Now().UTC().Format(time.RFC3339Nano))
	apiSrv, handler := api.NewServer(st, cfg, hub, nil)
	apiSrv.SetWakeProvider(fixedWakeProvider{capability: testWakeCapability()})
	sender := &recordingWakePacketSender{}
	apiSrv.SetWakePacketSender(sender)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "acct-1")

	reqBody := `{"clientId":"mobile-1","macAddress":"not-a-mac","broadcastAddress":"192.168.1.255","ports":[9]}`
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/wake/proxy", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "acct-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", resp.StatusCode)
	}
	if got := len(sender.packets); got != 0 {
		t.Fatalf("sent packets=%d, want 0", got)
	}
}

func TestProxyWakeRejectsDifferentSleepingTargetMAC(t *testing.T) {
	st, cfg, hub := testEnv(t)
	authSrv := profileAuthServer(t, "acct-1")
	defer authSrv.Close()
	insertPairedDeviceWithStableID(t, st, "mobile-1", "Phone", "phone", "stable-mobile-1", time.Now().UTC().Format(time.RFC3339Nano))
	apiSrv, handler := api.NewServer(st, cfg, hub, nil)
	apiSrv.SetWakeProvider(fixedWakeProvider{capability: testWakeCapability()})
	sender := &recordingWakePacketSender{}
	apiSrv.SetWakePacketSender(sender)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "acct-1")

	reqBody := `{"clientId":"mobile-1","macAddress":"00:11:22:33:44:55","broadcastAddress":"192.168.1.255","ports":[9]}`
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/wake/proxy", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "acct-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", resp.StatusCode)
	}
	if got := len(sender.packets); got != 0 {
		t.Fatalf("sent packets=%d, want 0", got)
	}
}

func TestProxyWakeAllowsRegisteredSameAccountSleepingTargetMAC(t *testing.T) {
	st, cfg, hub := testEnv(t)
	authSrv := profileAuthServer(t, "acct-1")
	defer authSrv.Close()
	insertPairedDeviceWithStableID(t, st, "mobile-1", "Phone", "phone", "stable-mobile-1", time.Now().UTC().Format(time.RFC3339Nano))
	apiSrv, handler := api.NewServer(st, cfg, hub, nil)
	apiSrv.SetWakeProvider(fixedWakeProvider{capability: testWakeCapability()})
	apiSrv.SetProxyWakeTargetProvider(fixedProxyWakeTargetProvider{
		targets: map[string][]protocol.WakeTarget{
			"acct-1": {
				{
					InterfaceName:    "en1",
					MACAddress:       "00:11:22:33:44:55",
					IPv4Address:      "192.168.1.30",
					BroadcastAddress: "192.168.1.255",
					Ports:            []int{9},
				},
			},
		},
	})
	sender := &recordingWakePacketSender{}
	apiSrv.SetWakePacketSender(sender)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "acct-1")

	reqBody := `{"clientId":"mobile-1","macAddress":"00:11:22:33:44:55","broadcastAddress":"192.168.1.255","ports":[9]}`
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/wake/proxy", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "acct-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status=%d, want 200 body=%s", resp.StatusCode, string(body))
	}
	if got := len(sender.packets); got != 1 {
		t.Fatalf("sent packets=%d, want 1", got)
	}
	if sender.packets[0].addr != "192.168.1.255:9" {
		t.Fatalf("addr=%q, want 192.168.1.255:9", sender.packets[0].addr)
	}
}

func TestProxyWakeRejectsRegisteredDifferentAccountSleepingTargetMAC(t *testing.T) {
	st, cfg, hub := testEnv(t)
	authSrv := profileAuthServer(t, "acct-1")
	defer authSrv.Close()
	insertPairedDeviceWithStableID(t, st, "mobile-1", "Phone", "phone", "stable-mobile-1", time.Now().UTC().Format(time.RFC3339Nano))
	apiSrv, handler := api.NewServer(st, cfg, hub, nil)
	apiSrv.SetWakeProvider(fixedWakeProvider{capability: &protocol.WakeCapability{
		Supported: true,
		UpdatedAt: "2026-06-09T03:00:00Z",
		Targets:   []protocol.WakeTarget{},
	}})
	apiSrv.SetProxyWakeTargetProvider(fixedProxyWakeTargetProvider{
		targets: map[string][]protocol.WakeTarget{
			"acct-2": {
				{
					InterfaceName:    "en1",
					MACAddress:       "00:11:22:33:44:55",
					IPv4Address:      "192.168.1.30",
					BroadcastAddress: "192.168.1.255",
					Ports:            []int{9},
				},
			},
		},
	})
	sender := &recordingWakePacketSender{}
	apiSrv.SetWakePacketSender(sender)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "acct-1")

	reqBody := `{"clientId":"mobile-1","macAddress":"00:11:22:33:44:55","broadcastAddress":"192.168.1.255","ports":[9]}`
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/wake/proxy", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "acct-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status=%d, want 400 body=%s", resp.StatusCode, string(body))
	}
	if got := len(sender.packets); got != 0 {
		t.Fatalf("sent packets=%d, want 0", got)
	}
}

func TestProxyWakeRejectsLimitedBroadcastWhenNotInWakeTargets(t *testing.T) {
	st, cfg, hub := testEnv(t)
	authSrv := profileAuthServer(t, "acct-1")
	defer authSrv.Close()
	insertPairedDeviceWithStableID(t, st, "mobile-1", "Phone", "phone", "stable-mobile-1", time.Now().UTC().Format(time.RFC3339Nano))
	apiSrv, handler := api.NewServer(st, cfg, hub, nil)
	apiSrv.SetWakeProvider(fixedWakeProvider{capability: testWakeCapability()})
	sender := &recordingWakePacketSender{}
	apiSrv.SetWakePacketSender(sender)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "acct-1")

	reqBody := `{"clientId":"mobile-1","macAddress":"aa:bb:cc:dd:ee:ff","broadcastAddress":"255.255.255.255","ports":[9]}`
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/wake/proxy", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "acct-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /wake/proxy: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", resp.StatusCode)
	}
	if got := len(sender.packets); got != 0 {
		t.Fatalf("sent packets=%d, want 0", got)
	}
}

type recordedWakePacket struct {
	addr   string
	packet []byte
}

type recordingWakePacketSender struct {
	packets []recordedWakePacket
}

func (r *recordingWakePacketSender) SendWakePacket(addr string, packet []byte) error {
	cloned := append([]byte(nil), packet...)
	r.packets = append(r.packets, recordedWakePacket{addr: addr, packet: cloned})
	return nil
}

func syncAccountContextForTest(t *testing.T, serverURL string, authBaseURL string, accountID string) {
	t.Helper()
	reqBody := `{"authBaseUrl":"` + authBaseURL + `","accessToken":"token","accountId":"` + accountID + `"}`
	resp, err := http.Post(serverURL+"/account/context", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /account/context: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("account context status=%d body=%s", resp.StatusCode, string(body))
	}
}

func TestPowerStateUpdateIsLocalOnly(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	httpSrv := httptest.NewServer(handler)
	defer httpSrv.Close()

	localReq, err := http.NewRequest(
		http.MethodPost,
		httpSrv.URL+"/power/state",
		strings.NewReader(`{"event":"resume","state":"awake","lastResumeAt":"2026-06-11T03:50:00Z","updatedAt":"2026-06-11T03:50:00Z"}`),
	)
	if err != nil {
		t.Fatalf("new local power request: %v", err)
	}
	localReq.Header.Set("Content-Type", "application/json")
	localResp, err := http.DefaultClient.Do(localReq)
	if err != nil {
		t.Fatalf("POST local power update: %v", err)
	}
	defer localResp.Body.Close()

	if localResp.StatusCode != http.StatusOK {
		t.Fatalf("local power update status = %d, want %d", localResp.StatusCode, http.StatusOK)
	}

	remoteReq := httptest.NewRequest(
		http.MethodPost,
		"/power/state",
		strings.NewReader(`{"event":"resume","state":"awake","updatedAt":"2026-06-11T03:51:00Z"}`),
	)
	remoteReq.RemoteAddr = "192.168.1.20:61234"
	remoteReq.Header.Set("Content-Type", "application/json")
	remoteResp := httptest.NewRecorder()

	handler.ServeHTTP(remoteResp, remoteReq)

	if remoteResp.Code != http.StatusForbidden {
		t.Fatalf("remote power update status = %d, want %d", remoteResp.Code, http.StatusForbidden)
	}
}

func TestAccountContextSyncIsLocalOnly(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)

	remoteReq := httptest.NewRequest(
		http.MethodPost,
		"/account/context",
		strings.NewReader(`{"authBaseUrl":"https://auth.example.test","accessToken":"token","accountId":"acct-1"}`),
	)
	remoteReq.RemoteAddr = "192.168.1.50:61234"
	remoteReq.Header.Set("Content-Type", "application/json")
	remoteResp := httptest.NewRecorder()

	handler.ServeHTTP(remoteResp, remoteReq)

	if remoteResp.Code != http.StatusForbidden {
		t.Fatalf("remote account context sync status = %d, want %d", remoteResp.Code, http.StatusForbidden)
	}
}

func TestTunnelCredentialsSyncIsLocalOnly(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)

	remoteReq := httptest.NewRequest(
		http.MethodPost,
		"/tunnel/credentials",
		strings.NewReader(`{"signalingUrl":"https://signal.example.test","accessToken":"token","accountId":"acct-1","iceServers":[]}`),
	)
	remoteReq.RemoteAddr = "192.168.1.50:61234"
	remoteReq.Header.Set("Content-Type", "application/json")
	remoteResp := httptest.NewRecorder()

	handler.ServeHTTP(remoteResp, remoteReq)

	if remoteResp.Code != http.StatusForbidden {
		t.Fatalf("remote tunnel credentials sync status = %d, want %d", remoteResp.Code, http.StatusForbidden)
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
	deviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	if body["serverId"] != deviceID {
		t.Fatalf("expected serverId %q, got %v", deviceID, body["serverId"])
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

func TestSettingsIncludeCrossDeviceReceivedAccessDefault(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/settings")
	if err != nil {
		t.Fatalf("GET /settings: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	var body struct {
		AllowCrossDeviceReceivedAccess bool `json:"allowCrossDeviceReceivedAccess"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	if !body.AllowCrossDeviceReceivedAccess {
		t.Fatalf("expected allowCrossDeviceReceivedAccess to default true")
	}
}

func TestUpdateSettingsPersistsCrossDeviceReceivedAccess(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	req, err := http.NewRequest(
		http.MethodPut,
		srv.URL+"/settings",
		strings.NewReader(`{"allowCrossDeviceReceivedAccess":false}`),
	)
	if err != nil {
		t.Fatalf("NewRequest PUT /settings: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT /settings: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected update status 200, got %d", resp.StatusCode)
	}
	var updateBody struct {
		AllowCrossDeviceReceivedAccess bool `json:"allowCrossDeviceReceivedAccess"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&updateBody); err != nil {
		t.Fatalf("decode update settings: %v", err)
	}
	if updateBody.AllowCrossDeviceReceivedAccess {
		t.Fatalf("expected update response to return false")
	}

	getResp, err := http.Get(srv.URL + "/settings")
	if err != nil {
		t.Fatalf("GET /settings after update: %v", err)
	}
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("expected get status 200, got %d", getResp.StatusCode)
	}
	var getBody struct {
		AllowCrossDeviceReceivedAccess bool `json:"allowCrossDeviceReceivedAccess"`
	}
	if err := json.NewDecoder(getResp.Body).Decode(&getBody); err != nil {
		t.Fatalf("decode get settings: %v", err)
	}
	if getBody.AllowCrossDeviceReceivedAccess {
		t.Fatalf("expected persisted allowCrossDeviceReceivedAccess false")
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

func TestPersonalListRejectsWhenRemoteAccessDisabled(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	if err := st.SetSetting("remote_access_enabled", "false"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
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

func TestPersonalListAcceptsDevSandboxMockToken(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "notes.txt"), []byte("personal"), 0o644); err != nil {
		t.Fatalf("write personal file: %v", err)
	}

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	token := "mock-sandbox-access-token:functional@example.com"
	reqBody := `{"authBaseUrl":"dev-sandbox://auth","accessToken":"` + token + `","accountId":"99999"}`
	resp, err := http.Post(srv.URL+"/account/context", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /account/context: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected account context sync 200, got %d", resp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
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

	resp, err = http.Get(srv.URL + withPersonalClientQuery("/personal/list"))
	if err != nil {
		t.Fatalf("GET /personal/list: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestPersonalAccessAcceptsPairedDeviceHMACWithoutAccountBearer(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "notes.txt"), []byte("personal notes"), 0o644); err != nil {
		t.Fatalf("write personal file: %v", err)
	}
	const (
		clientID     = "phone-hmac"
		clientName   = "Pairing Phone"
		pairingToken = "pairing-token-secret"
	)
	insertHMACPairedDevice(t, st, clientID, clientName, pairingToken)

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp := signedPersonalGET(t, srv, "/personal/list", clientID, clientName, pairingToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("signed personal list status=%d, want 200 body=%s", resp.StatusCode, string(body))
	}

	resp = signedPersonalGETWithQuery(t, srv, "/personal/download/notes.txt", clientID, clientName, pairingToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("signed personal download status=%d, want 200 body=%s", resp.StatusCode, string(body))
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read signed download body: %v", err)
	}
	if string(data) != "personal notes" {
		t.Fatalf("download body=%q, want personal notes", string(data))
	}
}

func TestPersonalAccessRejectsReplayedPairedDeviceHMACNonce(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "notes.txt"), []byte("personal notes"), 0o644); err != nil {
		t.Fatalf("write personal file: %v", err)
	}
	const (
		clientID     = "phone-replay-hmac"
		clientName   = "Replay Phone"
		pairingToken = "pairing-token-secret"
	)
	insertHMACPairedDevice(t, st, clientID, clientName, pairingToken)

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	signedURL := signedPersonalURLWithQuery(t, srv, "/personal/download/notes.txt", clientID, clientName, pairingToken)
	resp, err := http.Get(signedURL)
	if err != nil {
		t.Fatalf("first signed personal download: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("first signed personal download status=%d, want 200 body=%s", resp.StatusCode, string(body))
	}
	_, _ = io.Copy(io.Discard, resp.Body)

	resp, err = http.Get(signedURL)
	if err != nil {
		t.Fatalf("replayed signed personal download: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("replayed signed personal download status=%d, want 401 body=%s", resp.StatusCode, string(body))
	}
}

func TestPersonalAccessRejectsBlockedPairedDeviceHMAC(t *testing.T) {
	st, cfg, hub := testEnv(t)
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	const (
		clientID     = "phone-blocked-hmac"
		clientName   = "Blocked Phone"
		pairingToken = "pairing-token-secret"
	)
	insertHMACPairedDevice(t, st, clientID, clientName, pairingToken)
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}
	if err := st.BlockDevice(desktopDeviceID, clientID); err != nil {
		t.Fatalf("BlockDevice: %v", err)
	}

	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp := signedPersonalGET(t, srv, "/personal/list", clientID, clientName, pairingToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("signed personal list status=%d, want 403 body=%s", resp.StatusCode, string(body))
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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
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

func TestPersonalListReturnsVersionedThumbnailURLOnlyForSupportedImages(t *testing.T) {
	st, cfg, hub := testEnv(t)
	cfg.PersonalShareDir = filepath.Join(t.TempDir(), "Personal Share")
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	writeJPEGFixture(t, filepath.Join(cfg.PersonalDir(), "photo.jpg"), 640, 480)
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "clip.mov"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "archive.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write mkv: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "vector.svg"), []byte("<svg />"), 0o644); err != nil {
		t.Fatalf("write svg: %v", err)
	}
	if err := os.Mkdir(filepath.Join(cfg.PersonalDir(), "Album"), 0o755); err != nil {
		t.Fatalf("mkdir album: %v", err)
	}

	srv := authenticatePersonalAPITestServer(t, st, cfg, hub)
	resp := authorizedPersonalGET(t, srv, "/personal/list")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("personal list status=%d, want 200", resp.StatusCode)
	}

	var body struct {
		Files []struct {
			Name         string  `json:"name"`
			Type         string  `json:"type"`
			ThumbnailURL *string `json:"thumbnailUrl,omitempty"`
			StreamURL    *string `json:"streamUrl,omitempty"`
			IsDirectory  bool    `json:"isDirectory,omitempty"`
		} `json:"files"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode personal list: %v", err)
	}

	files := map[string]struct {
		Type         string
		ThumbnailURL *string
		StreamURL    *string
		IsDirectory  bool
	}{}
	for _, file := range body.Files {
		files[file.Name] = struct {
			Type         string
			ThumbnailURL *string
			StreamURL    *string
			IsDirectory  bool
		}{Type: file.Type, ThumbnailURL: file.ThumbnailURL, StreamURL: file.StreamURL, IsDirectory: file.IsDirectory}
	}

	photo := files["photo.jpg"].ThumbnailURL
	if photo == nil {
		t.Fatalf("photo.jpg missing thumbnailUrl in %+v", body.Files)
	}
	if !strings.HasPrefix(*photo, "/personal/thumbnail/photo.jpg?v=") {
		t.Fatalf("thumbnailUrl=%q, want versioned personal thumbnail URL", *photo)
	}
	clip := files["clip.mov"]
	if clip.Type != "video" {
		t.Fatalf("clip.mov type=%q, want video", clip.Type)
	}
	if clip.StreamURL == nil || *clip.StreamURL != "/personal/stream/clip.mov" {
		t.Fatalf("clip.mov streamUrl=%v, want /personal/stream/clip.mov", clip.StreamURL)
	}
	if clip.ThumbnailURL == nil || !strings.HasPrefix(*clip.ThumbnailURL, "/personal/thumbnail/clip.mov?v=") {
		t.Fatalf("clip.mov thumbnailUrl=%v, want versioned personal thumbnail URL", clip.ThumbnailURL)
	}

	archive := files["archive.mkv"]
	if archive.Type != "video" {
		t.Fatalf("archive.mkv type=%q, want video", archive.Type)
	}
	if archive.StreamURL == nil || *archive.StreamURL != "/personal/stream/archive.mkv" {
		t.Fatalf("archive.mkv streamUrl=%v, want /personal/stream/archive.mkv", archive.StreamURL)
	}
	if archive.ThumbnailURL != nil {
		t.Fatalf("archive.mkv thumbnailUrl=%q, want omitted", *archive.ThumbnailURL)
	}

	for _, name := range []string{"vector.svg", "Album"} {
		if got := files[name].ThumbnailURL; got != nil {
			t.Fatalf("%s thumbnailUrl=%q, want omitted", name, *got)
		}
	}
	if got := regularFilesUnder(t, filepath.Join(cfg.DataDir, "thumbnail-cache")); len(got) != 0 {
		t.Fatalf("personal list generated thumbnail cache files: %+v", got)
	}
}

func TestSharedListReturnsVideoThumbnailAndStreamURLs(t *testing.T) {
	st, cfg, hub := testEnv(t)
	sharedDir := cfg.SharedDir()
	if err := os.MkdirAll(sharedDir, 0o755); err != nil {
		t.Fatalf("mkdir shared dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sharedDir, "walkthrough.mp4"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
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
		t.Fatalf("shared list status=%d, want 200", resp.StatusCode)
	}

	var body struct {
		Files []struct {
			Name         string  `json:"name"`
			Type         string  `json:"type"`
			ThumbnailURL *string `json:"thumbnailUrl,omitempty"`
			StreamURL    *string `json:"streamUrl,omitempty"`
		} `json:"files"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode shared list: %v", err)
	}

	var video *struct {
		Name         string  `json:"name"`
		Type         string  `json:"type"`
		ThumbnailURL *string `json:"thumbnailUrl,omitempty"`
		StreamURL    *string `json:"streamUrl,omitempty"`
	}
	for i := range body.Files {
		if body.Files[i].Name == "walkthrough.mp4" {
			video = &body.Files[i]
			break
		}
	}
	if video == nil {
		t.Fatalf("walkthrough.mp4 missing in shared list: %+v", body.Files)
	}
	if video.Type != "video" {
		t.Fatalf("walkthrough.mp4 type=%q, want video", video.Type)
	}
	if video.StreamURL == nil || *video.StreamURL != "/shared/stream/walkthrough.mp4" {
		t.Fatalf("walkthrough.mp4 streamUrl=%v, want /shared/stream/walkthrough.mp4", video.StreamURL)
	}
	if video.ThumbnailURL == nil || !strings.HasPrefix(*video.ThumbnailURL, "/shared/thumbnail/walkthrough.mp4?v=") {
		t.Fatalf("walkthrough.mp4 thumbnailUrl=%v, want versioned shared thumbnail URL", video.ThumbnailURL)
	}
	if got := regularFilesUnder(t, filepath.Join(cfg.DataDir, "thumbnail-cache")); len(got) != 0 {
		t.Fatalf("shared list generated thumbnail cache files: %+v", got)
	}
}

func TestSharedVideoThumbnailBroadcastsRequestAndServesGeneratedCache(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	sharedDir := cfg.SharedDir()
	if err := os.MkdirAll(sharedDir, 0o755); err != nil {
		t.Fatalf("mkdir shared: %v", err)
	}
	videoPath := filepath.Join(sharedDir, "walkthrough.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	resolvedVideoPath, err := filepath.EvalSymlinks(videoPath)
	if err != nil {
		t.Fatalf("resolve video path: %v", err)
	}

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events/stream"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial events stream: %v", err)
	}
	defer conn.Close()

	respCh := make(chan *http.Response, 1)
	errCh := make(chan error, 1)
	go func() {
		resp, err := http.Get(srv.URL + "/shared/thumbnail/walkthrough.mp4")
		if err != nil {
			errCh <- err
			return
		}
		respCh <- resp
	}()

	event := readVideoThumbnailRequestEvent(t, conn, 2*time.Second)
	if event.Payload.RequestID == "" {
		t.Fatal("requestId is empty")
	}
	if event.Payload.SourcePath != resolvedVideoPath {
		t.Fatalf("sourcePath=%q, want %q", event.Payload.SourcePath, resolvedVideoPath)
	}
	if event.Payload.SourceVersion == "" {
		t.Fatal("sourceVersion is empty")
	}
	if event.Payload.CachePath == "" || !strings.HasPrefix(event.Payload.CachePath, filepath.Join(cfg.DataDir, "thumbnail-cache")) {
		t.Fatalf("cachePath=%q, want path under thumbnail-cache", event.Payload.CachePath)
	}
	if event.Payload.MaxEdge != directoryThumbnailMaxEdge || event.Payload.Quality != directoryThumbnailJPEGQuality {
		t.Fatalf("maxEdge/quality=%d/%d, want %d/%d", event.Payload.MaxEdge, event.Payload.Quality, directoryThumbnailMaxEdge, directoryThumbnailJPEGQuality)
	}

	if err := os.MkdirAll(filepath.Dir(event.Payload.CachePath), 0o755); err != nil {
		t.Fatalf("mkdir cache dir: %v", err)
	}
	writeJPEGFixture(t, event.Payload.CachePath, 64, 48)

	select {
	case err := <-errCh:
		t.Fatalf("thumbnail request failed: %v", err)
	case resp := <-respCh:
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("thumbnail status=%d, want 200", resp.StatusCode)
		}
		if contentType := resp.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "image/jpeg") {
			t.Fatalf("content-type=%q, want image/jpeg", contentType)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("thumbnail request timed out")
	}
}

func TestSharedVideoThumbnailDeduplicatesConcurrentRequests(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	sharedDir := cfg.SharedDir()
	if err := os.MkdirAll(sharedDir, 0o755); err != nil {
		t.Fatalf("mkdir shared: %v", err)
	}
	videoPath := filepath.Join(sharedDir, "walkthrough.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events/stream"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial events stream: %v", err)
	}
	defer conn.Close()

	const requestCount = 6
	start := make(chan struct{})
	respCh := make(chan *http.Response, requestCount)
	errCh := make(chan error, requestCount)
	for i := 0; i < requestCount; i++ {
		go func() {
			<-start
			resp, err := http.Get(srv.URL + "/shared/thumbnail/walkthrough.mp4")
			if err != nil {
				errCh <- err
				return
			}
			respCh <- resp
		}()
	}
	close(start)

	event := readVideoThumbnailRequestEvent(t, conn, 2*time.Second)
	if event.Payload.CachePath == "" {
		t.Fatal("cachePath is empty")
	}

	time.Sleep(200 * time.Millisecond)
	if err := os.MkdirAll(filepath.Dir(event.Payload.CachePath), 0o755); err != nil {
		t.Fatalf("mkdir cache dir: %v", err)
	}
	writeJPEGFixture(t, event.Payload.CachePath, 64, 48)

	for i := 0; i < requestCount; i++ {
		select {
		case err := <-errCh:
			t.Fatalf("thumbnail request %d failed: %v", i, err)
		case resp := <-respCh:
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("thumbnail request %d status=%d, want 200", i, resp.StatusCode)
			}
			if contentType := resp.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "image/jpeg") {
				t.Fatalf("thumbnail request %d content-type=%q, want image/jpeg", i, contentType)
			}
		case <-time.After(4 * time.Second):
			t.Fatalf("thumbnail request %d timed out", i)
		}
	}

	if extra := drainVideoThumbnailRequestEvents(t, conn, 300*time.Millisecond); extra != 0 {
		t.Fatalf("extra video thumbnail request events=%d, want 0", extra)
	}
}

func TestPersonalThumbnailGeneratesSmallCachedJPEG(t *testing.T) {
	st, cfg, hub := testEnv(t)
	cfg.PersonalShareDir = filepath.Join(t.TempDir(), "Personal Share")
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	imagePath := filepath.Join(cfg.PersonalDir(), "wide.jpg")
	writeJPEGFixture(t, imagePath, 640, 480)

	srv := authenticatePersonalAPITestServer(t, st, cfg, hub)
	resp := authorizedPersonalGET(t, srv, "/personal/thumbnail/wide.jpg")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("thumbnail status=%d, want 200", resp.StatusCode)
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

	secondResp := authorizedPersonalGET(t, srv, "/personal/thumbnail/wide.jpg")
	io.Copy(io.Discard, secondResp.Body)
	secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("second thumbnail status=%d, want 200", secondResp.StatusCode)
	}
	secondCacheFiles := regularFilesUnder(t, cacheDir)
	if len(secondCacheFiles) != 1 || secondCacheFiles[0] != cacheFiles[0] {
		t.Fatalf("second cache files=%+v, want cache hit on %q", secondCacheFiles, cacheFiles[0])
	}
	secondInfo, err := os.Stat(cacheFiles[0])
	if err != nil {
		t.Fatalf("stat second cache file: %v", err)
	}
	if !secondInfo.ModTime().Equal(firstInfo.ModTime()) {
		t.Fatalf("cache mtime changed on cache hit: first=%s second=%s", firstInfo.ModTime(), secondInfo.ModTime())
	}

	newMod := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(imagePath, newMod, newMod); err != nil {
		t.Fatalf("touch source image: %v", err)
	}
	thirdResp := authorizedPersonalGET(t, srv, "/personal/thumbnail/wide.jpg")
	io.Copy(io.Discard, thirdResp.Body)
	thirdResp.Body.Close()
	if thirdResp.StatusCode != http.StatusOK {
		t.Fatalf("third thumbnail status=%d, want 200", thirdResp.StatusCode)
	}
	thirdCacheFiles := regularFilesUnder(t, cacheDir)
	if len(thirdCacheFiles) != 2 {
		t.Fatalf("cache files after source change=%+v, want two versioned cache files", thirdCacheFiles)
	}
}

func TestPersonalVideoThumbnailBroadcastsRequestAndServesGeneratedCache(t *testing.T) {
	st, cfg, hub := testEnv(t)
	cfg.PersonalShareDir = filepath.Join(t.TempDir(), "Personal Share")
	authSrv := profileAuthServer(t, "account-1")
	t.Cleanup(authSrv.Close)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "account-1")

	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal: %v", err)
	}
	videoPath := filepath.Join(cfg.PersonalDir(), "clip.mov")
	if err := os.WriteFile(videoPath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	resolvedVideoPath, err := filepath.EvalSymlinks(videoPath)
	if err != nil {
		t.Fatalf("resolve video path: %v", err)
	}

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events/stream"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial events stream: %v", err)
	}
	defer conn.Close()

	respCh := make(chan *http.Response, 1)
	errCh := make(chan error, 1)
	go func() {
		req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/thumbnail/clip.mov"), nil)
		if err != nil {
			errCh <- err
			return
		}
		req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			errCh <- err
			return
		}
		respCh <- resp
	}()

	event := readVideoThumbnailRequestEvent(t, conn, 2*time.Second)
	if event.Payload.RequestID == "" {
		t.Fatal("requestId is empty")
	}
	if event.Payload.SourcePath != resolvedVideoPath {
		t.Fatalf("sourcePath=%q, want %q", event.Payload.SourcePath, resolvedVideoPath)
	}
	if event.Payload.SourceVersion == "" {
		t.Fatal("sourceVersion is empty")
	}
	if event.Payload.CachePath == "" || !strings.HasPrefix(event.Payload.CachePath, filepath.Join(cfg.DataDir, "thumbnail-cache")) {
		t.Fatalf("cachePath=%q, want path under thumbnail-cache", event.Payload.CachePath)
	}
	if event.Payload.MaxEdge != directoryThumbnailMaxEdge || event.Payload.Quality != directoryThumbnailJPEGQuality {
		t.Fatalf("maxEdge/quality=%d/%d, want %d/%d", event.Payload.MaxEdge, event.Payload.Quality, directoryThumbnailMaxEdge, directoryThumbnailJPEGQuality)
	}

	if err := os.MkdirAll(filepath.Dir(event.Payload.CachePath), 0o755); err != nil {
		t.Fatalf("mkdir cache dir: %v", err)
	}
	writeJPEGFixture(t, event.Payload.CachePath, 64, 48)

	select {
	case err := <-errCh:
		t.Fatalf("thumbnail request failed: %v", err)
	case resp := <-respCh:
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("thumbnail status=%d, want 200", resp.StatusCode)
		}
		if contentType := resp.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "image/jpeg") {
			t.Fatalf("content-type=%q, want image/jpeg", contentType)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("thumbnail request timed out")
	}
}

func TestPersonalVideoThumbnailReturnsNotFoundWhenCacheIsNotGenerated(t *testing.T) {
	st, cfg, hub := testEnv(t)
	cfg.PersonalShareDir = filepath.Join(t.TempDir(), "Personal Share")
	authSrv := profileAuthServer(t, "account-1")
	t.Cleanup(authSrv.Close)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	syncAccountContextForTest(t, srv.URL, authSrv.URL, "account-1")

	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "clip.mov"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}

	start := time.Now()
	resp := authorizedPersonalGET(t, srv, "/personal/thumbnail/clip.mov")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("thumbnail status=%d, want 404", resp.StatusCode)
	}
	if time.Since(start) < 250*time.Millisecond {
		t.Fatalf("thumbnail returned too quickly; expected polling path")
	}
}

func TestPersonalThumbnailReturnsNotFoundForUnsupportedImages(t *testing.T) {
	st, cfg, hub := testEnv(t)
	cfg.PersonalShareDir = filepath.Join(t.TempDir(), "Personal Share")
	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "vector.svg"), []byte("<svg />"), 0o644); err != nil {
		t.Fatalf("write svg: %v", err)
	}

	srv := authenticatePersonalAPITestServer(t, st, cfg, hub)
	resp := authorizedPersonalGET(t, srv, "/personal/thumbnail/vector.svg")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("svg thumbnail status=%d, want 404", resp.StatusCode)
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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
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

func TestPersonalDownloadServesRegularDocumentFile(t *testing.T) {
	st, cfg, hub := testEnv(t)
	personalRoot := filepath.Join(t.TempDir(), "Personal Share")
	cfg.PersonalShareDir = personalRoot
	if err := os.MkdirAll(personalRoot, 0o755); err != nil {
		t.Fatalf("mkdir personal share dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(personalRoot, "notes.txt"), []byte("personal notes"), 0o644); err != nil {
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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/download/notes.txt"), nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+fakeAccountJWT(t, "account-1"))

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /personal/download/notes.txt: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d body=%s", resp.StatusCode, string(body))
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(body) != "personal notes" {
		t.Fatalf("download body=%q, want personal notes", string(body))
	}
}

func TestPersonalAccessCreatesAccessRecordsWhenClientMetadataPresent(t *testing.T) {
	st, cfg, hub := testEnv(t)
	personalRoot := filepath.Join(t.TempDir(), "Personal Share")
	cfg.PersonalShareDir = personalRoot
	if err := os.MkdirAll(personalRoot, 0o755); err != nil {
		t.Fatalf("mkdir personal share dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(personalRoot, "notes.txt"), []byte("personal notes"), 0o644); err != nil {
		t.Fatalf("write personal file: %v", err)
	}
	desktopDeviceID, err := st.GetDeviceID()
	if err != nil {
		t.Fatalf("GetDeviceID: %v", err)
	}

	srv := authenticatePersonalAPITestServer(t, st, cfg, hub)
	for _, path := range []string{
		"/personal/list?clientId=client-001&clientName=Alice%20iPhone",
		"/personal/stream/notes.txt?clientId=client-001&clientName=Alice%20iPhone",
		"/personal/download/notes.txt?clientId=client-001&clientName=Alice%20iPhone",
	} {
		resp := authorizedPersonalGET(t, srv, path)
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET %s status=%d, want 200", path, resp.StatusCode)
		}
	}

	records, err := st.ListAccessRecords(desktopDeviceID, &[]string{"client-001"}[0])
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	seen := map[string]store.AccessRecord{}
	for _, record := range records {
		seen[record.Action] = record
		if record.ClientName != "Alice iPhone" {
			t.Fatalf("record client name=%q, want Alice iPhone: %+v", record.ClientName, record)
		}
		if record.Result != "ok" {
			t.Fatalf("record result=%q, want ok: %+v", record.Result, record)
		}
	}
	for _, action := range []string{"list", "view", "download"} {
		if _, ok := seen[action]; !ok {
			t.Fatalf("expected %s access record, got %+v", action, records)
		}
	}
	if seen["list"].ResourceName != "个人空间" || seen["list"].ResourceKind != "shared_folder" {
		t.Fatalf("list record should describe personal folder, got %+v", seen["list"])
	}
	if seen["view"].ResourceName != "notes.txt" || seen["view"].ResourceKind != "shared_file" ||
		seen["download"].ResourceName != "notes.txt" || seen["download"].ResourceKind != "shared_file" {
		t.Fatalf("file access records should use filename, got view=%+v download=%+v", seen["view"], seen["download"])
	}
}

func TestPersonalListRequiresClientMetadataForAccessRecording(t *testing.T) {
	st, cfg, hub := testEnv(t)
	personalRoot := filepath.Join(t.TempDir(), "Personal Share")
	cfg.PersonalShareDir = personalRoot
	if err := os.MkdirAll(personalRoot, 0o755); err != nil {
		t.Fatalf("mkdir personal share dir: %v", err)
	}

	srv := authenticatePersonalAPITestServer(t, st, cfg, hub)
	resp := authorizedPersonalGETWithoutClient(t, srv, "/personal/list")
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 400 when personal access omits client metadata, got %d body=%s", resp.StatusCode, string(body))
	}
}

func TestPersonalListSkipsSymlinkEscapingPersonalRoot(t *testing.T) {
	st, cfg, hub := testEnv(t)
	personalRoot := filepath.Join(t.TempDir(), "Personal Share")
	outsideRoot := t.TempDir()
	cfg.PersonalShareDir = personalRoot
	if err := os.MkdirAll(personalRoot, 0o755); err != nil {
		t.Fatalf("mkdir personal share dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(personalRoot, "notes.txt"), []byte("personal"), 0o644); err != nil {
		t.Fatalf("write personal file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(outsideRoot, "external.txt"), []byte("outside"), 0o644); err != nil {
		t.Fatalf("write external file: %v", err)
	}
	if err := os.Symlink(filepath.Join(outsideRoot, "external.txt"), filepath.Join(personalRoot, "external-link.txt")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
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

	req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/list"), nil)
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
		t.Fatalf("expected regular personal file, got %+v", body.Files)
	}
	if paths["external-link.txt"] {
		t.Fatalf("personal listing exposed escaping symlink: %+v", body.Files)
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
	if device.RevokedAt != nil {
		t.Fatal("expected existing paired device to remain authorized after connection code regeneration")
	}
}

func TestConnectionDevicesEndpointReturnsAuthorizedBlockedAndRecentAttempts(t *testing.T) {
	st, cfg, hub := testEnv(t)
	now := time.Now().UTC().Format(time.RFC3339)
	insertPairedDeviceWithStableID(t, st, "phone-a", "Nick iPhone", "phone-a", "stable-a", now)
	for i := 0; i < 3; i++ {
		if _, err := st.RecordPairingFailure(store.PairingClientMetadata{
			ClientID:        "phone-b",
			DesktopDeviceID: "desktop-1",
			ClientName:      "Blocked Phone",
			Platform:        "android",
			IP:              "192.168.1.30",
		}, 3); err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, fakeClientStates{"phone-a": "connected"})
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/settings/connection-devices")
	if err != nil {
		t.Fatalf("GET connection devices: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body struct {
		AuthorizedDevices []map[string]any `json:"authorizedDevices"`
		BlockedClients    []map[string]any `json:"blockedClients"`
		RecentAttempts    []map[string]any `json:"recentAttempts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.AuthorizedDevices) != 1 || body.AuthorizedDevices[0]["clientId"] != "phone-a" {
		t.Fatalf("unexpected authorized devices: %+v", body.AuthorizedDevices)
	}
	if body.AuthorizedDevices[0]["status"] != "connected" {
		t.Fatalf("expected connected status, got %+v", body.AuthorizedDevices[0])
	}
	if body.AuthorizedDevices[0]["displayName"] != "Nick iPhone" {
		t.Fatalf("expected displayName from clientName, got %+v", body.AuthorizedDevices[0])
	}
	if len(body.BlockedClients) != 1 || body.BlockedClients[0]["clientId"] != "phone-b" {
		t.Fatalf("unexpected blocked clients: %+v", body.BlockedClients)
	}
	if body.BlockedClients[0]["displayName"] != "Blocked Phone" {
		t.Fatalf("expected blocked displayName from clientName, got %+v", body.BlockedClients[0])
	}
	if len(body.RecentAttempts) == 0 {
		t.Fatal("expected recent attempts")
	}
}

func TestRevokeAuthorizedDeviceEndpointDoesNotDeleteHistory(t *testing.T) {
	st, cfg, hub := testEnv(t)
	now := time.Now().UTC().Format(time.RFC3339)
	insertPairedDeviceWithStableID(t, st, "phone-a", "Nick iPhone", "phone-a", "stable-a", now)
	if err := st.UpsertDailyStats(store.DailyStats{
		StatDate:             "2026-06-10",
		ClientID:             "phone-a",
		ClientNameSnapshot:   "Nick iPhone",
		ClientIPSnapshot:     "192.168.1.20",
		FileCount:            2,
		TotalBytes:           100,
		ActiveTransmissionMs: 50,
		UpdatedAt:            now,
	}); err != nil {
		t.Fatalf("UpsertDailyStats: %v", err)
	}

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

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	t.Cleanup(func() {
		_, _ = http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(`{"signalingUrl":"","accessToken":"","iceServers":[]}`))
	})

	reqBody := `{"signalingUrl":"` + signalingSrv.URL + `","accessToken":"token","iceServers":[]}`
	credentialsResp, err := http.Post(srv.URL+"/tunnel/credentials", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("POST /tunnel/credentials: %v", err)
	}
	credentialsResp.Body.Close()
	if credentialsResp.StatusCode != http.StatusOK {
		t.Fatalf("expected credentials 200, got %d", credentialsResp.StatusCode)
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

	resp, err := http.Post(srv.URL+"/settings/connection-devices/phone-a/revoke", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST revoke: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	select {
	case payload := <-registerCh:
		paired, ok := payload["pairedDevices"].([]any)
		if !ok || len(paired) != 0 {
			t.Fatalf("refreshed pairedDevices=%#v, want no devices", payload["pairedDevices"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("refreshed desktop registration was not sent after revoke")
	}

	device, err := st.GetPairedDevice("phone-a")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if device.RevokedAt == nil {
		t.Fatal("expected revoked_at to be set")
	}
	var statsCount int
	if err := st.DB().QueryRow("SELECT count(*) FROM device_daily_stats WHERE client_id = ?", "phone-a").Scan(&statsCount); err != nil {
		t.Fatalf("count daily stats: %v", err)
	}
	if statsCount != 1 {
		t.Fatalf("expected daily stats to remain, got %d", statsCount)
	}
}

func TestClearBlockedClientEndpointClearsBlockOnly(t *testing.T) {
	st, cfg, hub := testEnv(t)
	for i := 0; i < 3; i++ {
		if _, err := st.RecordPairingFailure(store.PairingClientMetadata{ClientID: "phone-a", DesktopDeviceID: "desktop-1"}, 3); err != nil {
			t.Fatalf("RecordPairingFailure desktop-1: %v", err)
		}
		if _, err := st.RecordPairingFailure(store.PairingClientMetadata{ClientID: "phone-a", DesktopDeviceID: "desktop-2"}, 3); err != nil {
			t.Fatalf("RecordPairingFailure desktop-2: %v", err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/settings/blocked-clients/phone-a/clear?desktopDeviceId=desktop-1", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST clear block: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if block, _ := st.GetActivePairingBlock("phone-a", "desktop-1"); block != nil {
		t.Fatal("expected desktop-1 active block to be cleared")
	}
	if block, err := st.GetActivePairingBlock("phone-a", "desktop-2"); err != nil || block == nil {
		t.Fatalf("expected desktop-2 active block to remain, block=%+v err=%v", block, err)
	}
	if _, err := st.GetPairedDevice("phone-a"); err == nil {
		t.Fatal("clearing block must not authorize device")
	}
}

func TestRegenerateConnectionCodeDoesNotRevokeAuthorizedDevices(t *testing.T) {
	st, cfg, hub := testEnv(t)
	now := time.Now().UTC().Format(time.RFC3339)
	insertPairedDeviceWithStableID(t, st, "phone-a", "Nick iPhone", "phone-a", "stable-a", now)
	oldCode, err := st.GetConnectionCode()
	if err != nil {
		t.Fatalf("GetConnectionCode before regenerate: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/connection-code/regenerate", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST regenerate: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	newCode := body["code"]
	if len(newCode) != 6 || newCode == oldCode {
		t.Fatalf("expected regenerated 6-digit code different from %q, got %q", oldCode, newCode)
	}
	storedCode, err := st.GetConnectionCode()
	if err != nil {
		t.Fatalf("GetConnectionCode after regenerate: %v", err)
	}
	if storedCode != newCode {
		t.Fatalf("stored code=%q, response code=%q", storedCode, newCode)
	}

	device, err := st.GetPairedDevice("phone-a")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if device.RevokedAt != nil {
		t.Fatal("regenerating connection code must not revoke authorized devices")
	}
}

func TestSetConnectionCode(t *testing.T) {
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

	resp, err := http.Post(
		srv.URL+"/connection-code",
		"application/json",
		strings.NewReader(`{"code":"238416"}`),
	)
	if err != nil {
		t.Fatalf("POST /connection-code: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["code"] != "238416" {
		t.Fatalf("code = %q, want 238416", body["code"])
	}

	code, err := st.GetConnectionCode()
	if err != nil {
		t.Fatalf("GetConnectionCode: %v", err)
	}
	if code != "238416" {
		t.Fatalf("stored code = %q, want 238416", code)
	}

	device, err := st.GetPairedDevice("known-client")
	if err != nil {
		t.Fatalf("GetPairedDevice after set: %v", err)
	}
	if device.RevokedAt != nil {
		t.Fatal("setting connection code must not revoke authorized devices")
	}
}

func TestSetConnectionCodeRejectsInvalidCode(t *testing.T) {
	st, cfg, hub := testEnv(t)
	handler := func() http.Handler { _, h := api.NewServer(st, cfg, hub, nil); return h }()
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(
		srv.URL+"/connection-code",
		"application/json",
		strings.NewReader(`{"code":"12345a"}`),
	)
	if err != nil {
		t.Fatalf("POST /connection-code: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
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
