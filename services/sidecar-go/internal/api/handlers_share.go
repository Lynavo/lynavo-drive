package api

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/nicksyncflow/sidecar/internal/share"
	"github.com/nicksyncflow/sidecar/internal/store"
)

type shareStatusDTO struct {
	Enabled         bool    `json:"enabled"`
	SmbURL          string  `json:"smbUrl"`
	ShareName       string  `json:"shareName,omitempty"`
	Status          string  `json:"status"`
	LastValidatedAt *string `json:"lastValidatedAt"`
	LastError       *string `json:"lastError"`
}

func (s *Server) handleShareStatus(w http.ResponseWriter, _ *http.Request) {
	cfg, err := s.store.GetShareConfig()
	if err != nil {
		slog.Error("get share status", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get share status")
		return
	}

	writeJSON(w, http.StatusOK, shareStatusDTO{
		Enabled:         cfg.ShareURL != "",
		SmbURL:          cfg.ShareURL,
		ShareName:       cfg.ShareName,
		Status:          cfg.ShareStatus,
		LastValidatedAt: cfg.LastValidatedAt,
		LastError:       cfg.LastError,
	})
}

// handleShareValidate runs SMB share detection and persists the result.
func (s *Server) handleShareValidate(w http.ResponseWriter, _ *http.Request) {
	cfg, err := s.store.GetShareConfig()
	if err != nil {
		slog.Error("share validate", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to validate share")
		return
	}

	pathConfig := *s.config
	if strings.TrimSpace(cfg.ReceiveRoot) != "" {
		pathConfig.ReceiveDir = cfg.ReceiveRoot
	}
	result := share.Detect(pathConfig.SharedDir(), cfg.ShareName)

	// Persist the detection result.
	now := time.Now().UTC().Format(time.RFC3339)
	if err := s.store.UpdateShareConfig(store.ShareConfig{
		ReceiveRoot:     cfg.ReceiveRoot,
		ShareName:       firstNonEmpty(result.ShareName, cfg.ShareName),
		ShareURL:        derefStr(result.SmbURL),
		ShareStatus:     string(result.Status),
		LastValidatedAt: &now,
		LastError:       result.Error,
	}); err != nil {
		slog.Error("share validate: update config", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to persist share status")
		return
	}

	if s.OnShareStatusChanged != nil {
		s.OnShareStatusChanged()
	}

	writeJSON(w, http.StatusOK, result)
}

// derefStr safely dereferences a *string, returning "" if nil.
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func firstNonEmpty(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}
