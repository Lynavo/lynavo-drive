package server

import (
	"errors"
	"fmt"
	"syscall"
	"testing"

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
