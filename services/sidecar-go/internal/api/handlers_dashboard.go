package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"time"

	"github.com/nicksyncflow/sidecar/internal/disk"
)

func (s *Server) handleDashboardSummary(w http.ResponseWriter, _ *http.Request) {
	if !s.ensureStorageDirsForRequest(w, "dashboard.summary") {
		return
	}

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
		"todayUploadCount":         summary.TotalFiles,
		"todayOccupiedBytes":       summary.TotalBytes,
		"remainingBytes":           remainingBytes,
		"isDiskLow":                isDiskLow,
		"lastSuccessfulSyncAt":     summary.LastSuccessfulSyncAt,
		"lastSuccessfulDeviceName": summary.LastSuccessfulDeviceName,
	})
}

func (s *Server) handleDashboardDevices(w http.ResponseWriter, _ *http.Request) {
	if !s.ensureStorageDirsForRequest(w, "dashboard.devices") {
		return
	}

	today := time.Now().Format("2006-01-02")

	devices, err := s.store.GetDashboardDevices(today)
	if err != nil {
		slog.Error("get dashboard devices", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get dashboard devices")
		return
	}

	_, remainingBytes, _ := disk.IsLow(s.config.ReceiveDir, s.config.LowDiskThresholdBytes)

	// Transform to DashboardDeviceDTO shape expected by desktop renderer
	type deviceDTO struct {
		DeviceID       string `json:"deviceId"`
		ClientName     string `json:"clientName"`
		DisplayName    string `json:"displayName"`
		DeviceAlias    string `json:"deviceAlias,omitempty"`
		ReceiveDirName string `json:"receiveDirName,omitempty"`
		Platform       string `json:"platform"`
		IP             string `json:"ip"`
		Status         string `json:"status"`
		TodayFileCount int    `json:"todayFileCount"`
		TodayBytes     int64  `json:"todayBytes"`
		StorageLeft    string `json:"storageLeft"`
		StoragePath    string `json:"storagePath"`
		DevicePath     string `json:"devicePath"`
		CurrentFile    *struct {
			Filename string  `json:"filename"`
			Progress float64 `json:"progress"`
			FileSize int64   `json:"fileSize"`
		} `json:"currentFile,omitempty"`
	}

	result := make([]deviceDTO, 0, len(devices))
	for _, d := range devices {
		ip := ""
		if d.LastIP != nil {
			ip = *d.LastIP
		}
		// Derive status: live TCP > HTTP presence > offline
		status := "offline"
		if s.clientStates != nil {
			liveStates := s.clientStates.ConnectedClientStates()
			if st, ok := liveStates[d.ClientID]; ok {
				if st == "syncing" {
					status = "transferring"
				} else {
					status = "connected_idle"
				}
			}
		}
		if status == "offline" && s.presence.IsAlive(d.ClientID, 45*time.Second) {
			status = "connected_idle"
		}

		if d.ReceiveDirName == nil || *d.ReceiveDirName == "" {
			slog.Error("device missing receive_dir_name, skipping", "clientID", d.ClientID)
			continue
		}
		devicePath := filepath.Join(s.config.ReceiveDir, *d.ReceiveDirName)

		// Assemble displayName: deviceAlias ?? clientName ?? clientId
		displayName := d.ClientName
		if d.DeviceAlias != nil && *d.DeviceAlias != "" {
			displayName = *d.DeviceAlias
		}
		if displayName == "" {
			displayName = d.ClientID
		}

		dto := deviceDTO{
			DeviceID:       d.ClientID,
			ClientName:     d.ClientName,
			DisplayName:    displayName,
			Platform:       d.Platform,
			IP:             ip,
			Status:         status,
			TodayFileCount: d.FileCount,
			TodayBytes:     d.TotalBytes,
			StorageLeft:    formatBytesHuman(remainingBytes),
			StoragePath:    s.config.ReceiveDir,
			DevicePath:     devicePath,
		}
		// Phase 5 observability: expose alias & dir name for diagnostics
		if d.DeviceAlias != nil {
			dto.DeviceAlias = *d.DeviceAlias
		}
		if d.ReceiveDirName != nil {
			dto.ReceiveDirName = *d.ReceiveDirName
		}
		if d.CurrentFile != nil && status == "transferring" {
			dto.CurrentFile = &struct {
				Filename string  `json:"filename"`
				Progress float64 `json:"progress"`
				FileSize int64   `json:"fileSize"`
			}{
				Filename: *d.CurrentFile,
				Progress: 0,
				FileSize: 0,
			}
		}
		result = append(result, dto)
	}

	writeJSON(w, http.StatusOK, result)
}

func formatBytesHuman(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %s", float64(b)/float64(div), []string{"KB", "MB", "GB", "TB"}[exp])
}
