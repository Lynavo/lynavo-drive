package api

import (
	"net/http"
	"strings"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/uploadfs"
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

func (s *Server) handleManagementBlockDevice(w http.ResponseWriter, r *http.Request) {
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
	if err := s.store.BlockDevice(desktopDeviceID, clientID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to block device")
		return
	}
	s.disconnectClients([]string{clientID}, "device_blocked")
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
	s.enrichAccessRecordLocalPaths(records)
	writeJSON(w, http.StatusOK, map[string]any{"items": records})
}

func (s *Server) enrichAccessRecordLocalPaths(records []store.AccessRecord) {
	for i := range records {
		if localPath, ok := s.accessRecordLocalPath(records[i]); ok {
			records[i].LocalPath = &localPath
		}
	}
}

func (s *Server) accessRecordLocalPath(record store.AccessRecord) (string, bool) {
	if record.ResourceID == "received_library" {
		return nonEmptyLocalPath(s.config.ReceiveDir)
	}
	if relPath, ok := personalAccessRecordPath(record.ResourceID); ok {
		resolved, err := s.resolvePersonalPath(relPath)
		if err == nil {
			return nonEmptyLocalPath(resolved)
		}
	}
	if localPath, ok := s.sharedResourceAccessLocalPath(record); ok {
		return localPath, true
	}
	if record.ResourceKind == "received_file" {
		return s.receivedFileAccessLocalPath(record.ResourceID)
	}
	return "", false
}

func personalAccessRecordPath(resourceID string) (string, bool) {
	if resourceID == "personal" {
		return "", true
	}
	if strings.HasPrefix(resourceID, "personal:") {
		return strings.TrimPrefix(resourceID, "personal:"), true
	}
	return "", false
}

func (s *Server) sharedResourceAccessLocalPath(record store.AccessRecord) (string, bool) {
	if record.ResourceID == "" || record.ResourceID == "shared_resources" {
		return "", false
	}
	resource, err := s.resolveSharedResourceHelper(record.DesktopDeviceID, record.ResourceID)
	if err != nil {
		return "", false
	}
	localPath, err := s.localPathForSharedResource(resource)
	if err != nil {
		return "", false
	}
	return nonEmptyLocalPath(localPath)
}

func (s *Server) receivedFileAccessLocalPath(fileKey string) (string, bool) {
	upload, err := s.store.GetUpload(fileKey)
	if err != nil || upload.FinalPath == nil || upload.Status != "completed" {
		return "", false
	}
	resolvedPath, ok := uploadfs.ResolveFinalPath(s.config.ReceiveDir, upload.FinalPath)
	if !ok {
		return "", false
	}
	return nonEmptyLocalPath(resolvedPath)
}

func nonEmptyLocalPath(path string) (string, bool) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", false
	}
	return trimmed, true
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
