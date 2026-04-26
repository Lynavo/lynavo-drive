package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/nicksyncflow/sidecar/internal/disk"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/runtimefs"
	"github.com/nicksyncflow/sidecar/internal/store"
	"github.com/nicksyncflow/sidecar/internal/uploadfs"
)

// handleSyncBegin processes SYNC_BEGIN_REQ, creating a session and
// transitioning to the syncing state.
func (c *connection) handleSyncBegin(body []byte) error {
	if c.state != stateAuthenticated {
		return fmt.Errorf("SYNC_BEGIN_REQ unexpected in state %d", c.state)
	}

	var req protocol.SyncBeginReq
	if err := json.Unmarshal(body, &req); err != nil {
		return fmt.Errorf("parse SYNC_BEGIN_REQ: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	clientName := c.clientID // fallback
	if dev, err := c.store.GetPairedDevice(c.clientID); err == nil {
		clientName = dev.ClientName
	}

	sess := store.Session{
		SessionID:  req.SessionID,
		ClientID:   c.clientID,
		ClientName: clientName,
		State:      "transferring",
		StartedAt:  now,
		UpdatedAt:  now,
	}
	if err := c.store.UpsertSession(sess); err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	c.sessionID = req.SessionID

	// Emit device state change
	c.hub.Broadcast(events.Event{
		Type: "device.state.changed",
		Payload: map[string]any{
			"deviceId": c.clientID,
			"status":   "transferring",
		},
	})

	if err := c.sendJSON(protocol.TypeSyncBeginRes, protocol.SyncBeginRes{OK: true}); err != nil {
		return err
	}

	slog.Info("sync session started",
		"sessionID", req.SessionID,
		"clientID", c.clientID,
		"queueCount", req.QueueTotalCount,
		"queueBytes", req.QueueTotalBytes,
	)
	c.state = stateSyncing
	if c.server != nil {
		c.server.SetClientState(c.clientID, "syncing")
	}
	return nil
}

// handleFileInit processes FILE_INIT_REQ. It checks disk space, determines
// whether the file should be uploaded fresh, resumed, or skipped, and creates
// the FileWriter for receiving data.
func (c *connection) handleFileInit(body []byte) error {
	if c.state != stateSyncing {
		return fmt.Errorf("FILE_INIT_REQ unexpected in state %d", c.state)
	}

	var req protocol.FileInitReq
	if err := json.Unmarshal(body, &req); err != nil {
		return fmt.Errorf("parse FILE_INIT_REQ: %w", err)
	}

	slog.Info("FILE_INIT_REQ received",
		"fileKey", req.FileKey,
		"filename", req.OriginalFilename,
		"size", req.FileSize,
		"queueIndex", req.QueueIndex,
	)

	if _, err := runtimefs.EnsureStorageDirs(c.config); err != nil {
		slog.Error("runtime storage unavailable during file init", "fileKey", req.FileKey, "err", err)
		c.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
		return c.sendJSON(protocol.TypeFileInitRes, protocol.FileInitRes{
			Action: "REJECT",
			Reason: "STORAGE_UNAVAILABLE",
		})
	}

	// Check disk space. Reserve the configured safety threshold *after* the
	// incoming file completes, so a single large file can't be accepted when
	// finishing it would leave the disk below the safety floor (and likely
	// race into ENOSPC mid-write).
	effectiveThreshold := c.config.LowDiskThresholdBytes
	if req.FileSize > 0 {
		effectiveThreshold += req.FileSize
	}
	isLow, remainingBytes, err := disk.IsLow(c.config.ReceiveDir, effectiveThreshold)
	if err != nil {
		slog.Warn("disk check failed, continuing", "err", err)
	} else if isLow {
		slog.Warn("low disk space, rejecting file",
			"fileKey", req.FileKey,
			"fileSize", req.FileSize,
			"remainingBytes", remainingBytes,
			"effectiveThreshold", effectiveThreshold,
		)
		c.hub.Broadcast(events.Event{
			Type: "disk.low",
			Payload: map[string]any{
				"remainingBytes": remainingBytes,
			},
		})
		c.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
		return c.sendJSON(protocol.TypeFileInitRes, protocol.FileInitRes{
			Action: "REJECT",
			Reason: "LOW_DISK_PAUSED",
		})
	}

	// Check existing upload
	existing, err := c.store.GetUpload(req.FileKey)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		slog.Warn("failed to check existing upload", "fileKey", req.FileKey, "err", err)
	}

	if existing != nil {
		if existing.Status == "completed" {
			if uploadfs.FinalFileExists(c.config.ReceiveDir, existing.FinalPath) {
				slog.Info("file already completed, skipping", "fileKey", req.FileKey)
				return c.sendJSON(protocol.TypeFileInitRes, protocol.FileInitRes{
					Action: "SKIP",
				})
			}

			slog.Warn("completed upload missing finalized file, restarting transfer",
				"fileKey", req.FileKey,
				"finalPath", existing.FinalPath,
			)
			existing = nil
		}
		if existing != nil && existing.CommittedBytes > 0 {
			// Partial upload — resume
			fw, err := NewFileWriter(c.config.StagingDir(), c.clientID, req.FileKey, req.FileSize)
			if err != nil {
				return fmt.Errorf("create file writer for resume: %w", err)
			}
			c.fileWriter = fw

			// Resume offset must match on-disk .part size to avoid stale DB offsets.
			resumeOffset := fw.CommittedOffset()
			if resumeOffset > req.FileSize {
				resumeOffset = req.FileSize
			}
			if resumeOffset != existing.CommittedBytes {
				slog.Info("adjusted resume offset to on-disk size",
					"fileKey", req.FileKey,
					"dbOffset", existing.CommittedBytes,
					"diskOffset", fw.CommittedOffset(),
					"resumeOffset", resumeOffset,
				)
				if err := c.store.UpdateUploadProgress(req.FileKey, resumeOffset); err != nil {
					slog.Warn("failed to reconcile upload progress offset", "fileKey", req.FileKey, "err", err)
				}
			}
			c.resetProgressFlush(req.FileKey, resumeOffset)
			c.startTransferTimer(req.FileKey)
			c.resetAckState(req.FileKey, resumeOffset)

			slog.Info("resuming partial upload",
				"fileKey", req.FileKey,
				"committedBytes", resumeOffset,
			)
			return c.sendJSON(protocol.TypeFileInitRes, protocol.FileInitRes{
				Action:       "RESUME",
				ResumeOffset: resumeOffset,
			})
		}
	}

	// Fresh upload
	now := time.Now().UTC().Format(time.RFC3339)
	sessionID := c.sessionID
	upload := store.Upload{
		FileKey:          req.FileKey,
		SessionID:        &sessionID,
		ClientID:         c.clientID,
		OriginalFilename: req.OriginalFilename,
		MediaType:        req.MediaType,
		FileSize:         req.FileSize,
		CreatedAtRemote:  &req.CreatedAt,
		ModifiedAtRemote: &req.ModifiedAt,
		Status:           "receiving",
		CommittedBytes:   0,
		UpdatedAt:        now,
	}
	if err := c.store.UpsertUpload(upload); err != nil {
		return fmt.Errorf("create upload record: %w", err)
	}

	fw, err := NewFileWriter(c.config.StagingDir(), c.clientID, req.FileKey, req.FileSize)
	if err != nil {
		return fmt.Errorf("create file writer: %w", err)
	}
	c.fileWriter = fw
	c.resetProgressFlush(req.FileKey, 0)
	c.startTransferTimer(req.FileKey)
	c.resetAckState(req.FileKey, 0)

	return c.sendJSON(protocol.TypeFileInitRes, protocol.FileInitRes{
		Action: "UPLOAD",
	})
}
