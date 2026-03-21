package api

import (
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
)

func (s *Server) handleRegenerateCode(w http.ResponseWriter, _ *http.Request) {
	code := fmt.Sprintf("%06d", 100000+rand.IntN(900000))

	if err := s.store.SetConnectionCode(code); err != nil {
		slog.Error("set connection code", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to regenerate code")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"code": code,
	})
}
