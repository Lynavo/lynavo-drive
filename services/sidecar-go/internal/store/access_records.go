package store

import (
	"fmt"
	"time"
)

func (s *Store) RecordAccess(record AccessRecord) (AccessRecord, error) {
	if record.RecordID == "" {
		var err error
		record.RecordID, err = randomID("acc")
		if err != nil {
			return AccessRecord{}, err
		}
	}
	if record.AccessedAt == "" {
		record.AccessedAt = time.Now().UTC().Format(time.RFC3339)
	}
	_, err := s.db.Exec(`
		INSERT INTO access_records
			(record_id, desktop_device_id, client_id, client_name, resource_id, resource_kind,
			 resource_name, action, result, accessed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.RecordID, record.DesktopDeviceID, record.ClientID, record.ClientName,
		record.ResourceID, record.ResourceKind, record.ResourceName, record.Action, record.Result,
		record.AccessedAt,
	)
	if err != nil {
		return AccessRecord{}, fmt.Errorf("record access: %w", err)
	}

	if record.Action == "download" && record.Result == "ok" {
		now := time.Now().UTC().Format(time.RFC3339)
		if _, err := s.db.Exec(`
			UPDATE shared_resources
			SET last_accessed_at = ?, download_count = download_count + 1
			WHERE desktop_device_id = ? AND resource_id = ?`,
			now, record.DesktopDeviceID, record.ResourceID,
		); err != nil {
			return AccessRecord{}, fmt.Errorf("update shared resource access stats: %w", err)
		}
	}

	return record, nil
}

func (s *Store) ListAccessRecords(desktopDeviceID string, clientID *string) ([]AccessRecord, error) {
	query := `
		SELECT record_id, desktop_device_id, client_id, COALESCE(client_name, ''), resource_id, resource_kind,
		       resource_name, action, result, accessed_at
		FROM access_records
		WHERE desktop_device_id = ?`
	args := []any{desktopDeviceID}
	if clientID != nil {
		query += " AND client_id = ?"
		args = append(args, *clientID)
	}
	query += " ORDER BY accessed_at DESC, record_id DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list access records: %w", err)
	}
	defer rows.Close()

	records := make([]AccessRecord, 0)
	for rows.Next() {
		var record AccessRecord
		if err := rows.Scan(
			&record.RecordID, &record.DesktopDeviceID, &record.ClientID, &record.ClientName,
			&record.ResourceID, &record.ResourceKind, &record.ResourceName, &record.Action,
			&record.Result, &record.AccessedAt,
		); err != nil {
			return nil, fmt.Errorf("scan access record: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate access records: %w", err)
	}
	return records, nil
}
