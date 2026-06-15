package api

import (
	"net/http"
	"strings"
)

func (s *Server) handleManagementDevices(w http.ResponseWriter, r *http.Request) {
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	devices, err := s.store.ListManagedDevices(desktopDeviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list managed devices")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": devices})
}

func (s *Server) handleManagementUnblockDevice(w http.ResponseWriter, r *http.Request) {
	clientID := strings.TrimSpace(r.PathValue("clientId"))
	if !isValidAPIID(clientID) {
		writeError(w, http.StatusBadRequest, "invalid clientId")
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	known, err := s.store.DeviceKnownForManagement(desktopDeviceID, clientID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load device")
		return
	}
	if !known {
		writeError(w, http.StatusNotFound, "device not found")
		return
	}
	if err := s.store.UnblockDevice(desktopDeviceID, clientID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to unblock device")
		return
	}
	state, err := s.store.GetDeviceBlockState(desktopDeviceID, clientID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load block state")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleManagementSyncRecords(w http.ResponseWriter, r *http.Request) {
	clientID, ok := optionalClientIDFromQuery(w, r)
	if !ok {
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	records, err := s.store.ListSyncRecords(desktopDeviceID, clientID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sync records")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": records})
}

func (s *Server) handleManagementAccessRecords(w http.ResponseWriter, r *http.Request) {
	clientID, ok := optionalClientIDFromQuery(w, r)
	if !ok {
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	records, err := s.store.ListAccessRecords(desktopDeviceID, clientID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list access records")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": records})
}

func optionalClientIDFromQuery(w http.ResponseWriter, r *http.Request) (*string, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("clientId"))
	if raw == "" {
		return nil, true
	}
	if !isValidAPIID(raw) {
		writeError(w, http.StatusBadRequest, "invalid clientId")
		return nil, false
	}
	return &raw, true
}

func isValidAPIID(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_' || r == '.':
		default:
			return false
		}
	}
	return !strings.Contains(value, "..")
}
