package main

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
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

const bonjourIPPollInterval = 5 * time.Second

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

	// Create the log directory before Setup so file logging works on first run.
	if err := ensureRuntimeDirs(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "create runtime dirs: %v\n", err)
		os.Exit(1)
	}

	logging.Setup(cfg.LogLevel, cfg.LogDir())
	slog.Info("starting vivi-drop-sidecar",
		"http_port", cfg.HTTPPort,
		"tcp_port", cfg.TCPPort,
		"platform", runtime.GOOS,
		"arch", runtime.GOARCH,
		"log_file", logging.LogFilePath(),
		"data_dir", cfg.DataDir,
	)
	slog.Info("startup network snapshot",
		"configured_ip", cfg.DeviceIP,
		"auto_ip", mdns.CurrentLocalIPv4(),
		"interfaces", mdns.SnapshotInterfacesForLog(),
	)

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
	if err := ensureRuntimeDirs(cfg); err != nil {
		slog.Error("create reconciled runtime dirs", "err", err)
		os.Exit(1)
	}

	// Backfill receive_dir_name for any legacy devices that lack it.
	// This runs once at startup so all devices are in a clean state
	// before the TCP server accepts connections.
	server.BackfillReceiveDirNames(st, cfg.ReceiveDir)

	// Verify that every device's receive directory actually exists on disk.
	// Fixes stale DB entries left by the old rename-on-alias-change code
	// (which updated the DB even when the directory rename failed).
	server.ReconcileReceiveDirNames(st, cfg.ReceiveDir)

	// Create TCP server first (API needs its client state tracker)
	tcpSrv := server.NewTCPServer(st, cfg, hub)
	if err := tcpSrv.Start(fmt.Sprintf(":%d", cfg.TCPPort)); err != nil {
		slog.Error("tcp server failed", "err", err)
		os.Exit(1)
	}

	// Create API server (uses tcpSrv for live client state)
	apiSrv, handler := api.NewServer(st, cfg, hub, tcpSrv)
	tcpSrv.SetPresenceProvider(apiSrv.PresenceTracker())
	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.HTTPPort),
		Handler: handler,
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Start Bonjour/mDNS broadcast
	deviceID, _ := st.GetDeviceID()
	deviceName, _ := st.GetSetting("device_name")
	if deviceName == "" {
		deviceName = cfg.DeviceName
	}

	var broadcasterMu sync.Mutex
	var broadcaster *mdns.Broadcaster
	currentDeviceName := deviceName
	currentAdvertisedIP := ""
	startBroadcaster := func(name string, reason string) {
		selectedIP := strings.TrimSpace(cfg.DeviceIP)
		if selectedIP == "" {
			selectedIP = mdns.CurrentLocalIPv4()
		}

		broadcasterMu.Lock()
		defer broadcasterMu.Unlock()

		if broadcaster != nil {
			broadcaster.Shutdown()
			broadcaster = nil
		}
		var err error
		broadcaster, err = mdns.NewBroadcaster(mdns.BroadcastConfig{
			DeviceID:     deviceID,
			DeviceName:   name,
			DeviceType:   mdns.DeviceTypeForGOOS(runtime.GOOS),
			DeviceIP:     selectedIP,
			TCPPort:      cfg.TCPPort,
			Proto:        2,
			ShareEnabled: false,
			ShareName:    "Vivi Drop",
		})
		if err != nil {
			slog.Warn("bonjour broadcast failed", "err", err, "reason", reason, "ip", selectedIP)
			return
		}
		currentDeviceName = name
		currentAdvertisedIP = selectedIP
	}
	startBroadcaster(deviceName, "startup")

	// Restart Bonjour when device name changes
	apiSrv.OnDeviceRenamed = func(newName string) {
		slog.Info("device renamed, restarting bonjour", "name", newName)
		startBroadcaster(newName, "device_renamed")
	}

	currentBonjourIP := func() string {
		broadcasterMu.Lock()
		defer broadcasterMu.Unlock()
		return currentAdvertisedIP
	}
	currentBonjourName := func() string {
		broadcasterMu.Lock()
		defer broadcasterMu.Unlock()
		return currentDeviceName
	}
	go watchBonjourIPChanges(
		ctx,
		bonjourIPPollInterval,
		cfg.DeviceIP,
		currentBonjourIP,
		mdns.CurrentLocalIPv4,
		func(oldIP, newIP string) {
			name := currentBonjourName()
			slog.Info("local IP changed, restarting bonjour",
				"from", oldIP,
				"to", newIP,
				"name", name,
				"from_iface", mdns.PreferredInterfaceName(oldIP),
				"to_iface", mdns.PreferredInterfaceName(newIP),
				"interfaces", mdns.SnapshotInterfacesForLog(),
			)
			startBroadcaster(name, "ip_changed")
		},
	)

	defer func() {
		broadcasterMu.Lock()
		defer broadcasterMu.Unlock()
		if broadcaster != nil {
			broadcaster.Shutdown()
		}
	}()

	go func() {
		slog.Info("http server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("http server error", "err", err)
			os.Exit(1)
		}
	}()

	// Watch shared directory for file changes and broadcast events
	go watchSharedDirectory(ctx, cfg, hub)

	<-ctx.Done()
	slog.Info("shutting down")

	tcpSrv.Stop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
}

func watchBonjourIPChanges(
	ctx context.Context,
	interval time.Duration,
	configuredIP string,
	currentAdvertisedIP func() string,
	currentLocalIP func() string,
	onChange func(oldIP, newIP string),
) {
	if strings.TrimSpace(configuredIP) != "" {
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			advertisedIP := currentAdvertisedIP()
			localIP := currentLocalIP()
			if shouldRestartBonjourForIPChange(configuredIP, advertisedIP, localIP) {
				onChange(strings.TrimSpace(advertisedIP), strings.TrimSpace(localIP))
			}
		}
	}
}

func shouldRestartBonjourForIPChange(configuredIP, advertisedIP, currentIP string) bool {
	if strings.TrimSpace(configuredIP) != "" {
		return false
	}
	advertisedIP = strings.TrimSpace(advertisedIP)
	currentIP = strings.TrimSpace(currentIP)
	return currentIP != "" && advertisedIP != currentIP
}

// bootstrapReconciliation ensures essential config values are populated after
// store initialization. This covers first-run scenarios where the migration
// seeds contain placeholders or empty values.
func bootstrapReconciliation(st *store.Store, cfg *config.Config) {
	// If share_config.receive_root is empty, set it from config
	shareConfig, err := st.GetShareConfig()
	if err == nil {
		receiveRoot := strings.TrimSpace(shareConfig.ReceiveRoot)
		if receiveRoot == "" {
			shareConfig.ReceiveRoot = cfg.ReceiveDir
			if err := st.UpdateShareConfig(*shareConfig); err != nil {
				slog.Warn("bootstrap: failed to set receive_root", "err", err)
			} else {
				slog.Info("bootstrap: set receive_root", "path", cfg.ReceiveDir)
			}
		} else if shouldRewriteLegacyReceiveRoot(cfg, receiveRoot) {
			previousRoot := receiveRoot
			shareConfig.ReceiveRoot = cfg.ReceiveDir
			if err := st.UpdateShareConfig(*shareConfig); err != nil {
				slog.Warn("bootstrap: failed to rewrite legacy receive_root", "from", previousRoot, "to", cfg.ReceiveDir, "err", err)
			} else {
				slog.Info("bootstrap: rewrote legacy receive_root", "from", previousRoot, "to", cfg.ReceiveDir)
			}
		} else {
			cfg.ReceiveDir = receiveRoot
			slog.Info("bootstrap: hydrated receive_dir from store", "path", cfg.ReceiveDir)
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

// watchSharedDirectory polls the shared directory for file changes and
// broadcasts shared.directory.changed events via the hub. Uses standard
// library only — no fsnotify dependency needed.
func watchSharedDirectory(ctx context.Context, cfg *config.Config, hub *events.Hub) {
	const pollInterval = 3 * time.Second
	var lastModTime time.Time
	var lastCount int

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sharedDir := cfg.SharedDir()
			info, err := os.Stat(sharedDir)
			if err != nil {
				continue
			}

			// Quick check: directory mod time changed, or count files at top level
			entries, err := os.ReadDir(sharedDir)
			if err != nil {
				continue
			}

			modTime := info.ModTime()
			count := len(entries)

			if modTime != lastModTime || count != lastCount {
				if lastModTime.IsZero() {
					// First run — just record baseline, don't broadcast
					lastModTime = modTime
					lastCount = count
					continue
				}
				lastModTime = modTime
				lastCount = count
				hub.Broadcast(events.Event{
					Type:    "shared.directory.changed",
					Payload: map[string]any{"path": sharedDir},
				})
			}
		}
	}
}

func ensureRuntimeDirs(cfg *config.Config) error {
	for _, dir := range []string{cfg.DataDir, cfg.ReceiveDir, cfg.SharedDir(), cfg.StagingDir(), cfg.LogDir()} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create runtime dir %q: %w", dir, err)
		}
	}
	return nil
}

func shouldRewriteLegacyReceiveRoot(cfg *config.Config, currentReceiveRoot string) bool {
	if filepath.Base(cfg.DataDir) != "Vivi Drop" {
		return false
	}

	legacyReceiveRoot := filepath.Join(filepath.Dir(cfg.DataDir), "小豹闪传", "received")
	return filepath.Clean(currentReceiveRoot) == filepath.Clean(legacyReceiveRoot) &&
		filepath.Clean(cfg.ReceiveDir) != filepath.Clean(legacyReceiveRoot)
}
