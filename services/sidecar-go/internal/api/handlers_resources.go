package api

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/nicksyncflow/sidecar/internal/store"
	"github.com/nicksyncflow/sidecar/internal/uploadfs"
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
		if !isValidReceivedFileKey(trimmed) {
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
	page := parsePositiveQueryInt(r, "page", 1)
	pageSize := parsePositiveQueryInt(r, "pageSize", 30)
	if pageSize > 200 {
		pageSize = 200
	}
	result, err := s.store.ListReceivedLibraryPageWithReceiveDir(desktopDeviceID, page, pageSize, s.config.ReceiveDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list received library")
		return
	}
	s.enrichResourcesReceivedThumbnailURLs(result.Items)
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) enrichResourcesReceivedThumbnailURLs(items []store.ReceivedLibraryItem) {
	for i := range items {
		if strings.TrimSpace(items[i].FileKey) == "" ||
			!isImageMedia(items[i].MediaType, items[i].Filename) ||
			!isSupportedDirectoryThumbnailSource(items[i].Filename) {
			continue
		}
		resolvedPath, ok := uploadfs.ResolveFinalPath(s.config.ReceiveDir, items[i].FinalPath)
		if !ok {
			continue
		}
		info, err := os.Stat(resolvedPath)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		query := url.Values{}
		query.Set("fileKey", items[i].FileKey)
		query.Set("v", directoryThumbnailSourceVersion(info))
		items[i].ThumbnailURL = "/resources/received/thumbnail?" + query.Encode()
	}
}

func parsePositiveQueryInt(r *http.Request, key string, fallback int) int {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func (s *Server) handleResourcesReceivedThumbnail(w http.ResponseWriter, r *http.Request) {
	if !isLocalRequest(r) {
		writeError(w, http.StatusForbidden, "local access required")
		return
	}
	upload, resolvedPath, info, ok := s.resolveResourcesReceivedUpload(w, r)
	if !ok {
		return
	}
	if !isImageMedia(upload.MediaType, upload.OriginalFilename) {
		writeError(w, http.StatusNotFound, "thumbnail not available for this file type")
		return
	}
	s.serveCachedThumbnailForResolvedFile(w, r, resolvedPath, info)
}

func (s *Server) handleMobileSharedResources(w http.ResponseWriter, r *http.Request) {
	client, ok := s.verifyMobileClientPaired(w, r)
	if !ok {
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}

	var virtualResources []store.SharedResource
	if runtime.GOOS == "windows" {
		for _, root := range windowsPersonalDriveRoots() {
			drivePath := root.Path
			displayName := root.ID + " 盘"
			virtualResources = append(virtualResources, store.SharedResource{
				ResourceID:      "drive_" + root.ID,
				DesktopDeviceID: desktopDeviceID,
				Kind:            "shared_folder",
				DisplayName:     displayName,
				LocalPath:       &drivePath,
				Status:          "available",
			})
		}
	} else {
		home, err := os.UserHomeDir()
		if err == nil {
			virtualResources = append(virtualResources, store.SharedResource{
				ResourceID:      "user_home",
				DesktopDeviceID: desktopDeviceID,
				Kind:            "shared_folder",
				DisplayName:     "电脑个人目录",
				LocalPath:       &home,
				Status:          "available",
			})
		}
	}

	resources, err := s.store.ListSharedResources(desktopDeviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list shared resources")
		return
	}

	combined := append(virtualResources, resources...)

	_, _ = s.recordResourceAccess(desktopDeviceID, client, "shared_resources", "shared_file", "Shared Resources", "list", "ok")
	writeJSON(w, http.StatusOK, map[string]any{"items": combined})
}

func (s *Server) handleMobileSharedResourceFolderList(w http.ResponseWriter, r *http.Request) {
	s.listMobileSharedResourceFolder(w, r, "")
}

func (s *Server) handleMobileSharedResourceFolderListPath(w http.ResponseWriter, r *http.Request) {
	s.listMobileSharedResourceFolder(w, r, r.PathValue("path"))
}

func (s *Server) listMobileSharedResourceFolder(w http.ResponseWriter, r *http.Request, relPath string) {
	client, ok := s.verifyMobileClientPaired(w, r)
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
	resource, err := s.resolveSharedResourceHelper(desktopDeviceID, resourceID)
	if err != nil {
		if errors.Is(err, store.ErrNoRows) {
			writeError(w, http.StatusNotFound, "resource not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to resolve resource")
		return
	}
	if resource.Kind != "shared_folder" {
		writeError(w, http.StatusBadRequest, "resource is not a shared folder")
		return
	}
	if resource.LocalPath == nil || strings.TrimSpace(*resource.LocalPath) == "" {
		writeError(w, http.StatusNotFound, "resource folder not found")
		return
	}

	rootPath := strings.TrimSpace(*resource.LocalPath)
	rootInfo, err := os.Stat(rootPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "resource folder not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to read resource folder")
		return
	}
	if !rootInfo.IsDir() {
		writeError(w, http.StatusBadRequest, "resource path is not a folder")
		return
	}
	resolvePath := func(path string) (string, error) {
		return resolveDirectoryPath(rootPath, path, "shared resource")
	}
	if !s.ensureMobileSharedFolderListable(w, relPath, resolvePath) {
		return
	}
	if _, err := s.recordResourceAccess(desktopDeviceID, client, resource.ResourceID, resource.Kind, resource.DisplayName, "list", "ok"); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record resource access")
		return
	}
	s.listDirectory(w, relPath, resolvePath, "", "", false)
}

func (s *Server) ensureMobileSharedFolderListable(
	w http.ResponseWriter,
	relPath string,
	resolvePath func(string) (string, error),
) bool {
	resolved, err := resolvePath(relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return false
	}

	info, err := os.Stat(resolved)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "directory not found")
			return false
		}
		writeError(w, http.StatusInternalServerError, "failed to read directory")
		return false
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "path is not a directory")
		return false
	}
	if _, err := os.ReadDir(resolved); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read directory")
		return false
	}
	return true
}

func (s *Server) handleMobileReceivedResources(w http.ResponseWriter, r *http.Request) {
	client, ok := s.verifyMobileClientPaired(w, r)
	if !ok {
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load desktop device id")
		return
	}
	policy, err := s.mobileReceivedAccessPolicy(client)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to resolve received access policy")
		return
	}
	scopedToClient := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("scope")), "client")
	hasPageParams := strings.TrimSpace(r.URL.Query().Get("page")) != "" ||
		strings.TrimSpace(r.URL.Query().Get("pageSize")) != ""
	if hasPageParams {
		page := parsePositiveQueryInt(r, "page", 1)
		pageSize := parsePositiveQueryInt(r, "pageSize", 30)
		if pageSize > 200 {
			pageSize = 200
		}
		var result store.ReceivedLibraryPage
		if scopedToClient {
			result, err = s.store.ListReceivedLibraryPageForClientWithReceiveDir(desktopDeviceID, client.ClientID, page, pageSize, s.config.ReceiveDir)
		} else if policy.AllowCrossDeviceReceivedAccess {
			result, err = s.store.ListReceivedLibraryPageWithReceiveDir(desktopDeviceID, page, pageSize, s.config.ReceiveDir)
		} else {
			result, err = s.store.ListReceivedLibraryPageForStableDeviceWithReceiveDir(desktopDeviceID, policy.StableDeviceID, client.ClientID, page, pageSize, s.config.ReceiveDir)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list received library")
			return
		}
		enrichMobileReceivedPreviewURLs(result.Items, client)
		slog.Info(
			"mobile received library listed",
			"clientID", client.ClientID,
			"scopedToClient", scopedToClient,
			"hasPageParams", true,
			"page", result.Page,
			"pageSize", result.PageSize,
			"itemCount", len(result.Items),
			"totalItems", result.TotalItems,
			"totalBytes", result.TotalBytes,
			"deletedCount", countDeletedReceivedLibraryItems(result.Items),
			"deviceStatsCount", len(result.DeviceStats),
			"remoteAddr", r.RemoteAddr,
		)
		_, _ = s.recordResourceAccess(desktopDeviceID, client, "received_library", "received_file", "Received Library", "list", "ok")
		writeJSON(w, http.StatusOK, result)
		return
	}

	var items []store.ReceivedLibraryItem
	if scopedToClient {
		items, err = s.store.ListReceivedLibraryForClientWithReceiveDir(desktopDeviceID, client.ClientID, s.config.ReceiveDir)
	} else if policy.AllowCrossDeviceReceivedAccess {
		items, err = s.store.ListReceivedLibraryWithReceiveDir(desktopDeviceID, s.config.ReceiveDir)
	} else {
		items, err = s.store.ListReceivedLibraryForStableDeviceWithReceiveDir(desktopDeviceID, policy.StableDeviceID, client.ClientID, s.config.ReceiveDir)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list received library")
		return
	}
	enrichMobileReceivedPreviewURLs(items, client)
	slog.Info(
		"mobile received library listed",
		"clientID", client.ClientID,
		"scopedToClient", scopedToClient,
		"hasPageParams", false,
		"itemCount", len(items),
		"deletedCount", countDeletedReceivedLibraryItems(items),
		"remoteAddr", r.RemoteAddr,
	)
	_, _ = s.recordResourceAccess(desktopDeviceID, client, "received_library", "received_file", "Received Library", "list", "ok")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func countDeletedReceivedLibraryItems(items []store.ReceivedLibraryItem) int {
	count := 0
	for _, item := range items {
		if item.FileStatus == "deleted" {
			count++
		}
	}
	return count
}

func enrichMobileReceivedPreviewURLs(items []store.ReceivedLibraryItem, client mobileAccessClient) {
	for i := range items {
		if strings.TrimSpace(items[i].FileKey) == "" {
			continue
		}
		if items[i].FileStatus == "deleted" {
			continue
		}
		if isVideoMedia(items[i].MediaType, items[i].Filename) {
			items[i].PreviewURL = mobileReceivedFileURL("preview", client, items[i].FileKey)
			items[i].StreamURL = mobileReceivedFileURL("stream", client, items[i].FileKey)
			if isSupportedDirectoryVideoPosterSource(items[i].Filename) {
				items[i].ThumbnailURL = mobileReceivedFileURL("thumbnail", client, items[i].FileKey)
			}
			continue
		}
		if isImageMedia(items[i].MediaType, items[i].Filename) {
			items[i].PreviewURL = mobileReceivedFileURL("preview", client, items[i].FileKey)
			if isSupportedDirectoryThumbnailSource(items[i].Filename) ||
				isSupportedDesktopGeneratedImageThumbnailSource(items[i].Filename) {
				items[i].ThumbnailURL = mobileReceivedFileURL("thumbnail", client, items[i].FileKey)
			}
			continue
		}
		items[i].PreviewURL = mobileReceivedFileURL("download", client, items[i].FileKey)
	}
}

func mobileReceivedFileURL(kind string, client mobileAccessClient, fileKey string) string {
	query := url.Values{}
	query.Set("clientId", client.ClientID)
	query.Set("clientName", client.ClientName)
	query.Set("fileKey", fileKey)
	return "/resources/mobile/received/" + kind + "?" + query.Encode()
}

func (s *Server) handleMobileReceivedFileThumbnail(w http.ResponseWriter, r *http.Request) {
	upload, resolvedPath, info, ok := s.resolveMobileReceivedUpload(w, r)
	if !ok {
		return
	}
	if isVideoMedia(upload.MediaType, upload.OriginalFilename) {
		if !isSupportedDirectoryVideoPosterSource(upload.OriginalFilename) {
			writeError(w, http.StatusNotFound, "thumbnail not available for this file type")
			return
		}
		s.serveCachedThumbnailForResolvedFile(w, r, resolvedPath, info)
		return
	}
	if isImageMedia(upload.MediaType, upload.OriginalFilename) {
		if !isSupportedDirectoryThumbnailSource(upload.OriginalFilename) &&
			!isSupportedDesktopGeneratedImageThumbnailSource(upload.OriginalFilename) {
			writeError(w, http.StatusNotFound, "thumbnail not available for this file type")
			return
		}
		s.serveCachedThumbnailForResolvedFile(w, r, resolvedPath, info)
		return
	}
	writeError(w, http.StatusNotFound, "thumbnail not available for this file type")
}

func (s *Server) handleMobileReceivedFilePreview(w http.ResponseWriter, r *http.Request) {
	client, upload, resolvedPath, info, ok := s.resolveMobileReceivedUploadWithClient(w, r)
	if !ok {
		return
	}
	if !isImageMedia(upload.MediaType, upload.OriginalFilename) && !isVideoMedia(upload.MediaType, upload.OriginalFilename) {
		writeError(w, http.StatusUnsupportedMediaType, "preview not available for this file type")
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err == nil {
		_, _ = s.recordResourceAccess(desktopDeviceID, client, upload.FileKey, "received_file", upload.OriginalFilename, "view", "ok")
	}
	serveLocalFileInline(w, r, resolvedPath, info)
}

func (s *Server) handleMobileReceivedFileStream(w http.ResponseWriter, r *http.Request) {
	client, upload, resolvedPath, info, ok := s.resolveMobileReceivedUploadWithClient(w, r)
	if !ok {
		return
	}
	if !isVideoMedia(upload.MediaType, upload.OriginalFilename) {
		writeError(w, http.StatusNotFound, "stream not available for this file type")
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err == nil {
		_, _ = s.recordResourceAccess(desktopDeviceID, client, upload.FileKey, "received_file", upload.OriginalFilename, "view", "ok")
	}
	serveLocalFileInline(w, r, resolvedPath, info)
}

func (s *Server) handleMobileReceivedFileDownload(w http.ResponseWriter, r *http.Request) {
	client, upload, resolvedPath, info, ok := s.resolveMobileReceivedUploadWithClient(w, r)
	if !ok {
		return
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err == nil {
		_, _ = s.recordResourceAccess(desktopDeviceID, client, upload.FileKey, "received_file", upload.OriginalFilename, "download", "ok")
	}
	serveLocalFileAttachment(w, r, resolvedPath, info, upload.OriginalFilename)
}

func (s *Server) resolveResourcesReceivedUpload(
	w http.ResponseWriter,
	r *http.Request,
) (*store.Upload, string, os.FileInfo, bool) {
	fileKey := strings.TrimSpace(r.URL.Query().Get("fileKey"))
	if !isValidReceivedFileKey(fileKey) {
		writeError(w, http.StatusBadRequest, "invalid fileKey")
		return nil, "", nil, false
	}
	upload, err := s.store.GetUpload(fileKey)
	if err != nil {
		writeError(w, http.StatusNotFound, "received file not found")
		return nil, "", nil, false
	}
	if upload.Status != "completed" {
		writeError(w, http.StatusNotFound, "received file not found")
		return nil, "", nil, false
	}
	resolvedPath, ok := uploadfs.ResolveFinalPath(s.config.ReceiveDir, upload.FinalPath)
	if !ok {
		writeError(w, http.StatusNotFound, "received file not found")
		return nil, "", nil, false
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		writeError(w, http.StatusNotFound, "received file not found")
		return nil, "", nil, false
	}
	if !info.Mode().IsRegular() {
		writeError(w, http.StatusNotFound, "received file not found")
		return nil, "", nil, false
	}
	return upload, resolvedPath, info, true
}

func (s *Server) resolveMobileReceivedUpload(
	w http.ResponseWriter,
	r *http.Request,
) (*store.Upload, string, os.FileInfo, bool) {
	_, upload, resolvedPath, info, ok := s.resolveMobileReceivedUploadWithClient(w, r)
	return upload, resolvedPath, info, ok
}

func (s *Server) resolveMobileReceivedUploadWithClient(
	w http.ResponseWriter,
	r *http.Request,
) (mobileAccessClient, *store.Upload, string, os.FileInfo, bool) {
	client, ok := s.verifyMobileClientPaired(w, r)
	if !ok {
		return mobileAccessClient{}, nil, "", nil, false
	}
	fileKey := strings.TrimSpace(r.URL.Query().Get("fileKey"))
	if !isValidReceivedFileKey(fileKey) {
		slog.Warn("resolveMobileReceivedUpload: invalid fileKey", "fileKey", fileKey)
		writeError(w, http.StatusBadRequest, "invalid fileKey")
		return mobileAccessClient{}, nil, "", nil, false
	}
	upload, err := s.store.GetUpload(fileKey)
	if err != nil {
		slog.Warn("resolveMobileReceivedUpload: GetUpload failed", "fileKey", fileKey, "err", err)
		writeError(w, http.StatusNotFound, "received file not found")
		return mobileAccessClient{}, nil, "", nil, false
	}
	if upload.Status != "completed" {
		slog.Warn("resolveMobileReceivedUpload: Status not completed", "fileKey", fileKey, "status", upload.Status)
		writeError(w, http.StatusNotFound, "received file not found")
		return mobileAccessClient{}, nil, "", nil, false
	}
	policy, err := s.mobileReceivedAccessPolicy(client)
	if err != nil {
		slog.Warn("resolveMobileReceivedUpload: access policy failed", "clientID", client.ClientID, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to resolve received access policy")
		return mobileAccessClient{}, nil, "", nil, false
	}
	if !policy.AllowCrossDeviceReceivedAccess {
		allowed, err := s.mobileReceivedUploadAllowedForPolicy(policy, upload)
		if err != nil {
			slog.Warn("resolveMobileReceivedUpload: authorization failed", "clientID", client.ClientID, "fileKey", upload.FileKey, "err", err)
			writeError(w, http.StatusInternalServerError, "failed to authorize received file")
			return mobileAccessClient{}, nil, "", nil, false
		}
		if !allowed {
			desktopDeviceID, err := s.store.GetDeviceID()
			if err == nil {
				_, _ = s.recordResourceAccess(desktopDeviceID, client, upload.FileKey, "received_file", upload.OriginalFilename, "view", "denied")
			}
			writeError(w, http.StatusForbidden, "received file not authorized")
			return mobileAccessClient{}, nil, "", nil, false
		}
	}
	resolvedPath, ok := uploadfs.ResolveFinalPath(s.config.ReceiveDir, upload.FinalPath)
	if !ok {
		slog.Warn("resolveMobileReceivedUpload: ResolveFinalPath failed", "fileKey", fileKey)
		writeError(w, http.StatusNotFound, "received file not found")
		return mobileAccessClient{}, nil, "", nil, false
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		slog.Warn("resolveMobileReceivedUpload: os.Stat failed", "fileKey", fileKey, "resolvedPath", resolvedPath, "err", err)
		writeError(w, http.StatusNotFound, "received file not found")
		return mobileAccessClient{}, nil, "", nil, false
	}
	if !info.Mode().IsRegular() {
		slog.Warn("resolveMobileReceivedUpload: path not a regular file", "fileKey", fileKey, "resolvedPath", resolvedPath, "mode", info.Mode().String())
		writeError(w, http.StatusNotFound, "received file not found")
		return mobileAccessClient{}, nil, "", nil, false
	}
	return client, upload, resolvedPath, info, true
}

type mobileReceivedAccessPolicy struct {
	Client                         mobileAccessClient
	AllowCrossDeviceReceivedAccess bool
	StableDeviceID                 string
}

func (s *Server) mobileReceivedAccessPolicy(client mobileAccessClient) (mobileReceivedAccessPolicy, error) {
	allowCrossDeviceReceivedAccess := true
	if val, err := s.store.GetSetting(allowCrossDeviceReceivedAccessSettingKey); err == nil {
		allowCrossDeviceReceivedAccess = (val == "true")
	} else if !errors.Is(err, sql.ErrNoRows) {
		return mobileReceivedAccessPolicy{}, err
	}

	stableDeviceID := ""
	if device, err := s.store.GetPairedDevice(client.ClientID); err == nil && device.StableDeviceID != nil {
		stableDeviceID = strings.TrimSpace(*device.StableDeviceID)
	} else if err != nil {
		return mobileReceivedAccessPolicy{}, err
	}

	return mobileReceivedAccessPolicy{
		Client:                         client,
		AllowCrossDeviceReceivedAccess: allowCrossDeviceReceivedAccess,
		StableDeviceID:                 stableDeviceID,
	}, nil
}

func (s *Server) mobileReceivedUploadAllowedForPolicy(policy mobileReceivedAccessPolicy, upload *store.Upload) (bool, error) {
	if upload.ClientID == policy.Client.ClientID {
		return true, nil
	}
	if strings.TrimSpace(policy.StableDeviceID) == "" {
		return false, nil
	}
	owner, err := s.store.GetPairedDevice(upload.ClientID)
	if err != nil {
		if errors.Is(err, store.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if owner.StableDeviceID == nil {
		return false, nil
	}
	return strings.TrimSpace(*owner.StableDeviceID) == policy.StableDeviceID, nil
}

func isValidReceivedFileKey(value string) bool {
	if value == "" || len(value) > 2048 {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func serveLocalFileInline(w http.ResponseWriter, r *http.Request, path string, info os.FileInfo) {
	contentType := mime.TypeByExtension(filepath.Ext(info.Name()))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", info.Name()))
	w.Header().Set("ETag", sharedFileEntityTag(info))

	f, err := os.Open(path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to open file")
		return
	}
	defer f.Close()
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

func serveLocalFileAttachment(w http.ResponseWriter, r *http.Request, path string, info os.FileInfo, filename string) {
	contentType := mime.TypeByExtension(filepath.Ext(info.Name()))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	downloadName := strings.TrimSpace(filename)
	if downloadName == "" {
		downloadName = info.Name()
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", downloadName))
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("ETag", sharedFileEntityTag(info))

	f, err := os.Open(path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to open file")
		return
	}
	defer f.Close()
	http.ServeContent(w, r, downloadName, info.ModTime(), f)
}

func isImageMedia(mediaType string, filename string) bool {
	media := strings.ToLower(strings.TrimSpace(mediaType))
	return media == "image" || strings.HasPrefix(media, "image/") || classifyFileType(filename) == "image"
}

func isVideoMedia(mediaType string, filename string) bool {
	media := strings.ToLower(strings.TrimSpace(mediaType))
	return media == "video" || strings.HasPrefix(media, "video/") || classifyFileType(filename) == "video"
}

func (s *Server) handleMobileResourceView(w http.ResponseWriter, r *http.Request) {
	client, ok := s.verifyMobileClientPaired(w, r)
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
	resource, err := s.resolveSharedResourceHelper(desktopDeviceID, resourceID)
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
	client, ok := s.verifyMobileClientPaired(w, r)
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
	resource, err := s.resolveSharedResourceHelper(desktopDeviceID, resourceID)
	if err != nil {
		if errors.Is(err, store.ErrNoRows) {
			writeError(w, http.StatusNotFound, "resource not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to resolve resource")
		return
	}

	// If a ?path= query param is provided and the resource is a shared_folder,
	// resolve the file path securely inside the folder's LocalPath.
	subPath := strings.TrimSpace(r.URL.Query().Get("path"))
	if subPath != "" {
		if resource.Kind != "shared_folder" {
			writeError(w, http.StatusBadRequest, "path param is only valid for shared_folder resources")
			return
		}
		if resource.LocalPath == nil || strings.TrimSpace(*resource.LocalPath) == "" {
			_, _ = s.recordResourceAccess(desktopDeviceID, client, resource.ResourceID, resource.Kind, resource.DisplayName, "download", "missing")
			writeError(w, http.StatusNotFound, "resource folder not found")
			return
		}
		rootPath := strings.TrimSpace(*resource.LocalPath)
		resolvedPath, resolveErr := resolveDirectoryPath(rootPath, subPath, "shared resource")
		if resolveErr != nil {
			writeError(w, http.StatusBadRequest, resolveErr.Error())
			return
		}
		info, statErr := os.Stat(resolvedPath)
		if statErr != nil || info.IsDir() {
			_, _ = s.recordResourceAccess(desktopDeviceID, client, resource.ResourceID, resource.Kind, resource.DisplayName, "download", "missing")
			writeError(w, http.StatusNotFound, "resource file not found")
			return
		}
		if _, err := s.recordResourceAccess(desktopDeviceID, client, resource.ResourceID, resource.Kind, resource.DisplayName, "download", "ok"); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to record resource access")
			return
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(resolvedPath)))
		contentType := mime.TypeByExtension(filepath.Ext(resolvedPath))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
		w.Header().Set("ETag", sharedFileEntityTag(info))
		http.ServeFile(w, r, resolvedPath)
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
	resolvedPath, ok := uploadfs.ResolveFinalPath(s.config.ReceiveDir, upload.FinalPath)
	if !ok {
		return "", store.ErrNoRows
	}
	return resolvedPath, nil
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

func optionalMobileAccessClientFromQuery(w http.ResponseWriter, r *http.Request) (mobileAccessClient, bool, bool) {
	clientID := strings.TrimSpace(r.URL.Query().Get("clientId"))
	clientName := strings.TrimSpace(r.URL.Query().Get("clientName"))
	if clientID == "" && clientName == "" {
		return mobileAccessClient{}, false, true
	}
	if !isValidAPIID(clientID) {
		writeError(w, http.StatusBadRequest, "invalid clientId")
		return mobileAccessClient{}, false, false
	}
	if clientName == "" {
		clientName = clientID
	}
	if len(clientName) > 128 {
		writeError(w, http.StatusBadRequest, "invalid clientName")
		return mobileAccessClient{}, false, false
	}
	return mobileAccessClient{ClientID: clientID, ClientName: clientName}, true, true
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

// verifyMobileClientPaired validates the client exists in paired_devices, is not revoked, and is not blocked.
func (s *Server) verifyMobileClientPaired(w http.ResponseWriter, r *http.Request) (mobileAccessClient, bool) {
	client, ok := mobileAccessClientFromQuery(w, r)
	if !ok {
		return client, false
	}
	device, err := s.store.GetPairedDevice(client.ClientID)
	if err != nil {
		writeError(w, http.StatusForbidden, "device not authorized")
		return client, false
	}
	if device.RevokedAt != nil {
		writeError(w, http.StatusForbidden, "device pairing revoked")
		return client, false
	}
	desktopDeviceID, err := s.store.GetDeviceID()
	if err == nil {
		block, err := s.store.GetDeviceBlockState(desktopDeviceID, client.ClientID)
		if err == nil && block.Blocked {
			writeError(w, http.StatusForbidden, "device is blocked")
			return client, false
		}
	}
	return client, true
}

// resolveSharedResourceHelper resolves custom/DB shared resources as well as virtual OS-level defaults.
func (s *Server) resolveSharedResourceHelper(desktopDeviceID, resourceID string) (store.SharedResource, error) {
	if resourceID == "user_home" {
		home, err := os.UserHomeDir()
		if err != nil {
			return store.SharedResource{}, err
		}
		return store.SharedResource{
			ResourceID:      "user_home",
			DesktopDeviceID: desktopDeviceID,
			Kind:            "shared_folder",
			DisplayName:     "电脑个人目录",
			LocalPath:       &home,
			Status:          "available",
		}, nil
	}
	if strings.HasPrefix(resourceID, "drive_") && len(resourceID) == 7 {
		driveLetter := string(resourceID[6])
		drivePath := driveLetter + ":\\"
		displayName := driveLetter + " 盘"
		return store.SharedResource{
			ResourceID:      resourceID,
			DesktopDeviceID: desktopDeviceID,
			Kind:            "shared_folder",
			DisplayName:     displayName,
			LocalPath:       &drivePath,
			Status:          "available",
		}, nil
	}
	return s.store.ResolveSharedResource(desktopDeviceID, resourceID)
}
