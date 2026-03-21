package api

import (
	"log/slog"
	"net/http"
)

type shareStatusDTO struct {
	Enabled         bool    `json:"enabled"`
	SmbURL          string  `json:"smbUrl"`
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
		Status:          cfg.ShareStatus,
		LastValidatedAt: cfg.LastValidatedAt,
		LastError:       cfg.LastError,
	})
}

// handleShareValidate is a placeholder. Real detection will be implemented in T2.7.
func (s *Server) handleShareValidate(w http.ResponseWriter, _ *http.Request) {
	cfg, err := s.store.GetShareConfig()
	if err != nil {
		slog.Error("share validate", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to validate share")
		return
	}

	writeJSON(w, http.StatusOK, shareStatusDTO{
		Enabled:         cfg.ShareURL != "",
		SmbURL:          cfg.ShareURL,
		Status:          cfg.ShareStatus,
		LastValidatedAt: cfg.LastValidatedAt,
		LastError:       cfg.LastError,
	})
}
