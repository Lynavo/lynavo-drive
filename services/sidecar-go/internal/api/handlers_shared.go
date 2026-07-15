package api

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/events"
)

const (
	directoryThumbnailCacheVersion = "v1"
	directoryThumbnailMaxEdge      = 256
	directoryThumbnailJPEGQuality  = 80
	directoryThumbnailMaxCacheSize = int64(256 * 1024 * 1024)
	videoThumbnailPollInterval     = 100 * time.Millisecond
	videoThumbnailPollTimeout      = 3 * time.Second
)

// directoryFileDTO mirrors the DirectoryFileDTO contract.
type directoryFileDTO struct {
	Name         string  `json:"name"`
	Path         string  `json:"path"`
	Type         string  `json:"type"`
	Size         int64   `json:"size"`
	ModifiedAt   string  `json:"modifiedAt"`
	ThumbnailURL *string `json:"thumbnailUrl,omitempty"`
	StreamURL    *string `json:"streamUrl,omitempty"`
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

	s.listDirectoryWithStreams(w, relPath, s.resolveSharedPath, "", "/shared/thumbnail/", "/shared/stream/", false)
}

func (s *Server) listDirectory(
	w http.ResponseWriter,
	relPath string,
	resolvePath func(string) (string, error),
	scope string,
	thumbnailPrefix string,
	versionedSupportedThumbnails bool,
) bool {
	return s.listDirectoryWithStreams(w, relPath, resolvePath, scope, thumbnailPrefix, "", versionedSupportedThumbnails)
}

func (s *Server) listDirectoryWithStreams(
	w http.ResponseWriter,
	relPath string,
	resolvePath func(string) (string, error),
	scope string,
	thumbnailPrefix string,
	streamPrefix string,
	versionedSupportedThumbnails bool,
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
		slog.Error("stat shared dir", "path", resolved, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to read directory")
		return false
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "path is not a directory")
		return false
	}

	entries, err := os.ReadDir(resolved)
	if err != nil {
		slog.Error("read shared dir", "path", resolved, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to read directory")
		return false
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
		var streamURL *string
		if !entryInfo.IsDir() {
			switch fileType {
			case "image":
				if thumbnailPrefix != "" {
					if !versionedSupportedThumbnails {
						u := thumbnailPrefix + filePath
						thumbURL = &u
					} else if isSupportedDirectoryThumbnailSource(e.Name()) ||
						isSupportedDesktopGeneratedImageThumbnailSource(e.Name()) {
						u := thumbnailPrefix + filePath + "?v=" + directoryThumbnailSourceVersion(entryInfo)
						thumbURL = &u
					}
				}
			case "video":
				if streamPrefix != "" {
					u := streamPrefix + filePath
					streamURL = &u
				}
				if thumbnailPrefix != "" && isSupportedDirectoryVideoPosterSource(e.Name()) {
					u := thumbnailPrefix + filePath + "?v=" + directoryThumbnailSourceVersion(entryInfo)
					thumbURL = &u
				}
			}
		}
		if fileType == "video" && !entryInfo.IsDir() {
			slog.Info("directory video listed",
				"scope", scope,
				"path", filePath,
				"name", e.Name(),
				"thumbnailUrl", optionalStringValue(thumbURL),
				"streamUrl", optionalStringValue(streamURL),
				"supportedPoster", isSupportedDirectoryVideoPosterSource(e.Name()),
			)
		}

		files = append(files, directoryFileDTO{
			Name:         e.Name(),
			Path:         filePath,
			Type:         fileType,
			Size:         entryInfo.Size(),
			ModifiedAt:   entryInfo.ModTime().UTC().Format(time.RFC3339),
			ThumbnailURL: thumbURL,
			StreamURL:    streamURL,
			IsDirectory:  entryInfo.IsDir(),
		})
	}

	writeJSON(w, http.StatusOK, directoryListingDTO{
		Scope:      scope,
		Path:       relPath,
		Files:      files,
		TotalCount: len(files),
	})
	return true
}

// handleSharedThumbnail serves a thumbnail for a shared file.
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

	if isSupportedDirectoryVideoPosterSource(info.Name()) ||
		isSupportedDesktopGeneratedImageThumbnailSource(info.Name()) {
		s.serveCachedThumbnailForResolvedFile(w, r, resolved, info)
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

func (s *Server) serveCachedDirectoryThumbnail(
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

	s.serveCachedThumbnailForResolvedFile(w, r, resolved, info)
}

func (s *Server) serveCachedThumbnailForResolvedFile(
	w http.ResponseWriter,
	r *http.Request,
	resolved string,
	info os.FileInfo,
) {
	isImageThumbnail := isSupportedDirectoryThumbnailSource(info.Name())
	isDesktopGeneratedThumbnail := isSupportedDirectoryVideoPosterSource(info.Name()) ||
		isSupportedDesktopGeneratedImageThumbnailSource(info.Name())
	if !isImageThumbnail && !isDesktopGeneratedThumbnail {
		writeError(w, http.StatusNotFound, "thumbnail not available for this file type")
		return
	}

	cachePath := s.directoryThumbnailCachePath(resolved, info)
	if validCachedThumbnailFile(cachePath) {
		if isDesktopGeneratedThumbnail {
			slog.Info("desktop thumbnail cache hit",
				"path", resolved,
				"cachePath", cachePath,
			)
		}
		serveCachedThumbnailFile(w, r, cachePath)
		return
	}

	if err := acquireThumbnailSlot(r, s.thumbnailLimiter); err != nil {
		if isDesktopGeneratedThumbnail {
			slog.Warn("desktop thumbnail acquire slot failed",
				"path", resolved,
				"cachePath", cachePath,
				"err", err,
			)
		}
		writeError(w, http.StatusServiceUnavailable, "thumbnail request cancelled")
		return
	}
	defer releaseThumbnailSlot(s.thumbnailLimiter)

	if validCachedThumbnailFile(cachePath) {
		if isDesktopGeneratedThumbnail {
			slog.Info("desktop thumbnail cache hit after limiter",
				"path", resolved,
				"cachePath", cachePath,
			)
		}
		serveCachedThumbnailFile(w, r, cachePath)
		return
	}

	if isDesktopGeneratedThumbnail {
		if s.requestVideoThumbnail(r, resolved, info, cachePath) {
			pruneDirectoryThumbnailCache(filepath.Join(s.config.DataDir, "thumbnail-cache"), directoryThumbnailMaxCacheSize)
			serveCachedThumbnailFile(w, r, cachePath)
			return
		}
		slog.Warn("desktop thumbnail unavailable after request",
			"path", resolved,
			"cachePath", cachePath,
		)
		writeError(w, http.StatusNotFound, "thumbnail not available for this file")
		return
	}

	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		slog.Error("create thumbnail cache dir", "path", filepath.Dir(cachePath), "err", err)
		writeError(w, http.StatusInternalServerError, "failed to prepare thumbnail cache")
		return
	}

	if err := generateDirectoryThumbnail(resolved, cachePath); err != nil {
		slog.Warn("generate directory thumbnail", "path", resolved, "err", err)
		writeError(w, http.StatusNotFound, "thumbnail not available for this file")
		return
	}
	pruneDirectoryThumbnailCache(filepath.Join(s.config.DataDir, "thumbnail-cache"), directoryThumbnailMaxCacheSize)
	serveCachedThumbnailFile(w, r, cachePath)
}

type videoThumbnailInflight struct {
	done chan struct{}
}

func (s *Server) requestVideoThumbnail(
	r *http.Request,
	resolved string,
	info os.FileInfo,
	cachePath string,
) bool {
	s.videoThumbnailMu.Lock()
	if existing := s.videoThumbnailInflight[cachePath]; existing != nil {
		done := existing.done
		s.videoThumbnailMu.Unlock()
		slog.Info("video thumbnail waiting for inflight request",
			"path", resolved,
			"cachePath", cachePath,
		)
		select {
		case <-done:
			ok := validCachedThumbnailFile(cachePath)
			slog.Info("video thumbnail inflight request completed",
				"path", resolved,
				"cachePath", cachePath,
				"cacheReady", ok,
			)
			return ok
		case <-r.Context().Done():
			slog.Warn("video thumbnail inflight wait cancelled",
				"path", resolved,
				"cachePath", cachePath,
				"err", r.Context().Err(),
			)
			return false
		}
	}
	inflight := &videoThumbnailInflight{done: make(chan struct{})}
	s.videoThumbnailInflight[cachePath] = inflight
	s.videoThumbnailMu.Unlock()

	defer func() {
		s.videoThumbnailMu.Lock()
		if s.videoThumbnailInflight[cachePath] == inflight {
			close(inflight.done)
			delete(s.videoThumbnailInflight, cachePath)
		}
		s.videoThumbnailMu.Unlock()
	}()

	if validCachedThumbnailFile(cachePath) {
		slog.Info("video thumbnail cache ready before broadcast",
			"path", resolved,
			"cachePath", cachePath,
		)
		return true
	}

	requestID := videoThumbnailRequestID(cachePath)
	sourceVersion := directoryThumbnailSourceVersion(info)
	slog.Info("video thumbnail request broadcast",
		"requestId", requestID,
		"path", resolved,
		"cachePath", cachePath,
		"sourceVersion", sourceVersion,
		"maxEdge", directoryThumbnailMaxEdge,
		"quality", directoryThumbnailJPEGQuality,
	)
	s.hub.Broadcast(events.Event{
		Type: "video.thumbnail.request",
		Payload: map[string]any{
			"requestId":     requestID,
			"sourcePath":    resolved,
			"cachePath":     cachePath,
			"sourceVersion": sourceVersion,
			"maxEdge":       directoryThumbnailMaxEdge,
			"quality":       directoryThumbnailJPEGQuality,
		},
	})

	startedAt := time.Now()
	ticker := time.NewTicker(videoThumbnailPollInterval)
	defer ticker.Stop()
	timeout := time.NewTimer(videoThumbnailPollTimeout)
	defer timeout.Stop()

	for {
		if validCachedThumbnailFile(cachePath) {
			slog.Info("video thumbnail cache appeared",
				"requestId", requestID,
				"path", resolved,
				"cachePath", cachePath,
				"elapsedMs", time.Since(startedAt).Milliseconds(),
			)
			return true
		}
		select {
		case <-ticker.C:
		case <-timeout.C:
			ok := validCachedThumbnailFile(cachePath)
			slog.Warn("video thumbnail wait timed out",
				"requestId", requestID,
				"path", resolved,
				"cachePath", cachePath,
				"cacheReady", ok,
				"elapsedMs", time.Since(startedAt).Milliseconds(),
			)
			return ok
		case <-r.Context().Done():
			slog.Warn("video thumbnail request cancelled",
				"requestId", requestID,
				"path", resolved,
				"cachePath", cachePath,
				"err", r.Context().Err(),
				"elapsedMs", time.Since(startedAt).Milliseconds(),
			)
			return false
		}
	}
}

func optionalStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func videoThumbnailRequestID(cachePath string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%d", cachePath, time.Now().UnixNano())))
	return hex.EncodeToString(sum[:])[:16]
}

func acquireThumbnailSlot(r *http.Request, limiter chan struct{}) error {
	select {
	case limiter <- struct{}{}:
		return nil
	case <-r.Context().Done():
		return r.Context().Err()
	}
}

func releaseThumbnailSlot(limiter chan struct{}) {
	<-limiter
}

func (s *Server) directoryThumbnailCachePath(resolved string, info os.FileInfo) string {
	sum := sha256.Sum256([]byte(
		resolved + "\x00" + directoryThumbnailSourceVersion(info) + "\x00" + directoryThumbnailCacheVersion,
	))
	key := hex.EncodeToString(sum[:])
	return filepath.Join(s.config.DataDir, "thumbnail-cache", key[:2], key+".jpg")
}

func directoryThumbnailSourceVersion(info os.FileInfo) string {
	return fmt.Sprintf("%d-%d-%s", info.Size(), info.ModTime().UnixNano(), directoryThumbnailCacheVersion)
}

func isSupportedDirectoryThumbnailSource(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".gif":
		return true
	default:
		return false
	}
}

func isSupportedDesktopGeneratedImageThumbnailSource(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".heic", ".heif":
		return true
	default:
		return false
	}
}

func isSupportedDirectoryVideoPosterSource(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp4", ".mov", ".m4v", ".webm":
		return true
	default:
		return false
	}
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func validCachedThumbnailFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Size() > 0
}

func serveCachedThumbnailFile(w http.ResponseWriter, r *http.Request, path string) {
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, path)
}

func generateDirectoryThumbnail(sourcePath string, cachePath string) error {
	src, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer src.Close()

	img, _, err := image.Decode(src)
	if err != nil {
		return err
	}
	thumbnail := resizeImageNearest(img, directoryThumbnailMaxEdge)

	tmp, err := os.CreateTemp(filepath.Dir(cachePath), ".thumbnail-*.jpg")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if err := jpeg.Encode(tmp, thumbnail, &jpeg.Options{Quality: directoryThumbnailJPEGQuality}); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, cachePath)
}

func resizeImageNearest(src image.Image, maxEdge int) image.Image {
	bounds := src.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 || maxEdge <= 0 {
		return src
	}

	targetWidth := width
	targetHeight := height
	if width >= height && width > maxEdge {
		targetWidth = maxEdge
		targetHeight = max(1, (height*maxEdge)/width)
	} else if height > width && height > maxEdge {
		targetHeight = maxEdge
		targetWidth = max(1, (width*maxEdge)/height)
	}

	dst := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	for y := 0; y < targetHeight; y++ {
		srcY := bounds.Min.Y + (y*height)/targetHeight
		for x := 0; x < targetWidth; x++ {
			srcX := bounds.Min.X + (x*width)/targetWidth
			dst.Set(x, y, src.At(srcX, srcY))
		}
	}
	return dst
}

type thumbnailCacheFile struct {
	path    string
	size    int64
	modTime time.Time
}

func pruneDirectoryThumbnailCache(cacheDir string, maxSize int64) {
	files := []thumbnailCacheFile{}
	var total int64
	err := filepath.WalkDir(cacheDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		info, statErr := entry.Info()
		if statErr != nil {
			return nil
		}
		total += info.Size()
		files = append(files, thumbnailCacheFile{
			path:    path,
			size:    info.Size(),
			modTime: info.ModTime(),
		})
		return nil
	})
	if err != nil || total <= maxSize {
		return
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].modTime.Before(files[j].modTime)
	})
	for _, file := range files {
		if total <= maxSize {
			return
		}
		if err := os.Remove(file.path); err == nil {
			total -= file.size
		}
	}
}

func (s *Server) serveDirectoryDownload(
	w http.ResponseWriter,
	r *http.Request,
	relPath string,
	resolvePath func(string) (string, error),
) bool {
	resolved, err := resolvePath(relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return false
	}

	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "file not found")
		return false
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
	return true
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
) bool {
	resolved, err := resolvePath(relPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return false
	}

	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "file not found")
		return false
	}

	f, err := os.Open(resolved)
	if err != nil {
		slog.Error("open file for streaming", "scope", scopeLabel, "path", resolved, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to open file")
		return false
	}
	defer f.Close()

	contentType := mime.TypeByExtension(filepath.Ext(info.Name()))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)

	// http.ServeContent handles Accept-Ranges and Range requests automatically
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return true
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
