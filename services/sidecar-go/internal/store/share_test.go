package store

import "testing"

func TestGetShareConfig_DefaultSeeds(t *testing.T) {
	s := newTestStore(t)

	cfg, err := s.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	if cfg.ReceiveRoot != "" {
		t.Errorf("expected empty receive_root, got %q", cfg.ReceiveRoot)
	}
	if cfg.ShareName != "Lynavo Drive" {
		t.Errorf("expected share_name 'Lynavo Drive', got %q", cfg.ShareName)
	}
	if cfg.ShareURL != "" {
		t.Errorf("expected empty share_url, got %q", cfg.ShareURL)
	}
	if cfg.ShareStatus != "unknown" {
		t.Errorf("expected share_status 'unknown', got %q", cfg.ShareStatus)
	}
	if cfg.LastValidatedAt != nil {
		t.Errorf("expected nil last_validated_at, got %v", cfg.LastValidatedAt)
	}
	if cfg.LastError != nil {
		t.Errorf("expected nil last_error, got %v", cfg.LastError)
	}
}

func TestUpdateGetShareConfig_Roundtrip(t *testing.T) {
	s := newTestStore(t)

	validated := "2026-03-21T12:00:00Z"
	updated := ShareConfig{
		ReceiveRoot:     "/Users/test/LynavoDrive",
		ShareName:       "MyShare",
		ShareURL:        "smb://mac/MyShare",
		ShareStatus:     "valid",
		LastValidatedAt: &validated,
		LastError:       nil,
	}

	if err := s.UpdateShareConfig(updated); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}

	got, err := s.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	if got.ReceiveRoot != "/Users/test/LynavoDrive" {
		t.Errorf("expected receive_root '/Users/test/LynavoDrive', got %q", got.ReceiveRoot)
	}
	if got.ShareName != "MyShare" {
		t.Errorf("expected share_name 'MyShare', got %q", got.ShareName)
	}
	if got.ShareURL != "smb://mac/MyShare" {
		t.Errorf("expected share_url 'smb://mac/MyShare', got %q", got.ShareURL)
	}
	if got.ShareStatus != "valid" {
		t.Errorf("expected share_status 'valid', got %q", got.ShareStatus)
	}
	if got.LastValidatedAt == nil || *got.LastValidatedAt != "2026-03-21T12:00:00Z" {
		t.Errorf("expected last_validated_at '2026-03-21T12:00:00Z', got %v", got.LastValidatedAt)
	}
	if got.LastError != nil {
		t.Errorf("expected nil last_error, got %v", got.LastError)
	}
}

func TestUpdateShareConfig_WithError(t *testing.T) {
	s := newTestStore(t)

	errMsg := "share not found"
	updated := ShareConfig{
		ReceiveRoot: "/tmp",
		ShareName:   "X",
		ShareURL:    "",
		ShareStatus: "error",
		LastError:   &errMsg,
	}

	if err := s.UpdateShareConfig(updated); err != nil {
		t.Fatalf("UpdateShareConfig: %v", err)
	}

	got, err := s.GetShareConfig()
	if err != nil {
		t.Fatalf("GetShareConfig: %v", err)
	}
	if got.ShareStatus != "error" {
		t.Errorf("expected share_status 'error', got %q", got.ShareStatus)
	}
	if got.LastError == nil || *got.LastError != "share not found" {
		t.Errorf("expected last_error 'share not found', got %v", got.LastError)
	}
}
