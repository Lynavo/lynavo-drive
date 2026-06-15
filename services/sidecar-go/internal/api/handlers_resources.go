package api

import (
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/nicksyncflow/sidecar/internal/store"
)

type sharedResourceCreateRequest struct {
	Kind            string  `json:"kind"`
	DisplayName     string  `json:"displayName"`
	LocalPath       *string `json:"localPath,omitempty"`
	ReceivedFileKey *string `json:"receivedFileKey,omitempty"`
	FileSize        *int64  `json:"fileSize,omitempty"`
	MediaType       *string `json:"mediaType,omitempty"`
	Status          string  `json:"status,omitempty"`
}

func (s *Server) handleResourcesShared(w http.ResponseWriter, r *http.Request) {
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	resources, err := s.store.ListSharedResources(desktopDeviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list shared resources")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": resources})
}

func (s *Server) handleResourcesAddShared(w http.ResponseWriter, r *http.Request) {
	var req sharedResourceCreateRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Kind = strings.TrimSpace(req.Kind)
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.Status = strings.TrimSpace(req.Status)
	if !isValidResourceKind(req.Kind) {
		writeError(w, http.StatusBadRequest, "invalid resource kind")
		return
	}
	if req.DisplayName == "" {
		writeError(w, http.StatusBadRequest, "displayName is required")
		return
	}
	if req.Status == "" {
		req.Status = "available"
	}
	if !isValidResourceStatus(req.Status) {
		writeError(w, http.StatusBadRequest, "invalid resource status")
		return
	}
	if req.LocalPath != nil {
		trimmed := strings.TrimSpace(*req.LocalPath)
		req.LocalPath = &trimmed
		if trimmed == "" {
			writeError(w, http.StatusBadRequest, "localPath must not be empty")
			return
		}
	}
	if req.ReceivedFileKey != nil {
		trimmed := strings.TrimSpace(*req.ReceivedFileKey)
		req.ReceivedFileKey = &trimmed
		if !isValidAPIID(trimmed) {
			writeError(w, http.StatusBadRequest, "invalid receivedFileKey")
			return
		}
	}
	if req.Kind == "received_file" && req.ReceivedFileKey == nil {
		writeError(w, http.StatusBadRequest, "receivedFileKey is required")
		return
	}
	if req.Kind != "received_file" && req.LocalPath == nil {
		writeError(w, http.StatusBadRequest, "localPath is required")
		return
	}

	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	resource, err := s.store.AddSharedResource(store.SharedResourceInput{
		DesktopDeviceID: desktopDeviceID,
		Kind:            req.Kind,
		DisplayName:     req.DisplayName,
		LocalPath:       req.LocalPath,
		ReceivedFileKey: req.ReceivedFileKey,
		FileSize:        req.FileSize,
		MediaType:       req.MediaType,
		Status:          req.Status,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to add shared resource")
		return
	}
	writeJSON(w, http.StatusCreated, resource)
}

func (s *Server) handleResourcesRemoveShared(w http.ResponseWriter, r *http.Request) {
	resourceID := strings.TrimSpace(r.PathValue("resourceId"))
	if !isValidAPIID(resourceID) {
		writeError(w, http.StatusBadRequest, "invalid resourceId")
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	if err := s.store.RemoveSharedResource(desktopDeviceID, resourceID); err != nil {
		if errors.Is(err, store.ErrNoRows) {
			writeError(w, http.StatusNotFound, "resource not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to remove shared resource")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleResourcesReceived(w http.ResponseWriter, r *http.Request) {
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	items, err := s.store.ListReceivedLibrary(desktopDeviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list received library")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleMobileSharedResources(w http.ResponseWriter, r *http.Request) {
	client, ok := mobileAccessClientFromQuery(w, r)
	if !ok {
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	resources, err := s.store.ListSharedResources(desktopDeviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list shared resources")
		return
	}
	_, _ = s.recordResourceAccess(desktopDeviceID, client, "shared_resources", "shared_file", "Shared Resources", "list", "ok")
	writeJSON(w, http.StatusOK, map[string]any{"items": resources})
}

func (s *Server) handleMobileReceivedResources(w http.ResponseWriter, r *http.Request) {
	client, ok := mobileAccessClientFromQuery(w, r)
	if !ok {
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	items, err := s.store.ListReceivedLibrary(desktopDeviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list received library")
		return
	}
	_, _ = s.recordResourceAccess(desktopDeviceID, client, "received_library", "received_file", "Received Library", "list", "ok")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleMobileResourceView(w http.ResponseWriter, r *http.Request) {
	client, ok := mobileAccessClientFromQuery(w, r)
	if !ok {
		return
	}
	resourceID := strings.TrimSpace(r.PathValue("resourceId"))
	if !isValidAPIID(resourceID) {
		writeError(w, http.StatusBadRequest, "invalid resourceId")
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	resource, err := s.store.ResolveSharedResource(desktopDeviceID, resourceID)
	if err != nil {
		if errors.Is(err, store.ErrNoRows) {
			writeError(w, http.StatusNotFound, "resource not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to resolve resource")
		return
	}
	if _, err := s.recordResourceAccess(desktopDeviceID, client, resource.ResourceID, resource.Kind, resource.DisplayName, "view", "ok"); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record resource access")
		return
	}
	writeJSON(w, http.StatusOK, resource)
}

func (s *Server) handleMobileResourceDownload(w http.ResponseWriter, r *http.Request) {
	client, ok := mobileAccessClientFromQuery(w, r)
	if !ok {
		return
	}
	resourceID := strings.TrimSpace(r.PathValue("resourceId"))
	if !isValidAPIID(resourceID) {
		writeError(w, http.StatusBadRequest, "invalid resourceId")
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	resource, err := s.store.ResolveSharedResource(desktopDeviceID, resourceID)
	if err != nil {
		if errors.Is(err, store.ErrNoRows) {
			writeError(w, http.StatusNotFound, "resource not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to resolve resource")
		return
	}
	localPath, err := s.localPathForSharedResource(resource)
	if err != nil {
		_, _ = s.recordResourceAccess(desktopDeviceID, client, resource.ResourceID, resource.Kind, resource.DisplayName, "download", "missing")
		writeError(w, http.StatusNotFound, "resource file not found")
		return
	}
	info, err := os.Stat(localPath)
	if err != nil || info.IsDir() {
		_, _ = s.recordResourceAccess(desktopDeviceID, client, resource.ResourceID, resource.Kind, resource.DisplayName, "download", "missing")
		writeError(w, http.StatusNotFound, "resource file not found")
		return
	}
	if _, err := s.recordResourceAccess(desktopDeviceID, client, resource.ResourceID, resource.Kind, resource.DisplayName, "download", "ok"); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record resource access")
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(localPath)))
	contentType := mime.TypeByExtension(filepath.Ext(localPath))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("ETag", sharedFileEntityTag(info))
	http.ServeFile(w, r, localPath)
}

func (s *Server) localPathForSharedResource(resource store.SharedResource) (string, error) {
	if resource.LocalPath != nil && strings.TrimSpace(*resource.LocalPath) != "" {
		return strings.TrimSpace(*resource.LocalPath), nil
	}
	if resource.Kind != "received_file" || resource.ReceivedFileKey == nil || strings.TrimSpace(*resource.ReceivedFileKey) == "" {
		return "", store.ErrNoRows
	}
	upload, err := s.store.GetUpload(strings.TrimSpace(*resource.ReceivedFileKey))
	if err != nil {
		return "", err
	}
	if upload.FinalPath == nil || strings.TrimSpace(*upload.FinalPath) == "" || upload.Status != "completed" {
		return "", store.ErrNoRows
	}
	return strings.TrimSpace(*upload.FinalPath), nil
}

type mobileAccessClient struct {
	ClientID   string
	ClientName string
}

func mobileAccessClientFromQuery(w http.ResponseWriter, r *http.Request) (mobileAccessClient, bool) {
	clientID := strings.TrimSpace(r.URL.Query().Get("clientId"))
	if !isValidAPIID(clientID) {
		writeError(w, http.StatusBadRequest, "invalid clientId")
		return mobileAccessClient{}, false
	}
	clientName := strings.TrimSpace(r.URL.Query().Get("clientName"))
	if clientName == "" {
		clientName = clientID
	}
	if len(clientName) > 128 {
		writeError(w, http.StatusBadRequest, "invalid clientName")
		return mobileAccessClient{}, false
	}
	return mobileAccessClient{ClientID: clientID, ClientName: clientName}, true
}

func (s *Server) recordResourceAccess(
	desktopDeviceID string,
	client mobileAccessClient,
	resourceID string,
	resourceKind string,
	resourceName string,
	action string,
	result string,
) (store.AccessRecord, error) {
	if !isValidAccessAction(action) {
		return store.AccessRecord{}, fmt.Errorf("invalid access action %q", action)
	}
	if !isValidAccessResult(result) {
		return store.AccessRecord{}, fmt.Errorf("invalid access result %q", result)
	}
	return s.store.RecordAccess(store.AccessRecord{
		DesktopDeviceID: desktopDeviceID,
		ClientID:        client.ClientID,
		ClientName:      client.ClientName,
		ResourceID:      resourceID,
		ResourceKind:    resourceKind,
		ResourceName:    resourceName,
		Action:          action,
		Result:          result,
	})
}

func isValidResourceKind(kind string) bool {
	switch kind {
	case "shared_file", "shared_folder", "received_file":
		return true
	default:
		return false
	}
}

func isValidResourceStatus(status string) bool {
	switch status {
	case "available", "missing", "removed":
		return true
	default:
		return false
	}
}

func isValidAccessAction(action string) bool {
	switch action {
	case "list", "view", "download", "error":
		return true
	default:
		return false
	}
}

func isValidAccessResult(result string) bool {
	switch result {
	case "ok", "denied", "missing", "error":
		return true
	default:
		return false
	}
}
