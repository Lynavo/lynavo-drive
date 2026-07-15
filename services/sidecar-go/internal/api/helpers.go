package api

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return fmt.Errorf("decode json: %w", err)
	}
	return nil
}
