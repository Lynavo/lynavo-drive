package runtimefs

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/config"
)

type EnsureResult struct {
	Recreated []string
}

func (r EnsureResult) RecreatedPath(path string) bool {
	cleanPath := filepath.Clean(path)
	for _, recreated := range r.Recreated {
		if filepath.Clean(recreated) == cleanPath {
			return true
		}
	}
	return false
}

// EnsureRuntimeDirs recreates the full runtime directory skeleton. It is used
// at startup, before SQLite opens, so first-run installs can create DataDir.
func EnsureRuntimeDirs(cfg *config.Config) (EnsureResult, error) {
	if err := validateManagedRootParent(cfg); err != nil {
		return EnsureResult{}, err
	}

	dirs := []string{
		cfg.DataDir,
		cfg.ReceiveDir,
		cfg.PersonalDir(),
		cfg.SharedDir(),
		cfg.StagingDir(),
		cfg.LogDir(),
	}
	return ensureDirs(dirs)
}

// EnsureCoreDirs creates only the sidecar-owned application state directories
// required for logging and SQLite. User-facing storage can be unavailable while
// the sidecar remains online and reports STORAGE_UNAVAILABLE for sync actions.
func EnsureCoreDirs(cfg *config.Config) (EnsureResult, error) {
	return ensureDirs([]string{
		cfg.DataDir,
		cfg.LogDir(),
	})
}

// EnsureStorageDirs recreates only user-facing transfer directories while the
// sidecar is running. If the configured storage root is also DataDir and it has
// disappeared, returning an error is safer than silently recreating an empty
// application data directory over a lost SQLite store.
func EnsureStorageDirs(cfg *config.Config) (EnsureResult, error) {
	if cfg.ReceiveDir == "" {
		return EnsureResult{}, fmt.Errorf("receive dir is not configured")
	}

	if err := validateManagedRootParent(cfg); err != nil {
		return EnsureResult{}, err
	}

	managedRoot := filepath.Clean(filepath.Dir(cfg.ReceiveDir))
	dataDir := filepath.Clean(cfg.DataDir)
	if managedRoot == dataDir {
		if info, err := os.Stat(managedRoot); err != nil {
			return EnsureResult{}, fmt.Errorf("managed root is data directory and unavailable %q: %w", managedRoot, err)
		} else if !info.IsDir() {
			return EnsureResult{}, fmt.Errorf("managed root is data directory but not a directory %q", managedRoot)
		}
	}

	return ensureDirs([]string{
		cfg.ReceiveDir,
		cfg.SharedDir(),
		cfg.StagingDir(),
	})
}

// EnsurePersonalDir recreates only the account-scoped personal shared
// directory. It is deliberately separate from EnsureStorageDirs because an
// unavailable personal disk should not block LAN receive/team shared flows.
func EnsurePersonalDir(cfg *config.Config) (EnsureResult, error) {
	personalDir := cfg.PersonalDir()
	if personalDir == "" {
		return EnsureResult{}, fmt.Errorf("personal dir is not configured")
	}
	if err := validateUserDirParent(personalDir); err != nil {
		return EnsureResult{}, err
	}
	return ensureDirs([]string{personalDir})
}

func validateManagedRootParent(cfg *config.Config) error {
	if cfg.ReceiveDir == "" {
		return nil
	}

	managedRoot := filepath.Clean(filepath.Dir(cfg.ReceiveDir))
	parent := filepath.Clean(filepath.Dir(managedRoot))
	if isDarwinVolumeMountRoot(managedRoot, parent) {
		if info, err := os.Stat(managedRoot); os.IsNotExist(err) {
			return fmt.Errorf("managed root volume unavailable %q: %w", managedRoot, err)
		} else if err != nil {
			return fmt.Errorf("stat managed root volume %q: %w", managedRoot, err)
		} else if !info.IsDir() {
			return fmt.Errorf("managed root volume is not a directory %q", managedRoot)
		}
	}

	if info, err := os.Stat(parent); err != nil {
		return fmt.Errorf("managed root parent unavailable %q: %w", parent, err)
	} else if !info.IsDir() {
		return fmt.Errorf("managed root parent is not a directory %q", parent)
	}
	return nil
}

func validateUserDirParent(dir string) error {
	cleanDir := filepath.Clean(dir)
	parent := filepath.Clean(filepath.Dir(cleanDir))
	if isDarwinVolumeMountRoot(cleanDir, parent) {
		if info, err := os.Stat(cleanDir); os.IsNotExist(err) {
			return fmt.Errorf("user directory volume unavailable %q: %w", cleanDir, err)
		} else if err != nil {
			return fmt.Errorf("stat user directory volume %q: %w", cleanDir, err)
		} else if !info.IsDir() {
			return fmt.Errorf("user directory volume is not a directory %q", cleanDir)
		}
		return nil
	}

	if info, err := os.Stat(parent); err != nil {
		return fmt.Errorf("user directory parent unavailable %q: %w", parent, err)
	} else if !info.IsDir() {
		return fmt.Errorf("user directory parent is not a directory %q", parent)
	}
	return nil
}

func isDarwinVolumeMountRoot(managedRoot, parent string) bool {
	return runtime.GOOS == "darwin" && parent == "/Volumes" && managedRoot != "/Volumes"
}

func ensureDirs(dirs []string) (EnsureResult, error) {
	result := EnsureResult{Recreated: make([]string, 0)}
	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			result.Recreated = append(result.Recreated, dir)
		} else if err != nil {
			return result, fmt.Errorf("stat runtime dir %q: %w", dir, err)
		}

		if err := os.MkdirAll(dir, 0o755); err != nil {
			return result, fmt.Errorf("create runtime dir %q: %w", dir, err)
		}
	}

	return result, nil
}
