package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
)

type resetStateResponse struct {
	OK bool `json:"ok"`
}

func (s *Server) handleResetState(w http.ResponseWriter, _ *http.Request) {
	if s.isTransferActive() {
		writeError(w, http.StatusConflict, "cannot reset state while a transfer is active")
		return
	}

	if !s.ensureStorageDirsForRequest(w, "settings.reset_state") {
		return
	}

	if err := s.store.ResetState(); err != nil {
		slog.Error("reset runtime state", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to reset state")
		return
	}

	protectedReceiveEntries := map[string]struct{}{
		filepath.Clean(s.config.DBPath()):          {},
		filepath.Clean(s.config.DBPath() + "-wal"): {},
		filepath.Clean(s.config.DBPath() + "-shm"): {},
		filepath.Clean(s.config.LogDir()):          {},
	}

	if err := clearDirectoryContents(s.config.ReceiveDir, protectedReceiveEntries); err != nil {
		slog.Error("clear receive dir for reset", "path", s.config.ReceiveDir, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to reset state")
		return
	}

	if err := clearDirectoryContents(s.config.StagingDir(), nil); err != nil {
		slog.Error("clear staging dir for reset", "path", s.config.StagingDir(), "err", err)
		writeError(w, http.StatusInternalServerError, "failed to reset state")
		return
	}

	legacyStagingDir := filepath.Clean(s.config.LegacyStagingDir())
	activeStagingDir := filepath.Clean(s.config.StagingDir())
	if legacyStagingDir != activeStagingDir {
		if err := clearDirectoryContentsIfExists(legacyStagingDir, nil); err != nil {
			slog.Error("clear legacy staging dir for reset", "path", legacyStagingDir, "err", err)
			writeError(w, http.StatusInternalServerError, "failed to reset state")
			return
		}
	}

	writeJSON(w, http.StatusOK, resetStateResponse{OK: true})
}

func clearDirectoryContentsIfExists(dir string, preserved map[string]struct{}) error {
	cleanDir := filepath.Clean(dir)
	if _, err := os.Stat(cleanDir); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return fmt.Errorf("stat dir %s: %w", cleanDir, err)
	}
	return clearDirectoryContents(cleanDir, preserved)
}

func clearDirectoryContents(dir string, preserved map[string]struct{}) error {
	cleanDir := filepath.Clean(dir)
	if err := os.MkdirAll(cleanDir, 0o755); err != nil {
		return fmt.Errorf("ensure dir %s: %w", cleanDir, err)
	}

	entries, err := os.ReadDir(cleanDir)
	if err != nil {
		return fmt.Errorf("read dir %s: %w", cleanDir, err)
	}

	for _, entry := range entries {
		target := filepath.Clean(filepath.Join(cleanDir, entry.Name()))
		if preserved != nil {
			if _, ok := preserved[target]; ok {
				continue
			}
		}
		if err := os.RemoveAll(target); err != nil {
			return fmt.Errorf("remove %s: %w", target, err)
		}
	}

	return nil
}
