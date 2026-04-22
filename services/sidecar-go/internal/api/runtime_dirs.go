package api

import (
	"log/slog"
	"net/http"

	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/runtimefs"
)

func (s *Server) ensureStorageDirsForRequest(w http.ResponseWriter, operation string) bool {
	result, err := runtimefs.EnsureStorageDirs(s.config)
	if err != nil {
		slog.Error("runtime storage unavailable", "operation", operation, "err", err)
		writeError(w, http.StatusServiceUnavailable, "storage path unavailable")
		return false
	}

	if len(result.Recreated) > 0 {
		slog.Warn("runtime directories recreated", "operation", operation, "paths", result.Recreated)
		s.hub.Broadcast(events.Event{
			Type:    "shared.directory.changed",
			Payload: map[string]any{"path": s.config.SharedDir()},
		})
		s.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
	}

	return true
}
