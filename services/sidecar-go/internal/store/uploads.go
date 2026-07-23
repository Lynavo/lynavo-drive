package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

// AbsolutizeCompletedUploadFinalPaths preserves completed upload locations
// before the configured receive directory changes.
func (s *Store) AbsolutizeCompletedUploadFinalPaths(
	receiveDir string,
	preserveUnavailablePaths bool,
) error {
	if strings.TrimSpace(receiveDir) == "" || !filepath.IsAbs(receiveDir) {
		return fmt.Errorf("receive directory must be an absolute path")
	}

	rows, err := s.db.Query(`
		SELECT file_key, final_path
		FROM uploads
		WHERE status = 'completed' AND final_path IS NOT NULL AND final_path != ''`)
	if err != nil {
		return fmt.Errorf("list completed upload final paths: %w", err)
	}

	type finalPathUpdate struct {
		fileKey      string
		previousPath string
		absolutePath string
	}
	updates := []finalPathUpdate{}
	for rows.Next() {
		var fileKey string
		var finalPath string
		if err := rows.Scan(&fileKey, &finalPath); err != nil {
			rows.Close()
			return fmt.Errorf("scan completed upload final path: %w", err)
		}
		if filepath.IsAbs(finalPath) {
			continue
		}
		absolutePath := filepath.Join(receiveDir, finalPath)
		if !preserveUnavailablePaths {
			if info, err := os.Stat(absolutePath); err != nil || info.IsDir() {
				continue
			}
		}
		updates = append(updates, finalPathUpdate{
			fileKey:      fileKey,
			previousPath: finalPath,
			absolutePath: absolutePath,
		})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate completed upload final paths: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close completed upload final paths: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin completed upload path update: %w", err)
	}
	defer tx.Rollback()
	for _, update := range updates {
		if _, err := tx.Exec(`
			UPDATE uploads
			SET final_path = ?
			WHERE file_key = ? AND final_path = ?`,
			update.absolutePath, update.fileKey, update.previousPath,
		); err != nil {
			return fmt.Errorf("preserve completed upload path %q: %w", update.fileKey, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit completed upload path update: %w", err)
	}
	return nil
}

// ListCompletedUploadRootDirs returns distinct first path components used by
// completed uploads for a client, newest first.
func (s *Store) ListCompletedUploadRootDirs(clientID, receiveDir string) ([]string, error) {
	rows, err := s.db.Query(`
		SELECT final_path
		FROM uploads
		WHERE client_id = ? AND status = 'completed' AND final_path IS NOT NULL AND final_path != ''
		ORDER BY COALESCE(completed_at, updated_at) DESC, file_key DESC`, clientID)
	if err != nil {
		return nil, fmt.Errorf("list completed upload root dirs for %q: %w", clientID, err)
	}
	defer rows.Close()

	seen := map[string]bool{}
	roots := []string{}
	for rows.Next() {
		var finalPath string
		if err := rows.Scan(&finalPath); err != nil {
			return nil, fmt.Errorf("scan completed upload final path: %w", err)
		}
		root := uploadRootDirFromFinalPath(finalPath, receiveDir)
		if root == "" || seen[root] {
			continue
		}
		seen[root] = true
		roots = append(roots, root)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return roots, nil
}

func uploadRootDirFromFinalPath(finalPath, receiveDir string) string {
	trimmed := strings.TrimSpace(finalPath)
	if trimmed == "" {
		return ""
	}
	if filepath.IsAbs(trimmed) {
		relativePath, err := filepath.Rel(receiveDir, trimmed)
		if err != nil || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
			return ""
		}
		trimmed = relativePath
	} else if strings.HasPrefix(trimmed, `\`) || (len(trimmed) >= 2 && trimmed[1] == ':') {
		return ""
	}
	separatorIndex := strings.IndexAny(trimmed, `/\`)
	if separatorIndex <= 0 {
		return ""
	}
	root := strings.TrimSpace(trimmed[:separatorIndex])
	if root == "" || root == "." || root == ".." {
		return ""
	}
	return root
}

// ListUploadsByDeviceAndDate returns uploads for a given client on a given date (YYYY-MM-DD).
func (s *Store) ListUploadsByDeviceAndDate(clientID, date string) ([]Upload, error) {
	page, err := s.ListUploadsPageByDeviceAndDate(clientID, date, "completedAt", "desc", 1, 10000)
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}

func (s *Store) ListUploadsPageByDeviceAndDate(
	clientID, date, sortField, sortDirection string,
	page, pageSize int,
) (UploadPage, error) {
	return s.ListUploadsPageByDeviceAndDateRange(clientID, date, "", sortField, sortDirection, page, pageSize)
}

func (s *Store) ListUploadsPageByDeviceAndDateRange(
	clientID, startDate, endDate, sortField, sortDirection string,
	page, pageSize int,
) (UploadPage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 200
	}

	orderBy, err := buildUploadOrderClause(sortField, sortDirection)
	if err != nil {
		return UploadPage{}, err
	}

	var result UploadPage
	result.Page = page
	result.PageSize = pageSize

	// Build date filter: single day or range
	dateFilter := "DATE(updated_at, 'localtime') = ?"
	dateArgs := []any{clientID, startDate}
	if endDate != "" && endDate != startDate {
		dateFilter = "DATE(updated_at, 'localtime') BETWEEN ? AND ?"
		dateArgs = []any{clientID, startDate, endDate}
	}

	countSQL := fmt.Sprintf(`
		SELECT
			COUNT(*),
			COALESCE(SUM(file_size), 0),
			COALESCE(SUM(active_transmission_ms), 0)
		FROM uploads
		WHERE client_id = ? AND %s AND status = 'completed'`, dateFilter)
	if err := s.db.QueryRow(countSQL, dateArgs...,
	).Scan(&result.TotalItems, &result.TotalBytes, &result.TotalActiveTransmissionMs); err != nil {
		return UploadPage{}, fmt.Errorf("list uploads summary for %q on %s..%s: %w", clientID, startDate, endDate, err)
	}

	querySQL := fmt.Sprintf(`
		SELECT file_key, session_id, client_id, original_filename, media_type,
		       file_size, created_at_remote, modified_at_remote, status, part_path, final_path,
		       committed_bytes, sha256, active_transmission_ms, completed_at, updated_at
		FROM uploads
		WHERE client_id = ? AND %s AND status = 'completed'
		ORDER BY %s
		LIMIT ? OFFSET ?`, dateFilter, orderBy)
	queryArgs := append(dateArgs, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(querySQL, queryArgs...)
	if err != nil {
		return UploadPage{}, fmt.Errorf("list uploads page for %q on %s..%s: %w", clientID, startDate, endDate, err)
	}
	defer rows.Close()

	items := make([]Upload, 0, pageSize)
	for rows.Next() {
		var u Upload
		if err := rows.Scan(
			&u.FileKey, &u.SessionID, &u.ClientID, &u.OriginalFilename, &u.MediaType,
			&u.FileSize, &u.CreatedAtRemote, &u.ModifiedAtRemote, &u.Status, &u.PartPath, &u.FinalPath,
			&u.CommittedBytes, &u.SHA256, &u.ActiveTransmissionMs, &u.CompletedAt, &u.UpdatedAt,
		); err != nil {
			return UploadPage{}, fmt.Errorf("scan upload: %w", err)
		}
		items = append(items, u)
	}
	if err := rows.Err(); err != nil {
		return UploadPage{}, err
	}

	result.Items = items
	return result, nil
}

func buildUploadOrderClause(sortField, sortDirection string) (string, error) {
	direction := strings.ToUpper(sortDirection)
	if direction != "ASC" && direction != "DESC" {
		direction = "DESC"
	}

	var expr string
	switch sortField {
	case "name":
		expr = "original_filename COLLATE NOCASE"
	case "size":
		expr = "file_size"
	case "createdAt":
		expr = "COALESCE(created_at_remote, '')"
	case "duration":
		expr = "active_transmission_ms"
	case "", "completedAt":
		expr = "COALESCE(completed_at, updated_at)"
	default:
		return "", fmt.Errorf("unsupported sort field %q", sortField)
	}

	return fmt.Sprintf("%s %s, updated_at %s, file_key %s", expr, direction, direction, direction), nil
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
		    active_transmission_ms = active_transmission_ms + ?, completed_at = ?, updated_at = ?
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

// PauseUploadForLowDisk marks an in-flight upload as resumable when disk space
// falls below the configured threshold mid-transfer.
func (s *Store) PauseUploadForLowDisk(fileKey string, committedBytes, transmissionMs int64) error {
	return s.PauseUploadResumable(fileKey, committedBytes, transmissionMs)
}

// PauseUploadResumable marks an in-flight upload as resumable after an
// environmental pause such as low disk space or unavailable storage path.
func (s *Store) PauseUploadResumable(fileKey string, committedBytes, transmissionMs int64) error {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(`
		UPDATE uploads
		SET status = 'paused_resumable',
		    committed_bytes = ?,
		    active_transmission_ms = active_transmission_ms + ?,
		    updated_at = ?
		WHERE file_key = ?`,
		committedBytes, transmissionMs, now, fileKey,
	)
	if err != nil {
		return fmt.Errorf("pause upload resumable %q: %w", fileKey, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("pause upload resumable %q: %w", fileKey, ErrNoRows)
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
	if err := s.db.QueryRow(`
		SELECT
			u.completed_at,
			COALESCE(NULLIF(pd.device_alias, ''), pd.client_name)
		FROM uploads u
		LEFT JOIN paired_devices pd ON pd.client_id = u.client_id
		WHERE u.status = 'completed' AND u.completed_at IS NOT NULL
		ORDER BY u.completed_at DESC
		LIMIT 1`,
	).Scan(&result.LastSuccessfulSyncAt, &result.LastSuccessfulDeviceName); err != nil && err != sql.ErrNoRows {
		return result, fmt.Errorf("get latest completed upload: %w", err)
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
			pd.receive_dir_name,
			pd.stable_device_id,
			pd.last_ip,
			pd.platform,
			pd.last_seen_at,
			COALESCE(ds.file_count, 0),
			COALESCE(ds.total_bytes, 0),
			u.original_filename,
			CASE
				WHEN u.file_size > 0 THEN
					CAST(u.committed_bytes AS REAL) * 100.0 / CAST(u.file_size AS REAL)
				ELSE 0
			END AS current_progress,
			COALESCE(u.file_size, 0) AS current_file_size,
			latest_sess.state
		FROM paired_devices pd
		LEFT JOIN device_daily_stats ds ON ds.client_id = pd.client_id AND ds.stat_date = ?
		LEFT JOIN (
			SELECT client_id, state, active_file_key,
				ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY started_at DESC) AS rn
			FROM sessions
			WHERE state = 'transferring'
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
			&d.ClientID, &d.ClientName, &d.DeviceAlias, &d.ReceiveDirName, &d.StableDeviceID, &d.LastIP, &d.Platform,
			&d.LastSeenAt, &d.FileCount, &d.TotalBytes, &d.CurrentFile, &d.CurrentProgress,
			&d.CurrentFileSize, &d.SessionState,
		); err != nil {
			return nil, fmt.Errorf("scan dashboard device: %w", err)
		}
		devices = append(devices, d)
	}
	return devices, rows.Err()
}
