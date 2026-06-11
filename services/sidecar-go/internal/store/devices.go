package store

import (
	"fmt"
	"time"
)

// UpsertPairedDevice inserts or replaces a paired device record.
func (s *Store) UpsertPairedDevice(d PairedDevice) error {
	_, err := s.db.Exec(`
		INSERT INTO paired_devices (client_id, client_name, device_alias, last_ip, platform, pairing_id, pairing_token_hash, created_at, last_seen_at, revoked_at, receive_dir_name, stable_device_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(client_id) DO UPDATE SET
			client_name = excluded.client_name,
			device_alias = excluded.device_alias,
			last_ip = excluded.last_ip,
			platform = excluded.platform,
			pairing_id = excluded.pairing_id,
			pairing_token_hash = excluded.pairing_token_hash,
			last_seen_at = excluded.last_seen_at,
			revoked_at = excluded.revoked_at,
			receive_dir_name = COALESCE(excluded.receive_dir_name, paired_devices.receive_dir_name),
			stable_device_id = COALESCE(excluded.stable_device_id, paired_devices.stable_device_id)`,
		d.ClientID, d.ClientName, d.DeviceAlias, d.LastIP, d.Platform,
		d.PairingID, d.PairingTokenHash, d.CreatedAt, d.LastSeenAt, d.RevokedAt,
		d.ReceiveDirName, d.StableDeviceID,
	)
	if err != nil {
		return fmt.Errorf("upsert paired device %q: %w", d.ClientID, err)
	}
	return nil
}

// GetPairedDevice retrieves a paired device by client ID.
func (s *Store) GetPairedDevice(clientID string) (*PairedDevice, error) {
	d := &PairedDevice{}
	err := s.db.QueryRow(`
		SELECT client_id, client_name, device_alias, last_ip, platform, pairing_id,
		       pairing_token_hash, created_at, last_seen_at, revoked_at, receive_dir_name, stable_device_id
		FROM paired_devices WHERE client_id = ?`, clientID,
	).Scan(
		&d.ClientID, &d.ClientName, &d.DeviceAlias, &d.LastIP, &d.Platform,
		&d.PairingID, &d.PairingTokenHash, &d.CreatedAt, &d.LastSeenAt, &d.RevokedAt,
		&d.ReceiveDirName, &d.StableDeviceID,
	)
	if err != nil {
		return nil, fmt.Errorf("get paired device %q: %w", clientID, err)
	}
	return d, nil
}

// UpdateReceiveDirName stores the sanitized directory name used on disk for a device.
func (s *Store) UpdateReceiveDirName(clientID, dirName string) error {
	_, err := s.db.Exec(
		"UPDATE paired_devices SET receive_dir_name = ? WHERE client_id = ?",
		dirName, clientID,
	)
	return err
}

// ListPairedDevices returns all paired devices ordered by last_seen_at descending.
func (s *Store) ListPairedDevices() ([]PairedDevice, error) {
	rows, err := s.db.Query(`
		SELECT client_id, client_name, device_alias, last_ip, platform, pairing_id,
		       pairing_token_hash, created_at, last_seen_at, revoked_at, receive_dir_name, stable_device_id
		FROM paired_devices ORDER BY last_seen_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list paired devices: %w", err)
	}
	defer rows.Close()

	var devices []PairedDevice
	for rows.Next() {
		var d PairedDevice
		if err := rows.Scan(
			&d.ClientID, &d.ClientName, &d.DeviceAlias, &d.LastIP, &d.Platform,
			&d.PairingID, &d.PairingTokenHash, &d.CreatedAt, &d.LastSeenAt, &d.RevokedAt,
			&d.ReceiveDirName, &d.StableDeviceID,
		); err != nil {
			return nil, fmt.Errorf("scan paired device: %w", err)
		}
		devices = append(devices, d)
	}
	return devices, rows.Err()
}

// RevokePairedDevice sets the revoked_at timestamp for a device.
func (s *Store) RevokePairedDevice(clientID string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(
		"UPDATE paired_devices SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL",
		now, clientID,
	)
	if err != nil {
		return fmt.Errorf("revoke paired device %q: %w", clientID, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("revoke paired device %q: %w", clientID, ErrNoRows)
	}
	return nil
}

// UpdateLastSeen updates the last_seen_at timestamp and last_ip for a device.
func (s *Store) UpdateLastSeen(clientID, ip string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(
		"UPDATE paired_devices SET last_seen_at = ?, last_ip = ? WHERE client_id = ?",
		now, ip, clientID,
	)
	if err != nil {
		return fmt.Errorf("update last seen %q: %w", clientID, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("update last seen %q: %w", clientID, ErrNoRows)
	}
	return nil
}

// ListReceiveDirNames returns all non-null receive_dir_name values from paired_devices.
func (s *Store) ListReceiveDirNames() ([]string, error) {
	rows, err := s.db.Query(
		"SELECT receive_dir_name FROM paired_devices WHERE receive_dir_name IS NOT NULL AND receive_dir_name != ''")
	if err != nil {
		return nil, fmt.Errorf("list receive dir names: %w", err)
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scan receive dir name: %w", err)
		}
		names = append(names, name)
	}
	return names, rows.Err()
}
