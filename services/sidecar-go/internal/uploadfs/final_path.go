package uploadfs

import (
	"os"
	"path/filepath"
)

// ResolveFinalPath converts a stored upload final_path into an absolute path.
func ResolveFinalPath(receiveDir string, finalPath *string) (string, bool) {
	if finalPath == nil || *finalPath == "" {
		return "", false
	}

	cleanPath := filepath.Clean(*finalPath)
	if filepath.IsAbs(cleanPath) {
		return cleanPath, true
	}

	return filepath.Join(receiveDir, cleanPath), true
}

// FinalFileExists reports whether the upload's finalized file is still present on disk.
func FinalFileExists(receiveDir string, finalPath *string) bool {
	absolutePath, ok := ResolveFinalPath(receiveDir, finalPath)
	if !ok {
		return false
	}

	info, err := os.Stat(absolutePath)
	if err != nil {
		return false
	}

	return info.Mode().IsRegular()
}
