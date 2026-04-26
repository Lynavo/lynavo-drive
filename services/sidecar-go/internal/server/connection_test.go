package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
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
	conn := newConnection(server, st, cfg, hub, nil)
	go conn.handle()

	return client, st, cfg, func() {
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
		ClientID:       testClientID,
		ClientName:     testClientName,
		ClientPlatform: "ios",
		AppVersion:     "1.0.0",
		AppState:       "active",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client, protocol.TypeHelloRes, &helloRes)
	if !helloRes.AuthRequired {
		t.Fatal("expected authRequired=true for new device")
	}
	if helloRes.Bound {
		t.Fatal("expected bound=false for new device")
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
		ClientID:          testClientID,
		ClientName:        testClientName,
		ClientPlatform:    "ios",
		AppVersion:        "1.0.0",
		PairingToken:      pairingToken,
		PreviousSessionID: sessionID,
		AppState:          "active",
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
		ClientID:       testClientID,
		ClientName:     updatedName,
		ClientIP:       advertisedIPv4,
		ClientPlatform: "ios",
		AppVersion:     "0.1.0",
		PairingToken:   pairingToken,
		AppState:       "foreground",
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

func TestConnectionCodeRotationForcesReturningDeviceToRePair(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	pairingToken := doPairing(t, client)
	client.Close()
	time.Sleep(50 * time.Millisecond)

	revokedCount, err := st.SetConnectionCodeAndRevokePairedDevices("654321")
	if err != nil {
		t.Fatalf("SetConnectionCodeAndRevokePairedDevices: %v", err)
	}
	if revokedCount != 1 {
		t.Fatalf("expected 1 revoked device, got %d", revokedCount)
	}

	client2, cleanup2 := setupTestConnectionWithStore(t, st, cfg)
	defer cleanup2()

	sendJSON(t, client2, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:       testClientID,
		ClientName:     testClientName,
		ClientPlatform: "ios",
		AppVersion:     "0.1.0",
		PairingToken:   pairingToken,
		AppState:       "foreground",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client2, protocol.TypeHelloRes, &helloRes)
	if !helloRes.AuthRequired {
		t.Fatal("expected authRequired=true after connection code rotation revoked old token")
	}
	if helloRes.Bound {
		t.Fatal("expected bound=false after connection code rotation revoked old token")
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
			ClientID:       "wrong-code-client",
			ClientName:     "Bad Client",
			ClientPlatform: "ios",
			AppVersion:     "1.0.0",
			AppState:       "active",
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
