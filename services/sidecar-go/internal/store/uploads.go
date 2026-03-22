package store

import (
	"database/sql"
	"fmt"
	"time"
)

// UpsertUpload inserts or replaces an upload record.
func (s *Store) UpsertUpload(u Upload) error {
	_, err := s.db.Exec(`
		INSERT INTO uploads (file_key, session_id, client_id, original_filename, media_type,
			file_size, created_at_remote, modified_at_remote, status, part_path, final_path,
			committed_bytes, sha256, active_transmission_ms, completed_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(file_key) DO UPDATE SET
			session_id = excluded.session_id,
			client_id = excluded.client_id,
			original_filename = excluded.original_filename,
			media_type = excluded.media_type,
			file_size = excluded.file_size,
			created_at_remote = excluded.created_at_remote,
			modified_at_remote = excluded.modified_at_remote,
			status = excluded.status,
			part_path = excluded.part_path,
			final_path = excluded.final_path,
			committed_bytes = excluded.committed_bytes,
			sha256 = excluded.sha256,
			active_transmission_ms = excluded.active_transmission_ms,
			completed_at = excluded.completed_at,
			updated_at = excluded.updated_at`,
		u.FileKey, u.SessionID, u.ClientID, u.OriginalFilename, u.MediaType,
		u.FileSize, u.CreatedAtRemote, u.ModifiedAtRemote, u.Status, u.PartPath, u.FinalPath,
		u.CommittedBytes, u.SHA256, u.ActiveTransmissionMs, u.CompletedAt, u.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert upload %q: %w", u.FileKey, err)
	}
	return nil
}

// GetUpload retrieves a single upload by file key.
func (s *Store) GetUpload(fileKey string) (*Upload, error) {
	u := &Upload{}
	err := s.db.QueryRow(`
		SELECT file_key, session_id, client_id, original_filename, media_type,
		       file_size, created_at_remote, modified_at_remote, status, part_path, final_path,
		       committed_bytes, sha256, active_transmission_ms, completed_at, updated_at
		FROM uploads WHERE file_key = ?`, fileKey,
	).Scan(
		&u.FileKey, &u.SessionID, &u.ClientID, &u.OriginalFilename, &u.MediaType,
		&u.FileSize, &u.CreatedAtRemote, &u.ModifiedAtRemote, &u.Status, &u.PartPath, &u.FinalPath,
		&u.CommittedBytes, &u.SHA256, &u.ActiveTransmissionMs, &u.CompletedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get upload %q: %w", fileKey, err)
	}
	return u, nil
}

// ListUploadsByDeviceAndDate returns uploads for a given client on a given date (YYYY-MM-DD).
func (s *Store) ListUploadsByDeviceAndDate(clientID, date string) ([]Upload, error) {
	rows, err := s.db.Query(`
		SELECT file_key, session_id, client_id, original_filename, media_type,
		       file_size, created_at_remote, modified_at_remote, status, part_path, final_path,
		       committed_bytes, sha256, active_transmission_ms, completed_at, updated_at
		FROM uploads
		WHERE client_id = ? AND DATE(updated_at, 'localtime') = ? AND status = 'completed'
		ORDER BY updated_at DESC`, clientID, date,
	)
	if err != nil {
		return nil, fmt.Errorf("list uploads for %q on %s: %w", clientID, date, err)
	}
	defer rows.Close()

	var uploads []Upload
	for rows.Next() {
		var u Upload
		if err := rows.Scan(
			&u.FileKey, &u.SessionID, &u.ClientID, &u.OriginalFilename, &u.MediaType,
			&u.FileSize, &u.CreatedAtRemote, &u.ModifiedAtRemote, &u.Status, &u.PartPath, &u.FinalPath,
			&u.CommittedBytes, &u.SHA256, &u.ActiveTransmissionMs, &u.CompletedAt, &u.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan upload: %w", err)
		}
		uploads = append(uploads, u)
	}
	return uploads, rows.Err()
}

// GetAvailableDates returns distinct dates (YYYY-MM-DD) that have uploads for a given client, descending.
func (s *Store) GetAvailableDates(clientID string) ([]string, error) {
	rows, err := s.db.Query(`
		SELECT DISTINCT DATE(updated_at, 'localtime') AS d
		FROM uploads
		WHERE client_id = ? AND status = 'completed'
		ORDER BY d DESC`, clientID,
	)
	if err != nil {
		return nil, fmt.Errorf("get available dates for %q: %w", clientID, err)
	}
	defer rows.Close()

	var dates []string
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, fmt.Errorf("scan date: %w", err)
		}
		dates = append(dates, d)
	}
	return dates, rows.Err()
}

// UpdateUploadProgress updates the committed bytes for an in-progress upload.
func (s *Store) UpdateUploadProgress(fileKey string, committedBytes int64) error {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(
		"UPDATE uploads SET committed_bytes = ?, updated_at = ? WHERE file_key = ?",
		committedBytes, now, fileKey,
	)
	if err != nil {
		return fmt.Errorf("update upload progress %q: %w", fileKey, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("update upload progress %q: %w", fileKey, ErrNoRows)
	}
	return nil
}

// CompleteUpload marks an upload as completed with its final path, hash, and transmission time.
func (s *Store) CompleteUpload(fileKey, finalPath, sha256 string, transmissionMs int64) error {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(`
		UPDATE uploads
		SET status = 'completed', final_path = ?, sha256 = ?,
		    active_transmission_ms = ?, completed_at = ?, updated_at = ?
		WHERE file_key = ?`,
		finalPath, sha256, transmissionMs, now, now, fileKey,
	)
	if err != nil {
		return fmt.Errorf("complete upload %q: %w", fileKey, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("complete upload %q: %w", fileKey, ErrNoRows)
	}
	return nil
}

// UpsertDailyStats inserts or updates a device daily stats record.
func (s *Store) UpsertDailyStats(stat DailyStats) error {
	_, err := s.db.Exec(`
		INSERT INTO device_daily_stats (stat_date, client_id, client_name_snapshot, client_ip_snapshot,
			file_count, total_bytes, active_transmission_ms, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(stat_date, client_id) DO UPDATE SET
			client_name_snapshot = excluded.client_name_snapshot,
			client_ip_snapshot = excluded.client_ip_snapshot,
			file_count = file_count + excluded.file_count,
			total_bytes = total_bytes + excluded.total_bytes,
			active_transmission_ms = active_transmission_ms + excluded.active_transmission_ms,
			updated_at = excluded.updated_at`,
		stat.StatDate, stat.ClientID, stat.ClientNameSnapshot, stat.ClientIPSnapshot,
		stat.FileCount, stat.TotalBytes, stat.ActiveTransmissionMs, stat.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert daily stats: %w", err)
	}
	return nil
}

// GetDashboardSummary aggregates file count and total bytes for a given date.
func (s *Store) GetDashboardSummary(today string) (DashboardSummaryResult, error) {
	var result DashboardSummaryResult
	err := s.db.QueryRow(`
		SELECT COALESCE(SUM(file_count), 0), COALESCE(SUM(total_bytes), 0)
		FROM device_daily_stats
		WHERE stat_date = ?`, today,
	).Scan(&result.TotalFiles, &result.TotalBytes)
	if err != nil && err != sql.ErrNoRows {
		return result, fmt.Errorf("get dashboard summary: %w", err)
	}
	return result, nil
}

// GetDashboardDevices returns per-device dashboard data for a given date,
// joining paired_devices with daily stats and optionally including current session info.
// Uses subquery to pick only the latest session per device, avoiding duplicates.
func (s *Store) GetDashboardDevices(today string) ([]DashboardDeviceResult, error) {
	rows, err := s.db.Query(`
		SELECT
			pd.client_id,
			pd.client_name,
			pd.device_alias,
			pd.last_ip,
			pd.platform,
			pd.last_seen_at,
			COALESCE(ds.file_count, 0),
			COALESCE(ds.total_bytes, 0),
			u.original_filename,
			latest_sess.state
		FROM paired_devices pd
		LEFT JOIN device_daily_stats ds ON ds.client_id = pd.client_id AND ds.stat_date = ?
		LEFT JOIN (
			SELECT client_id, state, active_file_key,
				ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY started_at DESC) AS rn
			FROM sessions
		) latest_sess ON latest_sess.client_id = pd.client_id AND latest_sess.rn = 1
		LEFT JOIN uploads u ON u.file_key = latest_sess.active_file_key
		WHERE pd.revoked_at IS NULL
		ORDER BY pd.last_seen_at DESC`, today,
	)
	if err != nil {
		return nil, fmt.Errorf("get dashboard devices: %w", err)
	}
	defer rows.Close()

	var devices []DashboardDeviceResult
	for rows.Next() {
		var d DashboardDeviceResult
		if err := rows.Scan(
			&d.ClientID, &d.ClientName, &d.DeviceAlias, &d.LastIP, &d.Platform,
			&d.LastSeenAt, &d.FileCount, &d.TotalBytes, &d.CurrentFile, &d.SessionState,
		); err != nil {
			return nil, fmt.Errorf("scan dashboard device: %w", err)
		}
		devices = append(devices, d)
	}
	return devices, rows.Err()
}
