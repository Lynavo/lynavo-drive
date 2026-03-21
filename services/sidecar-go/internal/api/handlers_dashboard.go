package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/nicksyncflow/sidecar/internal/disk"
	"github.com/nicksyncflow/sidecar/internal/store"
)

func (s *Server) handleDashboardSummary(w http.ResponseWriter, _ *http.Request) {
	today := time.Now().Format("2006-01-02")

	summary, err := s.store.GetDashboardSummary(today)
	if err != nil {
		slog.Error("get dashboard summary", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get dashboard summary")
		return
	}

	isDiskLow, remainingBytes, err := disk.IsLow(s.config.ReceiveDir, s.config.LowDiskThresholdBytes)
	if err != nil {
		slog.Warn("disk check failed, defaulting to safe values", "err", err)
		isDiskLow = false
		remainingBytes = 0
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"todayUploadCount":   summary.TotalFiles,
		"todayOccupiedBytes": summary.TotalBytes,
		"remainingBytes":     remainingBytes,
		"isDiskLow":          isDiskLow,
	})
}

func (s *Server) handleDashboardDevices(w http.ResponseWriter, _ *http.Request) {
	today := time.Now().Format("2006-01-02")

	devices, err := s.store.GetDashboardDevices(today)
	if err != nil {
		slog.Error("get dashboard devices", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get dashboard devices")
		return
	}

	// Ensure JSON array (not null) when empty
	if devices == nil {
		devices = []store.DashboardDeviceResult{}
	}

	writeJSON(w, http.StatusOK, devices)
}
