package server

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestNewFileWriterSeeksToResumeOffset(t *testing.T) {
	stagingDir := t.TempDir()
	clientID := "test-client"
	fileKey := "resume-file"

	partDir := filepath.Join(stagingDir, clientID)
	if err := os.MkdirAll(partDir, 0o755); err != nil {
		t.Fatalf("mkdir part dir: %v", err)
	}

	partPath := filepath.Join(partDir, fileKey+".part")
	firstHalf := []byte("hello-")
	if err := os.WriteFile(partPath, firstHalf, 0o644); err != nil {
		t.Fatalf("write part file: %v", err)
	}

	fw, err := NewFileWriter(stagingDir, clientID, fileKey, int64(len(firstHalf)+5))
	if err != nil {
		t.Fatalf("NewFileWriter: %v", err)
	}
	defer fw.Close()

	if fw.CommittedOffset() != int64(len(firstHalf)) {
		t.Fatalf("CommittedOffset() = %d, want %d", fw.CommittedOffset(), len(firstHalf))
	}

	if _, err := fw.WriteAt([]byte("world"), fw.CommittedOffset()); err != nil {
		t.Fatalf("WriteAt: %v", err)
	}

	if err := fw.ForceSync(); err != nil {
		t.Fatalf("ForceSync: %v", err)
	}
	if err := fw.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	content, err := os.ReadFile(partPath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if got, want := string(content), "hello-world"; got != want {
		t.Fatalf("part content = %q, want %q", got, want)
	}
}

func TestIsCrossDeviceRenameError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"windows different disk", errors.New("rename C:\\a D:\\b: The system cannot move the file to a different disk drive."), true},
		{"unix exdev", errors.New("rename /a /b: invalid cross-device link"), true},
		{"generic not same device", errors.New("not same device"), true},
		{"permission", errors.New("permission denied"), false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isCrossDeviceRenameError(tc.err); got != tc.want {
				t.Fatalf("isCrossDeviceRenameError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestCopyPartToFinalCopiesAndPreservesPart(t *testing.T) {
	dir := t.TempDir()
	partPath := filepath.Join(dir, "file.part")
	finalPath := filepath.Join(dir, "file.jpg")
	content := []byte("image-bytes")

	if err := os.WriteFile(partPath, content, 0o640); err != nil {
		t.Fatalf("write part: %v", err)
	}

	if err := copyPartToFinal(partPath, finalPath); err != nil {
		t.Fatalf("copyPartToFinal: %v", err)
	}

	got, err := os.ReadFile(finalPath)
	if err != nil {
		t.Fatalf("read final: %v", err)
	}
	if string(got) != string(content) {
		t.Fatalf("final content = %q, want %q", got, content)
	}
	if _, err := os.Stat(partPath); err != nil {
		t.Fatalf("part should remain until caller removes it: %v", err)
	}
}
