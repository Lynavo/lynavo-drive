package store

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestAccessRecordsScopedByDesktopAndClient(t *testing.T) {
	s := newTestStore(t)

	records := []AccessRecord{
		{
			DesktopDeviceID: "desktop-1",
			ClientID:        "client-1",
			ClientName:      "Alice iPhone",
			ResourceID:      "resource-1",
			ResourceKind:    "shared_file",
			ResourceName:    "Clip.mov",
			Action:          "list",
			Result:          "ok",
			AccessedAt:      time.Now().UTC().Format(time.RFC3339),
		},
		{
			DesktopDeviceID: "desktop-1",
			ClientID:        "client-1",
			ResourceID:      "resource-1",
			ResourceKind:    "shared_file",
			ResourceName:    "Clip.mov",
			Action:          "view",
			Result:          "ok",
			AccessedAt:      time.Now().UTC().Format(time.RFC3339),
		},
		{
			DesktopDeviceID: "desktop-1",
			ClientID:        "client-2",
			ResourceID:      "resource-1",
			ResourceKind:    "shared_file",
			ResourceName:    "Clip.mov",
			Action:          "download",
			Result:          "ok",
			AccessedAt:      time.Now().UTC().Format(time.RFC3339),
		},
		{
			DesktopDeviceID: "desktop-2",
			ClientID:        "client-1",
			ResourceID:      "resource-1",
			ResourceKind:    "shared_file",
			ResourceName:    "Clip.mov",
			Action:          "download",
			Result:          "ok",
			AccessedAt:      time.Now().UTC().Format(time.RFC3339),
		},
	}

	for i, record := range records {
		got, err := s.RecordAccess(record)
		if err != nil {
			t.Fatalf("RecordAccess #%d: %v", i+1, err)
		}
		if got.RecordID == "" {
			t.Fatalf("expected generated record id for record #%d", i+1)
		}
	}

	desktopRecords, err := s.ListAccessRecords("desktop-1", nil)
	if err != nil {
		t.Fatalf("ListAccessRecords desktop scope: %v", err)
	}
	if len(desktopRecords) != 3 {
		t.Fatalf("expected 3 desktop-1 records, got %d", len(desktopRecords))
	}

	clientID := "client-1"
	clientRecords, err := s.ListAccessRecords("desktop-1", &clientID)
	if err != nil {
		t.Fatalf("ListAccessRecords client scope: %v", err)
	}
	if len(clientRecords) != 2 {
		t.Fatalf("expected 2 desktop-1/client-1 records, got %d", len(clientRecords))
	}
	for _, record := range clientRecords {
		if record.DesktopDeviceID != "desktop-1" || record.ClientID != "client-1" {
			t.Fatalf("unexpected scoped record: %#v", record)
		}
	}
}

func TestAccessRecordAlwaysExposesDisplayName(t *testing.T) {
	s := newTestStore(t)

	record, err := s.RecordAccess(AccessRecord{
		DesktopDeviceID: "desktop-1",
		ClientID:        "client-1",
		ResourceID:      "resource-1",
		ResourceKind:    "shared_file",
		ResourceName:    "Clip.mov",
		Action:          "list",
		Result:          "ok",
		AccessedAt:      time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("RecordAccess: %v", err)
	}

	payload, err := json.Marshal(record)
	if err != nil {
		t.Fatalf("Marshal AccessRecord: %v", err)
	}
	if !strings.Contains(string(payload), `"displayName":""`) {
		t.Fatalf("expected AccessRecord JSON to include empty displayName string, got %s", string(payload))
	}

	records, err := s.ListAccessRecords("desktop-1", nil)
	if err != nil {
		t.Fatalf("ListAccessRecords: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	if records[0].ClientName != "" {
		t.Fatalf("expected NULL client_name to scan as empty displayName, got %q", records[0].ClientName)
	}
}
