package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/runtimefs"
)

const devSandboxAuthBaseURL = "dev-sandbox://auth"
const devSandboxAccessTokenPrefix = "mock-sandbox-access-token:"
const devSandboxAccountID = "99999"
const personalAccessSignatureMaxSkew = 5 * time.Minute

func (s *Server) setDesktopAuthContext(accountID string, authBaseURL string) {
	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	s.desktopAccountID = strings.TrimSpace(accountID)
	s.authBaseURL = strings.TrimRight(strings.TrimSpace(authBaseURL), "/")
}

func (s *Server) getDesktopAuthContext() (string, string) {
	s.accountMu.RLock()
	defer s.accountMu.RUnlock()
	return s.desktopAccountID, s.authBaseURL
}

func (s *Server) authorizePersonalRequest(w http.ResponseWriter, r *http.Request) bool {
	_, ok := s.authorizePersonalRequestAccountID(w, r)
	return ok
}

func (s *Server) authorizePersonalRequestAccountID(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !s.personalRemoteAccessEnabled() {
		writeError(w, http.StatusForbidden, "remote access is disabled")
		return "", false
	}

	if accountID, ok, status, message := s.authorizePersonalAccountRequest(r); ok {
		return accountID, true
	} else if pairedAccountID, pairedOK, pairedAttempted, pairedStatus, pairedMessage := s.authorizePersonalPairedDeviceRequest(r); pairedOK {
		return pairedAccountID, true
	} else if pairedAttempted {
		writeError(w, pairedStatus, pairedMessage)
		return "", false
	} else {
		writeError(w, status, message)
		return "", false
	}
}

func (s *Server) authorizePersonalAccountRequestAccountID(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !s.personalRemoteAccessEnabled() {
		writeError(w, http.StatusForbidden, "remote access is disabled")
		return "", false
	}

	accountID, ok, status, message := s.authorizePersonalAccountRequest(r)
	if !ok {
		writeError(w, status, message)
		return "", false
	}
	return accountID, true
}

func (s *Server) personalRemoteAccessEnabled() bool {
	if val, err := s.store.GetSetting("remote_access_enabled"); err == nil {
		return val == "true"
	}
	return true
}

func (s *Server) authorizePersonalAccountRequest(r *http.Request) (string, bool, int, string) {
	desktopAccountID, authBaseURL := s.getDesktopAuthContext()
	accessToken, err := requestAccessToken(r)
	if err != nil {
		return "", false, http.StatusUnauthorized, "account bearer token is required"
	}
	if desktopAccountID == "" || authBaseURL == "" {
		return "", false, http.StatusUnauthorized, "desktop account identity is unavailable"
	}

	mobileAccountID, err := s.verifyAccessTokenAccountID(r.Context(), authBaseURL, accessToken)
	if err != nil || mobileAccountID == "" {
		return "", false, http.StatusUnauthorized, "account bearer token is invalid"
	}
	if mobileAccountID != desktopAccountID {
		return "", false, http.StatusForbidden, "account mismatch"
	}

	return desktopAccountID, true, http.StatusOK, ""
}

func (s *Server) authorizePersonalPairedDeviceRequest(r *http.Request) (string, bool, bool, int, string) {
	signature := personalAccessAuthValue(r, "X-SyncFlow-Auth")
	timestamp := personalAccessAuthValue(r, "X-SyncFlow-Auth-Timestamp")
	nonce := personalAccessAuthValue(r, "X-SyncFlow-Auth-Nonce")
	if signature == "" && timestamp == "" && nonce == "" {
		return "", false, false, http.StatusUnauthorized, "account bearer token is required"
	}
	if signature == "" || timestamp == "" || nonce == "" {
		return "", false, true, http.StatusUnauthorized, "paired device signature is incomplete"
	}

	client := mobileAccessClient{
		ClientID:   strings.TrimSpace(r.URL.Query().Get("clientId")),
		ClientName: strings.TrimSpace(r.URL.Query().Get("clientName")),
	}
	if !isValidAPIID(client.ClientID) {
		return "", false, true, http.StatusBadRequest, "invalid clientId"
	}
	if client.ClientName == "" {
		client.ClientName = client.ClientID
	}
	if len(client.ClientName) > 128 {
		return "", false, true, http.StatusBadRequest, "invalid clientName"
	}

	signedAt, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return "", false, true, http.StatusUnauthorized, "paired device signature timestamp is invalid"
	}
	if skew := time.Since(signedAt); skew > personalAccessSignatureMaxSkew || skew < -personalAccessSignatureMaxSkew {
		return "", false, true, http.StatusUnauthorized, "paired device signature timestamp expired"
	}
	if strings.TrimSpace(nonce) == "" || len(nonce) > 128 {
		return "", false, true, http.StatusUnauthorized, "paired device signature nonce is invalid"
	}

	device, err := s.store.GetPairedDevice(client.ClientID)
	if err != nil {
		return "", false, true, http.StatusForbidden, "device not authorized"
	}
	if device.RevokedAt != nil {
		return "", false, true, http.StatusForbidden, "device pairing revoked"
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err == nil {
		block, err := s.store.GetDeviceBlockState(desktopDeviceID, client.ClientID)
		if err == nil && block.Blocked {
			return "", false, true, http.StatusForbidden, "device is blocked"
		}
	}

	tokenHashBytes, err := hex.DecodeString(strings.TrimSpace(device.PairingTokenHash))
	if err != nil || len(tokenHashBytes) == 0 {
		return "", false, true, http.StatusForbidden, "device pairing token is unavailable"
	}
	expected := personalAccessSignature(r.Method, r.URL.EscapedPath(), client.ClientID, timestamp, nonce, tokenHashBytes)
	if !hmac.Equal([]byte(strings.ToLower(signature)), []byte(expected)) {
		return "", false, true, http.StatusUnauthorized, "paired device signature is invalid"
	}
	if !isPersonalStreamRequestPath(r.URL.EscapedPath()) && !s.rememberPersonalAccessNonce(client.ClientID, nonce, signedAt.Add(personalAccessSignatureMaxSkew)) {
		return "", false, true, http.StatusUnauthorized, "paired device signature nonce replayed"
	}

	return "paired:" + client.ClientID, true, true, http.StatusOK, ""
}

func isPersonalStreamRequestPath(escapedPath string) bool {
	return strings.HasPrefix(escapedPath, "/personal/stream/")
}

func (s *Server) rememberPersonalAccessNonce(clientID, nonce string, expiresAt time.Time) bool {
	s.personalAccessNonceMu.Lock()
	defer s.personalAccessNonceMu.Unlock()

	now := time.Now()
	for key, expires := range s.personalAccessNonces {
		if !expires.After(now) {
			delete(s.personalAccessNonces, key)
		}
	}

	key := strings.TrimSpace(clientID) + "\x00" + strings.TrimSpace(nonce)
	if expires, exists := s.personalAccessNonces[key]; exists && expires.After(now) {
		return false
	}
	if expiresAt.Before(now) {
		expiresAt = now
	}
	s.personalAccessNonces[key] = expiresAt
	return true
}

func personalAccessAuthValue(r *http.Request, name string) string {
	if value := strings.TrimSpace(r.Header.Get(name)); value != "" {
		return value
	}
	return strings.TrimSpace(r.URL.Query().Get(name))
}

func personalAccessSignature(method, escapedPath, clientID, timestamp, nonce string, tokenHashBytes []byte) string {
	mac := hmac.New(sha256.New, tokenHashBytes)
	_, _ = mac.Write([]byte(strings.Join([]string{
		strings.ToUpper(method),
		escapedPath,
		clientID,
		timestamp,
		nonce,
	}, "\n")))
	return hex.EncodeToString(mac.Sum(nil))
}

func requestAccessToken(r *http.Request) (string, error) {
	if token, err := bearerAccessToken(r.Header.Get("Authorization")); err == nil && token != "" {
		return token, nil
	}
	token := strings.TrimSpace(r.URL.Query().Get("access_token"))
	if token == "" {
		return "", fmt.Errorf("missing bearer token")
	}
	return token, nil
}

func bearerAccessToken(authorization string) (string, error) {
	const prefix = "Bearer "
	if !strings.HasPrefix(authorization, prefix) {
		return "", fmt.Errorf("missing bearer token")
	}
	token := strings.TrimSpace(strings.TrimPrefix(authorization, prefix))
	if token == "" {
		return "", fmt.Errorf("missing bearer token")
	}
	return token, nil
}

func (s *Server) verifyAccessTokenAccountID(ctx context.Context, authBaseURL string, accessToken string) (string, error) {
	if isDevSandboxAuthBaseURL(authBaseURL) {
		return devSandboxAccessTokenAccountID(accessToken)
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, authBaseURL+"/api/v1/user/profile", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		io.Copy(io.Discard, resp.Body)
		return "", fmt.Errorf("profile validation failed: status %d", resp.StatusCode)
	}

	var body struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.Code != 0 {
		return "", fmt.Errorf("profile validation failed: code %d", body.Code)
	}
	return accountIDValue(body.Data["id"])
}

func isDevSandboxAuthBaseURL(authBaseURL string) bool {
	return strings.TrimRight(strings.TrimSpace(authBaseURL), "/") == devSandboxAuthBaseURL
}

func devSandboxAccessTokenAccountID(accessToken string) (string, error) {
	if strings.HasPrefix(strings.TrimSpace(accessToken), devSandboxAccessTokenPrefix) {
		return devSandboxAccountID, nil
	}
	return "", fmt.Errorf("invalid dev sandbox token")
}

func accountIDValue(value any) (string, error) {
	switch typed := value.(type) {
	case string:
		accountID := strings.TrimSpace(typed)
		if accountID == "" {
			return "", fmt.Errorf("empty account id")
		}
		return accountID, nil
	case float64:
		return fmt.Sprintf("%.0f", typed), nil
	default:
		return "", fmt.Errorf("account id not found")
	}
}

func accountIDFromJWT(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 || strings.TrimSpace(parts[1]) == "" {
		return "", fmt.Errorf("invalid token")
	}

	payload, err := decodeBase64URL(parts[1])
	if err != nil {
		return "", err
	}

	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", err
	}

	for _, key := range []string{"uid", "user_id", "account_id", "sub"} {
		if value, ok := claims[key]; ok {
			if accountID, err := accountIDValue(value); err == nil {
				return accountID, nil
			}
		}
	}

	return "", fmt.Errorf("account claim not found")
}

func decodeBase64URL(input string) ([]byte, error) {
	if payload, err := base64.RawURLEncoding.DecodeString(input); err == nil {
		return payload, nil
	}
	return base64.URLEncoding.DecodeString(input)
}

func (s *Server) handlePersonalList(w http.ResponseWriter, r *http.Request) {
	if !s.authorizePersonalRequest(w, r) {
		return
	}
	client, ok := mobileAccessClientFromQuery(w, r)
	if !ok {
		return
	}
	if s.listPersonalDir(w, "") {
		s.recordPersonalAccess(client, "", "list", "shared_folder")
	}
}

func (s *Server) handlePersonalListPath(w http.ResponseWriter, r *http.Request) {
	if !s.authorizePersonalRequest(w, r) {
		return
	}
	client, ok := mobileAccessClientFromQuery(w, r)
	if !ok {
		return
	}
	relPath := r.PathValue("path")
	if s.listPersonalDir(w, relPath) {
		s.recordPersonalAccess(client, relPath, "list", "shared_folder")
	}
}

func (s *Server) listPersonalDir(w http.ResponseWriter, relPath string) bool {
	if !s.ensurePersonalDirForRequest(w, "personal.list") {
		return false
	}

	if s.usesWindowsPersonalVirtualDrives() && relPath == "" {
		return s.listWindowsPersonalDriveRoot(w)
	}

	return s.listDirectoryWithStreams(w, relPath, s.resolvePersonalPath, "personal", "/personal/thumbnail/", "/personal/stream/", true)
}

func (s *Server) handlePersonalThumbnail(w http.ResponseWriter, r *http.Request) {
	if !s.authorizePersonalRequest(w, r) {
		return
	}
	if !s.ensurePersonalDirForRequest(w, "personal.thumbnail") {
		return
	}

	s.serveCachedDirectoryThumbnail(w, r, r.PathValue("path"), s.resolvePersonalPath)
}

func (s *Server) handlePersonalDownload(w http.ResponseWriter, r *http.Request) {
	if !s.authorizePersonalRequest(w, r) {
		return
	}
	if !s.ensurePersonalDirForRequest(w, "personal.download") {
		return
	}
	client, ok := mobileAccessClientFromQuery(w, r)
	if !ok {
		return
	}

	relPath := r.PathValue("path")
	if s.serveDirectoryDownload(w, r, relPath, s.resolvePersonalPath) {
		s.recordPersonalAccess(client, relPath, "download", "shared_file")
	}
}

func (s *Server) handlePersonalStream(w http.ResponseWriter, r *http.Request) {
	if !s.authorizePersonalRequest(w, r) {
		return
	}
	if !s.ensurePersonalDirForRequest(w, "personal.stream") {
		return
	}
	client, ok := mobileAccessClientFromQuery(w, r)
	if !ok {
		return
	}

	relPath := r.PathValue("path")
	if s.serveDirectoryStream(w, r, relPath, s.resolvePersonalPath, "personal") {
		s.recordPersonalAccess(client, relPath, "view", "shared_file")
	}
}

func (s *Server) recordPersonalAccess(client mobileAccessClient, relPath string, action string, resourceKind string) {
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		slog.Warn("record personal access: load desktop id failed", "err", err)
		return
	}
	resourceID := "personal"
	normalizedPath := strings.Trim(strings.TrimSpace(relPath), "/")
	if normalizedPath != "" {
		resourceID = "personal:" + normalizedPath
	}
	resourceName := personalAccessResourceName(normalizedPath)
	if _, err := s.recordResourceAccess(desktopDeviceID, client, resourceID, resourceKind, resourceName, action, "ok"); err != nil {
		slog.Warn("record personal access failed", "resourceID", resourceID, "action", action, "err", err)
	}
}

func personalAccessResourceName(relPath string) string {
	trimmed := strings.Trim(strings.TrimSpace(relPath), "/")
	if trimmed == "" {
		return "个人空间"
	}
	name := strings.TrimSpace(path.Base(trimmed))
	if name == "." || name == "/" || name == "" {
		return trimmed
	}
	return name
}

func (s *Server) ensurePersonalDirForRequest(w http.ResponseWriter, operation string) bool {
	if s.usesWindowsPersonalVirtualDrives() {
		return true
	}

	result, err := runtimefs.EnsurePersonalDir(s.config)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "personal path unavailable")
		return false
	}
	if len(result.Recreated) > 0 {
		s.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
	}
	return true
}
