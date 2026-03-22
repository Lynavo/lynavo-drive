package store

import (
	"database/sql"
	_ "embed"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

//go:embed migrations/001_initial.sql
var migrationSQL string

//go:embed migrations/002_device_dir_name.sql
var migration002SQL string

// Store wraps a SQLite database connection and provides CRUD operations
// for all SyncFlow sidecar tables.
type Store struct {
	db *sql.DB
}

// New opens (or creates) a SQLite database at dbPath and runs migrations.
func New(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// DB returns the underlying *sql.DB for advanced use cases.
func (s *Store) DB() *sql.DB {
	return s.db
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(migrationSQL); err != nil {
		return err
	}
	// Migration 002: add receive_dir_name column (idempotent — ignore if exists)
	_, _ = s.db.Exec(migration002SQL)
	return nil
}
