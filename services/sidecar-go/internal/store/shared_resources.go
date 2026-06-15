package store

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

func (s *Store) AddSharedResource(input SharedResourceInput) (SharedResource, error) {
	if input.LocalPath != nil && hasPathTraversal(*input.LocalPath) {
		return SharedResource{}, fmt.Errorf("shared resource path rejects traversal")
	}
	resourceID, err := randomID("res")
	if err != nil {
		return SharedResource{}, err
	}
	status := input.Status
	if status == "" {
		status = "available"
	}
	now := time.Now().UTC().Format(time.RFC3339)
	resource := SharedResource{
		ResourceID:      resourceID,
		DesktopDeviceID: input.DesktopDeviceID,
		Kind:            input.Kind,
		DisplayName:     input.DisplayName,
		LocalPath:       input.LocalPath,
		ReceivedFileKey: input.ReceivedFileKey,
		FileSize:        input.FileSize,
		MediaType:       input.MediaType,
		Status:          status,
		AddedAt:         now,
	}
	_, err = s.db.Exec(`
		INSERT INTO shared_resources
			(resource_id, desktop_device_id, kind, display_name, local_path, received_file_key,
			 file_size, media_type, status, added_at, removed_at, last_accessed_at, download_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0)`,
		resource.ResourceID, resource.DesktopDeviceID, resource.Kind, resource.DisplayName,
		resource.LocalPath, resource.ReceivedFileKey, resource.FileSize, resource.MediaType,
		resource.Status, resource.AddedAt,
	)
	if err != nil {
		return SharedResource{}, fmt.Errorf("add shared resource: %w", err)
	}
	return resource, nil
}

func (s *Store) RemoveSharedResource(desktopDeviceID, resourceID string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(`
		UPDATE shared_resources
		SET status = 'removed', removed_at = ?
		WHERE desktop_device_id = ? AND resource_id = ? AND status != 'removed'`,
		now, desktopDeviceID, resourceID,
	)
	if err != nil {
		return fmt.Errorf("remove shared resource: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("remove shared resource %q: %w", resourceID, ErrNoRows)
	}
	return nil
}

func (s *Store) ListSharedResources(desktopDeviceID string) ([]SharedResource, error) {
	rows, err := s.db.Query(`
		SELECT resource_id, desktop_device_id, kind, display_name, local_path, received_file_key,
		       file_size, media_type, status, added_at, removed_at, last_accessed_at, download_count
		FROM shared_resources
		WHERE desktop_device_id = ? AND status != 'removed' AND removed_at IS NULL
		ORDER BY added_at DESC, resource_id DESC`,
		desktopDeviceID,
	)
	if err != nil {
		return nil, fmt.Errorf("list shared resources: %w", err)
	}
	defer rows.Close()

	resources := make([]SharedResource, 0)
	for rows.Next() {
		resource, err := scanSharedResource(rows)
		if err != nil {
			return nil, err
		}
		resources = append(resources, resource)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate shared resources: %w", err)
	}
	return resources, nil
}

func (s *Store) ResolveSharedResource(desktopDeviceID, resourceID string) (SharedResource, error) {
	resource, err := scanSharedResource(s.db.QueryRow(`
		SELECT resource_id, desktop_device_id, kind, display_name, local_path, received_file_key,
		       file_size, media_type, status, added_at, removed_at, last_accessed_at, download_count
		FROM shared_resources
		WHERE desktop_device_id = ? AND resource_id = ? AND status = 'available' AND removed_at IS NULL`,
		desktopDeviceID, resourceID,
	))
	if err != nil {
		return SharedResource{}, fmt.Errorf("resolve shared resource: %w", err)
	}
	return resource, nil
}

type sharedResourceScanner interface {
	Scan(dest ...any) error
}

func scanSharedResource(scanner sharedResourceScanner) (SharedResource, error) {
	var resource SharedResource
	if err := scanner.Scan(
		&resource.ResourceID, &resource.DesktopDeviceID, &resource.Kind, &resource.DisplayName,
		&resource.LocalPath, &resource.ReceivedFileKey, &resource.FileSize, &resource.MediaType,
		&resource.Status, &resource.AddedAt, &resource.RemovedAt, &resource.LastAccessedAt,
		&resource.DownloadCount,
	); err != nil {
		return SharedResource{}, fmt.Errorf("scan shared resource: %w", err)
	}
	return resource, nil
}

func hasPathTraversal(path string) bool {
	for _, part := range strings.FieldsFunc(path, func(r rune) bool {
		return r == '/' || r == '\\'
	}) {
		if part == ".." {
			return true
		}
	}
	cleaned := filepath.Clean(path)
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, `..\`) {
		return true
	}
	return false
}

func randomID(prefix string) (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate random id: %w", err)
	}
	return prefix + "_" + hex.EncodeToString(b[:]), nil
}
