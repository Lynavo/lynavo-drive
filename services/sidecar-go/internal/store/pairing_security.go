package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const pairingBlockReasonWrongCodeLimit = "wrong_connection_code_limit"

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func scanNullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func (s *Store) RecordPairingAttempt(meta PairingClientMetadata, result PairingAttemptResult, failureReason string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`
		INSERT INTO pairing_attempts (
			client_id,
			desktop_device_id,
			client_name,
			device_alias,
			platform,
			stable_device_id,
			ip,
			result,
			failure_reason,
			created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		meta.ClientID,
		meta.DesktopDeviceID,
		nullString(meta.ClientName),
		nullString(meta.DeviceAlias),
		nullString(meta.Platform),
		nullString(meta.StableDeviceID),
		nullString(meta.IP),
		result,
		nullString(failureReason),
		now,
	)
	if err != nil {
		return fmt.Errorf("record pairing attempt for %q on %q: %w", meta.ClientID, meta.DesktopDeviceID, err)
	}
	return nil
}

func (s *Store) RecordPairingFailure(meta PairingClientMetadata, maxAttempts int) (PairingFailureResult, error) {
	if maxAttempts <= 0 {
		return PairingFailureResult{}, fmt.Errorf("max pairing attempts must be positive")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return PairingFailureResult{}, fmt.Errorf("begin pairing failure transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := tx.Exec(`
		INSERT INTO pairing_attempts (
			client_id,
			desktop_device_id,
			client_name,
			device_alias,
			platform,
			stable_device_id,
			ip,
			result,
			failure_reason,
			created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		meta.ClientID,
		meta.DesktopDeviceID,
		nullString(meta.ClientName),
		nullString(meta.DeviceAlias),
		nullString(meta.Platform),
		nullString(meta.StableDeviceID),
		nullString(meta.IP),
		PairingAttemptWrongCode,
		"PAIRING_CODE_INVALID",
		now,
	); err != nil {
		return PairingFailureResult{}, fmt.Errorf("record wrong-code pairing attempt for %q on %q: %w", meta.ClientID, meta.DesktopDeviceID, err)
	}

	if _, err := tx.Exec(`
		INSERT INTO pairing_rate_limits (
			client_id,
			desktop_device_id,
			failed_count,
			first_failed_at,
			last_failed_at,
			updated_at
		) VALUES (?, ?, 1, ?, ?, ?)
		ON CONFLICT(client_id, desktop_device_id) DO UPDATE SET
			failed_count = pairing_rate_limits.failed_count + 1,
			last_failed_at = excluded.last_failed_at,
			updated_at = excluded.updated_at`,
		meta.ClientID,
		meta.DesktopDeviceID,
		now,
		now,
		now,
	); err != nil {
		return PairingFailureResult{}, fmt.Errorf("upsert pairing rate limit for %q on %q: %w", meta.ClientID, meta.DesktopDeviceID, err)
	}

	var failedCount int
	if err := tx.QueryRow(`
		SELECT failed_count
		FROM pairing_rate_limits
		WHERE client_id = ? AND desktop_device_id = ?`,
		meta.ClientID,
		meta.DesktopDeviceID,
	).Scan(&failedCount); err != nil {
		return PairingFailureResult{}, fmt.Errorf("read pairing failure count for %q on %q: %w", meta.ClientID, meta.DesktopDeviceID, err)
	}

	blocked := failedCount >= maxAttempts
	if blocked {
		if _, err := tx.Exec(`
			INSERT INTO blocked_pairing_clients (
				client_id,
				desktop_device_id,
				client_name,
				device_alias,
				platform,
				stable_device_id,
				last_ip,
				failed_attempts,
				blocked_at,
				last_attempt_at,
				reason,
				cleared_at,
				cleared_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
			ON CONFLICT(client_id, desktop_device_id) WHERE cleared_at IS NULL DO UPDATE SET
				client_name = COALESCE(excluded.client_name, blocked_pairing_clients.client_name),
				device_alias = COALESCE(excluded.device_alias, blocked_pairing_clients.device_alias),
				platform = COALESCE(excluded.platform, blocked_pairing_clients.platform),
				stable_device_id = COALESCE(excluded.stable_device_id, blocked_pairing_clients.stable_device_id),
				last_ip = COALESCE(excluded.last_ip, blocked_pairing_clients.last_ip),
				failed_attempts = excluded.failed_attempts,
				last_attempt_at = excluded.last_attempt_at,
				reason = excluded.reason`,
			meta.ClientID,
			meta.DesktopDeviceID,
			nullString(meta.ClientName),
			nullString(meta.DeviceAlias),
			nullString(meta.Platform),
			nullString(meta.StableDeviceID),
			nullString(meta.IP),
			failedCount,
			now,
			now,
			pairingBlockReasonWrongCodeLimit,
		); err != nil {
			return PairingFailureResult{}, fmt.Errorf("upsert active pairing block for %q on %q: %w", meta.ClientID, meta.DesktopDeviceID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return PairingFailureResult{}, fmt.Errorf("commit pairing failure transaction: %w", err)
	}
	committed = true

	remainingAttempts := maxAttempts - failedCount
	if remainingAttempts < 0 {
		remainingAttempts = 0
	}
	return PairingFailureResult{
		FailedAttempts:    failedCount,
		RemainingAttempts: remainingAttempts,
		MaxAttempts:       maxAttempts,
		Blocked:           blocked,
	}, nil
}

func (s *Store) ClearPairingFailures(clientID, desktopDeviceID string) error {
	if _, err := s.db.Exec(
		"DELETE FROM pairing_rate_limits WHERE client_id = ? AND desktop_device_id = ?",
		clientID,
		desktopDeviceID,
	); err != nil {
		return fmt.Errorf("clear pairing failures for %q on %q: %w", clientID, desktopDeviceID, err)
	}
	return nil
}

func (s *Store) GetActivePairingBlock(clientID, desktopDeviceID string) (*BlockedPairingClient, error) {
	block, err := scanBlockedPairingClient(s.db.QueryRow(`
		SELECT
			client_id,
			desktop_device_id,
			client_name,
			device_alias,
			platform,
			stable_device_id,
			last_ip,
			failed_attempts,
			blocked_at,
			last_attempt_at,
			reason,
			cleared_at,
			cleared_by
		FROM blocked_pairing_clients
		WHERE client_id = ? AND desktop_device_id = ? AND cleared_at IS NULL`,
		clientID,
		desktopDeviceID,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get active pairing block for %q on %q: %w", clientID, desktopDeviceID, err)
	}
	return block, nil
}

func (s *Store) TouchActivePairingBlock(meta PairingClientMetadata) error {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(`
		UPDATE blocked_pairing_clients
		SET last_attempt_at = ?,
		    last_ip = COALESCE(?, last_ip)
		WHERE client_id = ? AND desktop_device_id = ? AND cleared_at IS NULL`,
		now,
		nullString(meta.IP),
		meta.ClientID,
		meta.DesktopDeviceID,
	)
	if err != nil {
		return fmt.Errorf("touch active pairing block for %q on %q: %w", meta.ClientID, meta.DesktopDeviceID, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("touch active pairing block for %q on %q: %w", meta.ClientID, meta.DesktopDeviceID, ErrNoRows)
	}
	return nil
}

func (s *Store) ClearPairingBlock(clientID, desktopDeviceID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin clear pairing block transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	now := time.Now().UTC().Format(time.RFC3339)
	result, err := tx.Exec(`
		UPDATE blocked_pairing_clients
		SET cleared_at = ?,
		    cleared_by = 'desktop_user'
		WHERE client_id = ? AND desktop_device_id = ? AND cleared_at IS NULL`,
		now,
		clientID,
		desktopDeviceID,
	)
	if err != nil {
		return fmt.Errorf("clear pairing block for %q on %q: %w", clientID, desktopDeviceID, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("clear pairing block for %q on %q: %w", clientID, desktopDeviceID, ErrNoRows)
	}

	if _, err := tx.Exec(
		"DELETE FROM pairing_rate_limits WHERE client_id = ? AND desktop_device_id = ?",
		clientID,
		desktopDeviceID,
	); err != nil {
		return fmt.Errorf("clear pairing failures after block clear for %q on %q: %w", clientID, desktopDeviceID, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit clear pairing block transaction: %w", err)
	}
	committed = true
	return nil
}

func displayName(deviceAlias, clientName *string, clientID string) string {
	if deviceAlias != nil && *deviceAlias != "" {
		return *deviceAlias
	}
	if clientName != nil && *clientName != "" {
		return *clientName
	}
	return clientID
}

func scanBlockedPairingClient(scanner interface{ Scan(dest ...any) error }) (*BlockedPairingClient, error) {
	var block BlockedPairingClient
	var clientName sql.NullString
	var deviceAlias sql.NullString
	var platform sql.NullString
	var stableDeviceID sql.NullString
	var lastIP sql.NullString
	var clearedAt sql.NullString
	var clearedBy sql.NullString

	if err := scanner.Scan(
		&block.ClientID,
		&block.DesktopDeviceID,
		&clientName,
		&deviceAlias,
		&platform,
		&stableDeviceID,
		&lastIP,
		&block.FailedAttempts,
		&block.BlockedAt,
		&block.LastAttemptAt,
		&block.Reason,
		&clearedAt,
		&clearedBy,
	); err != nil {
		return nil, err
	}

	block.ClientName = scanNullableString(clientName)
	block.DeviceAlias = scanNullableString(deviceAlias)
	block.Platform = scanNullableString(platform)
	block.StableDeviceID = scanNullableString(stableDeviceID)
	block.LastIP = scanNullableString(lastIP)
	block.ClearedAt = scanNullableString(clearedAt)
	block.ClearedBy = scanNullableString(clearedBy)
	return &block, nil
}

func (s *Store) ListAuthorizedDevices() ([]PairedDevice, error) {
	rows, err := s.db.Query(`
		SELECT client_id, client_name, device_alias, last_ip, platform, pairing_id,
		       pairing_token_hash, created_at, last_seen_at, revoked_at, receive_dir_name, stable_device_id
		FROM paired_devices
		WHERE revoked_at IS NULL
		ORDER BY last_seen_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list authorized devices: %w", err)
	}
	defer rows.Close()

	var devices []PairedDevice
	for rows.Next() {
		var d PairedDevice
		if err := rows.Scan(
			&d.ClientID,
			&d.ClientName,
			&d.DeviceAlias,
			&d.LastIP,
			&d.Platform,
			&d.PairingID,
			&d.PairingTokenHash,
			&d.CreatedAt,
			&d.LastSeenAt,
			&d.RevokedAt,
			&d.ReceiveDirName,
			&d.StableDeviceID,
		); err != nil {
			return nil, fmt.Errorf("scan authorized device: %w", err)
		}
		devices = append(devices, d)
	}
	return devices, rows.Err()
}

func (s *Store) ListBlockedPairingClients() ([]BlockedPairingClient, error) {
	rows, err := s.db.Query(`
		SELECT
			client_id,
			desktop_device_id,
			client_name,
			device_alias,
			platform,
			stable_device_id,
			last_ip,
			failed_attempts,
			blocked_at,
			last_attempt_at,
			reason,
			cleared_at,
			cleared_by
		FROM blocked_pairing_clients
		WHERE cleared_at IS NULL
		ORDER BY blocked_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list blocked pairing clients: %w", err)
	}
	defer rows.Close()

	var blocked []BlockedPairingClient
	for rows.Next() {
		block, err := scanBlockedPairingClient(rows)
		if err != nil {
			return nil, fmt.Errorf("scan blocked pairing client: %w", err)
		}
		blocked = append(blocked, *block)
	}
	return blocked, rows.Err()
}

func (s *Store) ListRecentPairingAttempts(limit int) ([]PairingAttempt, error) {
	if limit <= 0 || limit > 50 {
		limit = 50
	}

	rows, err := s.db.Query(`
		SELECT
			id,
			client_id,
			desktop_device_id,
			client_name,
			device_alias,
			platform,
			stable_device_id,
			ip,
			result,
			failure_reason,
			created_at
		FROM pairing_attempts
		ORDER BY created_at DESC, id DESC
		LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list recent pairing attempts: %w", err)
	}
	defer rows.Close()

	var attempts []PairingAttempt
	for rows.Next() {
		var attempt PairingAttempt
		var clientName sql.NullString
		var deviceAlias sql.NullString
		var platform sql.NullString
		var stableDeviceID sql.NullString
		var ip sql.NullString
		var failureReason sql.NullString

		if err := rows.Scan(
			&attempt.ID,
			&attempt.ClientID,
			&attempt.DesktopDeviceID,
			&clientName,
			&deviceAlias,
			&platform,
			&stableDeviceID,
			&ip,
			&attempt.Result,
			&failureReason,
			&attempt.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan recent pairing attempt: %w", err)
		}

		attempt.ClientName = scanNullableString(clientName)
		attempt.DeviceAlias = scanNullableString(deviceAlias)
		attempt.Platform = scanNullableString(platform)
		attempt.StableDeviceID = scanNullableString(stableDeviceID)
		attempt.IP = scanNullableString(ip)
		attempt.FailureReason = scanNullableString(failureReason)
		attempts = append(attempts, attempt)
	}
	return attempts, rows.Err()
}
