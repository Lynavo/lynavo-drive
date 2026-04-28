package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/nicksyncflow/sidecar/internal/disk"
	"github.com/nicksyncflow/sidecar/internal/uploadfs"
)

type dashboardExistingFileStats struct {
	FileCount  int
	TotalBytes int64
}

type dashboardLatestFileStats struct {
	Date       string
	FileCount  int
	TotalBytes int64
}

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
	if stats, err := s.dashboardExistingFileStatsForToday(today); err != nil {
		slog.Warn("get dashboard existing file stats", "err", err)
	} else {
		summary.TotalFiles = stats.FileCount
		summary.TotalBytes = stats.TotalBytes
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
		DeviceID        string `json:"deviceId"`
		ClientName      string `json:"clientName"`
		DisplayName     string `json:"displayName"`
		DeviceAlias     string `json:"deviceAlias,omitempty"`
		ReceiveDirName  string `json:"receiveDirName,omitempty"`
		Platform        string `json:"platform"`
		IP              string `json:"ip"`
		Status          string `json:"status"`
		TodayFileCount  int    `json:"todayFileCount"`
		TodayBytes      int64  `json:"todayBytes"`
		LatestDate      string `json:"latestDate,omitempty"`
		LatestFileCount int    `json:"latestFileCount,omitempty"`
		LatestBytes     int64  `json:"latestBytes,omitempty"`
		StorageLeft     string `json:"storageLeft"`
		StoragePath     string `json:"storagePath"`
		DevicePath      string `json:"devicePath"`
		CurrentFile     *struct {
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
		if stats, err := s.dashboardExistingFileStatsForDevice(d.ClientID, today); err != nil {
			slog.Warn("get dashboard device existing file stats", "err", err, "clientID", d.ClientID)
		} else {
			dto.TodayFileCount = stats.FileCount
			dto.TodayBytes = stats.TotalBytes
			latestStats, err := s.dashboardLatestExistingFileStatsForDevice(d.ClientID, today, stats)
			if err != nil {
				slog.Warn("get dashboard latest device stats", "err", err, "clientID", d.ClientID)
			} else if latestStats.Date != "" {
				dto.LatestDate = latestStats.Date
				dto.LatestFileCount = latestStats.FileCount
				dto.LatestBytes = latestStats.TotalBytes
			}
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

func (s *Server) dashboardExistingFileStatsForToday(today string) (dashboardExistingFileStats, error) {
	devices, err := s.store.GetDashboardDevices(today)
	if err != nil {
		return dashboardExistingFileStats{}, err
	}

	var total dashboardExistingFileStats
	for _, device := range devices {
		stats, err := s.dashboardExistingFileStatsForDevice(device.ClientID, today)
		if err != nil {
			return dashboardExistingFileStats{}, err
		}
		total.FileCount += stats.FileCount
		total.TotalBytes += stats.TotalBytes
	}

	return total, nil
}

func (s *Server) dashboardExistingFileStatsForDevice(deviceID, today string) (dashboardExistingFileStats, error) {
	uploads, err := s.store.ListCompletedUploadsByDeviceAndDateRange(
		deviceID,
		today,
		"",
		"completedAt",
		"desc",
	)
	if err != nil {
		return dashboardExistingFileStats{}, err
	}

	var stats dashboardExistingFileStats
	for _, upload := range uploads {
		absolutePath, ok := uploadfs.ResolveFinalPath(s.config.ReceiveDir, upload.FinalPath)
		if !ok {
			continue
		}
		info, err := os.Stat(absolutePath)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		stats.FileCount++
		stats.TotalBytes += info.Size()
	}

	if stats.FileCount > 0 || len(uploads) > 0 {
		return stats, nil
	}

	fsUploads, err := s.filesystemUploadsPage(deviceID, today, "completedAt", "desc", 1, 10000)
	if err != nil {
		return dashboardExistingFileStats{}, err
	}
	return dashboardExistingFileStats{
		FileCount:  fsUploads.TotalItems,
		TotalBytes: fsUploads.TotalBytes,
	}, nil
}

func (s *Server) dashboardLatestExistingFileStatsForDevice(
	deviceID, today string,
	todayStats dashboardExistingFileStats,
) (dashboardLatestFileStats, error) {
	dates, err := s.store.GetAvailableDates(deviceID)
	if err != nil {
		return dashboardLatestFileStats{}, err
	}

	fsDates, err := s.filesystemDates(deviceID)
	if err != nil {
		return dashboardLatestFileStats{}, err
	}
	dates = mergeDateKeys(dates, fsDates)

	for _, date := range dates {
		stats := todayStats
		if date != today {
			stats, err = s.dashboardExistingFileStatsForDevice(deviceID, date)
			if err != nil {
				return dashboardLatestFileStats{}, err
			}
		}
		if stats.FileCount <= 0 {
			continue
		}
		return dashboardLatestFileStats{
			Date:       date,
			FileCount:  stats.FileCount,
			TotalBytes: stats.TotalBytes,
		}, nil
	}

	return dashboardLatestFileStats{}, nil
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
