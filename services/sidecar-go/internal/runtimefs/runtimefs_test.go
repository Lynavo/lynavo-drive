package runtimefs

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/config"
)

func TestEnsureRuntimeDirsRecreatesManagedDirectories(t *testing.T) {
	root := t.TempDir()
	cfg := &config.Config{
		DataDir:    filepath.Join(root, "data"),
		ReceiveDir: filepath.Join(root, "Lynavo Drive", "received"),
	}

	result, err := EnsureRuntimeDirs(cfg)
	if err != nil {
		t.Fatalf("EnsureRuntimeDirs: %v", err)
	}

	for _, dir := range []string{
		cfg.DataDir,
		cfg.ReceiveDir,
		cfg.SharedDir(),
		cfg.StagingDir(),
		cfg.LogDir(),
	} {
		info, statErr := os.Stat(dir)
		if statErr != nil {
			t.Fatalf("Stat(%q): %v", dir, statErr)
		}
		if !info.IsDir() {
			t.Fatalf("%q is not a directory", dir)
		}
	}

	if len(result.Recreated) == 0 {
		t.Fatal("expected recreated directories to be reported")
	}
}

func TestEnsureRuntimeDirsReportsStatErrors(t *testing.T) {
	root := t.TempDir()
	dataFile := filepath.Join(root, "data-file")
	if err := os.WriteFile(dataFile, []byte("not a directory"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	cfg := &config.Config{
		DataDir:    dataFile,
		ReceiveDir: filepath.Join(root, "received"),
	}

	if _, err := EnsureRuntimeDirs(cfg); err == nil {
		t.Fatal("expected error when runtime path is a file")
	}
}

func TestEnsureCoreDirsDoesNotCreateMissingStorageRoot(t *testing.T) {
	root := t.TempDir()
	missingMount := filepath.Join(root, "MissingExternalDisk")
	cfg := &config.Config{
		DataDir:    filepath.Join(root, "data"),
		ReceiveDir: filepath.Join(missingMount, "Lynavo Drive", "received"),
	}

	result, err := EnsureCoreDirs(cfg)
	if err != nil {
		t.Fatalf("EnsureCoreDirs: %v", err)
	}

	for _, dir := range []string{cfg.DataDir, cfg.LogDir()} {
		if !result.RecreatedPath(dir) {
			t.Fatalf("expected core dir %q to be reported as recreated, got %v", dir, result.Recreated)
		}
		info, statErr := os.Stat(dir)
		if statErr != nil {
			t.Fatalf("Stat(%q): %v", dir, statErr)
		}
		if !info.IsDir() {
			t.Fatalf("%q is not a directory", dir)
		}
	}
	if _, err := os.Stat(missingMount); !os.IsNotExist(err) {
		t.Fatalf("expected missing storage mount not to be created, err=%v", err)
	}
}

func TestEnsureRuntimeDirsDoesNotCreateMissingManagedRootParent(t *testing.T) {
	root := t.TempDir()
	missingMount := filepath.Join(root, "MissingExternalDisk")
	cfg := &config.Config{
		DataDir:    filepath.Join(root, "data"),
		ReceiveDir: filepath.Join(missingMount, "Lynavo Drive", "received"),
	}

	if _, err := EnsureRuntimeDirs(cfg); err == nil {
		t.Fatal("expected missing managed root parent to fail")
	}
	if _, err := os.Stat(missingMount); !os.IsNotExist(err) {
		t.Fatalf("expected missing mount point not to be created, err=%v", err)
	}
}

func TestEnsureStorageDirsRecreatesStorageDirsWhenDataDirIsSeparate(t *testing.T) {
	root := t.TempDir()
	storageRoot := filepath.Join(root, "StorageRoot")
	if err := os.MkdirAll(storageRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", storageRoot, err)
	}
	cfg := &config.Config{
		DataDir:    filepath.Join(root, "data"),
		ReceiveDir: filepath.Join(storageRoot, "personal", "received"),
	}

	result, err := EnsureStorageDirs(cfg)
	if err != nil {
		t.Fatalf("EnsureStorageDirs: %v", err)
	}

	for _, dir := range []string{cfg.ReceiveDir, cfg.SharedDir(), cfg.StagingDir()} {
		if !result.RecreatedPath(dir) {
			t.Fatalf("expected %q to be reported as recreated, got %v", dir, result.Recreated)
		}
		info, statErr := os.Stat(dir)
		if statErr != nil {
			t.Fatalf("Stat(%q): %v", dir, statErr)
		}
		if !info.IsDir() {
			t.Fatalf("%q is not a directory", dir)
		}
	}

	if _, err := os.Stat(cfg.DataDir); !os.IsNotExist(err) {
		t.Fatalf("expected DataDir not to be created by EnsureStorageDirs, err=%v", err)
	}
}

func TestEnsureStorageDirsRejectsMissingDataDirRoot(t *testing.T) {
	root := t.TempDir()
	cfg := &config.Config{
		DataDir:    filepath.Join(root, "Lynavo Drive"),
		ReceiveDir: filepath.Join(root, "Lynavo Drive", "received"),
	}

	if _, err := EnsureStorageDirs(cfg); err == nil {
		t.Fatal("expected missing data-dir storage root to fail")
	}
	if _, err := os.Stat(cfg.DataDir); !os.IsNotExist(err) {
		t.Fatalf("expected DataDir not to be recreated, err=%v", err)
	}
}

func TestEnsureStorageDirsRejectsMissingDarwinVolumeRoot(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS /Volumes mount-point guard")
	}

	volumeRoot := filepath.Join("/Volumes", "LynavoDriveMissingVolumeForRuntimeFsTest")
	if _, err := os.Stat(volumeRoot); err == nil {
		t.Skipf("test volume root unexpectedly exists: %s", volumeRoot)
	} else if !os.IsNotExist(err) {
		t.Fatalf("Stat(%q): %v", volumeRoot, err)
	}

	cfg := &config.Config{
		DataDir:    filepath.Join(t.TempDir(), "data"),
		ReceiveDir: filepath.Join(volumeRoot, "received"),
	}

	if _, err := EnsureStorageDirs(cfg); err == nil {
		t.Fatal("expected missing /Volumes mount root to fail")
	}
	if _, err := os.Stat(volumeRoot); !os.IsNotExist(err) {
		t.Fatalf("expected missing volume root not to be recreated, err=%v", err)
	}
}
