package api

import (
	"encoding/json"
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
	SharedPath     string `json:"sharedPath"`
	ShareAddress   string `json:"shareAddress"`
	ShareStatus    string `json:"shareStatus"`
	ShareName      string `json:"shareName"`
}

type updateSettingsRequest struct {
	DeviceName  *string `json:"deviceName,omitempty"`
	RootPath    *string `json:"rootPath,omitempty"`
	ReceivePath *string `json:"receivePath,omitempty"`
}

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

	// Resolve the effective receive path: rootPath takes precedence over
	// legacy receivePath.  When rootPath is provided the receive directory
	// is always <rootPath>/received so the model stays consistent.
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
		trimmed := strings.TrimSpace(*req.ReceivePath)
		newReceivePath = &trimmed
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

		// Validate: receive path and shared path must not collide.
		newSharedPath := filepath.Join(filepath.Dir(newPath), "shared")
		cleanReceive := filepath.Clean(newPath)
		cleanShared := filepath.Clean(newSharedPath)
		if cleanReceive == cleanShared {
			writeError(w, http.StatusBadRequest, "receive path must not overlap with shared directory")
			return
		}

		// Validate: directories must be creatable AND writable before committing.
		for _, dir := range []string{newPath, newSharedPath} {
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
		slog.Info("receive path hot-reloaded", "newPath", newPath)
		s.hub.Broadcast(events.Event{
			Type:    "shared.directory.changed",
			Payload: map[string]any{"path": s.config.SharedDir()},
		})
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

	return &settingsDTO{
		DeviceName:     deviceName,
		ConnectionCode: code,
		RootPath:       filepath.Dir(shareConfig.ReceiveRoot),
		ReceivePath:    shareConfig.ReceiveRoot,
		SharedPath:     s.config.SharedDir(),
		ShareAddress:   shareConfig.ShareURL,
		ShareStatus:    shareConfig.ShareStatus,
		ShareName:      shareConfig.ShareName,
	}, nil
}

type syncTunnelCredentialsRequest struct {
	SignalingURL string          `json:"signalingUrl"`
	AccessToken  string          `json:"accessToken"`
	ICEServers   json.RawMessage `json:"iceServers"`
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
		slog.Info("sync tunnel credentials cleared")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "credentials cleared"})
		return
	}

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

	manager.Start(pairedDevices)
	slog.Info("sync tunnel credentials applied",
		"signalingUrl", signalingURL,
		"desktopId", deviceID,
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
