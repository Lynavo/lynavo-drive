package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/protocol"
)

func TestIsDiskFullError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"posix enospc", syscall.ENOSPC, true},
		{"wrapped posix enospc", fmt.Errorf("write file data: %w", syscall.ENOSPC), true},
		{"windows error_disk_full errno", syscall.Errno(112), true},
		{"wrapped windows errno", fmt.Errorf("outer: %w", syscall.Errno(112)), true},
		{"windows message text", errors.New("write C:\\path\\file.part: There is not enough space on the disk."), true},
		{"posix message text", errors.New("write /tmp/file: no space left on device"), true},
		{"generic disk is full message", errors.New("disk is full"), true},
		{"unrelated network error", errors.New("connection reset by peer"), false},
		{"unrelated generic error", errors.New("something went wrong"), false},
		{"other errno (permission denied)", syscall.EACCES, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isDiskFullError(tc.err); got != tc.want {
				t.Fatalf("isDiskFullError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestFileInitRecreatesRuntimeDirsWhenUserDeletedRoot(t *testing.T) {
	client, _, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	moveReceiveRootForRuntimeStorageTest(t, cfg)
	doPairing(t, client)
	sessionID := "sess-recreate-runtime-dirs"
	cfg.LowDiskThresholdBytes = 1

	root := filepath.Dir(cfg.ReceiveDir)
	if err := os.RemoveAll(root); err != nil {
		t.Fatalf("RemoveAll(root): %v", err)
	}

	doSyncBegin(t, client, sessionID, 1, 1024)

	initRes := doFileInit(t, client, "file-recreate-dirs", "small.jpg", 1024)
	if initRes.Action != "UPLOAD" {
		t.Fatalf("expected Action=UPLOAD after runtime dirs are recreated, got %q reason=%q", initRes.Action, initRes.Reason)
	}

	for _, dir := range []string{cfg.ReceiveDir, cfg.SharedDir(), cfg.StagingDir()} {
		info, err := os.Stat(dir)
		if err != nil {
			t.Fatalf("Stat(%q): %v", dir, err)
		}
		if !info.IsDir() {
			t.Fatalf("%q is not a directory", dir)
		}
	}
}

func TestFileDataPausesWhenRuntimeDirsDisappearMidTransfer(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	moveReceiveRootForRuntimeStorageTest(t, cfg)
	doPairing(t, client)
	cfg.LowDiskThresholdBytes = 1
	fileKey := "file-runtime-dirs-deleted-data"
	payload := bytes.Repeat([]byte("a"), 1024)

	doSyncBegin(t, client, "sess-runtime-dirs-deleted-data", 1, int64(len(payload)))
	initRes := doFileInit(t, client, fileKey, "deleted-data.jpg", int64(len(payload)))
	if initRes.Action != "UPLOAD" {
		t.Fatalf("expected Action=UPLOAD, got %q reason=%q", initRes.Action, initRes.Reason)
	}

	if err := os.RemoveAll(filepath.Dir(cfg.ReceiveDir)); err != nil {
		t.Fatalf("RemoveAll(root): %v", err)
	}

	sendFileData(t, client, fileKey, 0, payload[:512])

	var errMsg protocol.ErrorMsg
	recvJSON(t, client, protocol.TypeError, &errMsg)
	if errMsg.Code != "STORAGE_UNAVAILABLE" {
		t.Fatalf("expected STORAGE_UNAVAILABLE error, got %q", errMsg.Code)
	}

	upload, err := st.GetUpload(fileKey)
	if err != nil {
		t.Fatalf("GetUpload: %v", err)
	}
	if upload.Status != "paused_resumable" {
		t.Fatalf("expected paused_resumable status, got %q", upload.Status)
	}
}

func TestFileEndPausesWhenRuntimeDirsDisappearBeforeFinalize(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	moveReceiveRootForRuntimeStorageTest(t, cfg)
	doPairing(t, client)
	cfg.LowDiskThresholdBytes = 1
	fileKey := "file-runtime-dirs-deleted-end"
	payload := bytes.Repeat([]byte("b"), 1024)

	doSyncBegin(t, client, "sess-runtime-dirs-deleted-end", 1, int64(len(payload)))
	initRes := doFileInit(t, client, fileKey, "deleted-end.jpg", int64(len(payload)))
	if initRes.Action != "UPLOAD" {
		t.Fatalf("expected Action=UPLOAD, got %q reason=%q", initRes.Action, initRes.Reason)
	}

	sendFileData(t, client, fileKey, 0, payload)
	var ack protocol.FileAck
	recvJSON(t, client, protocol.TypeFileAck, &ack)
	if ack.CommittedOffset != int64(len(payload)) {
		t.Fatalf("expected committed offset %d, got %d", len(payload), ack.CommittedOffset)
	}

	if err := os.RemoveAll(filepath.Dir(cfg.ReceiveDir)); err != nil {
		t.Fatalf("RemoveAll(root): %v", err)
	}

	hash := sha256.Sum256(payload)
	endRes := doFileEnd(t, client, fileKey, int64(len(payload)), hex.EncodeToString(hash[:]))
	if endRes.OK {
		t.Fatal("expected FileEndRes.OK=false")
	}
	if endRes.Reason != "STORAGE_UNAVAILABLE" {
		t.Fatalf("expected Reason=STORAGE_UNAVAILABLE, got %q", endRes.Reason)
	}

	upload, err := st.GetUpload(fileKey)
	if err != nil {
		t.Fatalf("GetUpload: %v", err)
	}
	if upload.Status != "paused_resumable" {
		t.Fatalf("expected paused_resumable status, got %q", upload.Status)
	}
}

func TestFileInitRejectsWhenReceiveRootIsDataDirAndDeleted(t *testing.T) {
	client, _, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	doPairing(t, client)
	cfg.LowDiskThresholdBytes = 1

	if err := os.RemoveAll(filepath.Dir(cfg.ReceiveDir)); err != nil {
		t.Fatalf("RemoveAll(root): %v", err)
	}

	doSyncBegin(t, client, "sess-data-dir-deleted", 1, 1024)

	initRes := doFileInit(t, client, "file-data-dir-deleted", "small.jpg", 1024)
	if initRes.Action != "REJECT" {
		t.Fatalf("expected Action=REJECT when receive root is missing data dir, got %q reason=%q", initRes.Action, initRes.Reason)
	}
	if initRes.Reason != "STORAGE_UNAVAILABLE" {
		t.Fatalf("expected Reason=STORAGE_UNAVAILABLE, got %q", initRes.Reason)
	}
}

func moveReceiveRootForRuntimeStorageTest(t *testing.T, cfg *config.Config) {
	t.Helper()

	rootParent := t.TempDir()
	cfg.ReceiveDir = filepath.Join(rootParent, "ViviDrop", "received")
	for _, dir := range []string{cfg.ReceiveDir, cfg.StagingDir(), cfg.SharedDir()} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("MkdirAll(%q): %v", dir, err)
		}
	}
}

// TestFileInitRejectsWhenFileWouldBreachSafetyFloor verifies the Z fix:
// FILE_INIT must reject an incoming file whose size would leave the disk
// below the configured safety threshold, not just when the disk is already
// below it at request time.
func TestFileInitRejectsWhenFileWouldBreachSafetyFloor(t *testing.T) {
	client, _, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	doPairing(t, client)
	sessionID := "sess-dynamic-threshold"
	// Configured safety floor is tiny so the disk is NOT low at request time.
	cfg.LowDiskThresholdBytes = 1
	// But the incoming file is astronomically large — bigger than any real
	// free space on any machine, so effectiveThreshold (= 1 + FileSize)
	// forces IsLow to return true.
	const enormousFileSize int64 = 1 << 62

	doSyncBegin(t, client, sessionID, 1, enormousFileSize)

	initRes := doFileInit(t, client, "file-too-big", "huge.mov", enormousFileSize)
	if initRes.Action != "REJECT" {
		t.Fatalf("expected Action=REJECT for file that would breach safety floor, got %q", initRes.Action)
	}
	if initRes.Reason != "LOW_DISK_PAUSED" {
		t.Fatalf("expected Reason=LOW_DISK_PAUSED, got %q", initRes.Reason)
	}
}

// TestFileInitAcceptsSmallFileWhenDiskHasAmpleRoom guards the other half of
// Z: a normal-sized file on a host with plenty of free space must NOT be
// rejected just because we now add FileSize into the threshold.
func TestFileInitAcceptsSmallFileWhenDiskHasAmpleRoom(t *testing.T) {
	client, _, cfg, cleanup := setupTestConnection(t)
	defer cleanup()

	doPairing(t, client)
	sessionID := "sess-small-file"
	cfg.LowDiskThresholdBytes = 1

	doSyncBegin(t, client, sessionID, 1, 1024)

	initRes := doFileInit(t, client, "file-normal", "small.jpg", 1024)
	if initRes.Action != "UPLOAD" {
		t.Fatalf("expected Action=UPLOAD for a 1KB file on a disk with room, got %q", initRes.Action)
	}
	// Avoid unused-import complaints if protocol ever gets pared back.
	_ = protocol.TypeFileInitRes
}
