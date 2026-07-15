package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type personalDriveRoot struct {
	ID   string
	Name string
	Path string
}

var (
	personalShareGOOS              = runtime.GOOS
	windowsPersonalDriveRoots      = discoverWindowsPersonalDriveRoots
	windowsDefaultPersonalShareDir = defaultWindowsPersonalShareDir
)

const personalPathModeWindowsDrives = "windowsDrives"

func defaultWindowsPersonalShareDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(home)
}

func discoverWindowsPersonalDriveRoots() []personalDriveRoot {
	roots := make([]personalDriveRoot, 0, 26)
	for drive := 'A'; drive <= 'Z'; drive++ {
		id := string(drive)
		root := id + `:\`
		info, err := os.Stat(root)
		if err != nil || !info.IsDir() {
			continue
		}
		roots = append(roots, personalDriveRoot{
			ID:   id,
			Name: id + " Drive",
			Path: root,
		})
	}
	return roots
}

func (s *Server) usesWindowsPersonalVirtualDrives() bool {
	return usesWindowsPersonalVirtualDrivesForPath(s.config.PersonalDir())
}

func usesWindowsPersonalVirtualDrivesForPath(personalDir string) bool {
	if personalShareGOOS != "windows" {
		return false
	}

	defaultDir := windowsDefaultPersonalShareDir()
	if strings.TrimSpace(defaultDir) != "" && sameWindowsPath(personalDir, defaultDir) {
		return true
	}

	return isWindowsDriveRootPath(personalDir)
}

func sameWindowsPath(left string, right string) bool {
	return strings.EqualFold(filepath.Clean(strings.TrimSpace(left)), filepath.Clean(strings.TrimSpace(right)))
}

func isWindowsDriveRootPath(path string) bool {
	path = strings.TrimSpace(path)
	if len(path) < 3 || path[1] != ':' {
		return false
	}
	drive := path[0]
	if !((drive >= 'A' && drive <= 'Z') || (drive >= 'a' && drive <= 'z')) {
		return false
	}
	for _, ch := range path[2:] {
		if ch != '\\' && ch != '/' {
			return false
		}
	}
	return true
}

func (s *Server) listWindowsPersonalDriveRoot(w http.ResponseWriter) bool {
	roots := windowsPersonalDriveRoots()
	files := make([]directoryFileDTO, 0, len(roots))
	now := time.Now().UTC()

	for _, root := range roots {
		id := normalizeWindowsDriveID(root.ID)
		if id == "" || strings.TrimSpace(root.Path) == "" {
			continue
		}

		name := strings.TrimSpace(root.Name)
		if name == "" {
			name = id + " Drive"
		}

		modifiedAt := now
		if info, err := os.Stat(root.Path); err == nil {
			modifiedAt = info.ModTime().UTC()
		}

		files = append(files, directoryFileDTO{
			Name:        name,
			Path:        id,
			Type:        "other",
			Size:        0,
			ModifiedAt:  modifiedAt.Format(time.RFC3339),
			IsDirectory: true,
		})
	}

	writeJSON(w, http.StatusOK, directoryListingDTO{
		Scope:      "personal",
		Path:       "",
		Files:      files,
		TotalCount: len(files),
	})
	return true
}

func resolveWindowsPersonalDrivePath(relPath string) (string, error) {
	if err := rejectUnsafeSharedRelPath(relPath); err != nil {
		return "", err
	}

	normalized := strings.Trim(strings.ReplaceAll(relPath, `\`, "/"), "/")
	if normalized == "" {
		return "", fmt.Errorf("drive path is required")
	}

	segments := strings.SplitN(normalized, "/", 2)
	driveID := normalizeWindowsDriveID(segments[0])
	if driveID == "" {
		return "", fmt.Errorf("invalid drive path")
	}

	root, ok := windowsPersonalDriveRootByID(driveID)
	if !ok {
		return "", fmt.Errorf("drive not found")
	}

	childPath := ""
	if len(segments) == 2 {
		childPath = segments[1]
	}
	return resolveDirectoryPath(root.Path, childPath, "personal")
}

func windowsPersonalDriveRootByID(id string) (personalDriveRoot, bool) {
	for _, root := range windowsPersonalDriveRoots() {
		if normalizeWindowsDriveID(root.ID) == id && strings.TrimSpace(root.Path) != "" {
			return root, true
		}
	}
	return personalDriveRoot{}, false
}

func normalizeWindowsDriveID(id string) string {
	id = strings.TrimSpace(id)
	if len(id) != 1 {
		return ""
	}
	ch := id[0]
	if ch >= 'a' && ch <= 'z' {
		ch = ch - ('a' - 'A')
	}
	if ch < 'A' || ch > 'Z' {
		return ""
	}
	return string(ch)
}
