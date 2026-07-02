package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/events"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/runtimefs"
)

const personalAccessSignatureMaxSkew = 5 * time.Minute

const (
	personalGuardReasonCredentialsRequired = "paired_device_credentials_required"
	personalGuardReasonInvalidDeviceAuth   = "invalid_device_authorization"
)

const personalAccessCredentialsRequiredMessage = "paired device credentials are required for personal shared files access"

func (s *Server) authorizePersonalRequest(w http.ResponseWriter, r *http.Request) bool {
	_, ok := s.authorizePersonalPairedDeviceRequest(w, r)
	return ok
}

func (s *Server) authorizePersonalPairedDeviceRequest(w http.ResponseWriter, r *http.Request) (string, bool) {
	if pairedDeviceID, pairedOK, pairedAttempted, pairedStatus, pairedMessage, pairedReason := s.verifyPersonalPairedDeviceRequest(r); pairedOK {
		return pairedDeviceID, true
	} else if pairedAttempted {
		s.writePersonalAccessGuardError(w, r, pairedStatus, pairedMessage, pairedReason, "operation", "personal.paired_device")
		return "", false
	}

	s.writePersonalAccessCredentialsRequired(w, r, "personal.paired_device")
	return "", false
}

func (s *Server) verifyPersonalPairedDeviceRequest(r *http.Request) (string, bool, bool, int, string, string) {
	escapedPath := r.URL.EscapedPath()
	signature, timestamp, nonce, attempted, credentialsAllowed := personalAccessAuthValues(r, isPersonalQueryAuthAllowedPath(escapedPath))
	if !attempted {
		return "", false, false, http.StatusForbidden, personalAccessCredentialsRequiredMessage, personalGuardReasonCredentialsRequired
	}
	if !credentialsAllowed {
		return "", false, true, http.StatusUnauthorized, "paired device query credentials are not allowed for this endpoint", personalGuardReasonInvalidDeviceAuth
	}
	if signature == "" || timestamp == "" || nonce == "" {
		return "", false, true, http.StatusUnauthorized, "paired device signature is incomplete", personalGuardReasonInvalidDeviceAuth
	}

	clientID := strings.TrimSpace(r.URL.Query().Get("clientId"))
	if !isValidAPIID(clientID) {
		return "", false, true, http.StatusBadRequest, "invalid clientId", personalGuardReasonInvalidDeviceAuth
	}

	signedAt, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return "", false, true, http.StatusUnauthorized, "paired device signature timestamp is invalid", personalGuardReasonInvalidDeviceAuth
	}
	if skew := time.Since(signedAt); skew > personalAccessSignatureMaxSkew || skew < -personalAccessSignatureMaxSkew {
		return "", false, true, http.StatusUnauthorized, "paired device signature timestamp expired", personalGuardReasonInvalidDeviceAuth
	}
	if strings.TrimSpace(nonce) == "" || len(nonce) > 128 {
		return "", false, true, http.StatusUnauthorized, "paired device signature nonce is invalid", personalGuardReasonInvalidDeviceAuth
	}

	device, err := s.store.GetPairedDevice(clientID)
	if err != nil {
		return "", false, true, http.StatusUnauthorized, "paired device signature is invalid", personalGuardReasonInvalidDeviceAuth
	}

	tokenHashBytes, err := hex.DecodeString(strings.TrimSpace(device.PairingTokenHash))
	if err != nil || len(tokenHashBytes) == 0 {
		return "", false, true, http.StatusUnauthorized, "paired device signature is invalid", personalGuardReasonInvalidDeviceAuth
	}
	expected := personalAccessSignature(r.Method, escapedPath, clientID, timestamp, nonce, tokenHashBytes)
	if !hmac.Equal([]byte(strings.ToLower(signature)), []byte(expected)) {
		return "", false, true, http.StatusUnauthorized, "paired device signature is invalid", personalGuardReasonInvalidDeviceAuth
	}
	if !isReusablePersonalQueryAuthPath(escapedPath) && !s.rememberPersonalAccessNonce(clientID, nonce, signedAt.Add(personalAccessSignatureMaxSkew)) {
		return "", false, true, http.StatusUnauthorized, "paired device signature nonce replayed", personalGuardReasonInvalidDeviceAuth
	}
	if device.RevokedAt != nil {
		return "", false, true, http.StatusForbidden, "device pairing revoked", personalGuardReasonInvalidDeviceAuth
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		return "", false, true, http.StatusForbidden, "device authorization unavailable", personalGuardReasonInvalidDeviceAuth
	}
	block, err := s.store.GetDeviceBlockState(desktopDeviceID, clientID)
	if err != nil {
		return "", false, true, http.StatusForbidden, "device authorization unavailable", personalGuardReasonInvalidDeviceAuth
	}
	if block.Blocked {
		return "", false, true, http.StatusForbidden, "device is blocked", personalGuardReasonInvalidDeviceAuth
	}

	return "paired:" + clientID, true, true, http.StatusOK, "", ""
}

func (s *Server) writePersonalAccessCredentialsRequired(w http.ResponseWriter, r *http.Request, operation string) {
	s.writePersonalAccessGuardError(
		w,
		r,
		http.StatusForbidden,
		personalAccessCredentialsRequiredMessage,
		personalGuardReasonCredentialsRequired,
		"operation",
		operation,
	)
}

func (s *Server) writePersonalAccessGuardError(w http.ResponseWriter, r *http.Request, status int, message string, reason string, attrs ...any) {
	if reason == "" {
		reason = personalGuardReasonCredentialsRequired
	}
	logAttrs := []any{
		"reason", reason,
		"method", r.Method,
		"path", r.URL.Path,
		"remote", r.RemoteAddr,
	}
	logAttrs = append(logAttrs, attrs...)
	slog.Warn("personal shared files request rejected", logAttrs...)
	writeJSON(w, status, map[string]string{"error": message, "reason": reason})
}

func isReusablePersonalQueryAuthPath(escapedPath string) bool {
	return strings.HasPrefix(escapedPath, "/personal/stream/") ||
		strings.HasPrefix(escapedPath, "/personal/thumbnail/")
}

func isPersonalQueryAuthAllowedPath(escapedPath string) bool {
	return strings.HasPrefix(escapedPath, "/personal/download/") ||
		strings.HasPrefix(escapedPath, "/personal/stream/") ||
		strings.HasPrefix(escapedPath, "/personal/thumbnail/")
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

func personalAccessAuthValues(r *http.Request, allowQuery bool) (signature, timestamp, nonce string, attempted bool, credentialsAllowed bool) {
	headerSignature := strings.TrimSpace(r.Header.Get("X-LynavoDrive-Auth"))
	headerTimestamp := strings.TrimSpace(r.Header.Get("X-LynavoDrive-Auth-Timestamp"))
	headerNonce := strings.TrimSpace(r.Header.Get("X-LynavoDrive-Auth-Nonce"))
	if headerSignature != "" || headerTimestamp != "" || headerNonce != "" {
		return headerSignature, headerTimestamp, headerNonce, true, true
	}

	query := r.URL.Query()
	querySignature := strings.TrimSpace(query.Get("X-LynavoDrive-Auth"))
	queryTimestamp := strings.TrimSpace(query.Get("X-LynavoDrive-Auth-Timestamp"))
	queryNonce := strings.TrimSpace(query.Get("X-LynavoDrive-Auth-Nonce"))
	if querySignature == "" && queryTimestamp == "" && queryNonce == "" {
		return "", "", "", false, true
	}
	if !allowQuery {
		return "", "", "", true, false
	}
	return querySignature, queryTimestamp, queryNonce, true, true
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
	client = s.trustedPersonalAccessClient(client)
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

func (s *Server) trustedPersonalAccessClient(client mobileAccessClient) mobileAccessClient {
	device, err := s.store.GetPairedDevice(client.ClientID)
	if err != nil {
		client.ClientName = client.ClientID
		return client
	}
	if name := strings.TrimSpace(device.ClientName); name != "" {
		client.ClientName = name
	} else {
		client.ClientName = client.ClientID
	}
	return client
}

func personalAccessResourceName(relPath string) string {
	trimmed := strings.Trim(strings.TrimSpace(relPath), "/")
	if trimmed == "" {
		return "Personal Space"
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
