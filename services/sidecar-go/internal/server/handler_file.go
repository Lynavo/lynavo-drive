package server

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/store"
)

// handleFileData processes a FILE_DATA binary frame. The body layout is:
//
//	[2 bytes: fileKeyLen] [fileKeyLen bytes: fileKey] [8 bytes: offset] [remaining: data]
func (c *connection) handleFileData(hdr *protocol.FrameHeader, body []byte) error {
	if c.state != stateSyncing {
		return fmt.Errorf("FILE_DATA unexpected in state %d", c.state)
	}

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

	// Write data to .part file
	committedOffset, err := c.fileWriter.WriteAt(data, offset)
	if err != nil {
		return fmt.Errorf("write file data: %w", err)
	}

	if err := c.fileWriter.Sync(); err != nil {
		slog.Warn("file sync failed", "fileKey", fileKey, "err", err)
	}

	// Send FILE_ACK
	ack := protocol.FileAck{
		FileKey:         fileKey,
		CommittedOffset: committedOffset,
	}
	if err := c.sendJSON(protocol.TypeFileAck, ack); err != nil {
		return err
	}

	// Update store: upload progress + session active file
	if err := c.store.UpdateUploadProgress(fileKey, committedOffset); err != nil {
		slog.Warn("failed to update upload progress", "fileKey", fileKey, "err", err)
	}
	if err := c.store.UpdateSessionActiveFile(c.sessionID, fileKey, committedOffset); err != nil {
		slog.Warn("failed to update session active file", "sessionID", c.sessionID, "err", err)
	}

	// Emit progress event
	var progress int
	if c.fileWriter.expectedSize > 0 {
		progress = int(float64(committedOffset) / float64(c.fileWriter.expectedSize) * 100)
	}
	c.hub.Broadcast(events.Event{
		Type: "upload.progress",
		Payload: map[string]any{
			"clientId": c.clientID,
			"fileKey":  fileKey,
			"progress": progress,
		},
	})

	return nil
}

// handleFileEnd processes FILE_END_REQ. It verifies the SHA256 hash of the
// .part file and either finalizes it to the receive directory or cleans up
// on mismatch.
func (c *connection) handleFileEnd(body []byte) error {
	if c.state != stateSyncing {
		return fmt.Errorf("FILE_END_REQ unexpected in state %d", c.state)
	}

	var req protocol.FileEndReq
	if err := json.Unmarshal(body, &req); err != nil {
		return fmt.Errorf("parse FILE_END_REQ: %w", err)
	}

	if c.fileWriter == nil {
		return fmt.Errorf("FILE_END_REQ received but no file writer active")
	}

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

	// Close file before computing hash
	if err := c.fileWriter.Close(); err != nil {
		slog.Warn("failed to close file writer before hash", "err", err)
	}

	// Compute SHA256 of .part file
	computedHash, err := hashFile(c.fileWriter.PartPath())
	if err != nil {
		slog.Error("failed to hash .part file", "err", err)
		c.fileWriter.Cleanup()
		c.fileWriter = nil
		return c.sendJSON(protocol.TypeFileEndRes, protocol.FileEndRes{
			OK:      false,
			FileKey: req.FileKey,
		})
	}

	// Compare hashes
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
				"clientId": c.clientID,
				"fileKey":  req.FileKey,
				"reason":   "SHA256_MISMATCH",
			},
		})

		return c.sendJSON(protocol.TypeFileEndRes, protocol.FileEndRes{
			OK:      false,
			FileKey: req.FileKey,
		})
	}

	// SHA256 matches — finalize
	deviceAlias := c.clientID // fallback
	var oldDirName string
	if dev, err := c.store.GetPairedDevice(c.clientID); err == nil {
		if dev.DeviceAlias != nil && *dev.DeviceAlias != "" {
			deviceAlias = *dev.DeviceAlias
		} else {
			deviceAlias = dev.ClientName
		}
		if dev.ReceiveDirName != nil {
			oldDirName = *dev.ReceiveDirName
		}
	}

	// Migrate device directory if name changed
	newDirName := SanitizeDirName(deviceAlias)
	if oldDirName != "" && oldDirName != newDirName {
		MigrateDeviceDir(c.config.ReceiveDir, oldDirName, deviceAlias)
	}
	// Always update stored dir name
	_ = c.store.UpdateReceiveDirName(c.clientID, newDirName)

	date := time.Now().Format("2006-01-02")

	// Look up original filename from the upload record
	filename := req.FileKey // fallback
	if upload, err := c.store.GetUpload(req.FileKey); err == nil {
		filename = upload.OriginalFilename
	}

	relativePath, err := c.fileWriter.Finalize(c.config.ReceiveDir, deviceAlias, date, filename, req.FileKey)
	if err != nil {
		slog.Error("failed to finalize file", "fileKey", req.FileKey, "err", err)
		return c.sendJSON(protocol.TypeFileEndRes, protocol.FileEndRes{
			OK:      false,
			FileKey: req.FileKey,
		})
	}

	activeTransmissionMs := c.fileWriter.ElapsedMs()

	// Update store
	if err := c.store.CompleteUpload(req.FileKey, relativePath, req.SHA256, activeTransmissionMs); err != nil {
		slog.Warn("failed to complete upload in store", "fileKey", req.FileKey, "err", err)
	}

	// Update daily stats
	clientIP := extractIP(c.conn)
	clientName := c.clientID
	if dev, err := c.store.GetPairedDevice(c.clientID); err == nil {
		clientName = dev.ClientName
	}

	if err := c.store.UpsertDailyStats(store.DailyStats{
		StatDate:             date,
		ClientID:             c.clientID,
		ClientNameSnapshot:   clientName,
		ClientIPSnapshot:     clientIP,
		FileCount:            1,
		TotalBytes:           req.FileSize,
		ActiveTransmissionMs: activeTransmissionMs,
		UpdatedAt:            time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		slog.Warn("failed to upsert daily stats", "err", err)
	}

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
		StoredBytes:          req.FileSize,
		ActiveTransmissionMs: activeTransmissionMs,
	}); err != nil {
		return err
	}

	slog.Info("file transfer completed",
		"fileKey", req.FileKey,
		"relativePath", relativePath,
		"size", req.FileSize,
		"durationMs", activeTransmissionMs,
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

	if err := c.store.UpdateSessionState(c.sessionID, "completed"); err != nil {
		slog.Warn("failed to update session state", "sessionID", c.sessionID, "err", err)
	}

	c.hub.Broadcast(events.Event{
		Type: "device.state.changed",
		Payload: map[string]any{
			"clientId": c.clientID,
			"state":    "connected_idle",
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
