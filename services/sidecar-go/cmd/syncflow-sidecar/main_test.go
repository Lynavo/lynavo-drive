package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/store"
)

func TestBootstrapReconciliationUpdatesLegacyDefaultReceiveRoot(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "Vivi Drop")
	dbPath := filepath.Join(dataDir, "sidecar.db")

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(dataDir): %v", err)
	}

	st, err := store.New(dbPath)
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer st.Close()

	cfg, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	cfg.ReceiveRoot = filepath.Join(dir, "小豹闪传", "received")
	if err := st.UpdateShareConfig(*cfg); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}

	runtimeConfig := &config.Config{
		DataDir:    dataDir,
		ReceiveDir: filepath.Join(dataDir, "received"),
		DeviceName: "test-device",
	}

	bootstrapReconciliation(st, runtimeConfig)

	updated, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig(updated): %v", err)
	}
	if updated.ReceiveRoot != filepath.Join(dataDir, "received") {
		t.Fatalf("ReceiveRoot = %q, want %q", updated.ReceiveRoot, filepath.Join(dataDir, "received"))
	}
	if runtimeConfig.ReceiveDir != filepath.Join(dataDir, "received") {
		t.Fatalf("runtime ReceiveDir = %q, want %q", runtimeConfig.ReceiveDir, filepath.Join(dataDir, "received"))
	}
}

func TestBootstrapReconciliationKeepsCustomReceiveRoot(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "Vivi Drop")
	dbPath := filepath.Join(dataDir, "sidecar.db")

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(dataDir): %v", err)
	}

	st, err := store.New(dbPath)
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer st.Close()

	cfg, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	cfg.ReceiveRoot = filepath.Join(dir, "custom-received")
	if err := st.UpdateShareConfig(*cfg); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}

	runtimeConfig := &config.Config{
		DataDir:    dataDir,
		ReceiveDir: filepath.Join(dataDir, "received"),
		DeviceName: "test-device",
	}

	bootstrapReconciliation(st, runtimeConfig)

	updated, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig(updated): %v", err)
	}
	if updated.ReceiveRoot != filepath.Join(dir, "custom-received") {
		t.Fatalf("ReceiveRoot = %q, want %q", updated.ReceiveRoot, filepath.Join(dir, "custom-received"))
	}
	if runtimeConfig.ReceiveDir != filepath.Join(dir, "custom-received") {
		t.Fatalf("runtime ReceiveDir = %q, want %q", runtimeConfig.ReceiveDir, filepath.Join(dir, "custom-received"))
	}
}

func TestEnsureRuntimeDirsCreatesSharedDirAtStartup(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{
		DataDir:    filepath.Join(dir, "Vivi Drop"),
		ReceiveDir: filepath.Join(dir, "Vivi Drop", "received"),
		DeviceName: "test-device",
	}

	if err := ensureRuntimeDirs(cfg); err != nil {
		t.Fatalf("ensureRuntimeDirs: %v", err)
	}

	for _, path := range []string{
		cfg.DataDir,
		cfg.ReceiveDir,
		cfg.SharedDir(),
		cfg.StagingDir(),
		cfg.LogDir(),
	} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("Stat(%q): %v", path, err)
		}
		if !info.IsDir() {
			t.Fatalf("%q is not a directory", path)
		}
	}
}

func TestShouldRestartBonjourForIPChange(t *testing.T) {
	tests := []struct {
		name         string
		configuredIP string
		advertisedIP string
		currentIP    string
		want         bool
	}{
		{
			name:         "restarts when auto detected IP changes",
			advertisedIP: "192.168.3.224",
			currentIP:    "192.168.155.71",
			want:         true,
		},
		{
			name:         "does not restart when IP is unchanged",
			advertisedIP: "192.168.155.71",
			currentIP:    "192.168.155.71",
			want:         false,
		},
		{
			name:         "respects explicit configured IP",
			configuredIP: "192.168.3.224",
			advertisedIP: "192.168.3.224",
			currentIP:    "192.168.155.71",
			want:         false,
		},
		{
			name:         "ignores empty current IP",
			advertisedIP: "192.168.3.224",
			currentIP:    "",
			want:         false,
		},
		{
			name:      "restarts when current IP appears after empty advertisement",
			currentIP: "192.168.155.71",
			want:      true,
		},
		{
			name:         "trims whitespace",
			advertisedIP: " 192.168.3.224 ",
			currentIP:    " 192.168.155.71 ",
			want:         true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldRestartBonjourForIPChange(tt.configuredIP, tt.advertisedIP, tt.currentIP)
			if got != tt.want {
				t.Fatalf("shouldRestartBonjourForIPChange() = %v, want %v", got, tt.want)
			}
		})
	}
}
