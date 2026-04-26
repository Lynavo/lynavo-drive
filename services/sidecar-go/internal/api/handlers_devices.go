package api

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/nicksyncflow/sidecar/internal/store"
	"github.com/nicksyncflow/sidecar/internal/uploadfs"
)

func (s *Server) handleDeviceDetail(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("deviceId")
	if deviceID == "" {
		writeError(w, http.StatusBadRequest, "missing deviceId")
		return
	}

	today := time.Now().Format("2006-01-02")
	devices, err := s.store.GetDashboardDevices(today)
	if err != nil {
		slog.Error("get device detail", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get device")
		return
	}

	for _, d := range devices {
		if d.ClientID == deviceID {
			writeJSON(w, http.StatusOK, d)
			return
		}
	}

	// Fallback: try paired_devices directly
	device, err := s.store.GetPairedDevice(deviceID)
	if err != nil {
		if errors.Is(err, store.ErrNoRows) {
			writeError(w, http.StatusNotFound, "device not found")
			return
		}
		slog.Error("get paired device", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get device")
		return
	}

	writeJSON(w, http.StatusOK, device)
}

func (s *Server) handleDeviceFiles(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("deviceId")
	if deviceID == "" {
		writeError(w, http.StatusBadRequest, "missing deviceId")
		return
	}

	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	endDate := r.URL.Query().Get("endDate")

	page := parsePositiveInt(r.URL.Query().Get("page"), 1)
	pageSize := parsePositiveInt(r.URL.Query().Get("pageSize"), 200)
	if pageSize > 500 {
		pageSize = 500
	}
	sortField := r.URL.Query().Get("sortField")
	sortDirection := r.URL.Query().Get("sortDirection")

	uploads, err := s.store.ListCompletedUploadsByDeviceAndDateRange(
		deviceID,
		date,
		endDate,
		sortField,
		sortDirection,
	)
	if err != nil {
		slog.Error("list device files", "err", err, "deviceId", deviceID, "date", date, "endDate", endDate, "page", page, "pageSize", pageSize)
		writeError(w, http.StatusInternalServerError, "failed to list files")
		return
	}

	filteredUploads := make([]store.Upload, 0, len(uploads))
	for _, upload := range uploads {
		if !uploadfs.FinalFileExists(s.config.ReceiveDir, upload.FinalPath) {
			continue
		}
		filteredUploads = append(filteredUploads, upload)
	}

	uploadsPage := buildUploadPage(filteredUploads, page, pageSize)
	if uploadsPage.TotalItems == 0 {
		fsUploads, err := s.filesystemUploadsPageRange(deviceID, date, endDate, sortField, sortDirection, page, pageSize)
		if err != nil {
			slog.Warn("list filesystem uploads fallback failed", "err", err, "deviceId", deviceID, "date", date, "endDate", endDate, "page", page, "pageSize", pageSize)
		} else {
			uploadsPage = fsUploads
		}
	}

	// Ensure JSON arrays (not null) when empty.
	if uploadsPage.Items == nil {
		uploadsPage.Items = []store.Upload{}
	}

	writeJSON(w, http.StatusOK, uploadsPage)
}

func buildUploadPage(uploads []store.Upload, page, pageSize int) store.UploadPage {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 200
	}

	totalBytes := int64(0)
	totalTransmissionMs := int64(0)
	for _, upload := range uploads {
		totalBytes += upload.FileSize
		totalTransmissionMs += upload.ActiveTransmissionMs
	}

	start := (page - 1) * pageSize
	if start > len(uploads) {
		start = len(uploads)
	}
	end := start + pageSize
	if end > len(uploads) {
		end = len(uploads)
	}

	items := make([]store.Upload, 0, end-start)
	items = append(items, uploads[start:end]...)

	return store.UploadPage{
		Items:                     items,
		Page:                      page,
		PageSize:                  pageSize,
		TotalItems:                len(uploads),
		TotalBytes:                totalBytes,
		TotalActiveTransmissionMs: totalTransmissionMs,
	}
}

func (s *Server) handleDeviceDates(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("deviceId")
	if deviceID == "" {
		writeError(w, http.StatusBadRequest, "missing deviceId")
		return
	}

	dates, err := s.store.GetAvailableDates(deviceID)
	if err != nil {
		slog.Error("get available dates", "err", err, "deviceId", deviceID)
		writeError(w, http.StatusInternalServerError, "failed to get dates")
		return
	}
	fsDates, err := s.filesystemDates(deviceID)
	if err != nil {
		slog.Warn("list filesystem dates fallback failed", "err", err, "deviceId", deviceID)
	}
	dates = mergeDateKeys(dates, fsDates)

	if dates == nil {
		dates = []string{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dates": dates,
	})
}

func (s *Server) handleDeviceExistingFileKeys(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("deviceId")
	if deviceID == "" {
		writeError(w, http.StatusBadRequest, "missing deviceId")
		return
	}

	uploads, err := s.store.ListCompletedUploadsByDevice(deviceID)
	if err != nil {
		slog.Error("list completed uploads for existing file keys", "err", err, "deviceId", deviceID)
		writeError(w, http.StatusInternalServerError, "failed to list existing file keys")
		return
	}

	fileKeys := make([]string, 0, len(uploads))
	seen := make(map[string]struct{}, len(uploads))
	for _, upload := range uploads {
		if !uploadfs.FinalFileExists(s.config.ReceiveDir, upload.FinalPath) {
			continue
		}
		if _, ok := seen[upload.FileKey]; ok {
			continue
		}
		seen[upload.FileKey] = struct{}{}
		fileKeys = append(fileKeys, upload.FileKey)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"fileKeys": fileKeys,
	})
}

func parsePositiveInt(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return fallback
	}
	return value
}
