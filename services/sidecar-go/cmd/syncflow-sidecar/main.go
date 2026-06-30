package main

import (
	"context"
	"database/sql"
	"errors"
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
	"github.com/nicksyncflow/sidecar/internal/runtimefs"
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

	// Create sidecar-owned state directories before Setup so file logging and
	// SQLite work even if a user-facing receive root is currently unavailable.
	if err := ensureCoreRuntimeDirs(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "create core runtime dirs: %v\n", err)
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
	storageReady := ensureStorageDirsAtStartup(cfg)
	if err := cleanupLegacyStagingDir(cfg); err != nil {
		slog.Warn("cleanup legacy staging dir failed", "path", cfg.LegacyStagingDir(), "err", err)
	}

	if storageReady {
		// Backfill receive_dir_name for any legacy devices that lack it.
		// This runs once at startup so all devices are in a clean state
		// before the TCP server accepts connections.
		server.BackfillReceiveDirNames(st, cfg.ReceiveDir)

		// Verify that every device's receive directory actually exists on disk.
		// Fixes stale DB entries left by the old rename-on-alias-change code
		// (which updated the DB even when the directory rename failed).
		server.ReconcileReceiveDirNames(st, cfg.ReceiveDir)
	} else {
		slog.Warn("startup receive-dir reconciliation skipped because storage is unavailable", "receiveDir", cfg.ReceiveDir)
	}

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
		shareEnabled, shareName := bonjourShareMetadata(st)

		var err error
		broadcaster, err = mdns.NewBroadcaster(mdns.BroadcastConfig{
			DeviceID:     deviceID,
			DeviceName:   name,
			DeviceType:   mdns.DeviceTypeForGOOS(runtime.GOOS),
			DeviceIP:     selectedIP,
			TCPPort:      cfg.TCPPort,
			Proto:        2,
			ShareEnabled: shareEnabled,
			ShareName:    shareName,
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
	apiSrv.OnShareStatusChanged = func() {
		name := currentBonjourName()
		slog.Info("share status changed, restarting bonjour", "name", name)
		startBroadcaster(name, "share_status_changed")
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

func bonjourShareMetadata(st *store.Store) (bool, string) {
	shareEnabled := true
	shareName := "Vivi Drop"
	if shareConfig, err := st.GetShareConfig(); err == nil && shareConfig != nil {
		if strings.TrimSpace(shareConfig.ShareName) != "" {
			shareName = shareConfig.ShareName
		}
	} else if err != nil {
		slog.Warn("failed to read share config for bonjour", "err", err)
	}
	return shareEnabled, shareName
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
		} else if rewriteTarget, ok := receiveRootRewriteTarget(cfg, receiveRoot); ok {
			previousRoot := receiveRoot
			if err := migrateReceiveRootIfSafe(previousRoot, rewriteTarget); err != nil {
				cfg.ReceiveDir = receiveRoot
				slog.Warn("bootstrap: kept legacy receive_root because migration was unsafe", "from", previousRoot, "to", cfg.ReceiveDir, "err", err)
			} else {
				cfg.ReceiveDir = rewriteTarget
				shareConfig.ReceiveRoot = rewriteTarget
				if err := st.UpdateShareConfig(*shareConfig); err != nil {
					slog.Warn("bootstrap: failed to rewrite legacy receive_root", "from", previousRoot, "to", rewriteTarget, "err", err)
				} else {
					slog.Info("bootstrap: rewrote legacy receive_root", "from", previousRoot, "to", rewriteTarget)
				}
			}
		} else {
			cfg.ReceiveDir = receiveRoot
			slog.Info("bootstrap: hydrated receive_dir from store", "path", cfg.ReceiveDir)
		}
	}

	if personalRoot, err := st.GetSetting("personal_share_root"); err == nil {
		if strings.TrimSpace(personalRoot) != "" {
			cfg.PersonalShareDir = personalRoot
			slog.Info("bootstrap: hydrated personal_share_root from store", "path", cfg.PersonalShareDir)
		}
	} else if errors.Is(err, sql.ErrNoRows) {
		if err := st.SetSetting("personal_share_root", cfg.PersonalDir()); err != nil {
			slog.Warn("bootstrap: failed to set personal_share_root", "err", err)
		} else {
			slog.Info("bootstrap: set personal_share_root", "path", cfg.PersonalDir())
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
			result, err := runtimefs.EnsureStorageDirs(cfg)
			if err != nil {
				slog.Warn("watch shared directory: runtime dirs unavailable", "err", err)
				continue
			}
			sharedDir := cfg.SharedDir()
			info, err := os.Stat(sharedDir)
			if err != nil {
				continue
			}
			if len(result.Recreated) > 0 {
				slog.Warn("watch shared directory: runtime dirs recreated", "paths", result.Recreated)
				hub.Broadcast(events.Event{
					Type:    "shared.directory.changed",
					Payload: map[string]any{"path": sharedDir},
				})
				hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
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
	_, err := runtimefs.EnsureRuntimeDirs(cfg)
	return err
}

func ensureCoreRuntimeDirs(cfg *config.Config) error {
	_, err := runtimefs.EnsureCoreDirs(cfg)
	return err
}

func ensureStorageDirsAtStartup(cfg *config.Config) bool {
	result, err := runtimefs.EnsureStorageDirs(cfg)
	if err != nil {
		slog.Warn("startup storage dirs unavailable", "receiveDir", cfg.ReceiveDir, "err", err)
		return false
	}
	if len(result.Recreated) > 0 {
		slog.Info("startup storage dirs created", "paths", result.Recreated)
	}
	return true
}

func cleanupLegacyStagingDir(cfg *config.Config) error {
	legacyStagingDir := filepath.Clean(cfg.LegacyStagingDir())
	activeStagingDir := filepath.Clean(cfg.StagingDir())
	if legacyStagingDir == activeStagingDir {
		return nil
	}

	entries, err := os.ReadDir(legacyStagingDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read legacy staging dir: %w", err)
	}
	if len(entries) == 0 {
		return nil
	}

	if err := os.RemoveAll(legacyStagingDir); err != nil {
		return fmt.Errorf("remove legacy staging dir: %w", err)
	}
	slog.Info("legacy staging dir cleaned", "path", legacyStagingDir, "entries", len(entries))
	return nil
}

func receiveRootRewriteTarget(cfg *config.Config, currentReceiveRoot string) (string, bool) {
	currentReceiveRoot = filepath.Clean(currentReceiveRoot)
	if isObsoletePersonalReceiveRoot(currentReceiveRoot) {
		target := filepath.Join(filepath.Dir(filepath.Dir(currentReceiveRoot)), "received")
		return target, filepath.Clean(target) != currentReceiveRoot
	}

	if filepath.Base(cfg.DataDir) != "Vivi Drop" {
		return "", false
	}

	legacyBrandReceiveRoot := filepath.Join(filepath.Dir(cfg.DataDir), "小豹闪传", "received")
	currentBrandLegacyReceiveRoot := filepath.Join(cfg.DataDir, "received")
	if currentReceiveRoot == filepath.Clean(legacyBrandReceiveRoot) ||
		currentReceiveRoot == filepath.Clean(currentBrandLegacyReceiveRoot) {
		return cfg.ReceiveDir, filepath.Clean(cfg.ReceiveDir) != currentReceiveRoot
	}

	return "", false
}

func isObsoletePersonalReceiveRoot(receiveRoot string) bool {
	return filepath.Base(receiveRoot) == "received" &&
		filepath.Base(filepath.Dir(receiveRoot)) == "personal"
}

func migrateReceiveRootIfSafe(from string, to string) error {
	from = filepath.Clean(from)
	to = filepath.Clean(to)
	if from == to {
		return nil
	}

	if _, err := os.Stat(from); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return fmt.Errorf("stat legacy receive root: %w", err)
	}

	if _, err := os.Stat(to); os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
			return fmt.Errorf("create receive parent: %w", err)
		}
		if err := os.Rename(from, to); err != nil {
			return fmt.Errorf("move legacy receive root: %w", err)
		}
		return nil
	} else if err != nil {
		return fmt.Errorf("stat personal receive root: %w", err)
	}

	entries, err := os.ReadDir(from)
	if err != nil {
		return fmt.Errorf("read legacy receive root: %w", err)
	}
	if err := os.MkdirAll(to, 0o755); err != nil {
		return fmt.Errorf("create receive root: %w", err)
	}
	for _, entry := range entries {
		target := filepath.Join(to, entry.Name())
		if _, err := os.Stat(target); err == nil {
			return fmt.Errorf("target already exists: %s", target)
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("stat target: %w", err)
		}
	}
	for _, entry := range entries {
		if err := os.Rename(filepath.Join(from, entry.Name()), filepath.Join(to, entry.Name())); err != nil {
			return fmt.Errorf("move legacy entry %q: %w", entry.Name(), err)
		}
	}
	if err := os.Remove(from); err != nil {
		return fmt.Errorf("remove empty legacy receive root: %w", err)
	}
	return nil
}
