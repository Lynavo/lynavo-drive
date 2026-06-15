package store

import (
	"testing"
	"time"
)

func TestReceivedLibraryUsesCompletedUploadsAndShareState(t *testing.T) {
	s := newTestStore(t)
	now := time.Now().UTC().Format(time.RFC3339)

	upload := sampleUpload("file-1", "client-1")
	upload.OriginalFilename = "IMG_9001.jpg"
	upload.MediaType = "image/jpeg"
	upload.FileSize = 4096
	upload.Status = "completed"
	upload.CompletedAt = &now
	upload.UpdatedAt = now
	if err := s.UpsertUpload(upload); err != nil {
		t.Fatalf("UpsertUpload: %v", err)
	}

	items, err := s.ListReceivedLibrary("desktop-1")
	if err != nil {
		t.Fatalf("ListReceivedLibrary not shared: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 received item, got %d", len(items))
	}
	if items[0].ShareStatus != "not_shared" {
		t.Fatalf("expected not_shared, got %q", items[0].ShareStatus)
	}
	if items[0].ResourceID != "" {
		t.Fatalf("expected no resource id for not_shared item, got %q", items[0].ResourceID)
	}

	shared, err := s.AddSharedResource(SharedResourceInput{
		DesktopDeviceID: "desktop-1",
		Kind:            "received_file",
		DisplayName:     "IMG_9001.jpg",
		ReceivedFileKey: stringPtr("file-1"),
		FileSize:        int64Ptr(4096),
		MediaType:       stringPtr("image/jpeg"),
		Status:          "available",
	})
	if err != nil {
		t.Fatalf("AddSharedResource received_file: %v", err)
	}

	items, err = s.ListReceivedLibrary("desktop-1")
	if err != nil {
		t.Fatalf("ListReceivedLibrary shared: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 received item after share, got %d", len(items))
	}
	if items[0].ShareStatus != "shared" {
		t.Fatalf("expected shared, got %q", items[0].ShareStatus)
	}
	if items[0].ResourceID != shared.ResourceID {
		t.Fatalf("expected shared resource id %q, got %q", shared.ResourceID, items[0].ResourceID)
	}
}

func TestListSyncRecordsIncludesCompletedAndFailedUploads(t *testing.T) {
	s := newTestStore(t)
	completedAt := "2026-06-15T10:00:00Z"
	failedAt := "2026-06-15T11:00:00Z"

	completed := sampleUpload("file-completed", "client-1")
	completed.OriginalFilename = "Completed.jpg"
	completed.Status = "completed"
	completed.CompletedAt = &completedAt
	completed.UpdatedAt = completedAt
	if err := s.UpsertUpload(completed); err != nil {
		t.Fatalf("UpsertUpload completed: %v", err)
	}

	failed := sampleUpload("file-failed", "client-1")
	failed.OriginalFilename = "Failed.jpg"
	failed.Status = "failed"
	failed.CompletedAt = nil
	failed.UpdatedAt = failedAt
	if err := s.UpsertUpload(failed); err != nil {
		t.Fatalf("UpsertUpload failed: %v", err)
	}

	records, err := s.ListSyncRecords("desktop-1", nil)
	if err != nil {
		t.Fatalf("ListSyncRecords: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("expected completed and failed records, got %d", len(records))
	}
	byKey := map[string]DesktopSyncRecord{}
	for _, record := range records {
		byKey[record.FileKey] = record
	}
	completedRecord := byKey["file-completed"]
	if completedRecord.Status != "completed" {
		t.Fatalf("expected completed status, got %q", completedRecord.Status)
	}
	if completedRecord.CompletedAt == nil || *completedRecord.CompletedAt != completedAt {
		t.Fatalf("expected completed_at %q, got %#v", completedAt, completedRecord.CompletedAt)
	}
	if completedRecord.FailedAt != nil {
		t.Fatalf("expected completed record failed_at nil, got %q", *completedRecord.FailedAt)
	}

	failedRecord := byKey["file-failed"]
	if failedRecord.Status != "failed" {
		t.Fatalf("expected failed status, got %q", failedRecord.Status)
	}
	if failedRecord.CompletedAt != nil {
		t.Fatalf("expected failed record completed_at nil, got %q", *failedRecord.CompletedAt)
	}
	if failedRecord.FailedAt == nil || *failedRecord.FailedAt != failedAt {
		t.Fatalf("expected failed_at %q, got %#v", failedAt, failedRecord.FailedAt)
	}
	if failedRecord.ErrorSummary != nil {
		t.Fatalf("expected failed record error summary nil, got %q", *failedRecord.ErrorSummary)
	}
}
