package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/protocol"
)

type settingsDTO struct {
	DeviceName     string `json:"deviceName"`
	ConnectionCode string `json:"connectionCode"`
	RootPath       string `json:"rootPath"`
	ReceivePath    string `json:"receivePath"`
	PersonalPath   string `json:"personalPath"`
	SharedPath     string `json:"sharedPath"`
	ShareAddress   string `json:"shareAddress"`
	ShareStatus    string `json:"shareStatus"`
	ShareName      string `json:"shareName"`
}

type updateSettingsRequest struct {
	DeviceName   *string `json:"deviceName,omitempty"`
	RootPath     *string `json:"rootPath,omitempty"`
	ReceivePath  *string `json:"receivePath,omitempty"`
	PersonalPath *string `json:"personalPath,omitempty"`
}

const personalShareRootSettingKey = "personal_share_root"

func (s *Server) handleGetSettings(w http.ResponseWriter, _ *http.Request) {
	dto, err := s.assembleSettingsDTO()
	if err != nil {
		slog.Error("get settings", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}
	writeJSON(w, http.StatusOK, dto)
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req updateSettingsRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.DeviceName != nil {
		if err := s.store.SetDeviceName(*req.DeviceName); err != nil {
			slog.Error("update device_name", "err", err)
			writeError(w, http.StatusInternalServerError, "failed to update settings")
			return
		}
		if s.OnDeviceRenamed != nil {
			s.OnDeviceRenamed(*req.DeviceName)
		}
	}

	// rootPath is the only supported write entry for root-derived directories.
	// The receive directory is <rootPath>/received and the team shared directory
	// is <rootPath>/shared.
	var newReceivePath *string
	if req.RootPath != nil {
		root := strings.TrimSpace(*req.RootPath)
		if root == "" {
			writeError(w, http.StatusBadRequest, "root path must not be empty")
			return
		}
		if !filepath.IsAbs(root) {
			writeError(w, http.StatusBadRequest, "root path must be an absolute path")
			return
		}
		derived := filepath.Join(root, "received")
		newReceivePath = &derived
	} else if req.ReceivePath != nil {
		writeError(w, http.StatusBadRequest, "receive path updates are no longer supported; use rootPath")
		return
	}

	if newReceivePath != nil {
		newPath := *newReceivePath

		// Validate: non-empty, absolute path
		if newPath == "" {
			writeError(w, http.StatusBadRequest, "receive path must not be empty")
			return
		}
		if !filepath.IsAbs(newPath) {
			writeError(w, http.StatusBadRequest, "receive path must be an absolute path")
			return
		}

		// Reject path changes while a transfer is in progress
		if s.isTransferActive() {
			writeError(w, http.StatusConflict, "cannot change receive path while a transfer is active")
			return
		}

		pathConfig := *s.config
		pathConfig.ReceiveDir = newPath
		if req.RootPath != nil && strings.TrimSpace(pathConfig.PersonalShareDir) == "" {
			pathConfig.PersonalShareDir = s.config.PersonalDir()
		}
		// Validate: receive path and shared path must not collide.
		newSharedPath := pathConfig.SharedDir()
		cleanReceive := filepath.Clean(newPath)
		cleanShared := filepath.Clean(newSharedPath)
		if cleanReceive == cleanShared {
			writeError(w, http.StatusBadRequest, "receive path must not overlap with shared directory")
			return
		}

		// Validate: directories must be creatable AND writable before committing.
		for _, dir := range []string{newPath, newSharedPath, pathConfig.StagingDir()} {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				slog.Error("cannot create directory for new path", "path", dir, "err", err)
				writeError(w, http.StatusBadRequest, "cannot create directory: "+dir)
				return
			}
			// Probe writability with a unique temp file to avoid clobbering existing files.
			f, err := os.CreateTemp(dir, ".syncflow_probe_*")
			if err != nil {
				slog.Error("directory not writable", "path", dir, "err", err)
				writeError(w, http.StatusBadRequest, "directory is not writable: "+dir)
				return
			}
			probePath := f.Name()
			f.Close()
			os.Remove(probePath)
		}

		shareConfig, err := s.store.GetShareConfig()
		if err != nil {
			slog.Error("get share config for update", "err", err)
			writeError(w, http.StatusInternalServerError, "failed to update settings")
			return
		}
		shareConfig.ReceiveRoot = newPath
		if err := s.store.UpdateShareConfig(*shareConfig); err != nil {
			slog.Error("update share config receive_root", "err", err)
			writeError(w, http.StatusInternalServerError, "failed to update settings")
			return
		}

		// Hot-reload: update the in-memory config so all runtime paths
		// (file writes, dashboard, shared dir) converge immediately.
		s.config.ReceiveDir = newPath
		if req.RootPath != nil && strings.TrimSpace(s.config.PersonalShareDir) == "" {
			s.config.PersonalShareDir = pathConfig.PersonalShareDir
		}
		slog.Info("receive path hot-reloaded", "newPath", newPath)
		s.hub.Broadcast(events.Event{
			Type:    "shared.directory.changed",
			Payload: map[string]any{"path": s.config.SharedDir()},
		})
	}

	if req.PersonalPath != nil {
		newPersonalPath := strings.TrimSpace(*req.PersonalPath)
		if newPersonalPath == "" {
			writeError(w, http.StatusBadRequest, "personal path must not be empty")
			return
		}
		if !filepath.IsAbs(newPersonalPath) {
			writeError(w, http.StatusBadRequest, "personal path must be an absolute path")
			return
		}

		if err := os.MkdirAll(newPersonalPath, 0o755); err != nil {
			slog.Error("cannot create personal directory", "path", newPersonalPath, "err", err)
			writeError(w, http.StatusBadRequest, "cannot create directory: "+newPersonalPath)
			return
		}
		f, err := os.CreateTemp(newPersonalPath, ".syncflow_probe_*")
		if err != nil {
			slog.Error("personal directory not writable", "path", newPersonalPath, "err", err)
			writeError(w, http.StatusBadRequest, "directory is not writable: "+newPersonalPath)
			return
		}
		probePath := f.Name()
		f.Close()
		os.Remove(probePath)

		if err := s.store.SetSetting(personalShareRootSettingKey, newPersonalPath); err != nil {
			slog.Error("update personal share root", "err", err)
			writeError(w, http.StatusInternalServerError, "failed to update settings")
			return
		}
		s.config.PersonalShareDir = newPersonalPath
		slog.Info("personal share path hot-reloaded", "newPath", newPersonalPath)
	}

	dto, err := s.assembleSettingsDTO()
	if err != nil {
		slog.Error("get updated settings", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}
	writeJSON(w, http.StatusOK, dto)
}

func (s *Server) assembleSettingsDTO() (*settingsDTO, error) {
	deviceName, err := s.store.GetDeviceName()
	if err != nil {
		return nil, err
	}

	code, err := s.store.GetConnectionCode()
	if err != nil {
		return nil, err
	}

	shareConfig, err := s.store.GetShareConfig()
	if err != nil {
		return nil, err
	}

	pathConfig := *s.config
	if strings.TrimSpace(shareConfig.ReceiveRoot) != "" {
		pathConfig.ReceiveDir = shareConfig.ReceiveRoot
	}
	if personalRoot, err := s.store.GetSetting(personalShareRootSettingKey); err == nil {
		if strings.TrimSpace(personalRoot) != "" {
			pathConfig.PersonalShareDir = personalRoot
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	return &settingsDTO{
		DeviceName:     deviceName,
		ConnectionCode: code,
		RootPath:       pathConfig.RootDir(),
		ReceivePath:    pathConfig.ReceiveDir,
		PersonalPath:   pathConfig.PersonalDir(),
		SharedPath:     pathConfig.SharedDir(),
		ShareAddress:   shareConfig.ShareURL,
		ShareStatus:    shareConfig.ShareStatus,
		ShareName:      shareConfig.ShareName,
	}, nil
}

type syncTunnelCredentialsRequest struct {
	SignalingURL string          `json:"signalingUrl"`
	AccessToken  string          `json:"accessToken"`
	AccountID    string          `json:"accountId,omitempty"`
	ICEServers   json.RawMessage `json:"iceServers"`
}

type syncAccountContextRequest struct {
	AuthBaseURL string `json:"authBaseUrl"`
	AccessToken string `json:"accessToken"`
	AccountID   string `json:"accountId,omitempty"`
}

func (req syncAccountContextRequest) resolvedAccountID() string {
	accountID := strings.TrimSpace(req.AccountID)
	if accountID != "" {
		return accountID
	}
	if parsedAccountID, err := accountIDFromJWT(strings.TrimSpace(req.AccessToken)); err == nil {
		return parsedAccountID
	}
	return ""
}

func (s *Server) handleSyncAccountContext(w http.ResponseWriter, r *http.Request) {
	var req syncAccountContextRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	authBaseURL := strings.TrimSpace(req.AuthBaseURL)
	accessToken := strings.TrimSpace(req.AccessToken)
	if authBaseURL == "" || accessToken == "" {
		s.setDesktopAuthContext("", "")
		slog.Info("sync account context cleared")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "account context cleared"})
		return
	}

	accountID := req.resolvedAccountID()
	s.setDesktopAuthContext(accountID, authBaseURL)
	slog.Info("sync account context applied",
		"authBaseUrl", authBaseURL,
		"hasAccountId", accountID != "",
	)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "account context synced"})
}

func (s *Server) handleSyncTunnelCredentials(w http.ResponseWriter, r *http.Request) {
	var req syncTunnelCredentialsRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	signalingURL := strings.TrimSpace(req.SignalingURL)
	accessToken := strings.TrimSpace(req.AccessToken)
	if signalingURL == "" || accessToken == "" {
		s.StopTunnel()
		s.setDesktopAuthContext("", "")
		slog.Info("sync tunnel credentials cleared")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "credentials cleared"})
		return
	}

	accountID := syncAccountContextRequest{
		AuthBaseURL: signalingURL,
		AccessToken: accessToken,
		AccountID:   req.AccountID,
	}.resolvedAccountID()

	deviceID, err := s.store.GetDeviceID()
	if err != nil {
		slog.Error("failed to get desktop device id for p2p tunnel", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get device id")
		return
	}
	pairedDevices, err := s.pairedDevicesForSignaling()
	if err != nil {
		slog.Error("failed to list paired devices for p2p tunnel", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to list paired devices")
		return
	}

	manager := protocol.NewP2PManagerWithICEServers(
		deviceID,
		signalingURL,
		fmt.Sprintf("127.0.0.1:%d", s.config.HTTPPort),
		accessToken,
		protocol.ParseICEServersJSON(string(req.ICEServers)),
	)

	s.tunnelMu.Lock()
	if s.tunnel != nil {
		s.tunnel.Stop()
	}
	s.tunnel = manager
	s.tunnelMu.Unlock()
	s.setDesktopAuthContext(accountID, signalingURL)

	manager.Start(pairedDevices)
	slog.Info("sync tunnel credentials applied",
		"signalingUrl", signalingURL,
		"desktopId", deviceID,
		"hasAccountId", accountID != "",
		"pairedDevices", len(pairedDevices),
	)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "credentials synced"})
}

func (s *Server) pairedDevicesForSignaling() ([]map[string]string, error) {
	devices, err := s.store.ListPairedDevices()
	if err != nil {
		return nil, err
	}

	paired := make([]map[string]string, 0, len(devices))
	for _, device := range devices {
		if device.RevokedAt != nil || device.ClientID == "" || device.PairingTokenHash == "" {
			continue
		}
		paired = append(paired, map[string]string{
			"clientId":     device.ClientID,
			"pairingToken": device.PairingTokenHash,
		})
	}
	return paired, nil
}
