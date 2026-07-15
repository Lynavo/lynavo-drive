package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	maxWrongConnectionCodeAttempts = 3
	blockReasonTooManyFailed       = "too_many_failed_attempts"
)

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

	state.Blocked = state.BlockedAt != nil && manuallyUnblockedAt == nil
	state.Reason = managedDeviceBlockReason(reason, state.FailedAttemptCount)
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
	// Also clear any active pairing block so the device can pair again (Path-1 block).
	_, err = s.db.Exec(`
		UPDATE blocked_pairing_clients
		SET cleared_at = ?,
		    cleared_by = 'desktop_user'
		WHERE client_id = ? AND desktop_device_id = ? AND cleared_at IS NULL`,
		now, clientID, desktopDeviceID,
	)
	if err != nil {
		return fmt.Errorf("clear pairing block on unblock: %w", err)
	}
	// Also clear pairing rate-limit counters.
	_, err = s.db.Exec(
		"DELETE FROM pairing_rate_limits WHERE client_id = ? AND desktop_device_id = ?",
		clientID, desktopDeviceID,
	)
	if err != nil {
		return fmt.Errorf("clear pairing rate limits on unblock: %w", err)
	}
	return nil
}

func (s *Store) BlockDevice(desktopDeviceID, clientID string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`
		INSERT INTO device_blocks
			(desktop_device_id, client_id, reason, failed_attempt_count, blocked_at, manually_unblocked_at, updated_at)
		VALUES (?, ?, 'manually_blocked', 0, ?, NULL, ?)
		ON CONFLICT(desktop_device_id, client_id) DO UPDATE SET
			reason = 'manually_blocked',
			blocked_at = excluded.blocked_at,
			manually_unblocked_at = NULL,
			updated_at = excluded.updated_at`,
		desktopDeviceID, clientID, now, now,
	)
	if err != nil {
		return fmt.Errorf("block device: %w", err)
	}
	return nil
}

func (s *Store) DeviceKnownForManagement(desktopDeviceID, clientID string) (bool, error) {
	var exists int
	err := s.db.QueryRow(`
		SELECT (
			SELECT 1
			FROM paired_devices
			WHERE client_id = ?
			LIMIT 1
		) IS NOT NULL
		OR (
			SELECT 1
			FROM device_blocks
			WHERE desktop_device_id = ?
				AND client_id = ?
				AND blocked_at IS NOT NULL
				AND manually_unblocked_at IS NULL
			LIMIT 1
		) IS NOT NULL
		OR (
			SELECT 1
			FROM blocked_pairing_clients
			WHERE desktop_device_id = ?
				AND client_id = ?
				AND cleared_at IS NULL
			LIMIT 1
		) IS NOT NULL`,
		clientID, desktopDeviceID, clientID, desktopDeviceID, clientID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check managed device exists: %w", err)
	}
	return exists == 1, nil
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
		WITH paired_identity AS (
			SELECT
				p.*,
				COALESCE(NULLIF(TRIM(p.stable_device_id), ''), p.client_id) AS identity_key,
				ROW_NUMBER() OVER (
					PARTITION BY COALESCE(NULLIF(TRIM(p.stable_device_id), ''), p.client_id)
					ORDER BY p.last_seen_at DESC, p.client_id DESC
				) AS row_rank
			FROM paired_devices p
		),
		upload_stats AS (
			SELECT
				pi.identity_key,
				COUNT(u.file_key) AS total_file_count,
				COALESCE(SUM(u.file_size), 0) AS total_bytes,
				COUNT(CASE WHEN DATE(u.updated_at, 'localtime') = DATE('now', 'localtime') THEN u.file_key END) AS today_file_count,
				COALESCE(SUM(CASE WHEN DATE(u.updated_at, 'localtime') = DATE('now', 'localtime') THEN u.file_size ELSE 0 END), 0) AS today_bytes
			FROM paired_identity pi
			LEFT JOIN uploads u ON u.client_id = pi.client_id AND u.status = 'completed'
			GROUP BY pi.identity_key
		),
		identity_clients AS (
			SELECT
				identity_key,
				GROUP_CONCAT(client_id, char(31)) AS client_ids
			FROM paired_identity
			GROUP BY identity_key
		)
		SELECT
			p.client_id, p.client_name, p.device_alias, p.last_ip, p.platform, p.created_at,
			p.last_seen_at, p.revoked_at, p.stable_device_id,
			COALESCE(us.total_file_count, 0),
			COALESCE(us.total_bytes, 0),
			COALESCE(us.today_file_count, 0),
			COALESCE(us.today_bytes, 0),
			COALESCE(ic.client_ids, p.client_id)
		FROM paired_identity p
		LEFT JOIN upload_stats us ON us.identity_key = p.identity_key
		LEFT JOIN identity_clients ic ON ic.identity_key = p.identity_key
		WHERE p.row_rank = 1
		ORDER BY p.last_seen_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list managed devices: %w", err)
	}
	defer rows.Close()

	devices := make([]ManagedDevice, 0)
	seen := make(map[string]struct{})
	for rows.Next() {
		var device ManagedDevice
		var alias *string
		var revokedAt *string
		var identityClientIDs string
		if err := rows.Scan(
			&device.ClientID, &device.DisplayName, &alias, &device.LastIP, &device.Platform,
			&device.AuthorizedAt, &device.LastSeenAt, &revokedAt, &device.StableDeviceID,
			&device.TotalFileCount, &device.TotalBytes, &device.TodayFileCount, &device.TodayBytes,
			&identityClientIDs,
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
		for _, clientID := range strings.Split(identityClientIDs, string(rune(31))) {
			if clientID != "" {
				seen[clientID] = struct{}{}
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate managed devices: %w", err)
	}
	blockedDevices, err := s.listBlockedUnpairedManagedDevices(desktopDeviceID, seen)
	if err != nil {
		return nil, err
	}
	devices = append(devices, blockedDevices...)

	// Also include devices blocked via the pairing flow (wrong-code 3x) that
	// never completed pairing and therefore have no row in paired_devices.
	pairingBlocked, err := s.listBlockedPairingOnlyManagedDevices(desktopDeviceID, seen)
	if err != nil {
		return nil, err
	}
	devices = append(devices, pairingBlocked...)
	return devices, nil
}

func (s *Store) listBlockedUnpairedManagedDevices(desktopDeviceID string, seen map[string]struct{}) ([]ManagedDevice, error) {
	rows, err := s.db.Query(`
		SELECT
			b.client_id,
			COALESCE(
				(
					SELECT ca.client_name
					FROM connection_attempts ca
					WHERE ca.desktop_device_id = b.desktop_device_id
						AND ca.client_id = b.client_id
						AND ca.client_name IS NOT NULL
						AND ca.client_name != ''
					ORDER BY ca.attempted_at DESC, ca.id DESC
					LIMIT 1
				),
				b.client_id
			),
			b.reason, b.failed_attempt_count, b.blocked_at
		FROM device_blocks b
		WHERE b.desktop_device_id = ?
			AND b.blocked_at IS NOT NULL
			AND b.manually_unblocked_at IS NULL
		ORDER BY b.blocked_at DESC, b.client_id DESC`,
		desktopDeviceID,
	)
	if err != nil {
		return nil, fmt.Errorf("list blocked unpaired managed devices: %w", err)
	}
	defer rows.Close()

	devices := make([]ManagedDevice, 0)
	for rows.Next() {
		var device ManagedDevice
		var reason string
		if err := rows.Scan(
			&device.ClientID, &device.DisplayName, &reason,
			&device.FailedAttemptCount, &device.BlockedAt,
		); err != nil {
			return nil, fmt.Errorf("scan blocked unpaired managed device: %w", err)
		}
		if _, ok := seen[device.ClientID]; ok {
			continue
		}
		device.DesktopDeviceID = desktopDeviceID
		device.ClientIDShort = shortClientID(device.ClientID)
		device.AuthorizationStatus = "revoked"
		device.BlockStatus = "active"
		device.BlockReason = managedDeviceBlockReason(reason, device.FailedAttemptCount)
		devices = append(devices, device)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate blocked unpaired managed devices: %w", err)
	}
	return devices, nil
}

func managedDeviceBlockReason(reason string, failedAttemptCount int) *string {
	if failedAttemptCount >= maxWrongConnectionCodeAttempts {
		normalized := blockReasonTooManyFailed
		return &normalized
	}
	if reason == "" {
		return nil
	}
	return &reason
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

// listBlockedPairingOnlyManagedDevices returns devices that were blocked during
// the pairing handshake (wrong connection code >= 3 times) but never completed
// pairing, so they have no row in paired_devices. These devices are surfaced in
// the Device Management page so the administrator can clear the block.
func (s *Store) listBlockedPairingOnlyManagedDevices(desktopDeviceID string, seen map[string]struct{}) ([]ManagedDevice, error) {
	rows, err := s.db.Query(`
		SELECT
			bpc.client_id,
			COALESCE(bpc.device_alias, bpc.client_name, bpc.client_id),
			bpc.platform,
			bpc.last_ip,
			bpc.failed_attempts,
			bpc.blocked_at
		FROM blocked_pairing_clients bpc
		WHERE bpc.desktop_device_id = ?
			AND bpc.cleared_at IS NULL
		ORDER BY bpc.blocked_at DESC`,
		desktopDeviceID,
	)
	if err != nil {
		return nil, fmt.Errorf("list pairing-only blocked managed devices: %w", err)
	}
	defer rows.Close()

	reason := "too_many_failed_attempts"
	devices := make([]ManagedDevice, 0)
	for rows.Next() {
		var device ManagedDevice
		var platform *string
		if err := rows.Scan(
			&device.ClientID, &device.DisplayName, &platform,
			&device.LastIP, &device.FailedAttemptCount, &device.BlockedAt,
		); err != nil {
			return nil, fmt.Errorf("scan pairing-only blocked managed device: %w", err)
		}
		if _, ok := seen[device.ClientID]; ok {
			// Already included via paired_devices or device_blocks – skip.
			continue
		}
		if platform != nil {
			device.Platform = *platform
		}
		device.DesktopDeviceID = desktopDeviceID
		device.ClientIDShort = shortClientID(device.ClientID)
		device.AuthorizationStatus = "revoked"
		device.BlockStatus = "active"
		device.BlockReason = &reason
		devices = append(devices, device)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pairing-only blocked managed devices: %w", err)
	}
	return devices, nil
}
