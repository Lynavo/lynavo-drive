package store

import (
	"errors"
	"testing"
	"time"
)

func sampleDevice(id string) PairedDevice {
	now := time.Now().UTC().Format(time.RFC3339)
	alias := "iPhone-Work"
	ip := "192.168.1.10"
	return PairedDevice{
		ClientID:         id,
		ClientName:       "Test iPhone",
		DeviceAlias:      &alias,
		LastIP:           &ip,
		Platform:         "ios",
		PairingID:        "pair-" + id,
		PairingTokenHash: "hash-" + id,
		CreatedAt:        now,
		LastSeenAt:       now,
	}
}

func TestUpsertGetPairedDevice_Roundtrip(t *testing.T) {
	s := newTestStore(t)
	d := sampleDevice("client-1")

	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	got, err := s.GetPairedDevice("client-1")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if got.ClientID != "client-1" {
		t.Errorf("expected client_id 'client-1', got %q", got.ClientID)
	}
	if got.ClientName != "Test iPhone" {
		t.Errorf("expected client_name 'Test iPhone', got %q", got.ClientName)
	}
	if got.DeviceAlias == nil || *got.DeviceAlias != "iPhone-Work" {
		t.Errorf("expected device_alias 'iPhone-Work', got %v", got.DeviceAlias)
	}
	if got.LastIP == nil || *got.LastIP != "192.168.1.10" {
		t.Errorf("expected last_ip '192.168.1.10', got %v", got.LastIP)
	}
	if got.Platform != "ios" {
		t.Errorf("expected platform 'ios', got %q", got.Platform)
	}
	if got.PairingTokenHash != "hash-client-1" {
		t.Errorf("expected pairing_token_hash 'hash-client-1', got %q", got.PairingTokenHash)
	}
}

func TestUpsertPairedDevice_UpdatesExisting(t *testing.T) {
	s := newTestStore(t)
	d := sampleDevice("client-2")

	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	d.ClientName = "Updated Name"
	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice update: %v", err)
	}

	got, err := s.GetPairedDevice("client-2")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if got.ClientName != "Updated Name" {
		t.Errorf("expected 'Updated Name', got %q", got.ClientName)
	}
}

func TestUpsertPairedDevicePreservesRevocationWhenMetadataRefreshOmitsRevokedAt(t *testing.T) {
	s := newTestStore(t)
	d := sampleDevice("client-revoked-refresh")
	revokedAt := "2026-06-10T08:09:10Z"
	d.RevokedAt = &revokedAt

	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	d.ClientName = "Updated iPhone"
	d.RevokedAt = nil
	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice metadata refresh: %v", err)
	}

	got, err := s.GetPairedDevice("client-revoked-refresh")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if got.ClientName != "Updated iPhone" {
		t.Fatalf("expected refreshed metadata, got client_name=%q", got.ClientName)
	}
	if got.RevokedAt == nil || *got.RevokedAt != revokedAt {
		t.Fatalf("expected revoked_at to remain %q, got %v", revokedAt, got.RevokedAt)
	}
}

func TestUpsertAuthorizedPairedDeviceClearsPreviousRevocationAfterSuccessfulPairing(t *testing.T) {
	s := newTestStore(t)
	d := sampleDevice("client-repair")
	revokedAt := "2026-06-10T08:09:10Z"
	d.RevokedAt = &revokedAt

	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	d.PairingID = "pair-client-repair-new"
	d.PairingTokenHash = "hash-client-repair-new"
	d.RevokedAt = nil
	if err := s.UpsertAuthorizedPairedDevice(d); err != nil {
		t.Fatalf("UpsertAuthorizedPairedDevice: %v", err)
	}

	got, err := s.GetPairedDevice("client-repair")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if got.RevokedAt != nil {
		t.Fatalf("expected successful pairing to clear revoked_at, got %q", *got.RevokedAt)
	}
	if got.PairingTokenHash != "hash-client-repair-new" {
		t.Fatalf("expected refreshed token hash, got %q", got.PairingTokenHash)
	}
}

func TestGetPairedDevice_NotFound(t *testing.T) {
	s := newTestStore(t)

	_, err := s.GetPairedDevice("nonexistent")
	if !errors.Is(err, ErrNoRows) {
		t.Errorf("expected ErrNoRows, got %v", err)
	}
}

func TestListPairedDevices(t *testing.T) {
	s := newTestStore(t)

	for i, id := range []string{"a", "b", "c"} {
		d := sampleDevice(id)
		d.LastSeenAt = time.Now().UTC().Add(time.Duration(i) * time.Second).Format(time.RFC3339)
		if err := s.UpsertPairedDevice(d); err != nil {
			t.Fatalf("UpsertPairedDevice %q: %v", id, err)
		}
	}

	devices, err := s.ListPairedDevices()
	if err != nil {
		t.Fatalf("ListPairedDevices: %v", err)
	}
	if len(devices) != 3 {
		t.Fatalf("expected 3 devices, got %d", len(devices))
	}
	// Should be ordered by last_seen_at DESC
	if devices[0].ClientID != "c" {
		t.Errorf("expected first device to be 'c', got %q", devices[0].ClientID)
	}
}

func TestRevokePairedDevice(t *testing.T) {
	s := newTestStore(t)
	d := sampleDevice("revoke-me")

	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	if err := s.RevokePairedDevice("revoke-me"); err != nil {
		t.Fatalf("RevokePairedDevice: %v", err)
	}

	got, err := s.GetPairedDevice("revoke-me")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if got.RevokedAt == nil {
		t.Error("expected revoked_at to be set")
	}
}

func TestRevokePairedDeviceAlreadyRevokedReturnsNotFoundAndKeepsOriginalTimestamp(t *testing.T) {
	s := newTestStore(t)
	d := sampleDevice("already-revoked")
	revokedAt := "2026-06-10T08:09:10Z"
	d.RevokedAt = &revokedAt

	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	err := s.RevokePairedDevice("already-revoked")
	if !errors.Is(err, ErrNoRows) {
		t.Fatalf("expected ErrNoRows, got %v", err)
	}

	got, err := s.GetPairedDevice("already-revoked")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if got.RevokedAt == nil || *got.RevokedAt != revokedAt {
		t.Fatalf("expected revoked_at to remain %q, got %v", revokedAt, got.RevokedAt)
	}
}

func TestRevokePairedDevice_NotFound(t *testing.T) {
	s := newTestStore(t)

	err := s.RevokePairedDevice("nonexistent")
	if !errors.Is(err, ErrNoRows) {
		t.Errorf("expected ErrNoRows, got %v", err)
	}
}

func TestUpdateLastSeen(t *testing.T) {
	s := newTestStore(t)
	d := sampleDevice("update-ls")
	d.LastSeenAt = "2024-01-01T00:00:00Z"

	if err := s.UpsertPairedDevice(d); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}

	if err := s.UpdateLastSeen("update-ls", "10.0.0.5"); err != nil {
		t.Fatalf("UpdateLastSeen: %v", err)
	}

	got, err := s.GetPairedDevice("update-ls")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if got.LastSeenAt == "2024-01-01T00:00:00Z" {
		t.Error("expected last_seen_at to be updated")
	}
	if got.LastIP == nil || *got.LastIP != "10.0.0.5" {
		t.Errorf("expected last_ip '10.0.0.5', got %v", got.LastIP)
	}
}

func TestUpdateLastSeen_NotFound(t *testing.T) {
	s := newTestStore(t)

	err := s.UpdateLastSeen("nonexistent", "1.2.3.4")
	if !errors.Is(err, ErrNoRows) {
		t.Errorf("expected ErrNoRows, got %v", err)
	}
}
