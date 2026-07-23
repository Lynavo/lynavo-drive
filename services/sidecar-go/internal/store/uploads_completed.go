package store

import "fmt"

func (s *Store) ListDeviceReceiveLocations(clientID string) ([]DeviceReceiveLocation, bool, error) {
	var backfilled int
	if err := s.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM device_receive_location_backfills WHERE client_id = ?
		)`, clientID,
	).Scan(&backfilled); err != nil {
		return nil, false, fmt.Errorf("check receive location backfill for %q: %w", clientID, err)
	}
	rows, err := s.db.Query(`
		SELECT path, last_used_at
		FROM device_receive_locations
		WHERE client_id = ?`, clientID,
	)
	if err != nil {
		return nil, false, fmt.Errorf("list device receive locations for %q: %w", clientID, err)
	}
	defer rows.Close()

	locations := make([]DeviceReceiveLocation, 0)
	for rows.Next() {
		var location DeviceReceiveLocation
		if err := rows.Scan(&location.Path, &location.LastUsedAt); err != nil {
			return nil, false, fmt.Errorf("scan device receive location: %w", err)
		}
		locations = append(locations, location)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("iterate device receive locations for %q: %w", clientID, err)
	}
	return locations, backfilled != 0, nil
}

func (s *Store) CacheDeviceReceiveLocations(clientID string, locations []DeviceReceiveLocation) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin receive location cache for %q: %w", clientID, err)
	}
	defer tx.Rollback()

	for _, location := range locations {
		if _, err := tx.Exec(`
			INSERT INTO device_receive_locations (client_id, path, last_used_at)
			VALUES (?, ?, ?)
			ON CONFLICT(client_id, path) DO UPDATE SET
				last_used_at = CASE
					WHEN excluded.last_used_at > last_used_at THEN excluded.last_used_at
					ELSE last_used_at
				END`, clientID, location.Path, location.LastUsedAt,
		); err != nil {
			return fmt.Errorf("cache receive location for %q: %w", clientID, err)
		}
	}
	if _, err := tx.Exec(`
		INSERT OR IGNORE INTO device_receive_location_backfills (client_id) VALUES (?)`, clientID,
	); err != nil {
		return fmt.Errorf("mark receive location backfill for %q: %w", clientID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit receive location cache for %q: %w", clientID, err)
	}
	return nil
}

func (s *Store) RecordDeviceReceiveLocation(clientID, path, lastUsedAt string) error {
	_, err := s.db.Exec(`
		INSERT INTO device_receive_locations (client_id, path, last_used_at)
		VALUES (?, ?, ?)
		ON CONFLICT(client_id, path) DO UPDATE SET
			last_used_at = CASE
				WHEN excluded.last_used_at > last_used_at THEN excluded.last_used_at
				ELSE last_used_at
			END`,
		clientID, path, lastUsedAt,
	)
	if err != nil {
		return fmt.Errorf("record receive location for %q: %w", clientID, err)
	}
	return nil
}

// ListCompletedUploadLocationsByDevice returns the minimal completed-upload
// fields required to derive a device's receive folders.
func (s *Store) ListCompletedUploadLocationsByDevice(clientID string) ([]CompletedUploadLocation, error) {
	rows, err := s.db.Query(`
		SELECT final_path, completed_at, updated_at
		FROM uploads
		WHERE client_id = ? AND status = 'completed'
		  AND final_path IS NOT NULL AND final_path != ''`, clientID,
	)
	if err != nil {
		return nil, fmt.Errorf("list completed upload locations for %q: %w", clientID, err)
	}
	defer rows.Close()

	locations := make([]CompletedUploadLocation, 0)
	for rows.Next() {
		var location CompletedUploadLocation
		if err := rows.Scan(&location.FinalPath, &location.CompletedAt, &location.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan completed upload location: %w", err)
		}
		locations = append(locations, location)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate completed upload locations for %q: %w", clientID, err)
	}
	return locations, nil
}

// ListCompletedUploadsByDevice returns every completed upload row for a client.
func (s *Store) ListCompletedUploadsByDevice(clientID string) ([]Upload, error) {
	rows, err := s.db.Query(`
		SELECT file_key, session_id, client_id, original_filename, media_type,
		       file_size, created_at_remote, modified_at_remote, status, part_path, final_path,
		       committed_bytes, sha256, active_transmission_ms, completed_at, updated_at
		FROM uploads
		WHERE client_id = ? AND status = 'completed'
		ORDER BY COALESCE(completed_at, updated_at) DESC, file_key DESC`, clientID,
	)
	if err != nil {
		return nil, fmt.Errorf("list completed uploads for %q: %w", clientID, err)
	}
	defer rows.Close()

	uploads := make([]Upload, 0)
	for rows.Next() {
		var u Upload
		if err := rows.Scan(
			&u.FileKey, &u.SessionID, &u.ClientID, &u.OriginalFilename, &u.MediaType,
			&u.FileSize, &u.CreatedAtRemote, &u.ModifiedAtRemote, &u.Status, &u.PartPath, &u.FinalPath,
			&u.CommittedBytes, &u.SHA256, &u.ActiveTransmissionMs, &u.CompletedAt, &u.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan completed upload: %w", err)
		}
		uploads = append(uploads, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate completed uploads for %q: %w", clientID, err)
	}

	return uploads, nil
}

// ListCompletedUploadsByDeviceAndDateRange returns all completed uploads for a
// client within a local-date range, preserving the same ordering semantics as
// paginated device file queries.
func (s *Store) ListCompletedUploadsByDeviceAndDateRange(
	clientID, startDate, endDate, sortField, sortDirection string,
) ([]Upload, error) {
	orderBy, err := buildUploadOrderClause(sortField, sortDirection)
	if err != nil {
		return nil, err
	}

	dateFilter := "DATE(updated_at, 'localtime') = ?"
	dateArgs := []any{clientID, startDate}
	if endDate != "" && endDate != startDate {
		dateFilter = "DATE(updated_at, 'localtime') BETWEEN ? AND ?"
		dateArgs = []any{clientID, startDate, endDate}
	}

	querySQL := fmt.Sprintf(`
		SELECT file_key, session_id, client_id, original_filename, media_type,
		       file_size, created_at_remote, modified_at_remote, status, part_path, final_path,
		       committed_bytes, sha256, active_transmission_ms, completed_at, updated_at
		FROM uploads
		WHERE client_id = ? AND %s AND status = 'completed'
		ORDER BY %s`, dateFilter, orderBy)
	rows, err := s.db.Query(querySQL, dateArgs...)
	if err != nil {
		return nil, fmt.Errorf("list completed uploads for %q on %s..%s: %w", clientID, startDate, endDate, err)
	}
	defer rows.Close()

	uploads := make([]Upload, 0)
	for rows.Next() {
		var u Upload
		if err := rows.Scan(
			&u.FileKey, &u.SessionID, &u.ClientID, &u.OriginalFilename, &u.MediaType,
			&u.FileSize, &u.CreatedAtRemote, &u.ModifiedAtRemote, &u.Status, &u.PartPath, &u.FinalPath,
			&u.CommittedBytes, &u.SHA256, &u.ActiveTransmissionMs, &u.CompletedAt, &u.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan completed upload in range: %w", err)
		}
		uploads = append(uploads, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate completed uploads in range for %q: %w", clientID, err)
	}

	return uploads, nil
}
