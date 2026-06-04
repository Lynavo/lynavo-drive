package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/runtimefs"
)

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
	desktopAccountID, authBaseURL := s.getDesktopAuthContext()
	if desktopAccountID == "" || authBaseURL == "" {
		writeError(w, http.StatusUnauthorized, "desktop account identity is unavailable")
		return false
	}

	accessToken, err := requestAccessToken(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "account bearer token is required")
		return false
	}

	mobileAccountID, err := s.verifyAccessTokenAccountID(r.Context(), authBaseURL, accessToken)
	if err != nil || mobileAccountID == "" {
		writeError(w, http.StatusUnauthorized, "account bearer token is invalid")
		return false
	}
	if mobileAccountID != desktopAccountID {
		writeError(w, http.StatusForbidden, "account mismatch")
		return false
	}

	return true
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
	s.listPersonalDir(w, "")
}

func (s *Server) handlePersonalListPath(w http.ResponseWriter, r *http.Request) {
	if !s.authorizePersonalRequest(w, r) {
		return
	}
	s.listPersonalDir(w, r.PathValue("path"))
}

func (s *Server) listPersonalDir(w http.ResponseWriter, relPath string) {
	if !s.ensurePersonalDirForRequest(w, "personal.list") {
		return
	}

	s.listDirectory(w, relPath, s.resolvePersonalPath, "personal", "/personal/thumbnail/")
}

func (s *Server) handlePersonalThumbnail(w http.ResponseWriter, r *http.Request) {
	if !s.authorizePersonalRequest(w, r) {
		return
	}
	if !s.ensurePersonalDirForRequest(w, "personal.thumbnail") {
		return
	}

	s.serveDirectoryThumbnail(w, r, r.PathValue("path"), s.resolvePersonalPath)
}

func (s *Server) handlePersonalDownload(w http.ResponseWriter, r *http.Request) {
	if !s.authorizePersonalRequest(w, r) {
		return
	}
	if !s.ensurePersonalDirForRequest(w, "personal.download") {
		return
	}

	s.serveDirectoryDownload(w, r, r.PathValue("path"), s.resolvePersonalPath)
}

func (s *Server) handlePersonalStream(w http.ResponseWriter, r *http.Request) {
	if !s.authorizePersonalRequest(w, r) {
		return
	}
	if !s.ensurePersonalDirForRequest(w, "personal.stream") {
		return
	}

	s.serveDirectoryStream(w, r, r.PathValue("path"), s.resolvePersonalPath, "personal")
}

func (s *Server) ensurePersonalDirForRequest(w http.ResponseWriter, operation string) bool {
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
