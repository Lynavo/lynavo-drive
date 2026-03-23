package api

import (
	"log/slog"
	"net/http"
)

type settingsDTO struct {
	DeviceName     string `json:"deviceName"`
	ConnectionCode string `json:"connectionCode"`
	ReceivePath    string `json:"receivePath"`
	ShareAddress   string `json:"shareAddress"`
	ShareStatus    string `json:"shareStatus"`
	ShareName      string `json:"shareName"`
}

type updateSettingsRequest struct {
	DeviceName  *string `json:"deviceName,omitempty"`
	ReceivePath *string `json:"receivePath,omitempty"`
}

func (s *Server) handleGetSettings(w http.ResponseWriter, _ *http.Request) {
	dto, err := s.assembleSettingsDTO()
	if err != nil {
		slog.Error("get settings", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}
	writeJSON(w, http.StatusOK, dto)
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req updateSettingsRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.DeviceName != nil {
		if err := s.store.SetDeviceName(*req.DeviceName); err != nil {
			slog.Error("update device_name", "err", err)
			writeError(w, http.StatusInternalServerError, "failed to update settings")
			return
		}
		if s.OnDeviceRenamed != nil {
			s.OnDeviceRenamed(*req.DeviceName)
		}
	}

	if req.ReceivePath != nil {
		shareConfig, err := s.store.GetShareConfig()
		if err != nil {
			slog.Error("get share config for update", "err", err)
			writeError(w, http.StatusInternalServerError, "failed to update settings")
			return
		}
		shareConfig.ReceiveRoot = *req.ReceivePath
		if err := s.store.UpdateShareConfig(*shareConfig); err != nil {
			slog.Error("update share config receive_root", "err", err)
			writeError(w, http.StatusInternalServerError, "failed to update settings")
			return
		}
	}

	dto, err := s.assembleSettingsDTO()
	if err != nil {
		slog.Error("get updated settings", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}
	writeJSON(w, http.StatusOK, dto)
}

func (s *Server) assembleSettingsDTO() (*settingsDTO, error) {
	deviceName, err := s.store.GetDeviceName()
	if err != nil {
		return nil, err
	}

	code, err := s.store.GetConnectionCode()
	if err != nil {
		return nil, err
	}

	shareConfig, err := s.store.GetShareConfig()
	if err != nil {
		return nil, err
	}

	return &settingsDTO{
		DeviceName:     deviceName,
		ConnectionCode: code,
		ReceivePath:    shareConfig.ReceiveRoot,
		ShareAddress:   shareConfig.ShareURL,
		ShareStatus:    shareConfig.ShareStatus,
		ShareName:      shareConfig.ShareName,
	}, nil
}
