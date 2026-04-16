package store

import (
	"fmt"
	"time"
)

// UpsertSession inserts or replaces a sync session record.
func (s *Store) UpsertSession(sess Session) error {
	_, err := s.db.Exec(`
		INSERT INTO sessions (session_id, client_id, client_name, state, active_file_key, active_offset, started_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(session_id) DO UPDATE SET
			client_id = excluded.client_id,
			client_name = excluded.client_name,
			state = excluded.state,
			active_file_key = excluded.active_file_key,
			active_offset = excluded.active_offset,
			updated_at = excluded.updated_at`,
		sess.SessionID, sess.ClientID, sess.ClientName, sess.State,
		sess.ActiveFileKey, sess.ActiveOffset, sess.StartedAt, sess.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert session %q: %w", sess.SessionID, err)
	}
	return nil
}

// GetSession retrieves a session by ID.
func (s *Store) GetSession(sessionID string) (*Session, error) {
	sess := &Session{}
	err := s.db.QueryRow(`
		SELECT session_id, client_id, client_name, state, active_file_key, active_offset, started_at, updated_at
		FROM sessions WHERE session_id = ?`, sessionID,
	).Scan(
		&sess.SessionID, &sess.ClientID, &sess.ClientName, &sess.State,
		&sess.ActiveFileKey, &sess.ActiveOffset, &sess.StartedAt, &sess.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get session %q: %w", sessionID, err)
	}
	return sess, nil
}

// UpdateSessionState changes the state of a session and updates the timestamp.
func (s *Store) UpdateSessionState(sessionID, state string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(
		"UPDATE sessions SET state = ?, updated_at = ? WHERE session_id = ?",
		state, now, sessionID,
	)
	if err != nil {
		return fmt.Errorf("update session state %q: %w", sessionID, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("update session state %q: %w", sessionID, ErrNoRows)
	}
	return nil
}

// UpdateSessionActiveFile updates the currently active file and its byte offset for a session.
func (s *Store) UpdateSessionActiveFile(sessionID, fileKey string, offset int64) error {
	_, err := s.db.Exec(
		`UPDATE sessions SET active_file_key = ?, active_offset = ?, updated_at = ? WHERE session_id = ?`,
		fileKey, offset, time.Now().UTC().Format(time.RFC3339), sessionID,
	)
	if err != nil {
		return fmt.Errorf("update session active file %q: %w", sessionID, err)
	}
	return nil
}

// GetActiveSession returns the most recent non-ended, non-error session for a client.
func (s *Store) GetActiveSession(clientID string) (*Session, error) {
	sess := &Session{}
	err := s.db.QueryRow(`
		SELECT session_id, client_id, client_name, state, active_file_key, active_offset, started_at, updated_at
		FROM sessions
		WHERE client_id = ? AND state NOT IN ('ended', 'error', 'completed', 'interrupted')
		ORDER BY updated_at DESC
		LIMIT 1`, clientID,
	).Scan(
		&sess.SessionID, &sess.ClientID, &sess.ClientName, &sess.State,
		&sess.ActiveFileKey, &sess.ActiveOffset, &sess.StartedAt, &sess.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get active session for %q: %w", clientID, err)
	}
	return sess, nil
}
