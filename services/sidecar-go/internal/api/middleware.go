package api

import (
	"bufio"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"
)

func withJSON(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		next(w, r)
	}
}

// statusRecorder captures the response status code so the logging
// middleware can decide which slog level to emit. It does NOT alter
// the response — it only observes what the downstream handler wrote.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Hijack forwards to the underlying ResponseWriter so the /events/stream
// WebSocket upgrade keeps working. Without this, gorilla/websocket's Upgrade
// call fails with "response does not implement http.Hijacker".
func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := s.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, errors.New("ResponseWriter does not implement http.Hijacker")
}

// Flush forwards to the underlying ResponseWriter for handlers that stream
// responses (e.g. SSE). Matches the transparent-wrapper contract.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		// 4xx/5xx responses escalate to warn/error so production logs
		// (LogLevel=info) still surface API failures. Successful requests
		// stay at debug to keep the signal-to-noise ratio low.
		dur := time.Since(start)
		switch {
		case rec.status >= 500:
			slog.Error("http request failed",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"dur", dur,
				"remote", r.RemoteAddr,
			)
		case rec.status >= 400:
			slog.Warn("http request client error",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"dur", dur,
				"remote", r.RemoteAddr,
			)
		default:
			slog.Debug("http request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"dur", dur,
			)
		}
	})
}
