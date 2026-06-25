package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/store"
)

type fakePresenceStateProvider struct {
	alive bool
}

func (f fakePresenceStateProvider) IsAlive(clientID string, window time.Duration) bool {
	return f.alive
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

const (
	testClientID    = "test-iphone-001"
	testClientName  = "Test iPhone"
	testConnCode    = "123456"
	testReadTimeout = 5 * time.Second
)

// setupTestConnection creates an in-memory LMUP/2 server connection backed by
// a temp SQLite DB and net.Pipe(). It returns the client-side conn, store, config,
// and a cleanup function.
func setupTestConnection(t *testing.T) (clientConn net.Conn, st *store.Store, cfg *config.Config, cleanup func()) {
	clientConn, st, cfg, _, cleanup = setupTestConnectionWithDone(t)
	return clientConn, st, cfg, cleanup
}

func setupTestConnectionWithDone(t *testing.T) (clientConn net.Conn, st *store.Store, cfg *config.Config, done <-chan struct{}, cleanup func()) {
	clientConn, st, cfg, _, done, cleanup = setupTestConnectionWithDoneAndServer(t, false)
	return clientConn, st, cfg, done, cleanup
}

func setupTestConnectionWithTCPServerDone(t *testing.T) (clientConn net.Conn, st *store.Store, cfg *config.Config, done <-chan struct{}, cleanup func()) {
	clientConn, st, cfg, _, done, cleanup = setupTestConnectionWithDoneAndServer(t, true)
	return clientConn, st, cfg, done, cleanup
}

func setupTestConnectionWithTCPServer(t *testing.T) (clientConn net.Conn, st *store.Store, cfg *config.Config, srv *TCPServer, done <-chan struct{}, cleanup func()) {
	return setupTestConnectionWithDoneAndServer(t, true)
}

func setupTestConnectionWithDoneAndServer(t *testing.T, withTCPServer bool) (clientConn net.Conn, st *store.Store, cfg *config.Config, srv *TCPServer, done <-chan struct{}, cleanup func()) {
	t.Helper()
	tmpDir := t.TempDir()
	cfg = &config.Config{
		HTTPPort:              39394,
		TCPPort:               39393,
		DataDir:               tmpDir,
		ReceiveDir:            filepath.Join(tmpDir, "received"),
		DeviceName:            "test-mac",
		LowDiskThresholdBytes: 500 * 1024 * 1024,
	}
	os.MkdirAll(cfg.ReceiveDir, 0o755)
	os.MkdirAll(cfg.StagingDir(), 0o755)

	var err error
	st, err = store.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	if err := st.SetConnectionCode(testConnCode); err != nil {
		t.Fatalf("SetConnectionCode: %v", err)
	}
	if err := st.SetDeviceName("test-mac"); err != nil {
		t.Fatalf("SetDeviceName: %v", err)
	}

	hub := events.NewHub()

	client, server := net.Pipe()
	if withTCPServer {
		srv = NewTCPServer(st, cfg, hub)
	}
	conn := newConnection(server, st, cfg, hub, srv)
	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		conn.handle()
	}()

	return client, st, cfg, srv, doneCh, func() {
		client.Close()
		st.Close()
	}
}

// setupTestConnectionWithStore creates a connection using an existing store, allowing
// tests to simulate reconnection against persistent state.
func setupTestConnectionWithStore(t *testing.T, st *store.Store, cfg *config.Config) (clientConn net.Conn, cleanup func()) {
	t.Helper()
	hub := events.NewHub()

	client, server := net.Pipe()
	conn := newConnection(server, st, cfg, hub, nil)
	go conn.handle()

	return client, func() { client.Close() }
}

// --- Protocol helpers ---

// sendJSON marshals v and sends it as an LMUP/2 frame of the given type.
func sendJSON(t *testing.T, conn net.Conn, typ uint16, v any) {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal %T: %v", v, err)
	}
	if err := protocol.WriteFrame(conn, typ, data); err != nil {
		t.Fatalf("WriteFrame(0x%04x): %v", typ, err)
	}
}

// recvJSON reads a frame, checks its type, and unmarshals the body into v.
func recvJSON(t *testing.T, conn net.Conn, expectedType uint16, v any) {
	t.Helper()
	_ = recvJSONRaw(t, conn, expectedType, v)
}

func recvJSONRaw(t *testing.T, conn net.Conn, expectedType uint16, v any) []byte {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(testReadTimeout))
	hdr, body, err := protocol.ReadFrame(conn)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	if hdr.Type != expectedType {
		t.Fatalf("expected frame type 0x%04x, got 0x%04x (body=%s)", expectedType, hdr.Type, string(body))
	}
	if v != nil {
		if err := json.Unmarshal(body, v); err != nil {
			t.Fatalf("unmarshal %T: %v\nbody: %s", v, err, string(body))
		}
	}
	return body
}

func assertNoExtraFrame(t *testing.T, conn net.Conn) {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if hdr, _, err := protocol.ReadFrame(conn); err == nil {
		t.Fatalf("unexpected extra frame type=0x%04x", hdr.Type)
	}
}

// sendFileData constructs and sends a FILE_DATA binary frame.
func sendFileData(t *testing.T, conn net.Conn, fileKey string, offset int64, data []byte) {
	t.Helper()
	keyBytes := []byte(fileKey)
	bodyLen := 2 + len(keyBytes) + 8 + len(data)
	body := make([]byte, bodyLen)
	binary.BigEndian.PutUint16(body[0:2], uint16(len(keyBytes)))
	copy(body[2:2+len(keyBytes)], keyBytes)
	binary.BigEndian.PutUint64(body[2+len(keyBytes):2+len(keyBytes)+8], uint64(offset))
	copy(body[2+len(keyBytes)+8:], data)
	if err := protocol.WriteFrame(conn, protocol.TypeFileData, body); err != nil {
		t.Fatalf("WriteFrame(FILE_DATA): %v", err)
	}
}

// doPairing performs the HELLO -> PAIR_REQ -> PairRes handshake for a new device,
// returning the pairing token from PairRes.
func doPairing(t *testing.T, client net.Conn) string {
	t.Helper()

	// HELLO_REQ (no pairingToken -> new device)
	sendJSON(t, client, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                testClientID,
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		AppState:                "active",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client, protocol.TypeHelloRes, &helloRes)
	if !helloRes.AuthRequired {
		t.Fatal("expected authRequired=true for new device")
	}
	if helloRes.Bound {
		t.Fatal("expected bound=false for new device")
	}
	if helloRes.AppCompatibilityVersion != protocol.AppCompatibilityVersion {
		t.Fatalf(
			"appCompatibilityVersion=%d, want %d",
			helloRes.AppCompatibilityVersion,
			protocol.AppCompatibilityVersion,
		)
	}
	if helloRes.ServerAppVersion == "" {
		t.Fatal("serverAppVersion is empty")
	}

	// PAIR_REQ with correct connection code
	sendJSON(t, client, protocol.TypePairReq, protocol.PairReq{
		ClientID:       testClientID,
		ClientName:     testClientName,
		ConnectionCode: testConnCode,
	})

	var pairRes protocol.PairRes
	recvJSON(t, client, protocol.TypePairRes, &pairRes)
	if !pairRes.OK {
		t.Fatal("pairing failed: PairRes.OK=false")
	}
	if pairRes.PairingToken == "" {
		t.Fatal("pairing token is empty")
	}
	if pairRes.PairingID == "" {
		t.Fatal("pairing ID is empty")
	}

	return pairRes.PairingToken
}

func sendPairingHello(t *testing.T, client net.Conn, clientID string) protocol.HelloRes {
	t.Helper()
	sendJSON(t, client, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                clientID,
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		AppState:                "active",
		DeviceAlias:             "Nick iPhone",
		StableDeviceID:          clientID + "-stable",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client, protocol.TypeHelloRes, &helloRes)
	if !helloRes.AuthRequired {
		t.Fatal("expected authRequired=true for pairing hello")
	}
	if helloRes.Bound {
		t.Fatal("expected bound=false for pairing hello")
	}
	return helloRes
}

func sendPairRequest(t *testing.T, client net.Conn, clientID, code string) protocol.PairRes {
	t.Helper()
	pairRes, _ := sendPairRequestRaw(t, client, clientID, code)
	return pairRes
}

func sendPairRequestRaw(t *testing.T, client net.Conn, clientID, code string) (protocol.PairRes, []byte) {
	t.Helper()
	sendJSON(t, client, protocol.TypePairReq, protocol.PairReq{
		ClientID:       clientID,
		ClientName:     testClientName,
		ConnectionCode: code,
		DeviceAlias:    "Nick iPhone",
		StableDeviceID: clientID + "-stable",
	})

	var pairRes protocol.PairRes
	body := recvJSONRaw(t, client, protocol.TypePairRes, &pairRes)
	return pairRes, body
}

func pairClientWithCode(t *testing.T, client net.Conn, clientID, code string) protocol.PairRes {
	t.Helper()
	_ = sendPairingHello(t, client, clientID)
	return sendPairRequest(t, client, clientID, code)
}

func pairingTestMeta(clientID, desktopID string) store.PairingClientMetadata {
	return store.PairingClientMetadata{
		ClientID:        clientID,
		DesktopDeviceID: desktopID,
		ClientName:      testClientName,
		DeviceAlias:     "Nick iPhone",
		Platform:        "ios",
		StableDeviceID:  clientID + "-stable",
		IP:              "127.0.0.1",
	}
}

func assertPairingMetaRemainingZeroInRawJSON(t *testing.T, body []byte) {
	t.Helper()
	if !bytes.Contains(body, []byte(`"remainingAttempts":0`)) {
		t.Fatalf("raw frame is missing remainingAttempts zero metadata: %s", string(body))
	}
}

// doSyncBegin sends SYNC_BEGIN_REQ and verifies the response.
func doSyncBegin(t *testing.T, client net.Conn, sessionID string, count int, totalBytes int64) {
	t.Helper()
	sendJSON(t, client, protocol.TypeSyncBeginReq, protocol.SyncBeginReq{
		SessionID:       sessionID,
		QueueTotalCount: count,
		QueueTotalBytes: totalBytes,
	})
	var res protocol.SyncBeginRes
	recvJSON(t, client, protocol.TypeSyncBeginRes, &res)
	if !res.OK {
		t.Fatal("SyncBeginRes.OK=false")
	}
}

// doFileInit sends FILE_INIT_REQ and returns the FileInitRes.
func doFileInit(t *testing.T, client net.Conn, fileKey, filename string, fileSize int64) protocol.FileInitRes {
	t.Helper()
	sendJSON(t, client, protocol.TypeFileInitReq, protocol.FileInitReq{
		FileKey:          fileKey,
		OriginalFilename: filename,
		MediaType:        "image",
		MimeType:         "image/jpeg",
		FileSize:         fileSize,
		CreatedAt:        "2026-03-21T10:00:00Z",
		ModifiedAt:       "2026-03-21T10:00:00Z",
		QueueIndex:       0,
		QueueTotalCount:  1,
	})
	var res protocol.FileInitRes
	recvJSON(t, client, protocol.TypeFileInitRes, &res)
	return res
}

// doFileEnd sends FILE_END_REQ and returns the FileEndRes.
func doFileEnd(t *testing.T, client net.Conn, fileKey string, fileSize int64, sha256Hash string) protocol.FileEndRes {
	t.Helper()
	sendJSON(t, client, protocol.TypeFileEndReq, protocol.FileEndReq{
		FileKey:  fileKey,
		FileSize: fileSize,
		SHA256:   sha256Hash,
	})
	var res protocol.FileEndRes
	recvJSON(t, client, protocol.TypeFileEndRes, &res)
	return res
}

// computeHMAC computes HMAC-SHA256(key, message) where both are hex-decoded first.
func computeHMAC(t *testing.T, pairingToken, nonce string) string {
	t.Helper()
	// The server stores SHA256(pairingToken) as the token hash.
	// Auth HMAC is: HMAC-SHA256(tokenHashBytes, nonceBytes)
	tokenHash := sha256.Sum256([]byte(pairingToken))
	tokenHashBytes := tokenHash[:]

	nonceBytes, err := hex.DecodeString(nonce)
	if err != nil {
		t.Fatalf("hex decode nonce: %v", err)
	}

	mac := hmac.New(sha256.New, tokenHashBytes)
	mac.Write(nonceBytes)
	return hex.EncodeToString(mac.Sum(nil))
}

// --- Tests ---

func TestHelloRejectsIncompatibleAppVersion(t *testing.T) {
	client, _, _, cleanup := setupTestConnection(t)
	defer cleanup()

	sendJSON(t, client, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                testClientID,
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion + 1,
		AppState:                "active",
	})

	var errMsg protocol.ErrorMsg
	recvJSON(t, client, protocol.TypeError, &errMsg)
	if errMsg.Code != "APP_VERSION_INCOMPATIBLE" {
		t.Fatalf("error code=%q, want APP_VERSION_INCOMPATIBLE", errMsg.Code)
	}
}

func TestWrongConnectionCodeBlocksOnThirdAttempt(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()
	if err := st.SetSetting("device_id", "desktop-1"); err != nil {
		t.Fatalf("SetSetting(device_id): %v", err)
	}

	for attempt := 1; attempt <= 3; attempt++ {
		attemptClient := client
		attemptCleanup := func() {}
		if attempt > 1 {
			attemptClient, attemptCleanup = setupTestConnectionWithStore(t, st, cfg)
		}

		_ = sendPairingHello(t, attemptClient, "phone-a")
		pairRes, rawPairRes := sendPairRequestRaw(t, attemptClient, "phone-a", "000000")
		if pairRes.OK {
			t.Fatalf("attempt %d PairRes.OK=true, want false", attempt)
		}
		wantCode := "PAIRING_CODE_INVALID"
		if attempt == 3 {
			wantCode = "PAIRING_CLIENT_BLOCKED"
		}
		if pairRes.ErrorCode != wantCode {
			t.Fatalf("attempt %d errorCode=%q, want %q", attempt, pairRes.ErrorCode, wantCode)
		}
		if pairRes.ErrorMeta == nil {
			t.Fatalf("attempt %d ErrorMeta=nil", attempt)
		}
		if pairRes.ErrorMeta.FailedAttempts != attempt {
			t.Fatalf("attempt %d failedAttempts=%d, want %d", attempt, pairRes.ErrorMeta.FailedAttempts, attempt)
		}
		wantRemaining := 3 - attempt
		if pairRes.ErrorMeta.RemainingAttempts != wantRemaining {
			t.Fatalf("attempt %d remainingAttempts=%d, want %d", attempt, pairRes.ErrorMeta.RemainingAttempts, wantRemaining)
		}
		if pairRes.ErrorMeta.MaxAttempts != 3 {
			t.Fatalf("attempt %d maxAttempts=%d, want 3", attempt, pairRes.ErrorMeta.MaxAttempts)
		}
		if attempt == 3 {
			assertPairingMetaRemainingZeroInRawJSON(t, rawPairRes)
		}
		assertNoExtraFrame(t, attemptClient)

		attemptClient.Close()
		attemptCleanup()
		time.Sleep(20 * time.Millisecond)
	}

	block, err := st.GetActivePairingBlock("phone-a", "desktop-1")
	if err != nil {
		t.Fatalf("GetActivePairingBlock: %v", err)
	}
	if block == nil {
		t.Fatal("expected active pairing block for phone-a/desktop-1")
	}
}

func TestBlockedClientRejectedAtHelloBeforePairReq(t *testing.T) {
	client, st, _, cleanup := setupTestConnection(t)
	defer cleanup()
	if err := st.SetSetting("device_id", "desktop-1"); err != nil {
		t.Fatalf("SetSetting(device_id): %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := st.RecordPairingFailure(pairingTestMeta("phone-a", "desktop-1"), 3); err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	sendJSON(t, client, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                "phone-a",
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		AppState:                "active",
		DeviceAlias:             "Nick iPhone",
		StableDeviceID:          "phone-a-stable",
	})

	var errMsg protocol.ErrorMsg
	rawErrMsg := recvJSONRaw(t, client, protocol.TypeError, &errMsg)
	if errMsg.Code != "PAIRING_CLIENT_BLOCKED" {
		t.Fatalf("error code=%q, want PAIRING_CLIENT_BLOCKED", errMsg.Code)
	}
	if errMsg.Meta == nil {
		t.Fatal("expected blocked error metadata")
	}
	assertPairingMetaRemainingZeroInRawJSON(t, rawErrMsg)
	assertNoExtraFrame(t, client)

	attempts, err := st.ListRecentPairingAttempts(1)
	if err != nil {
		t.Fatalf("ListRecentPairingAttempts: %v", err)
	}
	if len(attempts) != 1 {
		t.Fatalf("recent attempts len=%d, want 1", len(attempts))
	}
	if attempts[0].Result != store.PairingAttemptBlocked {
		t.Fatalf("latest attempt result=%q, want %q", attempts[0].Result, store.PairingAttemptBlocked)
	}
}

func TestPairingBlockDoesNotAffectOtherDesktopOrClient(t *testing.T) {
	client1, st1, _, cleanup1 := setupTestConnection(t)
	defer cleanup1()
	if err := st1.SetSetting("device_id", "desktop-1"); err != nil {
		t.Fatalf("SetSetting(device_id desktop-1): %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := st1.RecordPairingFailure(pairingTestMeta("phone-a", "desktop-1"), 3); err != nil {
			t.Fatalf("RecordPairingFailure desktop-1: %v", err)
		}
	}

	client2, st2, _, cleanup2 := setupTestConnection(t)
	defer cleanup2()
	if err := st2.SetSetting("device_id", "desktop-2"); err != nil {
		t.Fatalf("SetSetting(device_id desktop-2): %v", err)
	}

	phoneAOnDesktop2 := pairClientWithCode(t, client2, "phone-a", testConnCode)
	if !phoneAOnDesktop2.OK {
		t.Fatalf("phone-a should pair on desktop-2, got errorCode=%q error=%q", phoneAOnDesktop2.ErrorCode, phoneAOnDesktop2.Error)
	}

	phoneBOnDesktop1 := pairClientWithCode(t, client1, "phone-b", testConnCode)
	if !phoneBOnDesktop1.OK {
		t.Fatalf("phone-b should pair on desktop-1, got errorCode=%q error=%q", phoneBOnDesktop1.ErrorCode, phoneBOnDesktop1.Error)
	}
}

func TestRevokedDeviceCannotUseOldTokenButCanRepairWithCorrectCode(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	firstPair := pairClientWithCode(t, client, "phone-a", testConnCode)
	if !firstPair.OK {
		t.Fatalf("initial pairing failed: errorCode=%q error=%q", firstPair.ErrorCode, firstPair.Error)
	}
	oldToken := firstPair.PairingToken
	if oldToken == "" {
		t.Fatal("old pairing token is empty")
	}

	if err := st.RevokePairedDevice("phone-a"); err != nil {
		t.Fatalf("RevokePairedDevice: %v", err)
	}
	client.Close()
	time.Sleep(50 * time.Millisecond)

	client2, cleanup2 := setupTestConnectionWithStore(t, st, cfg)
	defer cleanup2()
	sendJSON(t, client2, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                "phone-a",
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		PairingToken:            oldToken,
		AppState:                "active",
		DeviceAlias:             "Nick iPhone",
		StableDeviceID:          "phone-a-stable",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client2, protocol.TypeHelloRes, &helloRes)
	if !helloRes.AuthRequired {
		t.Fatal("expected authRequired=true for revoked device with old token")
	}
	if helloRes.Bound {
		t.Fatal("expected bound=false for revoked device with old token")
	}

	repairPair := sendPairRequest(t, client2, "phone-a", testConnCode)
	if !repairPair.OK {
		t.Fatalf("repair pairing failed: errorCode=%q error=%q", repairPair.ErrorCode, repairPair.Error)
	}
	if repairPair.PairingToken == "" {
		t.Fatal("repair pairing token is empty")
	}
	if repairPair.PairingToken == oldToken {
		t.Fatal("repair pairing token should differ from old token")
	}
}

func TestAuthBlockedAfterNonceDoesNotSendExtraProtocolError(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()
	if err := st.SetSetting("device_id", "desktop-1"); err != nil {
		t.Fatalf("SetSetting(device_id): %v", err)
	}

	pairingToken := pairClientWithCode(t, client, "phone-a", testConnCode)
	if !pairingToken.OK {
		t.Fatalf("initial pairing failed: errorCode=%q error=%q", pairingToken.ErrorCode, pairingToken.Error)
	}
	client.Close()
	time.Sleep(50 * time.Millisecond)

	client2, cleanup2 := setupTestConnectionWithStore(t, st, cfg)
	defer cleanup2()
	sendJSON(t, client2, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                "phone-a",
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		PairingToken:            pairingToken.PairingToken,
		AppState:                "active",
		DeviceAlias:             "Nick iPhone",
		StableDeviceID:          "phone-a-stable",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client2, protocol.TypeHelloRes, &helloRes)
	if helloRes.AuthRequired {
		t.Fatal("expected authRequired=false before auth block race")
	}
	if helloRes.Nonce == "" {
		t.Fatal("nonce is empty")
	}

	for i := 0; i < 3; i++ {
		if _, err := st.RecordPairingFailure(pairingTestMeta("phone-a", "desktop-1"), 3); err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	sendJSON(t, client2, protocol.TypeAuthReq, protocol.AuthReq{
		ClientID: "phone-a",
		Auth:     computeHMAC(t, pairingToken.PairingToken, helloRes.Nonce),
	})

	var errMsg protocol.ErrorMsg
	rawErrMsg := recvJSONRaw(t, client2, protocol.TypeError, &errMsg)
	if errMsg.Code != "PAIRING_CLIENT_BLOCKED" {
		t.Fatalf("error code=%q, want PAIRING_CLIENT_BLOCKED", errMsg.Code)
	}
	if errMsg.Meta == nil {
		t.Fatal("expected blocked error metadata")
	}
	assertPairingMetaRemainingZeroInRawJSON(t, rawErrMsg)
	assertNoExtraFrame(t, client2)
}

func TestHelloResponseAdvertisesWakeCapability(t *testing.T) {
	tmpDir := t.TempDir()
	cfg := &config.Config{
		HTTPPort:              39394,
		TCPPort:               39393,
		DataDir:               tmpDir,
		ReceiveDir:            filepath.Join(tmpDir, "received"),
		DeviceName:            "test-mac",
		LowDiskThresholdBytes: 500 * 1024 * 1024,
	}
	os.MkdirAll(cfg.ReceiveDir, 0o755)
	os.MkdirAll(cfg.StagingDir(), 0o755)

	st, err := store.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer st.Close()
	if err := st.SetConnectionCode(testConnCode); err != nil {
		t.Fatalf("SetConnectionCode: %v", err)
	}
	if err := st.SetDeviceName("test-mac"); err != nil {
		t.Fatalf("SetDeviceName: %v", err)
	}

	hub := events.NewHub()
	tcpSrv := NewTCPServer(st, cfg, hub)
	tcpSrv.SetWakeProvider(fixedWakeProvider{capability: testWakeCapability()})
	client, server := net.Pipe()
	conn := newConnection(server, st, cfg, hub, tcpSrv)
	go conn.handle()
	defer client.Close()

	sendJSON(t, client, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                testClientID,
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		AppState:                "active",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client, protocol.TypeHelloRes, &helloRes)
	wake := helloRes.ServerCapabilities.Wake
	if wake == nil || !wake.Supported {
		t.Fatalf("expected supported wake capability, got %+v", wake)
	}
	if len(wake.Targets) != 1 {
		t.Fatalf("wake target len = %d, want 1", len(wake.Targets))
	}
	if wake.Targets[0].BroadcastAddress != "192.168.1.255" {
		t.Fatalf("broadcast = %q, want 192.168.1.255", wake.Targets[0].BroadcastAddress)
	}
}

func TestFullPairingAndFileTransfer(t *testing.T) {
	client, _, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	// Step 1-2: Pair the device
	_ = doPairing(t, client)

	// Step 3: SYNC_BEGIN
	sessionID := "sess-full-001"
	payload := make([]byte, 1024)
	for i := range payload {
		payload[i] = byte(i % 251) // deterministic non-zero pattern
	}
	doSyncBegin(t, client, sessionID, 1, int64(len(payload)))

	// Step 4: FILE_INIT
	fileKey := "photo-abc-123"
	filename := "vacation.jpg"
	initRes := doFileInit(t, client, fileKey, filename, int64(len(payload)))
	if initRes.Action != "UPLOAD" {
		t.Fatalf("expected action=UPLOAD, got %q", initRes.Action)
	}

	// Step 5-6: FILE_DATA
	sendFileData(t, client, fileKey, 0, payload)

	var ack protocol.FileAck
	recvJSON(t, client, protocol.TypeFileAck, &ack)
	if ack.FileKey != fileKey {
		t.Fatalf("ack fileKey=%q, want %q", ack.FileKey, fileKey)
	}
	if ack.CommittedOffset != int64(len(payload)) {
		t.Fatalf("ack committedOffset=%d, want %d", ack.CommittedOffset, len(payload))
	}

	// Step 7-8: FILE_END with correct SHA256
	hash := sha256.Sum256(payload)
	sha256Hex := hex.EncodeToString(hash[:])

	endRes := doFileEnd(t, client, fileKey, int64(len(payload)), sha256Hex)
	if !endRes.OK {
		t.Fatal("FileEndRes.OK=false")
	}
	if endRes.FileKey != fileKey {
		t.Fatalf("FileEndRes.FileKey=%q, want %q", endRes.FileKey, fileKey)
	}

	// Step 9-10: Verify the final file exists and content matches
	// The file is at: <receiveDir>/<deviceAlias|clientName>/<date>/<filename>
	// Since our test client has no alias, it falls back to clientName
	date := time.Now().Format("2006-01-02")
	expectedPath := filepath.Join(cfg.ReceiveDir, testClientName, date, filename)

	content, err := os.ReadFile(expectedPath)
	if err != nil {
		// Try with clientID as fallback (the handler uses the device's name from store)
		t.Fatalf("read final file: %v (tried %s)", err, expectedPath)
	}
	if len(content) != len(payload) {
		t.Fatalf("file size=%d, want %d", len(content), len(payload))
	}
	for i := range content {
		if content[i] != payload[i] {
			t.Fatalf("file content mismatch at byte %d: got 0x%02x, want 0x%02x", i, content[i], payload[i])
		}
	}

	// Step 11: SYNC_END
	sendJSON(t, client, protocol.TypeSyncEndReq, struct{}{})
	var syncEndRes protocol.SyncEndRes
	recvJSON(t, client, protocol.TypeSyncEndRes, &syncEndRes)
	if !syncEndRes.OK {
		t.Fatal("SyncEndRes.OK=false")
	}
}

func TestCompletedSessionStaysCompletedAfterDisconnect(t *testing.T) {
	client, st, _, done, cleanup := setupTestConnectionWithTCPServerDone(t)
	defer cleanup()

	_ = doPairing(t, client)

	sessionID := "sess-completed-disconnect"
	payload := make([]byte, 1024)
	for i := range payload {
		payload[i] = byte(i % 251)
	}
	doSyncBegin(t, client, sessionID, 1, int64(len(payload)))

	fileKey := "photo-completed-disconnect"
	initRes := doFileInit(t, client, fileKey, "completed-disconnect.jpg", int64(len(payload)))
	if initRes.Action != "UPLOAD" {
		t.Fatalf("expected action=UPLOAD, got %q", initRes.Action)
	}

	sendFileData(t, client, fileKey, 0, payload)
	var ack protocol.FileAck
	recvJSON(t, client, protocol.TypeFileAck, &ack)

	hash := sha256.Sum256(payload)
	endRes := doFileEnd(t, client, fileKey, int64(len(payload)), hex.EncodeToString(hash[:]))
	if !endRes.OK {
		t.Fatal("FileEndRes.OK=false")
	}

	sendJSON(t, client, protocol.TypeSyncEndReq, struct{}{})
	var syncEndRes protocol.SyncEndRes
	recvJSON(t, client, protocol.TypeSyncEndRes, &syncEndRes)
	if !syncEndRes.OK {
		t.Fatal("SyncEndRes.OK=false")
	}

	if err := client.Close(); err != nil {
		t.Fatalf("client.Close: %v", err)
	}
	select {
	case <-done:
	case <-time.After(testReadTimeout):
		t.Fatal("server connection did not stop after client close")
	}

	sess, err := st.GetSession(sessionID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if sess.State != "completed" {
		t.Fatalf("session state=%q, want completed", sess.State)
	}
	if sess.ActiveFileKey != nil {
		t.Fatalf("active file key=%q, want nil", *sess.ActiveFileKey)
	}
	if sess.ActiveOffset != 0 {
		t.Fatalf("active offset=%d, want 0", sess.ActiveOffset)
	}
}

func TestResumeAfterDisconnect(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	// Step 1: Pair the device
	pairingToken := doPairing(t, client)

	// Step 2: Start sync, init file, send partial data
	sessionID := "sess-resume-001"
	payload := make([]byte, 2048)
	for i := range payload {
		payload[i] = byte((i * 7) % 256) // deterministic pattern
	}
	halfLen := len(payload) / 2

	doSyncBegin(t, client, sessionID, 1, int64(len(payload)))

	fileKey := "photo-resume-456"
	filename := "beach.jpg"
	initRes := doFileInit(t, client, fileKey, filename, int64(len(payload)))
	if initRes.Action != "UPLOAD" {
		t.Fatalf("expected action=UPLOAD, got %q", initRes.Action)
	}

	// Send first half only
	sendFileData(t, client, fileKey, 0, payload[:halfLen])
	var ack protocol.FileAck
	recvJSON(t, client, protocol.TypeFileAck, &ack)
	if ack.CommittedOffset != int64(halfLen) {
		t.Fatalf("ack committedOffset=%d, want %d", ack.CommittedOffset, halfLen)
	}
	if err := st.UpdateUploadProgress(fileKey, int64(halfLen)); err != nil {
		t.Fatalf("UpdateUploadProgress: %v", err)
	}

	// Step 3: Disconnect (close client side)
	client.Close()

	// Give the server goroutine a moment to run its deferred cleanup
	time.Sleep(50 * time.Millisecond)

	// Step 4: Reconnect using the same store
	client2, cleanup2 := setupTestConnectionWithStore(t, st, cfg)
	defer cleanup2()

	// Step 5: HELLO_REQ as returning device (with pairingToken + previousSessionId)
	sendJSON(t, client2, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                testClientID,
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		PairingToken:            pairingToken,
		PreviousSessionID:       sessionID,
		AppState:                "active",
	})

	// Step 6: Receive HELLO_RES with nonce (returning device)
	var helloRes protocol.HelloRes
	recvJSON(t, client2, protocol.TypeHelloRes, &helloRes)
	if helloRes.AuthRequired {
		t.Fatal("expected authRequired=false for returning device")
	}
	if !helloRes.Bound {
		t.Fatal("expected bound=true for returning device")
	}
	if helloRes.Nonce == "" {
		t.Fatal("nonce is empty for returning device")
	}

	// Step 7-8: AUTH_REQ with HMAC
	authHMAC := computeHMAC(t, pairingToken, helloRes.Nonce)
	sendJSON(t, client2, protocol.TypeAuthReq, protocol.AuthReq{
		ClientID: testClientID,
		Auth:     authHMAC,
	})

	var authRes map[string]any
	recvJSON(t, client2, protocol.TypeAuthRes, &authRes)

	// Step 9: SYNC_BEGIN
	sessionID2 := "sess-resume-002"
	doSyncBegin(t, client2, sessionID2, 1, int64(len(payload)))

	// Step 10: FILE_INIT (same fileKey) -> should get RESUME with offset
	initRes2 := doFileInit(t, client2, fileKey, filename, int64(len(payload)))
	if initRes2.Action != "RESUME" {
		t.Fatalf("expected action=RESUME, got %q", initRes2.Action)
	}
	if initRes2.ResumeOffset != int64(halfLen) {
		t.Fatalf("expected resumeOffset=%d, got %d", halfLen, initRes2.ResumeOffset)
	}

	// Step 11: Send remaining data from offset
	sendFileData(t, client2, fileKey, int64(halfLen), payload[halfLen:])
	var ack2 protocol.FileAck
	recvJSON(t, client2, protocol.TypeFileAck, &ack2)
	if ack2.CommittedOffset != int64(len(payload)) {
		t.Fatalf("ack2 committedOffset=%d, want %d", ack2.CommittedOffset, len(payload))
	}

	// Step 12: FILE_END
	hash := sha256.Sum256(payload)
	sha256Hex := hex.EncodeToString(hash[:])

	endRes := doFileEnd(t, client2, fileKey, int64(len(payload)), sha256Hex)
	if !endRes.OK {
		t.Fatal("FileEndRes.OK=false on resume")
	}

	// Step 13: Verify complete file exists with correct content
	date := time.Now().Format("2006-01-02")
	expectedPath := filepath.Join(cfg.ReceiveDir, testClientName, date, filename)

	content, err := os.ReadFile(expectedPath)
	if err != nil {
		t.Fatalf("read final file after resume: %v (tried %s)", err, expectedPath)
	}
	if len(content) != len(payload) {
		t.Fatalf("file size=%d, want %d", len(content), len(payload))
	}
	for i := range content {
		if content[i] != payload[i] {
			t.Fatalf("file content mismatch at byte %d after resume", i)
		}
	}
}

func TestPauseTransferWhenDiskFallsBelowThresholdMidFile(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	_ = doPairing(t, client)

	sessionID := "sess-low-disk-001"
	fileKey := "photo-low-disk-001"
	filename := "disk-low.jpg"
	payload := bytes.Repeat([]byte("a"), 1024)

	doSyncBegin(t, client, sessionID, 1, int64(len(payload)))

	initRes := doFileInit(t, client, fileKey, filename, int64(len(payload)))
	if initRes.Action != "UPLOAD" {
		t.Fatalf("expected action=UPLOAD, got %q", initRes.Action)
	}

	cfg.LowDiskThresholdBytes = 1 << 60
	sendFileData(t, client, fileKey, 0, payload[:512])

	var errMsg protocol.ErrorMsg
	recvJSON(t, client, protocol.TypeError, &errMsg)
	if errMsg.Code != "LOW_DISK_PAUSED" {
		t.Fatalf("expected LOW_DISK_PAUSED error, got %q", errMsg.Code)
	}

	upload, err := st.GetUpload(fileKey)
	if err != nil {
		t.Fatalf("GetUpload: %v", err)
	}
	if upload.Status != "paused_resumable" {
		t.Fatalf("expected paused_resumable status, got %q", upload.Status)
	}
	if upload.CommittedBytes != 0 {
		t.Fatalf("expected committed bytes to remain 0 before rejected chunk write, got %d", upload.CommittedBytes)
	}
}

func TestReturningHelloRefreshesClientNameAndIPv4(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	pairingToken := doPairing(t, client)
	client.Close()
	time.Sleep(50 * time.Millisecond)

	client2, cleanup2 := setupTestConnectionWithStore(t, st, cfg)
	defer cleanup2()

	const updatedName = "iPhone 9C2A"
	const advertisedIPv4 = "192.168.1.88"

	sendJSON(t, client2, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                testClientID,
		ClientName:              updatedName,
		ClientIP:                advertisedIPv4,
		ClientPlatform:          "ios",
		AppVersion:              "0.1.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		PairingToken:            pairingToken,
		AppState:                "foreground",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client2, protocol.TypeHelloRes, &helloRes)
	if helloRes.AuthRequired {
		t.Fatal("expected authRequired=false for returning device")
	}

	paired, err := st.GetPairedDevice(testClientID)
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if paired.ClientName != updatedName {
		t.Fatalf("client name=%q, want %q", paired.ClientName, updatedName)
	}
	if paired.LastIP == nil || *paired.LastIP != advertisedIPv4 {
		t.Fatalf("last ip=%v, want %q", paired.LastIP, advertisedIPv4)
	}
}

func TestReturningHelloIgnoresDesktopNameAsClientAlias(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	pairingToken := doPairing(t, client)
	client.Close()
	time.Sleep(50 * time.Millisecond)

	staleDesktopAlias := cfg.DeviceName
	device, err := st.GetPairedDevice(testClientID)
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	device.DeviceAlias = &staleDesktopAlias
	if err := st.UpsertPairedDevice(*device); err != nil {
		t.Fatalf("UpsertPairedDevice stale alias: %v", err)
	}

	client2, cleanup2 := setupTestConnectionWithStore(t, st, cfg)
	defer cleanup2()

	sendJSON(t, client2, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                testClientID,
		ClientName:              "Android CDY-TN20",
		ClientPlatform:          "android",
		AppVersion:              "0.1.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		DeviceAlias:             cfg.DeviceName,
		PairingToken:            pairingToken,
		AppState:                "foreground",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client2, protocol.TypeHelloRes, &helloRes)
	if helloRes.AuthRequired {
		t.Fatal("expected authRequired=false for returning device")
	}

	paired, err := st.GetPairedDevice(testClientID)
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if paired.ClientName != "Android CDY-TN20" {
		t.Fatalf("client name=%q, want Android CDY-TN20", paired.ClientName)
	}
	if paired.DeviceAlias != nil {
		t.Fatalf("device alias=%q, want nil", *paired.DeviceAlias)
	}
}

func TestConnectionCodeRotationRequiresReturningDeviceToPairAgain(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	pairingToken := doPairing(t, client)
	client.Close()
	time.Sleep(50 * time.Millisecond)

	if err := st.RotateConnectionCode("654321"); err != nil {
		t.Fatalf("RotateConnectionCode: %v", err)
	}

	client2, cleanup2 := setupTestConnectionWithStore(t, st, cfg)
	defer cleanup2()

	sendJSON(t, client2, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                testClientID,
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "0.1.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		PairingToken:            pairingToken,
		AppState:                "foreground",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client2, protocol.TypeHelloRes, &helloRes)
	if !helloRes.AuthRequired {
		t.Fatal("expected authRequired=true after connection code rotation")
	}
	if helloRes.Bound {
		t.Fatal("expected bound=false after connection code rotation")
	}
	if helloRes.Nonce != "" {
		t.Fatal("expected nonce to be empty until returning device pairs again")
	}
	_ = pairingToken
}

func TestDisconnectClientsClosesActiveConnection(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()

	tcpSrv := NewTCPServer(nil, nil, events.NewHub())
	conn := newConnection(server, nil, nil, events.NewHub(), tcpSrv)
	tcpSrv.RegisterClientConnection(testClientID, conn)
	if disconnected := tcpSrv.DisconnectClients([]string{testClientID}, "connection_code_changed"); disconnected != 1 {
		t.Fatalf("DisconnectClients closed %d connections, want 1", disconnected)
	}

	client.SetReadDeadline(time.Now().Add(testReadTimeout))
	if hdr, _, err := protocol.ReadFrame(client); err == nil {
		t.Fatalf("expected connection close, got frame 0x%04x", hdr.Type)
	}
}

func TestDisconnectClientsSendsPairingInvalidatedForConnectionCodeReset(t *testing.T) {
	testDisconnectClientsSendsPairingInvalidated(t, "connection_code_regenerated")
}

func TestDisconnectClientsSendsPairingInvalidatedForConnectionCodeSet(t *testing.T) {
	testDisconnectClientsSendsPairingInvalidated(t, "connection_code_set")
}

func TestDisconnectClientsSendsPairingInvalidatedToAllActiveConnectionsForClient(t *testing.T) {
	firstClient, firstServer := net.Pipe()
	defer firstClient.Close()
	defer firstServer.Close()
	secondClient, secondServer := net.Pipe()
	defer secondClient.Close()
	defer secondServer.Close()

	tcpSrv := NewTCPServer(nil, nil, events.NewHub())
	firstConn := newConnection(firstServer, nil, nil, events.NewHub(), tcpSrv)
	secondConn := newConnection(secondServer, nil, nil, events.NewHub(), tcpSrv)
	tcpSrv.RegisterClientConnection(testClientID, firstConn)
	tcpSrv.RegisterClientConnection(testClientID, secondConn)

	done := make(chan int, 1)
	go func() {
		done <- tcpSrv.DisconnectClients([]string{testClientID}, "connection_code_regenerated")
	}()

	type readResult struct {
		name   string
		reason string
		err    error
	}
	results := make(chan readResult, 2)
	readInvalidation := func(name string, client net.Conn) {
		client.SetReadDeadline(time.Now().Add(testReadTimeout))
		var payload map[string]string
		hdr, body, err := protocol.ReadFrame(client)
		if err != nil {
			results <- readResult{name: name, err: err}
			return
		}
		if hdr.Type != protocol.TypePairingInvalidated {
			results <- readResult{name: name, err: fmt.Errorf("frame type=0x%04x", hdr.Type)}
			return
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			results <- readResult{name: name, err: err}
			return
		}
		results <- readResult{name: name, reason: payload["reason"]}
	}

	go readInvalidation("first", firstClient)
	go readInvalidation("second", secondClient)

	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatalf("%s connection did not receive pairing invalidation: %v", result.name, result.err)
		}
		if result.reason != "connection_code_regenerated" {
			t.Fatalf("%s connection pairing invalidated reason=%q, want connection_code_regenerated", result.name, result.reason)
		}
	}

	select {
	case disconnected := <-done:
		if disconnected != 2 {
			t.Fatalf("DisconnectClients closed %d connections, want 2", disconnected)
		}
	case <-time.After(testReadTimeout):
		t.Fatal("DisconnectClients did not return after sending pairing invalidation to all connections")
	}
}

func testDisconnectClientsSendsPairingInvalidated(t *testing.T, reason string) {
	t.Helper()

	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()

	tcpSrv := NewTCPServer(nil, nil, events.NewHub())
	conn := newConnection(server, nil, nil, events.NewHub(), tcpSrv)
	tcpSrv.RegisterClientConnection(testClientID, conn)

	done := make(chan int, 1)
	go func() {
		done <- tcpSrv.DisconnectClients([]string{testClientID}, reason)
	}()

	client.SetReadDeadline(time.Now().Add(testReadTimeout))
	var payload map[string]string
	recvJSON(t, client, protocol.TypePairingInvalidated, &payload)
	if payload["reason"] != reason {
		t.Fatalf("pairing invalidated reason=%q, want %s", payload["reason"], reason)
	}

	select {
	case disconnected := <-done:
		if disconnected != 1 {
			t.Fatalf("DisconnectClients closed %d connections, want 1", disconnected)
		}
	case <-time.After(testReadTimeout):
		t.Fatal("DisconnectClients did not return after sending pairing invalidation")
	}

	client.SetReadDeadline(time.Now().Add(testReadTimeout))
	if hdr, _, err := protocol.ReadFrame(client); err == nil {
		t.Fatalf("expected connection close after pairing invalidation, got frame 0x%04x", hdr.Type)
	}
}

func TestUnregisterOneOfMultipleConnectionsKeepsClientState(t *testing.T) {
	firstClient, firstServer := net.Pipe()
	defer firstClient.Close()
	defer firstServer.Close()
	secondClient, secondServer := net.Pipe()
	defer secondClient.Close()
	defer secondServer.Close()

	tcpSrv := NewTCPServer(nil, nil, events.NewHub())
	firstConn := newConnection(firstServer, nil, nil, events.NewHub(), tcpSrv)
	secondConn := newConnection(secondServer, nil, nil, events.NewHub(), tcpSrv)
	tcpSrv.RegisterClientConnection(testClientID, firstConn)
	tcpSrv.RegisterClientConnection(testClientID, secondConn)
	tcpSrv.SetClientState(testClientID, "connected")

	tcpSrv.UnregisterClientConnection(testClientID, firstConn)
	tcpSrv.RemoveClient(testClientID)

	if got := tcpSrv.GetClientState(testClientID); got != "connected" {
		t.Fatalf("client state after closing one of two connections=%q, want connected", got)
	}
}

func TestDisconnectBroadcastStatus_UsesPresenceState(t *testing.T) {
	tcpSrv := NewTCPServer(nil, nil, events.NewHub())

	if got := tcpSrv.DisconnectBroadcastStatus(testClientID); got != "offline" {
		t.Fatalf("expected offline without presence, got %q", got)
	}

	tcpSrv.SetPresenceProvider(fakePresenceStateProvider{alive: true})
	if got := tcpSrv.DisconnectBroadcastStatus(testClientID); got != "connected_idle" {
		t.Fatalf("expected connected_idle with live presence, got %q", got)
	}

	tcpSrv.SetPresenceProvider(fakePresenceStateProvider{alive: false})
	if got := tcpSrv.DisconnectBroadcastStatus(testClientID); got != "offline" {
		t.Fatalf("expected offline with stale presence, got %q", got)
	}
}

func TestDisconnectBroadcastStatus_IgnoresPresenceForRevokedDevice(t *testing.T) {
	tmpDir := t.TempDir()
	st, err := store.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer st.Close()

	now := time.Now().UTC().Format(time.RFC3339)
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         testClientID,
		ClientName:       testClientName,
		Platform:         "ios",
		PairingID:        "pair-1",
		PairingTokenHash: "hash-1",
		CreatedAt:        now,
		LastSeenAt:       now,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}
	if err := st.RevokePairedDevice(testClientID); err != nil {
		t.Fatalf("RevokePairedDevice: %v", err)
	}

	tcpSrv := NewTCPServer(st, nil, events.NewHub())
	tcpSrv.SetPresenceProvider(fakePresenceStateProvider{alive: true})

	if got := tcpSrv.DisconnectBroadcastStatus(testClientID); got != "offline" {
		t.Fatalf("expected offline for revoked device with live presence, got %q", got)
	}
}

func TestAckFlushesOnIntervalWithoutMoreFrames(t *testing.T) {
	client, _, _, cleanup := setupTestConnection(t)
	defer cleanup()

	_ = doPairing(t, client)

	sessionID := "sess-ack-flush-001"
	chunkSize := 1 * 1024 * 1024
	payload := make([]byte, chunkSize*3)
	for i := range payload {
		payload[i] = byte((i * 11) % 251)
	}

	doSyncBegin(t, client, sessionID, 1, int64(len(payload)))

	fileKey := "photo-ack-flush"
	filename := "ack-flush.jpg"
	initRes := doFileInit(t, client, fileKey, filename, int64(len(payload)))
	if initRes.Action != "UPLOAD" {
		t.Fatalf("expected action=UPLOAD, got %q", initRes.Action)
	}

	sendFileData(t, client, fileKey, 0, payload[:chunkSize])

	var ack1 protocol.FileAck
	recvJSON(t, client, protocol.TypeFileAck, &ack1)
	if ack1.CommittedOffset != int64(chunkSize) {
		t.Fatalf("first ack committedOffset=%d, want %d", ack1.CommittedOffset, chunkSize)
	}

	sendFileData(t, client, fileKey, int64(chunkSize), payload[chunkSize:chunkSize*2])
	sendFileData(t, client, fileKey, int64(chunkSize*2), payload[chunkSize*2:])

	var ack2 protocol.FileAck
	recvJSON(t, client, protocol.TypeFileAck, &ack2)
	if ack2.CommittedOffset != int64(len(payload)) {
		t.Fatalf("second ack committedOffset=%d, want %d", ack2.CommittedOffset, len(payload))
	}

	hash := sha256.Sum256(payload)
	sha256Hex := hex.EncodeToString(hash[:])
	endRes := doFileEnd(t, client, fileKey, int64(len(payload)), sha256Hex)
	if !endRes.OK {
		t.Fatal("FileEndRes.OK=false")
	}
}

func TestErrorPaths(t *testing.T) {
	t.Run("WrongConnectionCode", func(t *testing.T) {
		client, _, _, cleanup := setupTestConnection(t)
		defer cleanup()

		// HELLO_REQ
		sendJSON(t, client, protocol.TypeHelloReq, protocol.HelloReq{
			ClientID:                "wrong-code-client",
			ClientName:              "Bad Client",
			ClientPlatform:          "ios",
			AppVersion:              "1.0.0",
			AppCompatibilityVersion: protocol.AppCompatibilityVersion,
			AppState:                "active",
		})

		var helloRes protocol.HelloRes
		recvJSON(t, client, protocol.TypeHelloRes, &helloRes)
		if !helloRes.AuthRequired {
			t.Fatal("expected authRequired=true")
		}

		// PAIR_REQ with wrong code
		sendJSON(t, client, protocol.TypePairReq, protocol.PairReq{
			ClientID:       "wrong-code-client",
			ClientName:     "Bad Client",
			ConnectionCode: "999999", // wrong code
		})

		// Server sends PairRes{OK:false} then returns an error which closes the connection.
		// We should get the PairRes first.
		var pairRes protocol.PairRes
		recvJSON(t, client, protocol.TypePairRes, &pairRes)
		if pairRes.OK {
			t.Fatal("expected PairRes.OK=false for wrong code")
		}
	})

	t.Run("SkipDuplicate", func(t *testing.T) {
		client, st, cfg, cleanup := setupTestConnection(t)
		defer cleanup()

		// Pair and complete a full file transfer
		_ = doPairing(t, client)

		sessionID := "sess-dup-001"
		payload := make([]byte, 512)
		for i := range payload {
			payload[i] = byte(i % 200)
		}
		doSyncBegin(t, client, sessionID, 1, int64(len(payload)))

		fileKey := "photo-dup-789"
		filename := "dup.jpg"
		initRes := doFileInit(t, client, fileKey, filename, int64(len(payload)))
		if initRes.Action != "UPLOAD" {
			t.Fatalf("expected UPLOAD, got %q", initRes.Action)
		}

		sendFileData(t, client, fileKey, 0, payload)
		var ack protocol.FileAck
		recvJSON(t, client, protocol.TypeFileAck, &ack)

		hash := sha256.Sum256(payload)
		sha256Hex := hex.EncodeToString(hash[:])
		endRes := doFileEnd(t, client, fileKey, int64(len(payload)), sha256Hex)
		if !endRes.OK {
			t.Fatal("first upload FileEndRes.OK=false")
		}

		// SYNC_END to return to authenticated state, then start new sync
		sendJSON(t, client, protocol.TypeSyncEndReq, struct{}{})
		var syncEndRes protocol.SyncEndRes
		recvJSON(t, client, protocol.TypeSyncEndRes, &syncEndRes)

		// Start new sync and try same fileKey -> should get SKIP
		sessionID2 := "sess-dup-002"
		doSyncBegin(t, client, sessionID2, 1, int64(len(payload)))

		initRes2 := doFileInit(t, client, fileKey, filename, int64(len(payload)))
		if initRes2.Action != "SKIP" {
			t.Fatalf("expected SKIP for duplicate, got %q", initRes2.Action)
		}

		// Verify the upload record is still "completed" in the store
		upload, err := st.GetUpload(fileKey)
		if err != nil {
			t.Fatalf("GetUpload: %v", err)
		}
		if upload.Status != "completed" {
			t.Fatalf("upload status=%q, want completed", upload.Status)
		}

		// Verify file still on disk
		date := time.Now().Format("2006-01-02")
		expectedPath := filepath.Join(cfg.ReceiveDir, testClientName, date, filename)
		if _, err := os.Stat(expectedPath); os.IsNotExist(err) {
			t.Fatalf("original file missing after skip: %s", expectedPath)
		}
	})

	t.Run("ReuploadWhenCompletedFileMissing", func(t *testing.T) {
		client, st, cfg, cleanup := setupTestConnection(t)
		defer cleanup()

		_ = doPairing(t, client)

		sessionID := "sess-missing-final-001"
		payload := make([]byte, 512)
		for i := range payload {
			payload[i] = byte((i * 3) % 251)
		}
		doSyncBegin(t, client, sessionID, 1, int64(len(payload)))

		fileKey := "photo-missing-final-123"
		filename := "missing-final.jpg"
		initRes := doFileInit(t, client, fileKey, filename, int64(len(payload)))
		if initRes.Action != "UPLOAD" {
			t.Fatalf("expected initial UPLOAD, got %q", initRes.Action)
		}

		sendFileData(t, client, fileKey, 0, payload)
		var ack protocol.FileAck
		recvJSON(t, client, protocol.TypeFileAck, &ack)

		hash := sha256.Sum256(payload)
		sha256Hex := hex.EncodeToString(hash[:])
		endRes := doFileEnd(t, client, fileKey, int64(len(payload)), sha256Hex)
		if !endRes.OK {
			t.Fatal("first upload FileEndRes.OK=false")
		}

		sendJSON(t, client, protocol.TypeSyncEndReq, struct{}{})
		var syncEndRes protocol.SyncEndRes
		recvJSON(t, client, protocol.TypeSyncEndRes, &syncEndRes)

		date := time.Now().Format("2006-01-02")
		finalPath := filepath.Join(cfg.ReceiveDir, testClientName, date, filename)
		if err := os.Remove(finalPath); err != nil {
			t.Fatalf("remove finalized file: %v", err)
		}

		sessionID2 := "sess-missing-final-002"
		doSyncBegin(t, client, sessionID2, 1, int64(len(payload)))

		initRes2 := doFileInit(t, client, fileKey, filename, int64(len(payload)))
		if initRes2.Action != "UPLOAD" {
			t.Fatalf("expected UPLOAD after finalized file was removed, got %q", initRes2.Action)
		}

		upload, err := st.GetUpload(fileKey)
		if err != nil {
			t.Fatalf("GetUpload: %v", err)
		}
		if upload.Status != "receiving" {
			t.Fatalf("upload status=%q, want receiving", upload.Status)
		}
	})

	t.Run("SHA256Mismatch", func(t *testing.T) {
		client, _, cfg, cleanup := setupTestConnection(t)
		defer cleanup()

		_ = doPairing(t, client)

		sessionID := "sess-mismatch-001"
		payload := make([]byte, 768)
		for i := range payload {
			payload[i] = byte(i % 150)
		}
		doSyncBegin(t, client, sessionID, 1, int64(len(payload)))

		fileKey := "photo-bad-hash"
		filename := "bad.jpg"
		initRes := doFileInit(t, client, fileKey, filename, int64(len(payload)))
		if initRes.Action != "UPLOAD" {
			t.Fatalf("expected UPLOAD, got %q", initRes.Action)
		}

		sendFileData(t, client, fileKey, 0, payload)
		var ack protocol.FileAck
		recvJSON(t, client, protocol.TypeFileAck, &ack)

		// Send FILE_END with a wrong hash
		wrongHash := "0000000000000000000000000000000000000000000000000000000000000000"
		endRes := doFileEnd(t, client, fileKey, int64(len(payload)), wrongHash)
		if endRes.OK {
			t.Fatal("expected FileEndRes.OK=false for SHA256 mismatch")
		}

		// Verify .part file was cleaned up
		partPath := filepath.Join(cfg.StagingDir(), testClientID, fileKey+".part")
		if _, err := os.Stat(partPath); !os.IsNotExist(err) {
			t.Fatalf(".part file should have been deleted after SHA256 mismatch, but exists at %s", partPath)
		}
	})
}
