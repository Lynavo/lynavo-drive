package store

import "fmt"

func (s *Store) ListSyncRecords(desktopDeviceID string, clientID *string) ([]DesktopSyncRecord, error) {
	query := `
		SELECT
			u.file_key, u.client_id, COALESCE(p.device_alias, p.client_name, u.client_id) AS display_name,
			u.original_filename, u.media_type, u.file_size, u.status, u.completed_at, u.updated_at
		FROM uploads u
		LEFT JOIN paired_devices p ON p.client_id = u.client_id
		WHERE u.status IN ('completed', 'failed')`
	args := []any{}
	if clientID != nil {
		query += " AND u.client_id = ?"
		args = append(args, *clientID)
	}
	query += " ORDER BY COALESCE(u.completed_at, u.updated_at) DESC, u.file_key DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list sync records: %w", err)
	}
	defer rows.Close()

	records := make([]DesktopSyncRecord, 0)
	for rows.Next() {
		var record DesktopSyncRecord
		var updatedAt string
		if err := rows.Scan(
			&record.FileKey, &record.ClientID, &record.DisplayName, &record.Filename,
			&record.MediaType, &record.FileSize, &record.Status, &record.CompletedAt, &updatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan sync record: %w", err)
		}
		record.DesktopDeviceID = desktopDeviceID
		record.RecordID = record.FileKey
		if record.Status == "failed" {
			record.CompletedAt = nil
			record.FailedAt = &updatedAt
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sync records: %w", err)
	}
	return records, nil
}

func (s *Store) ListReceivedLibrary(desktopDeviceID string) ([]ReceivedLibraryItem, error) {
	rows, err := s.db.Query(`
		SELECT
			u.file_key,
			u.client_id,
			COALESCE(p.device_alias, p.client_name, u.client_id) AS display_name,
			u.original_filename,
			u.media_type,
			u.file_size,
			COALESCE(u.completed_at, u.updated_at) AS completed_at,
			sr.resource_id,
			sr.status
		FROM uploads u
		LEFT JOIN paired_devices p ON p.client_id = u.client_id
		LEFT JOIN shared_resources sr
			ON sr.desktop_device_id = ?
			AND sr.received_file_key = u.file_key
			AND sr.kind = 'received_file'
			AND sr.status != 'removed'
		WHERE u.status = 'completed'
		ORDER BY COALESCE(u.completed_at, u.updated_at) DESC, u.file_key DESC`,
		desktopDeviceID,
	)
	if err != nil {
		return nil, fmt.Errorf("list received library: %w", err)
	}
	defer rows.Close()

	items := make([]ReceivedLibraryItem, 0)
	for rows.Next() {
		var item ReceivedLibraryItem
		var resourceID *string
		var resourceStatus *string
		if err := rows.Scan(
			&item.FileKey, &item.ClientID, &item.DisplayName, &item.Filename,
			&item.MediaType, &item.FileSize, &item.CompletedAt, &resourceID, &resourceStatus,
		); err != nil {
			return nil, fmt.Errorf("scan received library item: %w", err)
		}
		item.DesktopDeviceID = desktopDeviceID
		item.ShareStatus = "not_shared"
		if resourceID != nil {
			item.ResourceID = *resourceID
			item.ShareStatus = "shared"
			if resourceStatus != nil && *resourceStatus == "missing" {
				item.ShareStatus = "missing"
			}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate received library: %w", err)
	}
	return items, nil
}
