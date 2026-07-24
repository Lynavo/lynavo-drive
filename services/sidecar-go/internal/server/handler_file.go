package server

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/disk"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/events"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/protocol"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/runtimefs"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
)

// windowsErrorDiskFull mirrors the Windows system error code returned when a
// write fails because the volume is full. Defined as a constant so the check
// compiles on non-Windows platforms too.
const windowsErrorDiskFull syscall.Errno = 112

// isDiskFullError reports whether err represents an out-of-space condition.
// It combines the canonical POSIX ENOSPC check, a raw Windows ERROR_DISK_FULL
// errno probe, and a last-resort message sniff to cover cases where the
// underlying platform layer returns an uncategorised error whose string still
// reveals the cause (seen on Windows via os.File.WriteAt in our field logs).
func isDiskFullError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, syscall.ENOSPC) {
		return true
	}
	var errno syscall.Errno
	if errors.As(err, &errno) && errno == windowsErrorDiskFull {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no space left") ||
		strings.Contains(msg, "not enough space on the disk") ||
		strings.Contains(msg, "disk is full")
}

var (
	uploadPerfLoggingOnce    sync.Once
	uploadPerfLoggingEnabled bool
)

func sidecarUploadPerfLoggingEnabled() bool {
	uploadPerfLoggingOnce.Do(func() {
		raw := strings.TrimSpace(os.Getenv("LYNAVO_UPLOAD_PERF_LOG"))
		switch strings.ToLower(raw) {
		case "1", "true", "yes", "on":
			uploadPerfLoggingEnabled = true
		}
	})
	return uploadPerfLoggingEnabled
}

func sidecarPerfLog(msg string, args ...any) {
	if sidecarUploadPerfLoggingEnabled() {
		slog.Info(msg, args...)
	}
}

// handleFileData processes a FILE_DATA binary frame. The body layout is:
//
//	[2 bytes: fileKeyLen] [fileKeyLen bytes: fileKey] [8 bytes: offset] [remaining: data]
func (c *connection) handleFileData(hdr *protocol.FrameHeader, body []byte) error {
	if c.state != stateSyncing {
		return fmt.Errorf("FILE_DATA unexpected in state %d", c.state)
	}
	frameStart := time.Now()

	// Parse binary body with bounds checking
	if len(body) < 2 {
		return fmt.Errorf("FILE_DATA too short for fileKeyLen")
	}
	fileKeyLen := int(binary.BigEndian.Uint16(body[0:2]))

	if len(body) < 2+fileKeyLen+8 {
		return fmt.Errorf("FILE_DATA too short for fileKey + offset")
	}
	fileKey := string(body[2 : 2+fileKeyLen])
	offset := int64(binary.BigEndian.Uint64(body[2+fileKeyLen : 2+fileKeyLen+8]))
	data := body[2+fileKeyLen+8:]

	if c.fileWriter == nil {
		return fmt.Errorf("FILE_DATA received but no file writer active")
	}

	if err := c.activeTransferStorageError(); err != nil {
		return c.pauseTransferForStorageUnavailable(fileKey, err)
	}

	isLow, remainingBytes, err := disk.IsLow(c.config.ReceiveDir, c.config.LowDiskThresholdBytes)
	if err != nil {
		slog.Warn("disk check failed during file transfer, continuing", "fileKey", fileKey, "err", err)
	} else if isLow {
		return c.pauseTransferForLowDisk(fileKey, remainingBytes)
	}

	// Write data to .part file
	writeStart := time.Now()
	committedOffset, err := c.fileWriter.WriteAt(data, offset)
	writeElapsed := time.Since(writeStart)
	if err != nil {
		if isDiskFullError(err) {
			// The pre-check at the top of this handler (and the one at
			// FILE_INIT) looked OK, but the OS layer still ran out of room
			// mid-write. Route through the structured pause path so the
			// client receives LOW_DISK_PAUSED instead of a raw write error
			// that would be classified as a retryable network fault.
			_, remainingBytes, checkErr := disk.IsLow(c.config.ReceiveDir, c.config.LowDiskThresholdBytes)
			if checkErr != nil {
				remainingBytes = 0
			}
			slog.Warn("write failed due to disk full, routing to low-disk pause",
				"fileKey", fileKey,
				"offset", offset,
				"remainingBytes", remainingBytes,
				"err", err,
			)
			return c.pauseTransferForLowDisk(fileKey, remainingBytes)
		}
		return fmt.Errorf("write file data: %w", err)
	}

	syncStart := time.Now()
	if err := c.fileWriter.MaybeSync(); err != nil {
		slog.Warn("file periodic sync failed", "fileKey", fileKey, "err", err)
	}
	syncElapsed := time.Since(syncStart)

	// Send coalesced FILE_ACK to reduce control-frame overhead.
	ackSent := false
	var ackElapsed time.Duration
	if c.shouldSendAck(fileKey, committedOffset) {
		ack := protocol.FileAck{
			FileKey:         fileKey,
			CommittedOffset: committedOffset,
		}
		ackStart := time.Now()
		if err := c.sendJSON(protocol.TypeFileAck, ack); err != nil {
			return err
		}
		c.markAckSent(fileKey, committedOffset)
		ackElapsed = time.Since(ackStart)
		ackSent = true
	} else {
		c.scheduleAckFlush(fileKey, committedOffset)
	}

	// Persist progress with throttling to reduce SQLite write pressure.
	progressStart := time.Now()
	if err := c.maybeFlushProgress(fileKey, committedOffset); err != nil {
		slog.Warn("failed to persist throttled upload progress", "fileKey", fileKey, "err", err)
	}
	progressElapsed := time.Since(progressStart)

	// Emit progress event
	var progress int
	if c.fileWriter.expectedSize > 0 {
		progress = int(float64(committedOffset) / float64(c.fileWriter.expectedSize) * 100)
	}
	c.hub.Broadcast(events.Event{
		Type: "upload.progress",
		Payload: map[string]any{
			"deviceId": c.clientID,
			"fileKey":  fileKey,
			"progress": progress,
		},
	})

	sidecarPerfLog("upload perf frame",
		"clientID", c.clientID,
		"fileKey", fileKey,
		"offset", offset,
		"chunkBytes", len(data),
		"committedOffset", committedOffset,
		"writeMs", writeElapsed.Milliseconds(),
		"syncMs", syncElapsed.Milliseconds(),
		"ackSent", ackSent,
		"ackMs", ackElapsed.Milliseconds(),
		"progressMs", progressElapsed.Milliseconds(),
		"frameMs", time.Since(frameStart).Milliseconds(),
	)

	return nil
}

func (c *connection) pauseTransferForLowDisk(fileKey string, remainingBytes uint64) error {
	committedOffset := int64(0)
	if c.fileWriter != nil {
		committedOffset = c.fileWriter.CommittedOffset()
	}

	transmissionMs := c.transferElapsedMs(fileKey)
	if transmissionMs <= 0 && c.fileWriter != nil {
		transmissionMs = c.fileWriter.ElapsedMs()
	}

	slog.Warn("low disk space detected during file transfer, pausing upload",
		"fileKey", fileKey,
		"remainingBytes", remainingBytes,
		"committedOffset", committedOffset,
	)

	if fileKey != "" {
		if err := c.flushProgress(fileKey, committedOffset); err != nil {
			slog.Warn("failed to flush upload progress before low disk pause", "fileKey", fileKey, "err", err)
		}
		if err := c.store.PauseUploadForLowDisk(fileKey, committedOffset, transmissionMs); err != nil {
			slog.Warn("failed to mark upload paused for low disk", "fileKey", fileKey, "err", err)
		}
	}

	c.clearTransferTimer(fileKey)
	c.clearAckState(fileKey)

	if c.fileWriter != nil {
		if err := c.fileWriter.Close(); err != nil {
			slog.Warn("failed to close file writer after low disk pause", "fileKey", fileKey, "err", err)
		}
		c.fileWriter = nil
	}

	c.hub.Broadcast(events.Event{
		Type: "disk.low",
		Payload: map[string]any{
			"remainingBytes": remainingBytes,
		},
	})
	c.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})

	return c.sendError("LOW_DISK_PAUSED", fmt.Sprintf("remaining disk bytes %d below threshold", remainingBytes))
}

func (c *connection) pauseTransferForStorageUnavailable(fileKey string, cause error) error {
	c.markTransferPausedForStorageUnavailable(fileKey, cause)
	return c.sendError("STORAGE_UNAVAILABLE", "desktop receive directory is unavailable")
}

func (c *connection) activeTransferStorageError() error {
	result, err := runtimefs.EnsureStorageDirs(c.config)
	if err != nil {
		return err
	}
	if result.RecreatedPath(c.config.ReceiveDir) || result.RecreatedPath(c.config.StagingDir()) {
		return errors.New("runtime upload directory was recreated")
	}
	if c.fileWriter != nil {
		if _, err := os.Stat(c.fileWriter.PartPath()); err != nil {
			return fmt.Errorf("part file unavailable: %w", err)
		}
	}
	return nil
}

func (c *connection) markTransferPausedForStorageUnavailable(fileKey string, cause error) {
	committedOffset := int64(0)
	if c.fileWriter != nil {
		committedOffset = c.fileWriter.CommittedOffset()
	}

	transmissionMs := c.transferElapsedMs(fileKey)
	if transmissionMs <= 0 && c.fileWriter != nil {
		transmissionMs = c.fileWriter.ElapsedMs()
	}

	slog.Warn("storage unavailable during file transfer, pausing upload",
		"fileKey", fileKey,
		"committedOffset", committedOffset,
		"err", cause,
	)

	if fileKey != "" {
		if err := c.flushProgress(fileKey, committedOffset); err != nil {
			slog.Warn("failed to flush upload progress before storage pause", "fileKey", fileKey, "err", err)
		}
		if err := c.store.PauseUploadResumable(fileKey, committedOffset, transmissionMs); err != nil {
			slog.Warn("failed to mark upload paused for storage unavailable", "fileKey", fileKey, "err", err)
		}
	}

	c.clearTransferTimer(fileKey)
	c.clearAckState(fileKey)

	if c.fileWriter != nil {
		if err := c.fileWriter.Close(); err != nil {
			slog.Warn("failed to close file writer after storage pause", "fileKey", fileKey, "err", err)
		}
		c.fileWriter = nil
	}

	c.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
}

// handleFileEnd processes FILE_END_REQ. It verifies the SHA256 hash of the
// .part file and either finalizes it to the receive directory or cleans up
// on mismatch.
func (c *connection) handleFileEnd(body []byte) error {
	if c.state != stateSyncing {
		return fmt.Errorf("FILE_END_REQ unexpected in state %d", c.state)
	}
	fileEndStart := time.Now()

	var req protocol.FileEndReq
	if err := json.Unmarshal(body, &req); err != nil {
		return fmt.Errorf("parse FILE_END_REQ: %w", err)
	}

	if c.fileWriter == nil {
		return fmt.Errorf("FILE_END_REQ received but no file writer active")
	}
	defer c.clearTransferTimer(req.FileKey)
	defer c.clearAckState(req.FileKey)

	slog.Info("FILE_END_REQ received",
		"fileKey", req.FileKey,
		"fileSize", req.FileSize,
		"sha256", req.SHA256,
	)

	// Verify file size
	if c.fileWriter.CommittedOffset() != req.FileSize {
		slog.Warn("file size mismatch",
			"expected", req.FileSize,
			"actual", c.fileWriter.CommittedOffset(),
		)
	}

	// Ensure final progress is persisted for reliable resume metadata.
	flushProgressStart := time.Now()
	if err := c.flushProgress(req.FileKey, c.fileWriter.CommittedOffset()); err != nil {
		slog.Warn("failed to flush final upload progress", "fileKey", req.FileKey, "err", err)
	}
	flushProgressElapsed := time.Since(flushProgressStart)

	// Force flush staged bytes at file boundary.
	forceSyncStart := time.Now()
	if err := c.fileWriter.ForceSync(); err != nil {
		slog.Warn("failed to force sync part file before close", "fileKey", req.FileKey, "err", err)
	}
	forceSyncElapsed := time.Since(forceSyncStart)

	// Close file before computing hash
	closeStart := time.Now()
	if err := c.fileWriter.Close(); err != nil {
		slog.Warn("failed to close file writer before hash", "err", err)
	}
	closeElapsed := time.Since(closeStart)

	if err := c.activeTransferStorageError(); err != nil {
		slog.Error("runtime storage unavailable before hash", "fileKey", req.FileKey, "err", err)
		c.markTransferPausedForStorageUnavailable(req.FileKey, err)
		return c.sendJSON(protocol.TypeFileEndRes, protocol.FileEndRes{
			OK:      false,
			FileKey: req.FileKey,
			Reason:  "STORAGE_UNAVAILABLE",
		})
	}

	// Compute and verify SHA256 only if client provided one (empty = skipped for speed)
	computedHash := ""
	hashElapsed := time.Duration(0)
	if req.SHA256 != "" {
		var err error
		hashStart := time.Now()
		computedHash, err = hashFile(c.fileWriter.PartPath())
		hashElapsed = time.Since(hashStart)
		if err != nil {
			slog.Error("failed to hash .part file", "err", err)
			c.fileWriter.Cleanup()
			c.fileWriter = nil
			return c.sendJSON(protocol.TypeFileEndRes, protocol.FileEndRes{
				OK:      false,
				FileKey: req.FileKey,
			})
		}

		if computedHash != req.SHA256 {
			slog.Warn("SHA256 mismatch",
				"fileKey", req.FileKey,
				"expected", req.SHA256,
				"computed", computedHash,
			)
			c.fileWriter.Cleanup()
			c.fileWriter = nil

			// Update upload status to failed
			if err := c.store.UpsertUpload(store.Upload{
				FileKey:   req.FileKey,
				ClientID:  c.clientID,
				Status:    "failed",
				UpdatedAt: time.Now().UTC().Format(time.RFC3339),
			}); err != nil {
				slog.Warn("failed to mark upload as failed", "err", err)
			}

			c.hub.Broadcast(events.Event{
				Type: "upload.failed",
				Payload: map[string]any{
					"deviceId": c.clientID,
					"fileKey":  req.FileKey,
					"reason":   "SHA256_MISMATCH",
				},
			})

			return c.sendJSON(protocol.TypeFileEndRes, protocol.FileEndRes{
				OK:      false,
				FileKey: req.FileKey,
			})
		}
	} else {
		slog.Info("SHA256 skipped by client, relying on file size validation",
			"fileKey", req.FileKey,
			"fileSize", req.FileSize,
		)
	}

	// Get stable receive directory name (guaranteed non-empty by EnsureReceiveDirName)
	if err := c.activeTransferStorageError(); err != nil {
		slog.Error("runtime storage unavailable before finalize", "fileKey", req.FileKey, "err", err)
		c.markTransferPausedForStorageUnavailable(req.FileKey, err)
		return c.sendJSON(protocol.TypeFileEndRes, protocol.FileEndRes{
			OK:      false,
			FileKey: req.FileKey,
			Reason:  "STORAGE_UNAVAILABLE",
		})
	}

	dirName, err := EnsureReceiveDirName(c.store, c.config.ReceiveDir, c.clientID)
	if err != nil {
		return fmt.Errorf("ensure receive dir name: %w", err)
	}

	date := time.Now().Format("2006-01-02")

	// Look up original filename from the upload record
	filename := req.FileKey // fallback
	if upload, err := c.store.GetUpload(req.FileKey); err == nil {
		filename = upload.OriginalFilename
	}

	finalizeStart := time.Now()
	relativePath, err := c.fileWriter.Finalize(c.config.ReceiveDir, dirName, date, filename, req.FileKey)
	finalizeElapsed := time.Since(finalizeStart)
	if err != nil {
		slog.Error("failed to finalize file", "fileKey", req.FileKey, "err", err)
		c.markTransferPausedForStorageUnavailable(req.FileKey, err)
		return c.sendJSON(protocol.TypeFileEndRes, protocol.FileEndRes{
			OK:      false,
			FileKey: req.FileKey,
			Reason:  "STORAGE_UNAVAILABLE",
		})
	}

	thisSegmentMs := c.transferElapsedMs(req.FileKey)
	if thisSegmentMs <= 0 {
		// Fallback for older/incomplete timing state.
		thisSegmentMs = c.fileWriter.ElapsedMs()
	}

	// Update store (accumulates active_transmission_ms)
	storeCompleteStart := time.Now()
	if err := c.store.CompleteUpload(req.FileKey, relativePath, req.SHA256, thisSegmentMs); err != nil {
		slog.Warn("failed to complete upload in store", "fileKey", req.FileKey, "err", err)
	} else {
		absoluteFinalPath := filepath.Join(c.config.ReceiveDir, relativePath)
		if err := c.store.RecordDeviceReceiveLocation(
			c.clientID,
			filepath.Dir(filepath.Dir(absoluteFinalPath)),
			time.Now().UTC().Format(time.RFC3339),
		); err != nil {
			slog.Warn("failed to record device receive location", "fileKey", req.FileKey, "err", err)
			if invalidateErr := c.store.InvalidateDeviceReceiveLocationBackfill(c.clientID); invalidateErr != nil {
				slog.Warn(
					"failed to invalidate device receive location backfill",
					"fileKey", req.FileKey,
					"err", invalidateErr,
				)
			}
		}
	}
	storeCompleteElapsed := time.Since(storeCompleteStart)

	// Update daily stats
	clientIP := c.clientIP
	if clientIP == "" {
		clientIP = extractIP(c.conn)
	}
	clientName := c.clientID
	if dev, err := c.store.GetPairedDevice(c.clientID); err == nil {
		clientName = dev.ClientName
	}

	// Read back accumulated total transmission time
	var totalTransmissionMs int64 = thisSegmentMs
	if upload, err := c.store.GetUpload(req.FileKey); err == nil {
		totalTransmissionMs = upload.ActiveTransmissionMs
	}

	dailyStatsStart := time.Now()
	if err := c.store.UpsertDailyStats(store.DailyStats{
		StatDate:             date,
		ClientID:             c.clientID,
		ClientNameSnapshot:   clientName,
		ClientIPSnapshot:     clientIP,
		FileCount:            1,
		TotalBytes:           req.FileSize,
		ActiveTransmissionMs: totalTransmissionMs,
		UpdatedAt:            time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		slog.Warn("failed to upsert daily stats", "err", err)
	}
	dailyStatsElapsed := time.Since(dailyStatsStart)

	// Emit events
	c.hub.Broadcast(events.Event{
		Type: "upload.completed",
		Payload: map[string]any{
			"clientId":     c.clientID,
			"fileKey":      req.FileKey,
			"relativePath": relativePath,
			"storedBytes":  req.FileSize,
		},
	})
	c.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
	c.hub.Broadcast(events.Event{Type: "history.updated", Payload: nil})

	// Send response
	if err := c.sendJSON(protocol.TypeFileEndRes, protocol.FileEndRes{
		OK:                   true,
		FileKey:              req.FileKey,
		RelativePath:         relativePath,
		LedgerDate:           date,
		StoredBytes:          req.FileSize,
		ActiveTransmissionMs: totalTransmissionMs,
	}); err != nil {
		return err
	}

	slog.Info("file transfer completed",
		"fileKey", req.FileKey,
		"relativePath", relativePath,
		"size", req.FileSize,
		"durationMs", totalTransmissionMs,
	)
	sidecarPerfLog("upload perf file complete",
		"clientID", c.clientID,
		"fileKey", req.FileKey,
		"fileSize", req.FileSize,
		"flushProgressMs", flushProgressElapsed.Milliseconds(),
		"forceSyncMs", forceSyncElapsed.Milliseconds(),
		"closeMs", closeElapsed.Milliseconds(),
		"hashMs", hashElapsed.Milliseconds(),
		"finalizeMs", finalizeElapsed.Milliseconds(),
		"completeUploadMs", storeCompleteElapsed.Milliseconds(),
		"dailyStatsMs", dailyStatsElapsed.Milliseconds(),
		"activeTransmissionMs", totalTransmissionMs,
		"totalMs", time.Since(fileEndStart).Milliseconds(),
	)

	c.fileWriter = nil
	return nil
}

// handleSyncEnd processes SYNC_END_REQ, marking the session as completed
// and returning to the authenticated state.
func (c *connection) handleSyncEnd(body []byte) error {
	if c.state != stateSyncing {
		return fmt.Errorf("SYNC_END_REQ unexpected in state %d", c.state)
	}

	if err := c.store.CompleteSession(c.sessionID); err != nil {
		slog.Warn("failed to update session state", "sessionID", c.sessionID, "err", err)
	}

	// Update live TCP state back to connected
	if c.server != nil {
		c.server.SetClientState(c.clientID, "connected")
	}

	c.hub.Broadcast(events.Event{
		Type: "device.state.changed",
		Payload: map[string]any{
			"deviceId": c.clientID,
			"status":   "connected_idle",
		},
	})

	if err := c.sendJSON(protocol.TypeSyncEndRes, protocol.SyncEndRes{OK: true}); err != nil {
		return err
	}

	slog.Info("sync session ended", "sessionID", c.sessionID, "clientID", c.clientID)
	c.state = stateAuthenticated
	return nil
}

// hashFile computes the hex-encoded SHA256 hash of the file at path.
func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
