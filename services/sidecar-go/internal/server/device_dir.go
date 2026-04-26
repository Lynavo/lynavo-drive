package server

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/nicksyncflow/sidecar/internal/store"
)

// ensureDirMu serialises receive-dir-name generation so two goroutines
// cannot race to create conflicting names for the same (or different) devices.
// Called infrequently — once per pairing or once per legacy-device first connection.
var ensureDirMu sync.Mutex

// EnsureReceiveDirName returns the stable receive directory name for a device.
// If receive_dir_name is already persisted, returns it.
// For legacy devices (receive_dir_name = NULL), performs lazy backfill:
// tries to claim an existing directory, then generates a new unique name.
// For new devices, use GenerateReceiveDirName instead (skips legacy claim).
func EnsureReceiveDirName(st *store.Store, receiveDir string, clientID string) (string, error) {
	return ensureReceiveDirName(st, receiveDir, clientID, false)
}

// PairDeviceWithDirName generates a unique receive directory name and stores
// the complete device record atomically under the dir-name mutex.
// This prevents two concurrent pairings from computing the same directory name,
// because both name generation and DB write happen inside the critical section.
// Skips legacy directory claiming — a new device should never adopt orphan directories.
func PairDeviceWithDirName(st *store.Store, receiveDir string, device store.PairedDevice) (string, error) {
	ensureDirMu.Lock()
	defer ensureDirMu.Unlock()

	dirName, err := resolveReceiveDirName(st, receiveDir, &device, true)
	if err != nil {
		return "", fmt.Errorf("PairDeviceWithDirName: generate for %q: %w", device.ClientID, err)
	}

	device.ReceiveDirName = &dirName
	if err := st.UpsertPairedDevice(device); err != nil {
		return "", fmt.Errorf("PairDeviceWithDirName: store %q: %w", device.ClientID, err)
	}

	// Materialise the directory so "open folder" never targets a non-existent path.
	if err := os.MkdirAll(filepath.Join(receiveDir, dirName), 0o755); err != nil {
		slog.Warn("PairDeviceWithDirName: mkdir failed (non-fatal)", "dir", dirName, "err", err)
	}

	slog.Info("new device paired with dir name", "clientID", device.ClientID, "dirName", dirName)
	return dirName, nil
}

func ensureReceiveDirName(st *store.Store, receiveDir string, clientID string, skipLegacyClaim bool) (string, error) {
	ensureDirMu.Lock()
	defer ensureDirMu.Unlock()

	device, err := st.GetPairedDevice(clientID)
	if err != nil {
		return "", fmt.Errorf("ensureReceiveDirName: get device %q: %w", clientID, err)
	}

	// 1. Already persisted — return immediately.
	if device.ReceiveDirName != nil && *device.ReceiveDirName != "" {
		return *device.ReceiveDirName, nil
	}

	// 2. Generate / backfill.
	result, err := resolveReceiveDirName(st, receiveDir, device, skipLegacyClaim)
	if err != nil {
		return "", fmt.Errorf("ensureReceiveDirName: resolve for %q: %w", clientID, err)
	}

	// 3. Persist.
	if err := st.UpdateReceiveDirName(clientID, result); err != nil {
		return "", fmt.Errorf("ensureReceiveDirName: persist for %q: %w", clientID, err)
	}

	// Materialise the directory so "open folder" never targets a non-existent path.
	if err := os.MkdirAll(filepath.Join(receiveDir, result), 0o755); err != nil {
		slog.Warn("ensureReceiveDirName: mkdir failed (non-fatal)", "dir", result, "err", err)
	}

	slog.Info("receive dir name assigned", "clientID", clientID, "dirName", result)
	return result, nil
}

// resolveReceiveDirName tries legacy claim first (unless skipped), then generates a new unique name.
func resolveReceiveDirName(st *store.Store, receiveDir string, device *store.PairedDevice, skipLegacyClaim bool) (string, error) {
	if !skipLegacyClaim {
		// --- 2a. Legacy claim: try to find an existing directory. ---
		// A directory is only claimable if it exists on disk AND is not already
		// reserved by another device in the DB.
		dbNames, err := st.ListReceiveDirNames()
		if err != nil {
			return "", fmt.Errorf("list reserved dir names: %w", err)
		}
		reserved := make(map[string]bool, len(dbNames))
		for _, n := range dbNames {
			reserved[n] = true
		}

		// clientName first — legacy dirs were created from clientName.
		if candidate := SanitizeDirName(device.ClientName); candidate != "" {
			if !reserved[candidate] && dirExists(receiveDir, candidate) {
				return candidate, nil
			}
		}

		// deviceAlias second.
		if device.DeviceAlias != nil && *device.DeviceAlias != "" {
			if candidate := SanitizeDirName(*device.DeviceAlias); candidate != "" {
				if !reserved[candidate] && dirExists(receiveDir, candidate) {
					return candidate, nil
				}
			}
		}
	}

	// --- 2b. Generate new name — no legacy dir found (or legacy claim skipped). ---
	bestName := pickBestName(device)
	candidate := SanitizeDirName(bestName)
	if candidate == "" {
		candidate = "Unknown"
	}

	unique, err := makeUnique(st, receiveDir, candidate)
	if err != nil {
		return "", err
	}
	return unique, nil
}

// pickBestName returns the best human-readable name for a new device.
// alias first for new names because we want the best readable name.
func pickBestName(d *store.PairedDevice) string {
	if d.DeviceAlias != nil && *d.DeviceAlias != "" {
		return *d.DeviceAlias
	}
	if d.ClientName != "" {
		return d.ClientName
	}
	return d.ClientID
}

// makeUnique appends (2), (3), ... to candidate until it conflicts with neither
// the DB nor the filesystem.
func makeUnique(st *store.Store, receiveDir, candidate string) (string, error) {
	taken, err := buildTakenSet(st, receiveDir)
	if err != nil {
		return "", err
	}

	if !taken[candidate] {
		return candidate, nil
	}

	for i := 2; i < 1000; i++ {
		suffixed := fmt.Sprintf("%s (%d)", candidate, i)
		if !taken[suffixed] {
			return suffixed, nil
		}
	}
	return "", fmt.Errorf("could not find unique dir name for %q after 999 attempts", candidate)
}

// buildTakenSet returns a union of all names reserved in the DB and all
// subdirectory names on disk under receiveDir.
func buildTakenSet(st *store.Store, receiveDir string) (map[string]bool, error) {
	taken := make(map[string]bool)

	// DB names.
	dbNames, err := st.ListReceiveDirNames()
	if err != nil {
		return nil, fmt.Errorf("list DB dir names: %w", err)
	}
	for _, n := range dbNames {
		taken[n] = true
	}

	// Filesystem names.
	entries, err := os.ReadDir(receiveDir)
	if err != nil {
		// If the receive directory doesn't exist yet, no filesystem conflicts.
		if os.IsNotExist(err) {
			return taken, nil
		}
		return nil, fmt.Errorf("read receive dir %q: %w", receiveDir, err)
	}
	for _, e := range entries {
		if e.IsDir() {
			taken[e.Name()] = true
		}
	}

	return taken, nil
}

// dirExists checks whether a subdirectory named name exists under receiveDir.
func dirExists(receiveDir, name string) bool {
	info, err := os.Stat(filepath.Join(receiveDir, name))
	return err == nil && info.IsDir()
}

// ReconcileReceiveDirNames verifies that every device's receive_dir_name points
// to a directory that actually exists on disk. If the directory is missing
// (e.g. a previous rename wrote the DB but failed to move the folder), the
// stale name is cleared and EnsureReceiveDirName re-runs, which will attempt
// legacy directory claiming before generating a fresh name.
// Called once at startup, after BackfillReceiveDirNames.
func ReconcileReceiveDirNames(st *store.Store, receiveDir string) {
	devices, err := st.ListPairedDevices()
	if err != nil {
		slog.Warn("reconcile: failed to list paired devices", "err", err)
		return
	}

	reconciled := 0
	for _, d := range devices {
		if d.ReceiveDirName == nil || *d.ReceiveDirName == "" {
			continue
		}
		if dirExists(receiveDir, *d.ReceiveDirName) {
			continue
		}

		// Directory missing — clear stale name and re-derive.
		oldName := *d.ReceiveDirName
		if err := st.UpdateReceiveDirName(d.ClientID, ""); err != nil {
			slog.Warn("reconcile: failed to clear stale receive_dir_name",
				"clientID", d.ClientID, "oldName", oldName, "err", err)
			continue
		}

		newName, err := EnsureReceiveDirName(st, receiveDir, d.ClientID)
		if err != nil {
			slog.Warn("reconcile: failed to re-derive receive_dir_name",
				"clientID", d.ClientID, "err", err)
			continue
		}

		reconciled++
		slog.Info("reconcile: fixed stale receive_dir_name",
			"clientID", d.ClientID,
			"oldName", oldName,
			"newName", newName)
	}
	if reconciled > 0 {
		slog.Info("reconcile: completed", "fixed", reconciled)
	}
}

// BackfillReceiveDirNames iterates all paired devices and ensures each has a
// receive_dir_name. Called once at sidecar startup so legacy devices are in a
// clean state before the TCP server accepts connections.
func BackfillReceiveDirNames(st *store.Store, receiveDir string) {
	devices, err := st.ListPairedDevices()
	if err != nil {
		slog.Warn("backfill: failed to list paired devices", "err", err)
		return
	}

	backfilled := 0
	for _, d := range devices {
		if d.ReceiveDirName != nil && *d.ReceiveDirName != "" {
			continue
		}
		dirName, err := EnsureReceiveDirName(st, receiveDir, d.ClientID)
		if err != nil {
			slog.Warn("backfill: failed to ensure receive dir name",
				"clientID", d.ClientID, "err", err)
			continue
		}
		backfilled++
		slog.Info("backfill: assigned receive dir name",
			"clientID", d.ClientID, "dirName", dirName)
	}
	if backfilled > 0 {
		slog.Info("backfill: completed", "count", backfilled)
	}
}
