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
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/events"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/protocol"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/share"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
)

const (
	pairingMaxWrongCodeAttempts = 3
	errorPairingCodeInvalid     = "PAIRING_CODE_INVALID"
	errorPairingClientBlocked   = "PAIRING_CLIENT_BLOCKED"
	errorPairTokenInvalid       = "PAIR_TOKEN_INVALID"
	errorAppVersionIncompatible = "APP_VERSION_INCOMPATIBLE"
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
	c.clientIP = preferredClientIP(req.ClientIP, c.conn)
	c.clientPlatform = req.ClientPlatform

	serverID, _ := c.store.GetDeviceID()

	slog.Info("HELLO_REQ received",
		"clientID", req.ClientID,
		"clientName", req.ClientName,
		"platform", req.ClientPlatform,
	)

	serverName, _ := c.store.GetDeviceName()
	shareConfig, _ := c.store.GetShareConfig()

	meta := c.pairingClientMetadata(req.ClientID, req.ClientName, req.DeviceAlias, req.StableDeviceID)
	if block, err := c.store.GetActivePairingBlock(meta.ClientID, meta.DesktopDeviceID); err != nil {
		return fmt.Errorf("check active pairing block: %w", err)
	} else if block != nil {
		return c.rejectPairingBlocked(meta, block)
	}

	if req.AppCompatibilityVersion != protocol.AppCompatibilityVersion {
		slog.Warn("rejecting incompatible app version",
			"clientID", req.ClientID,
			"clientVersion", req.AppVersion,
			"clientCompatibilityVersion", req.AppCompatibilityVersion,
			"serverCompatibilityVersion", protocol.AppCompatibilityVersion,
		)
		_ = c.store.RecordPairingAttempt(
			store.PairingClientMetadata{
				ClientID:        req.ClientID,
				DesktopDeviceID: serverID,
				ClientName:      req.ClientName,
				DeviceAlias:     req.DeviceAlias,
				Platform:        req.ClientPlatform,
				StableDeviceID:  req.StableDeviceID,
				IP:              preferredClientIP(req.ClientIP, c.conn),
			},
			store.PairingAttemptIncompatible,
			errorAppVersionIncompatible,
		)
		return c.rejectWithError(
			errorAppVersionIncompatible,
			fmt.Sprintf(
				"手機與桌面 App 版本不相容，請同時更新兩端後再連線。手機版本=%s 相容版本=%d，桌面相容版本=%d",
				req.AppVersion,
				req.AppCompatibilityVersion,
				protocol.AppCompatibilityVersion,
			),
		)
	}

	caps := protocol.ServerCapabilities{
		LowDiskPauseEnabled: true,
	}
	if c.server != nil {
		caps.Wake = c.server.WakeCapability()
	}
	if shareConfig != nil {
		caps.ShareEnabled = share.IsAccessibleConfig(shareConfig.ShareStatus, shareConfig.ShareURL)
		caps.ShareName = shareConfig.ShareName
	}

	// Check if device is already paired
	device, err := c.store.GetPairedDevice(req.ClientID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		slog.Error("failed to look up paired device", "clientID", req.ClientID, "err", err)
	}

	var blockBlocked bool
	if err == nil {
		block, err := c.store.GetDeviceBlockState(serverID, req.ClientID)
		if err == nil {
			blockBlocked = block.Blocked
		}
	}

	paired := device != nil && device.RevokedAt == nil && !blockBlocked

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

		shouldUpsertDevice := false
		metadataChanged := false
		if req.ClientName != "" && device.ClientName != req.ClientName {
			device.ClientName = req.ClientName
			shouldUpsertDevice = true
			metadataChanged = true
		}
		if device.DeviceAlias != nil && normalizeClientDeviceAlias(*device.DeviceAlias, serverName) == "" {
			device.DeviceAlias = nil
			shouldUpsertDevice = true
			metadataChanged = true
		}
		if alias := normalizeClientDeviceAlias(req.DeviceAlias, serverName); alias != "" &&
			(device.DeviceAlias == nil || *device.DeviceAlias != alias) {
			device.DeviceAlias = &alias
			shouldUpsertDevice = true
			metadataChanged = true
		}
		if c.clientIP != "" && (device.LastIP == nil || *device.LastIP != c.clientIP) {
			device.LastIP = &c.clientIP
			shouldUpsertDevice = true
			metadataChanged = true
		}
		if req.ClientPlatform != "" && device.Platform != req.ClientPlatform {
			device.Platform = req.ClientPlatform
			shouldUpsertDevice = true
			metadataChanged = true
		}
		if req.StableDeviceID != "" && (device.StableDeviceID == nil || *device.StableDeviceID != req.StableDeviceID) {
			device.StableDeviceID = &req.StableDeviceID
			shouldUpsertDevice = true
			metadataChanged = true
		}

		if shouldUpsertDevice {
			device.LastSeenAt = time.Now().UTC().Format(time.RFC3339)
			if err := c.store.UpsertPairedDevice(*device); err != nil {
				slog.Warn("failed to refresh paired device metadata", "err", err)
			}
		} else if err := c.store.UpdateLastSeen(req.ClientID, c.clientIP); err != nil {
			slog.Warn("failed to update last_seen", "err", err)
		}

		if metadataChanged && c.hub != nil {
			c.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
		}

		attrs := append(
			[]any{"clientID", req.ClientID, "paired", true, "authRequired", false},
			wakeCapabilityLogAttrs(caps.Wake)...,
		)
		slog.Info("HELLO_RES wake metadata", attrs...)
		slog.Info("sending HELLO_RES (returning device, authRequired=false)", "clientID", req.ClientID)
		res := protocol.HelloRes{
			ServerID:                serverID,
			ServerName:              serverName,
			ServerType:              "desktop",
			ServerAppVersion:        desktopAppVersion(),
			AppCompatibilityVersion: protocol.AppCompatibilityVersion,
			ProtoVersion:            protocol.Version,
			AuthRequired:            false,
			Bound:                   true,
			Nonce:                   c.nonce,
			Resume:                  resume,
			ServerCapabilities:      caps,
		}
		if err := c.sendJSON(protocol.TypeHelloRes, res); err != nil {
			return err
		}
		slog.Info("HELLO_RES sent, waiting for AUTH_REQ", "clientID", req.ClientID)
		c.state = stateWaitAuth
		return nil
	}

	// Not paired — ask client to pair
	attrs := append(
		[]any{"clientID", req.ClientID, "paired", false, "authRequired", true},
		wakeCapabilityLogAttrs(caps.Wake)...,
	)
	slog.Info("HELLO_RES wake metadata", attrs...)
	slog.Info("sending HELLO_RES (new device, authRequired=true)", "clientID", req.ClientID)
	res := protocol.HelloRes{
		ServerID:                serverID,
		ServerName:              serverName,
		ServerType:              "desktop",
		ServerAppVersion:        desktopAppVersion(),
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		ProtoVersion:            protocol.Version,
		AuthRequired:            true,
		Bound:                   false,
		ServerCapabilities:      caps,
	}
	if err := c.sendJSON(protocol.TypeHelloRes, res); err != nil {
		return err
	}
	slog.Info("HELLO_RES sent, waiting for PAIR_REQ", "clientID", req.ClientID)
	c.state = stateWaitPair
	return nil
}

func wakeCapabilityLogAttrs(capability *protocol.WakeCapability) []any {
	if capability == nil {
		return []any{
			"wakePresent", false,
			"wakeSupported", false,
			"wakeTargetCount", 0,
			"wakeUsableTargetCount", 0,
			"wakeUpdatedAt", "",
		}
	}
	usableTargetCount := 0
	for _, target := range capability.Targets {
		if target.MACAddress != "" && target.BroadcastAddress != "" && len(target.Ports) > 0 {
			usableTargetCount++
		}
	}
	return []any{
		"wakePresent", true,
		"wakeSupported", capability.Supported,
		"wakeTargetCount", len(capability.Targets),
		"wakeUsableTargetCount", usableTargetCount,
		"wakeUpdatedAt", capability.UpdatedAt,
		"wakeTargets", wakeTargetLogSummary(capability.Targets),
	}
}

func wakeTargetLogSummary(targets []protocol.WakeTarget) string {
	parts := make([]string, 0, len(targets))
	for _, target := range targets {
		parts = append(parts, "interface="+target.InterfaceName+
			" mac="+maskedWakeMACAddress(target.MACAddress)+
			" ipv4="+target.IPv4Address+
			" broadcast="+target.BroadcastAddress+
			" ports="+intListLogSummary(target.Ports))
	}
	return strings.Join(parts, "; ")
}

func maskedWakeMACAddress(macAddress string) string {
	parts := strings.Split(strings.ToLower(strings.ReplaceAll(strings.TrimSpace(macAddress), "-", ":")), ":")
	if len(parts) != 6 {
		return "<invalid>"
	}
	return "**:**:**:**:" + parts[4] + ":" + parts[5]
}

func intListLogSummary(values []int) string {
	if len(values) == 0 {
		return ""
	}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.Itoa(value))
	}
	return strings.Join(parts, ",")
}

func (c *connection) pairingClientMetadata(clientID, clientName, deviceAlias, stableDeviceID string) store.PairingClientMetadata {
	desktopDeviceID, _ := c.store.GetDeviceID()
	serverName, _ := c.store.GetDeviceName()
	return store.PairingClientMetadata{
		ClientID:        clientID,
		DesktopDeviceID: desktopDeviceID,
		ClientName:      clientName,
		DeviceAlias:     normalizeClientDeviceAlias(deviceAlias, serverName),
		Platform:        c.clientPlatform,
		StableDeviceID:  stableDeviceID,
		IP:              c.clientIP,
	}
}

func pairingErrorMeta(result store.PairingFailureResult) *protocol.PairingErrorMetadata {
	return &protocol.PairingErrorMetadata{
		FailedAttempts:    result.FailedAttempts,
		RemainingAttempts: result.RemainingAttempts,
		MaxAttempts:       result.MaxAttempts,
	}
}

func (c *connection) rejectPairingBlocked(meta store.PairingClientMetadata, block *store.BlockedPairingClient) error {
	_ = c.store.RecordPairingAttempt(meta, store.PairingAttemptBlocked, errorPairingClientBlocked)
	_ = c.store.TouchActivePairingBlock(meta)
	if err := c.sendJSON(protocol.TypeError, protocol.ErrorMsg{
		Code:    errorPairingClientBlocked,
		Message: "This mobile client is blocked on this desktop",
		Meta: &protocol.PairingErrorMetadata{
			FailedAttempts:    block.FailedAttempts,
			RemainingAttempts: 0,
			MaxAttempts:       pairingMaxWrongCodeAttempts,
		},
	}); err != nil {
		return err
	}
	return errProtocolErrorAlreadySent
}

func desktopAppVersion() string {
	if version := strings.TrimSpace(os.Getenv("LYNAVO_DESKTOP_APP_VERSION")); version != "" {
		return version
	}
	return "0.1.1"
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

	desktopDeviceID, _ := c.store.GetDeviceID()
	if block, err := c.store.GetActivePairingBlock(c.clientID, desktopDeviceID); err != nil {
		return fmt.Errorf("check active pairing block before auth: %w", err)
	} else if block != nil {
		meta := store.PairingClientMetadata{
			ClientID:        c.clientID,
			DesktopDeviceID: desktopDeviceID,
			ClientName:      device.ClientName,
			Platform:        device.Platform,
			IP:              c.clientIP,
		}
		if device.DeviceAlias != nil {
			meta.DeviceAlias = *device.DeviceAlias
		}
		if device.StableDeviceID != nil {
			meta.StableDeviceID = *device.StableDeviceID
		}
		_ = c.store.RecordPairingAttempt(meta, store.PairingAttemptBlocked, errorPairingClientBlocked)
		_ = c.store.TouchActivePairingBlock(meta)
		if err := c.sendJSON(protocol.TypeError, protocol.ErrorMsg{
			Code:    errorPairingClientBlocked,
			Message: "This mobile client is blocked on this desktop",
			Meta: &protocol.PairingErrorMetadata{
				FailedAttempts:    block.FailedAttempts,
				RemainingAttempts: 0,
				MaxAttempts:       pairingMaxWrongCodeAttempts,
			},
		}); err != nil {
			return err
		}
		return errProtocolErrorAlreadySent
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
		if err := c.sendError(errorPairTokenInvalid, "HMAC verification failed"); err != nil {
			return err
		}
		return errProtocolErrorAlreadySent
	}

	slog.Info("client authenticated via HMAC", "clientID", c.clientID)
	c.state = stateAuthenticated
	if c.server != nil {
		c.server.RegisterClientConnection(c.clientID, c)
		c.server.SetClientState(c.clientID, "connected")
		if c.hub != nil {
			c.hub.Broadcast(events.Event{
				Type: "device.state.changed",
				Payload: map[string]any{
					"deviceId": c.clientID,
					"status":   "connected_idle",
				},
			})
			c.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
		}
	}

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

	c.clientID = req.ClientID
	c.clientIP = preferredClientIP(req.ClientIP, c.conn)
	meta := c.pairingClientMetadata(req.ClientID, req.ClientName, req.DeviceAlias, req.StableDeviceID)
	serverID := meta.DesktopDeviceID
	if block, err := c.store.GetActivePairingBlock(meta.ClientID, meta.DesktopDeviceID); err != nil {
		return fmt.Errorf("check active pairing block before pair: %w", err)
	} else if block != nil {
		_ = c.store.RecordPairingAttempt(meta, store.PairingAttemptBlocked, errorPairingClientBlocked)
		_ = c.store.TouchActivePairingBlock(meta)
		if err := c.sendJSON(protocol.TypePairRes, protocol.PairRes{
			OK:        false,
			Error:     "client blocked",
			ErrorCode: errorPairingClientBlocked,
			ErrorMeta: &protocol.PairingErrorMetadata{
				FailedAttempts:    block.FailedAttempts,
				RemainingAttempts: 0,
				MaxAttempts:       pairingMaxWrongCodeAttempts,
			},
			RemainingAttempts: 0,
			Blocked:           true,
		}); err != nil {
			return err
		}
		return errProtocolErrorAlreadySent
	}

	// Verify connection code
	expectedCode, err := c.store.GetConnectionCode()
	if err != nil {
		return fmt.Errorf("get connection code: %w", err)
	}

	if req.ConnectionCode != expectedCode {
		slog.Warn("pair rejected: wrong connection code", "clientID", req.ClientID)
		result, recordErr := c.store.RecordPairingFailure(meta, pairingMaxWrongCodeAttempts)
		if recordErr != nil {
			return fmt.Errorf("record pairing failure: %w", recordErr)
		}
		code := errorPairingCodeInvalid
		message := "connection code invalid"
		if result.Blocked {
			code = errorPairingClientBlocked
			message = "client blocked"
		}
		if err := c.sendJSON(protocol.TypePairRes, protocol.PairRes{
			OK:                false,
			Error:             message,
			ErrorCode:         code,
			ErrorMeta:         pairingErrorMeta(result),
			RemainingAttempts: result.RemainingAttempts,
			Blocked:           result.Blocked,
		}); err != nil {
			return err
		}
		return errProtocolErrorAlreadySent
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
	clientIP := c.clientIP

	serverName, _ := c.store.GetDeviceName()
	var alias *string
	if normalizedAlias := normalizeClientDeviceAlias(req.DeviceAlias, serverName); normalizedAlias != "" {
		alias = &normalizedAlias
	}

	platform := c.clientPlatform
	if platform == "" {
		platform = "ios" // fallback for clients that don't send clientPlatform
	}

	device := store.PairedDevice{
		ClientID:         req.ClientID,
		ClientName:       req.ClientName,
		DeviceAlias:      alias,
		LastIP:           &clientIP,
		Platform:         platform,
		PairingID:        pairingID,
		PairingTokenHash: tokenHash,
		CreatedAt:        now,
		LastSeenAt:       now,
	}
	if req.StableDeviceID != "" {
		device.StableDeviceID = &req.StableDeviceID
	}

	// Generate dir name + store device atomically under the dir-name mutex.
	// No intermediate state — the device record is complete from birth.
	if _, err := PairDeviceWithDirName(c.store, c.config.ReceiveDir, device); err != nil {
		return fmt.Errorf("pair device %q: %w", req.ClientID, err)
	}
	if err := c.store.RecordPairingAttempt(meta, store.PairingAttemptSuccess, ""); err != nil {
		slog.Warn("failed to record successful pairing attempt", "clientID", req.ClientID, "err", err)
	}
	if err := c.store.ClearPairingFailures(meta.ClientID, meta.DesktopDeviceID); err != nil {
		slog.Warn("failed to clear pairing failures after success", "clientID", req.ClientID, "err", err)
	}

	// Build server info
	shareConfig, _ := c.store.GetShareConfig()
	shareName := ""
	if shareConfig != nil {
		shareName = shareConfig.ShareName
	}
	if err := c.store.ClearConnectionAttempts(serverID, req.ClientID); err != nil {
		return fmt.Errorf("clear connection attempts: %w", err)
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
	if c.server != nil {
		c.server.RegisterClientConnection(c.clientID, c)
		c.server.SetClientState(c.clientID, "connected")
		if onPairedDevicesChanged := c.server.OnPairedDevicesChanged; onPairedDevicesChanged != nil {
			go onPairedDevicesChanged("device_paired")
		}
	}
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

func preferredClientIP(advertisedIP string, conn net.Conn) string {
	advertisedIP = normalizeClientIP(advertisedIP)
	if advertisedIP != "" {
		return advertisedIP
	}
	return normalizeClientIP(extractIP(conn))
}

func normalizeClientIP(raw string) string {
	ip := net.ParseIP(raw)
	if ip == nil || ip.IsLoopback() {
		return ""
	}
	if ipv4 := ip.To4(); ipv4 != nil {
		return ipv4.String()
	}
	return ip.String()
}

func normalizeClientDeviceAlias(raw, serverName string) string {
	alias := strings.TrimSpace(raw)
	if alias == "" || alias == strings.TrimSpace(serverName) {
		return ""
	}
	return alias
}
