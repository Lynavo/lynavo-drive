package main

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nicksyncflow/sidecar/internal/api"
	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/logging"
	"github.com/nicksyncflow/sidecar/internal/mdns"
	"github.com/nicksyncflow/sidecar/internal/server"
	"github.com/nicksyncflow/sidecar/internal/store"
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
	slog.Info("starting syncflow-sidecar", "http_port", cfg.HTTPPort, "tcp_port", cfg.TCPPort)

	// Ensure data directories exist
	for _, dir := range []string{cfg.DataDir, cfg.ReceiveDir, cfg.StagingDir(), cfg.LogDir()} {
		os.MkdirAll(dir, 0755)
	}

	// Init store
	st, err := store.New(cfg.DBPath())
	if err != nil {
		slog.Error("failed to init store", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	// Init event hub
	hub := events.NewHub()

	// Bootstrap reconciliation: ensure DB has config defaults
	bootstrapReconciliation(st, cfg)

	// Create API server
	handler := api.NewServer(st, cfg, hub)

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.HTTPPort),
		Handler: handler,
	}

	// Start TCP server for LMUP/2 protocol
	tcpSrv := server.NewTCPServer(st, cfg, hub)
	if err := tcpSrv.Start(fmt.Sprintf(":%d", cfg.TCPPort)); err != nil {
		slog.Error("tcp server failed", "err", err)
		os.Exit(1)
	}

	// Start Bonjour/mDNS broadcast
	deviceID, _ := st.GetDeviceID()
	deviceName, _ := st.GetSetting("device_name")
	if deviceName == "" {
		deviceName = cfg.DeviceName
	}
	broadcaster, err := mdns.NewBroadcaster(mdns.BroadcastConfig{
		DeviceID:     deviceID,
		DeviceName:   deviceName,
		DeviceType:   "mac",
		TCPPort:      cfg.TCPPort,
		Proto:        2,
		ShareEnabled: false,
		ShareName:    "SyncFlow",
	})
	if err != nil {
		slog.Warn("bonjour broadcast failed, continuing without discovery", "err", err)
	} else {
		defer broadcaster.Shutdown()
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

	tcpSrv.Stop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
}

// bootstrapReconciliation ensures essential config values are populated after
// store initialization. This covers first-run scenarios where the migration
// seeds contain placeholders or empty values.
func bootstrapReconciliation(st *store.Store, cfg *config.Config) {
	// If share_config.receive_root is empty, set it from config
	shareConfig, err := st.GetShareConfig()
	if err == nil && shareConfig.ReceiveRoot == "" {
		shareConfig.ReceiveRoot = cfg.ReceiveDir
		if err := st.UpdateShareConfig(*shareConfig); err != nil {
			slog.Warn("bootstrap: failed to set receive_root", "err", err)
		} else {
			slog.Info("bootstrap: set receive_root", "path", cfg.ReceiveDir)
		}
	}

	// If device_name is empty, set it from config
	if name, err := st.GetSetting("device_name"); err == nil && name == "" {
		if err := st.SetSetting("device_name", cfg.DeviceName); err != nil {
			slog.Warn("bootstrap: failed to set device_name", "err", err)
		} else {
			slog.Info("bootstrap: set device_name", "name", cfg.DeviceName)
		}
	}

	// Auto-regenerate default connection code "000000"
	if code, err := st.GetConnectionCode(); err == nil && code == "000000" {
		newCode := fmt.Sprintf("%06d", 100000+rand.IntN(900000))
		if err := st.SetConnectionCode(newCode); err != nil {
			slog.Warn("bootstrap: failed to regenerate connection code", "err", err)
		} else {
			slog.Info("bootstrap: regenerated connection code", "code", newCode)
		}
	}
}
