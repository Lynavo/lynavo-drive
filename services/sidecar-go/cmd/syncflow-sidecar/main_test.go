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

	bootstrapReconciliation(st, &config.Config{
		DataDir:    dataDir,
		ReceiveDir: filepath.Join(dataDir, "received"),
		DeviceName: "test-device",
	})

	updated, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig(updated): %v", err)
	}
	if updated.ReceiveRoot != filepath.Join(dataDir, "received") {
		t.Fatalf("ReceiveRoot = %q, want %q", updated.ReceiveRoot, filepath.Join(dataDir, "received"))
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

	bootstrapReconciliation(st, &config.Config{
		DataDir:    dataDir,
		ReceiveDir: filepath.Join(dataDir, "received"),
		DeviceName: "test-device",
	})

	updated, err := st.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig(updated): %v", err)
	}
	if updated.ReceiveRoot != filepath.Join(dir, "custom-received") {
		t.Fatalf("ReceiveRoot = %q, want %q", updated.ReceiveRoot, filepath.Join(dir, "custom-received"))
	}
}
