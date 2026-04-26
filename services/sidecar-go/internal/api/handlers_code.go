package api

import (
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
)

func (s *Server) handleRegenerateCode(w http.ResponseWriter, _ *http.Request) {
	code := fmt.Sprintf("%06d", 100000+rand.IntN(900000))

	revokedCount, err := s.store.SetConnectionCodeAndRevokePairedDevices(code)
	if err != nil {
		slog.Error("rotate connection code", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to regenerate code")
		return
	}
	slog.Info("connection code regenerated; paired devices revoked", "revokedCount", revokedCount)

	writeJSON(w, http.StatusOK, map[string]string{
		"code": code,
	})
}
