package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const maxWrongConnectionCodeAttempts = 5

func (s *Store) RecordConnectionAttempt(attempt ConnectionAttempt) (DeviceBlockState, error) {
	switch attempt.Result {
	case "success", "wrong_code", "blocked":
	default:
		return DeviceBlockState{}, fmt.Errorf("unsupported connection attempt result %q", attempt.Result)
	}
	if attempt.AttemptedAt == "" {
		attempt.AttemptedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if _, err := s.db.Exec(`
		INSERT INTO connection_attempts
			(desktop_device_id, client_id, client_name, result, failure_reason, attempted_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		attempt.DesktopDeviceID, attempt.ClientID, attempt.ClientName, attempt.Result,
		attempt.FailureReason, attempt.AttemptedAt,
	); err != nil {
		return DeviceBlockState{}, fmt.Errorf("record connection attempt: %w", err)
	}

	switch attempt.Result {
	case "success":
		current, err := s.GetDeviceBlockState(attempt.DesktopDeviceID, attempt.ClientID)
		if err != nil {
			return DeviceBlockState{}, err
		}
		if current.Blocked {
			return current, nil
		}
		if err := s.ClearConnectionAttempts(attempt.DesktopDeviceID, attempt.ClientID); err != nil {
			return DeviceBlockState{}, err
		}
	case "wrong_code":
		if err := s.recordWrongCodeAttempt(attempt); err != nil {
			return DeviceBlockState{}, err
		}
	case "blocked":
		// The device is already blocked. The audit row above is enough.
	}

	return s.GetDeviceBlockState(attempt.DesktopDeviceID, attempt.ClientID)
}

func (s *Store) recordWrongCodeAttempt(attempt ConnectionAttempt) error {
	now := time.Now().UTC().Format(time.RFC3339)
	reason := "wrong_code"
	if attempt.FailureReason != nil && *attempt.FailureReason != "" {
		reason = *attempt.FailureReason
	}

	_, err := s.db.Exec(`
		INSERT INTO device_blocks
			(desktop_device_id, client_id, reason, failed_attempt_count, blocked_at, manually_unblocked_at, updated_at)
		VALUES (?, ?, ?, 1, NULL, NULL, ?)
		ON CONFLICT(desktop_device_id, client_id) DO UPDATE SET
			reason = CASE
				WHEN device_blocks.blocked_at IS NOT NULL AND device_blocks.manually_unblocked_at IS NULL
					THEN device_blocks.reason
				ELSE excluded.reason
			END,
			failed_attempt_count = CASE
				WHEN device_blocks.blocked_at IS NOT NULL AND device_blocks.manually_unblocked_at IS NULL
					THEN device_blocks.failed_attempt_count
				ELSE MIN(device_blocks.failed_attempt_count + 1, ?)
			END,
			blocked_at = CASE
				WHEN device_blocks.blocked_at IS NOT NULL AND device_blocks.manually_unblocked_at IS NULL
					THEN device_blocks.blocked_at
				WHEN device_blocks.failed_attempt_count + 1 >= ?
					THEN excluded.updated_at
				ELSE NULL
			END,
			manually_unblocked_at = CASE
				WHEN device_blocks.blocked_at IS NOT NULL AND device_blocks.manually_unblocked_at IS NULL
					THEN device_blocks.manually_unblocked_at
				ELSE NULL
			END,
			updated_at = CASE
				WHEN device_blocks.blocked_at IS NOT NULL AND device_blocks.manually_unblocked_at IS NULL
					THEN device_blocks.updated_at
				ELSE excluded.updated_at
			END`,
		attempt.DesktopDeviceID, attempt.ClientID, reason, now,
		maxWrongConnectionCodeAttempts, maxWrongConnectionCodeAttempts,
	)
	if err != nil {
		return fmt.Errorf("record wrong code attempt: %w", err)
	}
	return nil
}

func (s *Store) GetDeviceBlockState(desktopDeviceID, clientID string) (DeviceBlockState, error) {
	state := DeviceBlockState{
		DesktopDeviceID:    desktopDeviceID,
		ClientID:           clientID,
		RemainingAttempts:  maxWrongConnectionCodeAttempts,
		FailedAttemptCount: 0,
	}
	var reason string
	var manuallyUnblockedAt *string
	err := s.db.QueryRow(`
		SELECT reason, failed_attempt_count, blocked_at, manually_unblocked_at
		FROM device_blocks
		WHERE desktop_device_id = ? AND client_id = ?`,
		desktopDeviceID, clientID,
	).Scan(&reason, &state.FailedAttemptCount, &state.BlockedAt, &manuallyUnblockedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return state, nil
		}
		return DeviceBlockState{}, fmt.Errorf("get device block state: %w", err)
	}

	if reason != "" {
		state.Reason = &reason
	}
	state.Blocked = state.BlockedAt != nil && manuallyUnblockedAt == nil
	if state.Blocked {
		state.RemainingAttempts = 0
		return state, nil
	}
	state.RemainingAttempts = maxWrongConnectionCodeAttempts - state.FailedAttemptCount
	if state.RemainingAttempts < 0 {
		state.RemainingAttempts = 0
	}
	return state, nil
}

func (s *Store) UnblockDevice(desktopDeviceID, clientID string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`
		INSERT INTO device_blocks
			(desktop_device_id, client_id, reason, failed_attempt_count, blocked_at, manually_unblocked_at, updated_at)
		VALUES (?, ?, '', 0, NULL, ?, ?)
		ON CONFLICT(desktop_device_id, client_id) DO UPDATE SET
			reason = '',
			failed_attempt_count = 0,
			blocked_at = NULL,
			manually_unblocked_at = excluded.manually_unblocked_at,
			updated_at = excluded.updated_at`,
		desktopDeviceID, clientID, now, now,
	)
	if err != nil {
		return fmt.Errorf("unblock device: %w", err)
	}
	return nil
}

func (s *Store) ClearConnectionAttempts(desktopDeviceID, clientID string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`
		INSERT INTO device_blocks
			(desktop_device_id, client_id, reason, failed_attempt_count, blocked_at, manually_unblocked_at, updated_at)
		VALUES (?, ?, '', 0, NULL, NULL, ?)
		ON CONFLICT(desktop_device_id, client_id) DO UPDATE SET
			reason = '',
			failed_attempt_count = 0,
			blocked_at = NULL,
			manually_unblocked_at = NULL,
			updated_at = excluded.updated_at
		WHERE NOT (
			device_blocks.blocked_at IS NOT NULL
			AND device_blocks.manually_unblocked_at IS NULL
		)`,
		desktopDeviceID, clientID, now,
	)
	if err != nil {
		return fmt.Errorf("clear connection attempts: %w", err)
	}
	return nil
}

func (s *Store) ListManagedDevices(desktopDeviceID string) ([]ManagedDevice, error) {
	rows, err := s.db.Query(`
		SELECT
			p.client_id, p.client_name, p.device_alias, p.last_ip, p.platform, p.created_at,
			p.last_seen_at, p.revoked_at, p.stable_device_id,
			COUNT(u.file_key),
			COALESCE(SUM(u.file_size), 0),
			COUNT(CASE WHEN DATE(u.updated_at, 'localtime') = DATE('now', 'localtime') THEN u.file_key END),
			COALESCE(SUM(CASE WHEN DATE(u.updated_at, 'localtime') = DATE('now', 'localtime') THEN u.file_size ELSE 0 END), 0)
		FROM paired_devices p
		LEFT JOIN uploads u ON u.client_id = p.client_id AND u.status = 'completed'
		GROUP BY p.client_id
		ORDER BY p.last_seen_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list managed devices: %w", err)
	}
	defer rows.Close()

	devices := make([]ManagedDevice, 0)
	for rows.Next() {
		var device ManagedDevice
		var alias *string
		var revokedAt *string
		if err := rows.Scan(
			&device.ClientID, &device.DisplayName, &alias, &device.LastIP, &device.Platform,
			&device.AuthorizedAt, &device.LastSeenAt, &revokedAt, &device.StableDeviceID,
			&device.TotalFileCount, &device.TotalBytes, &device.TodayFileCount, &device.TodayBytes,
		); err != nil {
			return nil, fmt.Errorf("scan managed device: %w", err)
		}
		if alias != nil && *alias != "" {
			device.DisplayName = *alias
		}
		device.DesktopDeviceID = desktopDeviceID
		device.ClientIDShort = shortClientID(device.ClientID)
		device.AuthorizationStatus = "authorized"
		if revokedAt != nil {
			device.AuthorizationStatus = "revoked"
		}
		block, err := s.GetDeviceBlockState(desktopDeviceID, device.ClientID)
		if err != nil {
			return nil, err
		}
		device.BlockStatus = "none"
		if block.Blocked {
			device.BlockStatus = "active"
		}
		device.FailedAttemptCount = block.FailedAttemptCount
		device.BlockedAt = block.BlockedAt
		device.BlockReason = block.Reason
		devices = append(devices, device)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate managed devices: %w", err)
	}
	return devices, nil
}

func shortClientID(clientID string) string {
	if len(clientID) <= 8 {
		return clientID
	}
	parts := strings.Split(clientID, "-")
	if len(parts) > 0 && len(parts[0]) >= 4 {
		return parts[0]
	}
	return clientID[:8]
}
