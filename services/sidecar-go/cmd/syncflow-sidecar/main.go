package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/logging"
)

func main() {
	cfgPath := "syncflow-sidecar.yml"
	if v := os.Getenv("SYNCFLOW_CONFIG"); v != "" {
		cfgPath = v
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}

	logging.Setup(cfg.LogLevel)
	slog.Info("starting syncflow-sidecar", "http_port", cfg.HTTPPort)

	// Ensure data directories exist
	for _, dir := range []string{cfg.DataDir, cfg.ReceiveDir, cfg.StagingDir(), cfg.LogDir()} {
		os.MkdirAll(dir, 0755)
	}

	// TODO: init store, init router, init mdns (added in subsequent tasks)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true,"service":"syncflow-sidecar","version":"0.1.0"}`))
	})

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.HTTPPort),
		Handler: mux,
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("http server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("http server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
}
