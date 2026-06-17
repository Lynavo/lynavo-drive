package api

import (
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// directoryFileDTO mirrors the DirectoryFileDTO contract.
type directoryFileDTO struct {
	Name         string  `json:"name"`
	Path         string  `json:"path"`
	Type         string  `json:"type"`
	Size         int64   `json:"size"`
	ModifiedAt   string  `json:"modifiedAt"`
	ThumbnailURL *string `json:"thumbnailUrl,omitempty"`
	IsDirectory  bool    `json:"isDirectory,omitempty"`
}

// directoryListingDTO mirrors the DirectoryListingDTO contract. Scope is
// omitted for legacy /shared responses to keep that payload stable.
type directoryListingDTO struct {
	Scope      string             `json:"scope,omitempty"`
	Path       string             `json:"path"`
	Files      []directoryFileDTO `json:"files"`
	TotalCount int                `json:"totalCount"`
}

// resolveSharedPath validates and resolves a relative path within the shared directory.
// It rejects path traversal attempts (including symlinks that escape the shared root)
// and returns the absolute, symlink-resolved path.
func (s *Server) resolveSharedPath(relPath string) (string, error) {
	return resolveDirectoryPath(s.config.SharedDir(), relPath, "shared")
}

func (s *Server) resolvePersonalPath(relPath string) (string, error) {
	if s.usesWindowsPersonalVirtualDrives() {
		return resolveWindowsPersonalDrivePath(relPath)
	}
	return resolveDirectoryPath(s.config.PersonalDir(), relPath, "personal")
}

func resolveDirectoryPath(rootDir string, relPath string, scopeLabel string) (string, error) {
	// Step 1: Lexical reject before filesystem access. Windows treats `\` as a
	// separator, so normalize both separators here instead of only splitting on `/`.
	if err := rejectUnsafeSharedRelPath(relPath); err != nil {
		return "", err
	}

	lexical := filepath.Clean(filepath.Join(rootDir, relPath))
	if !pathWithinDir(rootDir, lexical) {
		return "", fmt.Errorf("path escapes %s directory", scopeLabel)
	}

	// Step 2: Resolve the real root (it may itself be a symlink).
	realRootDir, err := filepath.EvalSymlinks(rootDir)
	if err != nil {
		return "", fmt.Errorf("cannot resolve %s directory: %w", scopeLabel, err)
	}

	// Step 3: Resolve the target path through symlinks.
	realResolved, err := filepath.EvalSymlinks(lexical)
	if err != nil {
		// If the path doesn't exist yet (e.g., listing a directory that was just
		// deleted), fall back to the lexical path — the caller will get a
		// "not found" from os.Stat anyway.
		if os.IsNotExist(err) {
			return lexical, nil
		}
		return "", fmt.Errorf("cannot resolve path: %w", err)
	}

	// Step 4: Re-verify that the real path is still inside the real root.
	if !pathWithinDir(realRootDir, realResolved) {
		return "", fmt.Errorf("path escapes %s directory via symlink", scopeLabel)
	}

	return realResolved, nil
}

func rejectUnsafeSharedRelPath(relPath string) error {
	if relPath == "" {
		return nil
	}
	if filepath.IsAbs(relPath) || strings.HasPrefix(relPath, "/") || strings.HasPrefix(relPath, `\`) || hasWindowsVolumePrefix(relPath) {
		return fmt.Errorf("absolute path rejected")
	}

	normalized := strings.ReplaceAll(relPath, `\`, "/")
	for _, seg := range strings.Split(normalized, "/") {
		if seg == ".." {
			return fmt.Errorf("path traversal rejected")
		}
	}
	return nil
}

func hasWindowsVolumePrefix(path string) bool {
	if len(path) < 2 || path[1] != ':' {
		return false
	}
	first := path[0]
	return (first >= 'A' && first <= 'Z') || (first >= 'a' && first <= 'z')
}

func pathWithinDir(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

// classifyFileType returns a simplified media type based on the file extension.
func classifyFileType(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".heif", ".tiff", ".tif", ".svg":
		return "image"
	case ".mp4", ".mov", ".avi", ".mkv", ".wmv", ".flv", ".webm", ".m4v":
		return "video"
	case ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".rtf":
		return "document"
	default:
		return "other"
	}
}

// handleSharedList lists files in the shared directory root.
func (s *Server) handleSharedList(w http.ResponseWriter, _ *http.Request) {
	s.listSharedDir(w, "")
}

// handleSharedListPath lists files in a subdirectory of the shared directory.
func (s *Server) handleSharedListPath(w http.ResponseWriter, r *http.Request) {
	subPath := r.PathValue("path")
	s.listSharedDir(w, subPath)
}

func (s *Server) listSharedDir(w http.ResponseWriter, relPath string) {
	if !s.ensureStorageDirsForRequest(w, "shared.list") {
		return
	}

	s.listDirectory(w, relPath, s.resolveSharedPath, "", "/shared/thumbnail/")
}

func (s *Server) listDirectory(
	w http.ResponseWriter,
	relPath string,
	resolvePath func(string) (string, error),
	scope string,
	thumbnailPrefix string,
) {
	resolved, err := resolvePath(relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(resolved)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "directory not found")
			return
		}
		slog.Error("stat shared dir", "path", resolved, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to read directory")
		return
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "path is not a directory")
		return
	}

	entries, err := os.ReadDir(resolved)
	if err != nil {
		slog.Error("read shared dir", "path", resolved, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to read directory")
		return
	}

	files := make([]directoryFileDTO, 0, len(entries))
	for _, e := range entries {
		// Skip hidden files
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}

		filePath := relPath
		if filePath == "" {
			filePath = e.Name()
		} else {
			filePath = filePath + "/" + e.Name()
		}

		resolvedEntry, err := resolvePath(filePath)
		if err != nil {
			continue
		}
		entryInfo, err := os.Stat(resolvedEntry)
		if err != nil {
			continue
		}

		fileType := classifyFileType(e.Name())
		if entryInfo.IsDir() {
			fileType = "other"
		}

		var thumbURL *string
		if fileType == "image" && thumbnailPrefix != "" {
			u := thumbnailPrefix + filePath
			thumbURL = &u
		}

		files = append(files, directoryFileDTO{
			Name:         e.Name(),
			Path:         filePath,
			Type:         fileType,
			Size:         entryInfo.Size(),
			ModifiedAt:   entryInfo.ModTime().UTC().Format(time.RFC3339),
			ThumbnailURL: thumbURL,
			IsDirectory:  entryInfo.IsDir(),
		})
	}

	writeJSON(w, http.StatusOK, directoryListingDTO{
		Scope:      scope,
		Path:       relPath,
		Files:      files,
		TotalCount: len(files),
	})
}

// handleSharedThumbnail serves a thumbnail for a shared file.
// For images, the file is served directly. For other types, a 404 is returned.
func (s *Server) handleSharedThumbnail(w http.ResponseWriter, r *http.Request) {
	if !s.ensureStorageDirsForRequest(w, "shared.thumbnail") {
		return
	}

	s.serveDirectoryThumbnail(w, r, r.PathValue("path"), s.resolveSharedPath)
}

// handleSharedDownload serves a file for download with Content-Disposition header.
func (s *Server) handleSharedDownload(w http.ResponseWriter, r *http.Request) {
	if !s.ensureStorageDirsForRequest(w, "shared.download") {
		return
	}

	s.serveDirectoryDownload(w, r, r.PathValue("path"), s.resolveSharedPath)
}

func (s *Server) serveDirectoryThumbnail(
	w http.ResponseWriter,
	r *http.Request,
	relPath string,
	resolvePath func(string) (string, error),
) {
	resolved, err := resolvePath(relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}

	fileType := classifyFileType(info.Name())
	if fileType != "image" {
		writeError(w, http.StatusNotFound, "thumbnail not available for this file type")
		return
	}

	// Serve the image directly as a thumbnail (no resizing — keep it simple)
	http.ServeFile(w, r, resolved)
}

func (s *Server) serveDirectoryDownload(
	w http.ResponseWriter,
	r *http.Request,
	relPath string,
	resolvePath func(string) (string, error),
) {
	resolved, err := resolvePath(relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", info.Name()))

	contentType := mime.TypeByExtension(filepath.Ext(info.Name()))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("ETag", sharedFileEntityTag(info))

	http.ServeFile(w, r, resolved)
}

func sharedFileEntityTag(info os.FileInfo) string {
	return fmt.Sprintf(`"%x-%x"`, info.ModTime().UnixNano(), info.Size())
}

// handleSharedStream serves a file with support for HTTP Range requests (video streaming).
func (s *Server) handleSharedStream(w http.ResponseWriter, r *http.Request) {
	if !s.ensureStorageDirsForRequest(w, "shared.stream") {
		return
	}

	s.serveDirectoryStream(w, r, r.PathValue("path"), s.resolveSharedPath, "shared")
}

func (s *Server) serveDirectoryStream(
	w http.ResponseWriter,
	r *http.Request,
	relPath string,
	resolvePath func(string) (string, error),
	scopeLabel string,
) {
	resolved, err := resolvePath(relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}

	f, err := os.Open(resolved)
	if err != nil {
		slog.Error("open file for streaming", "scope", scopeLabel, "path", resolved, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to open file")
		return
	}
	defer f.Close()

	contentType := mime.TypeByExtension(filepath.Ext(info.Name()))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)

	// http.ServeContent handles Accept-Ranges and Range requests automatically
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

// handleTransferActive returns whether any transfer is currently in progress.
func (s *Server) handleTransferActive(w http.ResponseWriter, _ *http.Request) {
	active := false
	if s.clientStates != nil {
		for _, state := range s.clientStates.ConnectedClientStates() {
			if state == "syncing" {
				active = true
				break
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"active": active})
}

// isTransferActive checks whether any connected client is currently syncing.
func (s *Server) isTransferActive() bool {
	if s.clientStates == nil {
		return false
	}
	for _, state := range s.clientStates.ConnectedClientStates() {
		if state == "syncing" {
			return true
		}
	}
	return false
}
