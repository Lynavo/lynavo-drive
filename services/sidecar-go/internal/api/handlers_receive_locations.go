package api

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/uploadfs"
)

type deviceReceiveLocation struct {
	Path       string `json:"path"`
	Available  bool   `json:"available"`
	IsCurrent  bool   `json:"isCurrent"`
	LastUsedAt string `json:"lastUsedAt"`
}

type derivedDeviceReceiveLocation struct {
	deviceReceiveLocation
	lastUsedTime time.Time
}

func (s *Server) handleDeviceReceiveLocations(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("deviceId")
	if deviceID == "" {
		writeError(w, http.StatusBadRequest, "missing deviceId")
		return
	}

	stored, backfilled, err := s.store.ListDeviceReceiveLocations(deviceID)
	if err != nil {
		slog.Error("list device receive locations", "err", err, "deviceId", deviceID)
		writeError(w, http.StatusInternalServerError, "failed to list receive locations")
		return
	}
	if backfilled {
		writeJSON(w, http.StatusOK, renderDeviceReceiveLocations(s.config.ReceiveDir, stored))
		return
	}

	uploads, err := s.store.ListCompletedUploadLocationsByDevice(deviceID)
	if err != nil {
		slog.Error("backfill device receive locations", "err", err, "deviceId", deviceID)
		writeError(w, http.StatusInternalServerError, "failed to list receive locations")
		return
	}
	locations := deriveDeviceReceiveLocations(s.config.ReceiveDir, uploads)
	cacheEntries := make([]store.DeviceReceiveLocation, 0, len(locations))
	for _, location := range locations {
		cacheEntries = append(cacheEntries, store.DeviceReceiveLocation{
			Path:       location.Path,
			LastUsedAt: location.LastUsedAt,
		})
	}
	if err := s.store.CacheDeviceReceiveLocations(deviceID, cacheEntries); err != nil {
		slog.Warn("cache device receive locations", "err", err, "deviceId", deviceID)
	}

	writeJSON(w, http.StatusOK, locations)
}

func deriveDeviceReceiveLocations(
	receiveDir string,
	uploads []store.CompletedUploadLocation,
) []deviceReceiveLocation {
	locationsByPath := make(map[string]derivedDeviceReceiveLocation)
	for _, upload := range uploads {
		if upload.FinalPath == nil || *upload.FinalPath == "" || hasDotPathSegment(*upload.FinalPath) {
			continue
		}

		storedPath := *upload.FinalPath
		if !filepath.IsAbs(storedPath) && !validRelativeFinalPathLayout(storedPath) {
			continue
		}
		finalPath, ok := uploadfs.ResolveFinalPath(receiveDir, upload.FinalPath)
		if !ok || !filepath.IsAbs(finalPath) {
			continue
		}

		dateDir := filepath.Dir(filepath.Clean(finalPath))
		if !isDateDirectoryName(filepath.Base(dateDir)) {
			continue
		}
		deviceDir := filepath.Clean(filepath.Dir(dateDir))
		if !validDeviceReceiveFolder(receiveDir, deviceDir) {
			continue
		}

		lastUsedAt := upload.UpdatedAt
		if upload.CompletedAt != nil {
			lastUsedAt = *upload.CompletedAt
		}
		lastUsedTime, err := time.Parse(time.RFC3339, lastUsedAt)
		if err != nil {
			continue
		}

		candidate := newDerivedDeviceReceiveLocation(receiveDir, deviceDir, lastUsedTime)
		key := receiveLocationPathKey(deviceDir, runtime.GOOS)
		if existing, found := locationsByPath[key]; found && !newerReceiveLocation(candidate, existing) {
			continue
		}
		locationsByPath[key] = candidate
	}

	return sortedDeviceReceiveLocations(locationsByPath)
}

func renderDeviceReceiveLocations(
	receiveDir string,
	stored []store.DeviceReceiveLocation,
) []deviceReceiveLocation {
	locationsByPath := make(map[string]derivedDeviceReceiveLocation)
	for _, location := range stored {
		path := filepath.Clean(location.Path)
		if hasDotPathSegment(location.Path) || !validDeviceReceiveFolder(receiveDir, path) {
			continue
		}
		lastUsedTime, err := time.Parse(time.RFC3339, location.LastUsedAt)
		if err != nil {
			continue
		}

		candidate := newDerivedDeviceReceiveLocation(receiveDir, path, lastUsedTime)
		key := receiveLocationPathKey(path, runtime.GOOS)
		if existing, found := locationsByPath[key]; found && !newerReceiveLocation(candidate, existing) {
			continue
		}
		locationsByPath[key] = candidate
	}

	return sortedDeviceReceiveLocations(locationsByPath)
}

func newDerivedDeviceReceiveLocation(
	receiveDir string,
	path string,
	lastUsedTime time.Time,
) derivedDeviceReceiveLocation {
	return derivedDeviceReceiveLocation{
		deviceReceiveLocation: deviceReceiveLocation{
			Path:       path,
			Available:  isReceiveLocationDirectory(path),
			IsCurrent:  pathWithinReceiveRoot(receiveDir, path),
			LastUsedAt: lastUsedTime.Format(time.RFC3339),
		},
		lastUsedTime: lastUsedTime,
	}
}

func newerReceiveLocation(candidate, existing derivedDeviceReceiveLocation) bool {
	if !candidate.lastUsedTime.Equal(existing.lastUsedTime) {
		return candidate.lastUsedTime.After(existing.lastUsedTime)
	}
	return candidate.Path < existing.Path
}

func sortedDeviceReceiveLocations(
	locationsByPath map[string]derivedDeviceReceiveLocation,
) []deviceReceiveLocation {
	derived := make([]derivedDeviceReceiveLocation, 0, len(locationsByPath))
	for _, location := range locationsByPath {
		derived = append(derived, location)
	}
	sort.Slice(derived, func(i, j int) bool {
		if derived[i].IsCurrent != derived[j].IsCurrent {
			return derived[i].IsCurrent
		}
		if !derived[i].lastUsedTime.Equal(derived[j].lastUsedTime) {
			return derived[i].lastUsedTime.After(derived[j].lastUsedTime)
		}
		return derived[i].Path < derived[j].Path
	})

	locations := make([]deviceReceiveLocation, 0, len(derived))
	for _, location := range derived {
		locations = append(locations, location.deviceReceiveLocation)
	}
	return locations
}

func validRelativeFinalPathLayout(path string) bool {
	if filepath.IsAbs(path) || filepath.VolumeName(path) != "" || filepath.Clean(path) != path {
		return false
	}
	parts := strings.Split(path, string(filepath.Separator))
	if len(parts) != 3 {
		return false
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func hasDotPathSegment(path string) bool {
	for _, part := range strings.Split(path, string(filepath.Separator)) {
		if part == "." || part == ".." {
			return true
		}
	}
	return false
}

func isDateDirectoryName(name string) bool {
	parsed, err := time.Parse("2006-01-02", name)
	return err == nil && parsed.Format("2006-01-02") == name
}

func validDeviceReceiveFolder(receiveDir, path string) bool {
	if path == "" || !filepath.IsAbs(path) {
		return false
	}
	cleanPath := filepath.Clean(path)
	volumeRoot := filepath.VolumeName(cleanPath) + string(filepath.Separator)
	pathKey := receiveLocationPathKey(cleanPath, runtime.GOOS)
	return pathKey != receiveLocationPathKey(volumeRoot, runtime.GOOS) &&
		pathKey != receiveLocationPathKey(receiveDir, runtime.GOOS)
}

func receiveLocationPathKey(path, goos string) string {
	key := filepath.Clean(path)
	if goos == "windows" {
		key = strings.ToLower(key)
	}
	return key
}

func pathWithinReceiveRoot(root, path string) bool {
	cleanRoot := filepath.Clean(root)
	cleanPath := filepath.Clean(path)
	if !filepath.IsAbs(cleanRoot) || !filepath.IsAbs(cleanPath) {
		return false
	}
	relative, err := filepath.Rel(cleanRoot, cleanPath)
	if err != nil {
		return false
	}
	return relative != "." && relative != ".." &&
		!strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func isReceiveLocationDirectory(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
