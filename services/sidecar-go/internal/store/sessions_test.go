package store

import (
	"errors"
	"testing"
	"time"
)

func sampleSession(id, clientID string) Session {
	now := time.Now().UTC().Format(time.RFC3339)
	return Session{
		SessionID:  id,
		ClientID:   clientID,
		ClientName: "Test Phone",
		State:      "idle",
		StartedAt:  now,
		UpdatedAt:  now,
	}
}

func TestUpsertGetSession_Roundtrip(t *testing.T) {
	s := newTestStore(t)
	sess := sampleSession("sess-1", "client-1")

	if err := s.UpsertSession(sess); err != nil {
		t.Fatalf("UpsertSession: %v", err)
	}

	got, err := s.GetSession("sess-1")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.SessionID != "sess-1" {
		t.Errorf("expected session_id 'sess-1', got %q", got.SessionID)
	}
	if got.State != "idle" {
		t.Errorf("expected state 'idle', got %q", got.State)
	}
	if got.ClientName != "Test Phone" {
		t.Errorf("expected client_name 'Test Phone', got %q", got.ClientName)
	}
}

func TestUpsertSession_UpdatesExisting(t *testing.T) {
	s := newTestStore(t)
	sess := sampleSession("sess-u", "client-1")

	if err := s.UpsertSession(sess); err != nil {
		t.Fatalf("UpsertSession: %v", err)
	}

	fileKey := "file-active"
	sess.State = "transferring"
	sess.ActiveFileKey = &fileKey
	sess.ActiveOffset = 1024
	sess.UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	if err := s.UpsertSession(sess); err != nil {
		t.Fatalf("UpsertSession update: %v", err)
	}

	got, err := s.GetSession("sess-u")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.State != "transferring" {
		t.Errorf("expected state 'transferring', got %q", got.State)
	}
	if got.ActiveFileKey == nil || *got.ActiveFileKey != "file-active" {
		t.Errorf("expected active_file_key 'file-active', got %v", got.ActiveFileKey)
	}
	if got.ActiveOffset != 1024 {
		t.Errorf("expected active_offset 1024, got %d", got.ActiveOffset)
	}
}

func TestGetSession_NotFound(t *testing.T) {
	s := newTestStore(t)

	_, err := s.GetSession("nonexistent")
	if !errors.Is(err, ErrNoRows) {
		t.Errorf("expected ErrNoRows, got %v", err)
	}
}

func TestUpdateSessionState(t *testing.T) {
	s := newTestStore(t)
	sess := sampleSession("sess-state", "client-1")

	if err := s.UpsertSession(sess); err != nil {
		t.Fatalf("UpsertSession: %v", err)
	}

	if err := s.UpdateSessionState("sess-state", "ended"); err != nil {
		t.Fatalf("UpdateSessionState: %v", err)
	}

	got, err := s.GetSession("sess-state")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.State != "ended" {
		t.Errorf("expected state 'ended', got %q", got.State)
	}
}

func TestUpdateSessionState_NotFound(t *testing.T) {
	s := newTestStore(t)

	err := s.UpdateSessionState("nonexistent", "ended")
	if !errors.Is(err, ErrNoRows) {
		t.Errorf("expected ErrNoRows, got %v", err)
	}
}

func TestGetActiveSession(t *testing.T) {
	s := newTestStore(t)

	// Create ended session
	ended := sampleSession("ended-1", "client-1")
	ended.State = "ended"
	if err := s.UpsertSession(ended); err != nil {
		t.Fatalf("UpsertSession ended: %v", err)
	}

	// Create active session
	active := sampleSession("active-1", "client-1")
	active.State = "transferring"
	active.UpdatedAt = time.Now().UTC().Add(time.Second).Format(time.RFC3339)
	if err := s.UpsertSession(active); err != nil {
		t.Fatalf("UpsertSession active: %v", err)
	}

	got, err := s.GetActiveSession("client-1")
	if err != nil {
		t.Fatalf("GetActiveSession: %v", err)
	}
	if got.SessionID != "active-1" {
		t.Errorf("expected session_id 'active-1', got %q", got.SessionID)
	}
	if got.State != "transferring" {
		t.Errorf("expected state 'transferring', got %q", got.State)
	}
}

func TestGetActiveSession_NoneActive(t *testing.T) {
	s := newTestStore(t)

	ended := sampleSession("ended-only", "client-2")
	ended.State = "ended"
	if err := s.UpsertSession(ended); err != nil {
		t.Fatalf("UpsertSession: %v", err)
	}

	_, err := s.GetActiveSession("client-2")
	if !errors.Is(err, ErrNoRows) {
		t.Errorf("expected ErrNoRows when no active session, got %v", err)
	}
}

func TestGetActiveSession_IgnoresCompletedAndInterrupted(t *testing.T) {
	s := newTestStore(t)

	completed := sampleSession("completed-1", "client-3")
	completed.State = "completed"
	if err := s.UpsertSession(completed); err != nil {
		t.Fatalf("UpsertSession completed: %v", err)
	}

	interrupted := sampleSession("interrupted-1", "client-3")
	interrupted.State = "interrupted"
	interrupted.UpdatedAt = time.Now().UTC().Add(time.Second).Format(time.RFC3339)
	if err := s.UpsertSession(interrupted); err != nil {
		t.Fatalf("UpsertSession interrupted: %v", err)
	}

	_, err := s.GetActiveSession("client-3")
	if !errors.Is(err, ErrNoRows) {
		t.Errorf("expected ErrNoRows when only completed/interrupted sessions exist, got %v", err)
	}
}
