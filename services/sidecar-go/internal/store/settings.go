package store

import (
	"database/sql"
	"fmt"
)

// GetSetting retrieves a setting value by key.
// Returns sql.ErrNoRows if the key does not exist.
func (s *Store) GetSetting(key string) (string, error) {
	var value string
	err := s.db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	if err != nil {
		return "", fmt.Errorf("get setting %q: %w", key, err)
	}
	return value, nil
}

// SetSetting inserts or updates a setting key-value pair.
func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(
		"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		key, value,
	)
	if err != nil {
		return fmt.Errorf("set setting %q: %w", key, err)
	}
	return nil
}

// GetConnectionCode returns the current connection code.
func (s *Store) GetConnectionCode() (string, error) {
	return s.GetSetting("connection_code")
}

// SetConnectionCode updates the connection code.
func (s *Store) SetConnectionCode(code string) error {
	return s.SetSetting("connection_code", code)
}

// GetDeviceID returns the auto-generated device identifier.
func (s *Store) GetDeviceID() (string, error) {
	return s.GetSetting("device_id")
}

// GetDeviceName returns the user-assigned device name.
func (s *Store) GetDeviceName() (string, error) {
	return s.GetSetting("device_name")
}

// SetDeviceName updates the device display name.
func (s *Store) SetDeviceName(name string) error {
	return s.SetSetting("device_name", name)
}

// settingExists checks if a given key is present in settings (used internally for testing).
func (s *Store) settingExists(key string) bool {
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM settings WHERE key = ?", key).Scan(&count)
	return err == nil && count > 0
}

// ErrNoRows exposes sql.ErrNoRows for callers.
var ErrNoRows = sql.ErrNoRows
