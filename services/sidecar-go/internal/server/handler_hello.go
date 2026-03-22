package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"time"

	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/store"
)

// handleHello processes HELLO_REQ from the client. It determines whether the
// device is already paired (returning) or new (needs pairing) and responds
// with the appropriate HelloRes.
func (c *connection) handleHello(body []byte) error {
	if c.state != stateWaitHello {
		return fmt.Errorf("HELLO_REQ unexpected in state %d", c.state)
	}

	var req protocol.HelloReq
	if err := json.Unmarshal(body, &req); err != nil {
		return fmt.Errorf("parse HELLO_REQ: %w", err)
	}
	c.clientID = req.ClientID

	slog.Info("HELLO_REQ received",
		"clientID", req.ClientID,
		"clientName", req.ClientName,
		"platform", req.ClientPlatform,
	)

	// Retrieve server identity
	serverID, _ := c.store.GetDeviceID()
	serverName, _ := c.store.GetDeviceName()
	shareConfig, _ := c.store.GetShareConfig()

	caps := protocol.ServerCapabilities{
		LowDiskPauseEnabled: true,
	}
	if shareConfig != nil {
		caps.ShareEnabled = shareConfig.ShareStatus == "active"
		caps.ShareName = shareConfig.ShareName
	}

	// Check if device is already paired
	device, err := c.store.GetPairedDevice(req.ClientID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		slog.Error("failed to look up paired device", "clientID", req.ClientID, "err", err)
	}

	paired := device != nil && device.RevokedAt == nil

	// If device is "returning" but client didn't send a pairingToken,
	// the client lost its credentials (e.g. app reinstall). Force re-pair.
	if paired && req.PairingToken == "" {
		slog.Info("returning device has no pairingToken — forcing re-pair", "clientID", req.ClientID)
		paired = false
	}

	if paired {
		// Generate nonce for HMAC auth
		nonceBytes := make([]byte, 32)
		if _, err := rand.Read(nonceBytes); err != nil {
			return fmt.Errorf("generate nonce: %w", err)
		}
		c.nonce = hex.EncodeToString(nonceBytes)

		// Check for session resume
		var resume *protocol.ResumeInfo
		if req.PreviousSessionID != "" {
			sess, err := c.store.GetActiveSession(req.ClientID)
			if err == nil && sess != nil && sess.SessionID == req.PreviousSessionID {
				resume = &protocol.ResumeInfo{
					Accepted:  true,
					SessionID: sess.SessionID,
				}
				if sess.ActiveFileKey != nil {
					resume.ActiveFileKey = *sess.ActiveFileKey
					resume.ResumeOffset = sess.ActiveOffset
				}
			}
		}

		// Update device_alias if provided
		if req.DeviceAlias != "" && (device.DeviceAlias == nil || *device.DeviceAlias != req.DeviceAlias) {
			device.DeviceAlias = &req.DeviceAlias
			if err := c.store.UpsertPairedDevice(*device); err != nil {
				slog.Warn("failed to update device alias", "err", err)
			}
		}

		// Update last_seen with client IP
		clientIP := extractIP(c.conn)
		if err := c.store.UpdateLastSeen(req.ClientID, clientIP); err != nil {
			slog.Warn("failed to update last_seen", "err", err)
		}

		slog.Info("sending HELLO_RES (returning device, authRequired=false)", "clientID", req.ClientID)
		res := protocol.HelloRes{
			ServerID:           serverID,
			ServerName:         serverName,
			ServerType:         "desktop",
			ProtoVersion:       protocol.Version,
			AuthRequired:       false,
			Bound:              true,
			Nonce:              c.nonce,
			Resume:             resume,
			ServerCapabilities: caps,
		}
		if err := c.sendJSON(protocol.TypeHelloRes, res); err != nil {
			return err
		}
		slog.Info("HELLO_RES sent, waiting for AUTH_REQ", "clientID", req.ClientID)
		c.state = stateWaitAuth
		return nil
	}

	// Not paired — ask client to pair
	slog.Info("sending HELLO_RES (new device, authRequired=true)", "clientID", req.ClientID)
	res := protocol.HelloRes{
		ServerID:           serverID,
		ServerName:         serverName,
		ServerType:         "desktop",
		ProtoVersion:       protocol.Version,
		AuthRequired:       true,
		Bound:              false,
		ServerCapabilities: caps,
	}
	if err := c.sendJSON(protocol.TypeHelloRes, res); err != nil {
		return err
	}
	slog.Info("HELLO_RES sent, waiting for PAIR_REQ", "clientID", req.ClientID)
	c.state = stateWaitPair
	return nil
}

// handleAuth processes AUTH_REQ from a returning (already-paired) client.
// The client proves possession of its pairingToken by computing
// HMAC-SHA256(pairingTokenHash, nonce).
func (c *connection) handleAuth(body []byte) error {
	if c.state != stateWaitAuth {
		return fmt.Errorf("AUTH_REQ unexpected in state %d", c.state)
	}

	var req protocol.AuthReq
	if err := json.Unmarshal(body, &req); err != nil {
		return fmt.Errorf("parse AUTH_REQ: %w", err)
	}

	device, err := c.store.GetPairedDevice(c.clientID)
	if err != nil {
		return fmt.Errorf("look up device for auth: %w", err)
	}

	// Compute expected HMAC: HMAC-SHA256(pairing_token_hash_bytes, nonce_bytes)
	tokenHashBytes, err := hex.DecodeString(device.PairingTokenHash)
	if err != nil {
		return fmt.Errorf("decode pairing token hash: %w", err)
	}
	nonceBytes, err := hex.DecodeString(c.nonce)
	if err != nil {
		return fmt.Errorf("decode nonce: %w", err)
	}

	mac := hmac.New(sha256.New, tokenHashBytes)
	mac.Write(nonceBytes)
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(req.Auth)) {
		_ = c.sendError("PAIR_TOKEN_INVALID", "HMAC verification failed")
		return fmt.Errorf("HMAC mismatch for client %s", c.clientID)
	}

	slog.Info("client authenticated via HMAC", "clientID", c.clientID)
	c.state = stateAuthenticated

	// Send AUTH_RES so the client isn't stuck waiting
	if err := c.sendJSON(protocol.TypeAuthRes, map[string]interface{}{"ok": true}); err != nil {
		return fmt.Errorf("send AUTH_RES: %w", err)
	}
	return nil
}

// handlePair processes PAIR_REQ from a new (unpaired) client. It verifies the
// connection code, generates pairing credentials, and stores the device.
func (c *connection) handlePair(body []byte) error {
	if c.state != stateWaitPair {
		return fmt.Errorf("PAIR_REQ unexpected in state %d", c.state)
	}

	var req protocol.PairReq
	if err := json.Unmarshal(body, &req); err != nil {
		return fmt.Errorf("parse PAIR_REQ: %w", err)
	}

	// Verify connection code
	expectedCode, err := c.store.GetConnectionCode()
	if err != nil {
		return fmt.Errorf("get connection code: %w", err)
	}

	if req.ConnectionCode != expectedCode {
		slog.Warn("pair rejected: wrong connection code", "clientID", req.ClientID)
		_ = c.sendJSON(protocol.TypePairRes, protocol.PairRes{OK: false})
		return fmt.Errorf("invalid connection code from %s", req.ClientID)
	}

	// Generate pairing credentials
	pairingID, err := generateUUID()
	if err != nil {
		return fmt.Errorf("generate pairing ID: %w", err)
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return fmt.Errorf("generate pairing token: %w", err)
	}
	pairingToken := hex.EncodeToString(tokenBytes)

	// Hash the token for storage
	hash := sha256.Sum256([]byte(pairingToken))
	tokenHash := hex.EncodeToString(hash[:])

	now := time.Now().UTC().Format(time.RFC3339)
	clientIP := extractIP(c.conn)

	var alias *string
	if req.DeviceAlias != "" {
		alias = &req.DeviceAlias
	}

	device := store.PairedDevice{
		ClientID:         req.ClientID,
		ClientName:       req.ClientName,
		DeviceAlias:      alias,
		LastIP:           &clientIP,
		Platform:         "ios", // default for mobile clients
		PairingID:        pairingID,
		PairingTokenHash: tokenHash,
		CreatedAt:        now,
		LastSeenAt:       now,
	}
	if err := c.store.UpsertPairedDevice(device); err != nil {
		return fmt.Errorf("store paired device: %w", err)
	}
	c.clientID = req.ClientID

	// Build server info
	serverID, _ := c.store.GetDeviceID()
	serverName, _ := c.store.GetDeviceName()
	shareConfig, _ := c.store.GetShareConfig()
	shareName := ""
	if shareConfig != nil {
		shareName = shareConfig.ShareName
	}

	res := protocol.PairRes{
		OK:           true,
		PairingID:    pairingID,
		PairingToken: pairingToken,
		ServerInfo: protocol.ServerInfo{
			ServerID:   serverID,
			ServerName: serverName,
			ShareName:  shareName,
		},
	}
	if err := c.sendJSON(protocol.TypePairRes, res); err != nil {
		return err
	}

	slog.Info("device paired successfully", "clientID", req.ClientID, "pairingID", pairingID)
	c.state = stateAuthenticated
	return nil
}

// --- Helpers ---

// generateUUID creates a v4 UUID using crypto/rand.
func generateUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:]), nil
}

// extractIP returns the IP address portion of a net.Conn's remote address.
func extractIP(conn net.Conn) string {
	if addr, ok := conn.RemoteAddr().(*net.TCPAddr); ok {
		return addr.IP.String()
	}
	host, _, err := net.SplitHostPort(conn.RemoteAddr().String())
	if err != nil {
		return conn.RemoteAddr().String()
	}
	return host
}
