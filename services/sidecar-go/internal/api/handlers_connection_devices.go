package api

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"
)

type connectionDeviceDTO struct {
	ClientID       string  `json:"clientId"`
	StableDeviceID *string `json:"stableDeviceId,omitempty"`
	DisplayName    string  `json:"displayName"`
	ClientName     string  `json:"clientName"`
	DeviceAlias    *string `json:"deviceAlias,omitempty"`
	Platform       string  `json:"platform"`
	IP             *string `json:"ip,omitempty"`
	Status         string  `json:"status"`
	AuthorizedAt   string  `json:"authorizedAt"`
	LastSeenAt     string  `json:"lastSeenAt"`
	RevokedAt      *string `json:"revokedAt,omitempty"`
}

type blockedPairingClientDTO struct {
	ClientID       string  `json:"clientId"`
	StableDeviceID *string `json:"stableDeviceId,omitempty"`
	DisplayName    string  `json:"displayName"`
	ClientName     *string `json:"clientName,omitempty"`
	DeviceAlias    *string `json:"deviceAlias,omitempty"`
	Platform       *string `json:"platform,omitempty"`
	LastIP         *string `json:"lastIp,omitempty"`
	FailedAttempts int     `json:"failedAttempts"`
	BlockedAt      string  `json:"blockedAt"`
	LastAttemptAt  string  `json:"lastAttemptAt"`
	Reason         string  `json:"reason"`
}

type pairingAttemptDTO struct {
	ID             int64   `json:"id"`
	ClientID       string  `json:"clientId"`
	StableDeviceID *string `json:"stableDeviceId,omitempty"`
	DisplayName    string  `json:"displayName"`
	ClientName     *string `json:"clientName,omitempty"`
	DeviceAlias    *string `json:"deviceAlias,omitempty"`
	Platform       *string `json:"platform,omitempty"`
	IP             *string `json:"ip,omitempty"`
	Result         string  `json:"result"`
	FailureReason  *string `json:"failureReason,omitempty"`
	CreatedAt      string  `json:"createdAt"`
}

type connectionDevicesSettingsDTO struct {
	AuthorizedDevices []connectionDeviceDTO     `json:"authorizedDevices"`
	BlockedClients    []blockedPairingClientDTO `json:"blockedClients"`
	RecentAttempts    []pairingAttemptDTO       `json:"recentAttempts"`
}

func resolveConnectionDeviceDisplayName(deviceAlias *string, clientName *string, clientID string) string {
	if deviceAlias != nil && strings.TrimSpace(*deviceAlias) != "" {
		return *deviceAlias
	}
	if clientName != nil && strings.TrimSpace(*clientName) != "" {
		return *clientName
	}
	return clientID
}

func (s *Server) handleGetConnectionDevices(w http.ResponseWriter, _ *http.Request) {
	devices, err := s.store.ListAuthorizedDevices()
	if err != nil {
		slog.Error("list authorized devices", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to list authorized devices")
		return
	}
	blocks, err := s.store.ListBlockedPairingClients()
	if err != nil {
		slog.Error("list blocked pairing clients", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to list blocked clients")
		return
	}
	attempts, err := s.store.ListRecentPairingAttempts(50)
	if err != nil {
		slog.Error("list recent pairing attempts", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to list pairing attempts")
		return
	}

	states := map[string]string{}
	if s.clientStates != nil {
		states = s.clientStates.ConnectedClientStates()
	}

	resp := connectionDevicesSettingsDTO{
		AuthorizedDevices: make([]connectionDeviceDTO, 0, len(devices)),
		BlockedClients:    make([]blockedPairingClientDTO, 0, len(blocks)),
		RecentAttempts:    make([]pairingAttemptDTO, 0, len(attempts)),
	}

	for _, device := range devices {
		status := "authorized"
		if state, ok := states[device.ClientID]; ok && strings.TrimSpace(state) != "" {
			status = "connected"
		}
		clientName := device.ClientName
		resp.AuthorizedDevices = append(resp.AuthorizedDevices, connectionDeviceDTO{
			ClientID:       device.ClientID,
			StableDeviceID: device.StableDeviceID,
			DisplayName:    resolveConnectionDeviceDisplayName(device.DeviceAlias, &clientName, device.ClientID),
			ClientName:     device.ClientName,
			DeviceAlias:    device.DeviceAlias,
			Platform:       device.Platform,
			IP:             device.LastIP,
			Status:         status,
			AuthorizedAt:   device.CreatedAt,
			LastSeenAt:     device.LastSeenAt,
			RevokedAt:      device.RevokedAt,
		})
	}

	for _, block := range blocks {
		resp.BlockedClients = append(resp.BlockedClients, blockedPairingClientDTO{
			ClientID:       block.ClientID,
			StableDeviceID: block.StableDeviceID,
			DisplayName:    resolveConnectionDeviceDisplayName(block.DeviceAlias, block.ClientName, block.ClientID),
			ClientName:     block.ClientName,
			DeviceAlias:    block.DeviceAlias,
			Platform:       block.Platform,
			LastIP:         block.LastIP,
			FailedAttempts: block.FailedAttempts,
			BlockedAt:      block.BlockedAt,
			LastAttemptAt:  block.LastAttemptAt,
			Reason:         block.Reason,
		})
	}

	for _, attempt := range attempts {
		resp.RecentAttempts = append(resp.RecentAttempts, pairingAttemptDTO{
			ID:             attempt.ID,
			ClientID:       attempt.ClientID,
			StableDeviceID: attempt.StableDeviceID,
			DisplayName:    resolveConnectionDeviceDisplayName(attempt.DeviceAlias, attempt.ClientName, attempt.ClientID),
			ClientName:     attempt.ClientName,
			DeviceAlias:    attempt.DeviceAlias,
			Platform:       attempt.Platform,
			IP:             attempt.IP,
			Result:         string(attempt.Result),
			FailureReason:  attempt.FailureReason,
			CreatedAt:      attempt.CreatedAt,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleRevokeConnectionDevice(w http.ResponseWriter, r *http.Request) {
	clientID := strings.TrimSpace(r.PathValue("clientId"))
	if clientID == "" {
		writeError(w, http.StatusBadRequest, "clientId is required")
		return
	}

	if err := s.store.RevokePairedDevice(clientID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "device not found")
			return
		}
		slog.Error("revoke connection device", "clientId", clientID, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to revoke device")
		return
	}
	s.disconnectClients([]string{clientID}, "device_revoked")

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleClearBlockedClient(w http.ResponseWriter, r *http.Request) {
	clientID := strings.TrimSpace(r.PathValue("clientId"))
	if clientID == "" {
		writeError(w, http.StatusBadRequest, "clientId is required")
		return
	}

	desktopDeviceID := strings.TrimSpace(r.URL.Query().Get("desktopDeviceId"))
	if desktopDeviceID == "" {
		deviceID, err := s.store.GetDeviceID()
		if err != nil {
			slog.Error("get desktop device id for block clear", "err", err)
			writeError(w, http.StatusInternalServerError, "failed to get device id")
			return
		}
		desktopDeviceID = strings.TrimSpace(deviceID)
	}
	if desktopDeviceID == "" {
		writeError(w, http.StatusBadRequest, "desktopDeviceId is required")
		return
	}

	if err := s.store.ClearPairingBlock(clientID, desktopDeviceID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "blocked client not found")
			return
		}
		slog.Error("clear blocked pairing client", "clientId", clientID, "desktopDeviceId", desktopDeviceID, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to clear blocked client")
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
