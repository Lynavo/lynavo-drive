package store

import (
	"fmt"
	"strings"
)

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
	return s.listAllReceivedLibrary(desktopDeviceID, nil)
}

func (s *Store) ListReceivedLibraryForClient(desktopDeviceID string, clientID string) ([]ReceivedLibraryItem, error) {
	return s.listAllReceivedLibrary(desktopDeviceID, &clientID)
}

func (s *Store) listAllReceivedLibrary(desktopDeviceID string, clientID *string) ([]ReceivedLibraryItem, error) {
	page, err := s.listReceivedLibraryPage(desktopDeviceID, clientID, 1, 1)
	if err != nil {
		return nil, err
	}
	if page.TotalItems == 0 {
		return []ReceivedLibraryItem{}, nil
	}
	fullPage, err := s.listReceivedLibraryPage(desktopDeviceID, clientID, 1, page.TotalItems)
	if err != nil {
		return nil, err
	}
	return fullPage.Items, nil
}

func (s *Store) ListReceivedLibraryPage(desktopDeviceID string, page, pageSize int) (ReceivedLibraryPage, error) {
	return s.listReceivedLibraryPage(desktopDeviceID, nil, page, pageSize)
}

func (s *Store) ListReceivedLibraryPageForClient(desktopDeviceID string, clientID string, page, pageSize int) (ReceivedLibraryPage, error) {
	return s.listReceivedLibraryPage(desktopDeviceID, &clientID, page, pageSize)
}

func (s *Store) listReceivedLibraryPage(desktopDeviceID string, clientID *string, page, pageSize int) (ReceivedLibraryPage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 30
	}

	result := ReceivedLibraryPage{
		Page:     page,
		PageSize: pageSize,
	}

	whereSQL, whereArgs := receivedLibraryWhere(clientID)
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*), COALESCE(SUM(file_size), 0)
		FROM uploads u
		WHERE %s`, whereSQL)
	if err := s.db.QueryRow(countQuery, whereArgs...).Scan(&result.TotalItems, &result.TotalBytes); err != nil {
		return ReceivedLibraryPage{}, fmt.Errorf("count received library: %w", err)
	}

	deviceStats, err := s.listReceivedLibraryDeviceStats(clientID)
	if err != nil {
		return ReceivedLibraryPage{}, err
	}
	result.DeviceStats = deviceStats

	query := `
		SELECT
			u.file_key,
			u.client_id,
			COALESCE(p.device_alias, p.client_name, u.client_id) AS display_name,
			u.original_filename,
			u.media_type,
			u.file_size,
			COALESCE(u.completed_at, u.updated_at) AS completed_at,
			u.final_path,
			sr.resource_id,
			sr.status
		FROM uploads u
		LEFT JOIN paired_devices p ON p.client_id = u.client_id
		LEFT JOIN shared_resources sr
			ON sr.desktop_device_id = ?
			AND sr.received_file_key = u.file_key
			AND sr.kind = 'received_file'
			AND sr.status != 'removed'
		WHERE ` + whereSQL + `
		ORDER BY COALESCE(u.completed_at, u.updated_at) DESC, u.file_key DESC
		LIMIT ? OFFSET ?`
	args := []any{desktopDeviceID}
	args = append(args, whereArgs...)
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return ReceivedLibraryPage{}, fmt.Errorf("list received library: %w", err)
	}
	defer rows.Close()

	items := make([]ReceivedLibraryItem, 0, pageSize)
	for rows.Next() {
		var item ReceivedLibraryItem
		var resourceID *string
		var resourceStatus *string
		if err := rows.Scan(
			&item.FileKey, &item.ClientID, &item.DisplayName, &item.Filename,
			&item.MediaType, &item.FileSize, &item.CompletedAt, &item.FinalPath, &resourceID, &resourceStatus,
		); err != nil {
			return ReceivedLibraryPage{}, fmt.Errorf("scan received library item: %w", err)
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
		return ReceivedLibraryPage{}, fmt.Errorf("iterate received library: %w", err)
	}
	result.Items = items
	return result, nil
}

func receivedLibraryWhere(clientID *string) (string, []any) {
	clauses := []string{"u.status = 'completed'"}
	args := []any{}
	if clientID != nil {
		clauses = append(clauses, "u.client_id = ?")
		args = append(args, *clientID)
	}
	return strings.Join(clauses, " AND "), args
}

func (s *Store) listReceivedLibraryDeviceStats(clientID *string) ([]ReceivedLibraryDeviceStat, error) {
	whereSQL, args := receivedLibraryWhere(clientID)
	query := fmt.Sprintf(`
		SELECT
			u.client_id,
			COALESCE(SUM(CASE
				WHEN u.media_type = 'image'
					OR u.media_type = 'video'
					OR u.media_type LIKE 'image/%%'
					OR u.media_type LIKE 'video/%%'
				THEN 1 ELSE 0 END), 0) AS photo_count,
			COALESCE(SUM(CASE
				WHEN u.media_type = 'image'
					OR u.media_type = 'video'
					OR u.media_type LIKE 'image/%%'
					OR u.media_type LIKE 'video/%%'
				THEN 0 ELSE 1 END), 0) AS file_count,
			COALESCE(SUM(u.file_size), 0) AS total_bytes
		FROM uploads u
		WHERE %s
		GROUP BY u.client_id`, whereSQL)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list received library device stats: %w", err)
	}
	defer rows.Close()

	stats := make([]ReceivedLibraryDeviceStat, 0)
	for rows.Next() {
		var stat ReceivedLibraryDeviceStat
		if err := rows.Scan(&stat.ClientID, &stat.PhotoCount, &stat.FileCount, &stat.TotalBytes); err != nil {
			return nil, fmt.Errorf("scan received library device stat: %w", err)
		}
		stats = append(stats, stat)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate received library device stats: %w", err)
	}
	return stats, nil
}
