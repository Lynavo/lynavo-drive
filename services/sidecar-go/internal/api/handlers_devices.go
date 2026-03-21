package api

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/nicksyncflow/sidecar/internal/store"
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

	uploads, err := s.store.ListUploadsByDeviceAndDate(deviceID, date)
	if err != nil {
		slog.Error("list device files", "err", err, "deviceId", deviceID, "date", date)
		writeError(w, http.StatusInternalServerError, "failed to list files")
		return
	}

	// Ensure JSON array (not null) when empty
	if uploads == nil {
		uploads = []store.Upload{}
	}

	writeJSON(w, http.StatusOK, uploads)
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

	if dates == nil {
		dates = []string{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dates": dates,
	})
}
