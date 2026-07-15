package store

import "fmt"

// GetShareConfig retrieves the singleton share configuration row.
func (s *Store) GetShareConfig() (*ShareConfig, error) {
	cfg := &ShareConfig{}
	err := s.db.QueryRow(`
		SELECT receive_root, share_name, share_url, share_status, last_validated_at, last_error
		FROM share_config WHERE id = 1`,
	).Scan(
		&cfg.ReceiveRoot, &cfg.ShareName, &cfg.ShareURL, &cfg.ShareStatus,
		&cfg.LastValidatedAt, &cfg.LastError,
	)
	if err != nil {
		return nil, fmt.Errorf("get share config: %w", err)
	}
	return cfg, nil
}

// UpdateShareConfig updates the singleton share configuration row.
func (s *Store) UpdateShareConfig(cfg ShareConfig) error {
	_, err := s.db.Exec(`
		UPDATE share_config
		SET receive_root = ?, share_name = ?, share_url = ?, share_status = ?,
		    last_validated_at = ?, last_error = ?
		WHERE id = 1`,
		cfg.ReceiveRoot, cfg.ShareName, cfg.ShareURL, cfg.ShareStatus,
		cfg.LastValidatedAt, cfg.LastError,
	)
	if err != nil {
		return fmt.Errorf("update share config: %w", err)
	}
	return nil
}
