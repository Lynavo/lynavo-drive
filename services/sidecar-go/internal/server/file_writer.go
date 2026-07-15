package server

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const defaultSyncEveryBytes int64 = 256 * 1024 * 1024 // 256 MiB

// FileWriter manages writing to a .part staging file during an upload.
// It supports resuming from a previous offset if the .part file already exists.
type FileWriter struct {
	file           *os.File
	partPath       string
	offset         int64
	expectedSize   int64
	firstWrite     time.Time
	hasWritten     bool
	bytesSinceSync int64
	syncEveryBytes int64
}

// NewFileWriter creates a new FileWriter for the given file key.
// It creates the staging directory if needed and opens (or resumes) the .part file.
// If a .part file already exists from a previous partial upload, it seeks to
// the end so writing resumes from the correct offset.
func NewFileWriter(stagingDir, clientID, fileKey string, expectedSize int64) (*FileWriter, error) {
	dir := filepath.Join(stagingDir, clientID)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("create staging dir: %w", err)
	}

	partPath := filepath.Join(dir, fileKey+".part")

	// Open file for writing; create if not exists, append if exists
	f, err := os.OpenFile(partPath, os.O_CREATE|os.O_WRONLY, 0o640)
	if err != nil {
		return nil, fmt.Errorf("open part file: %w", err)
	}

	// If .part exists from previous upload, seek to end for resume offset
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, fmt.Errorf("stat part file: %w", err)
	}
	offset := info.Size()
	if _, err := f.Seek(offset, 0); err != nil {
		f.Close()
		return nil, fmt.Errorf("seek part file to resume offset: %w", err)
	}

	return &FileWriter{
		file:           f,
		partPath:       partPath,
		offset:         offset,
		expectedSize:   expectedSize,
		syncEveryBytes: defaultSyncEveryBytes,
	}, nil
}

// WriteAt writes data at the specified offset in the .part file. It returns
// the new committed offset (end of written data).
func (fw *FileWriter) WriteAt(data []byte, offset int64) (int64, error) {
	if !fw.hasWritten {
		fw.firstWrite = time.Now()
		fw.hasWritten = true
	}
	var (
		n   int
		err error
	)
	// Fast path for normal sequential uploads.
	if offset == fw.offset {
		n, err = fw.file.Write(data)
	} else {
		n, err = fw.file.WriteAt(data, offset)
	}
	if err != nil {
		return fw.offset, fmt.Errorf("write at offset %d: %w", offset, err)
	}

	newEnd := offset + int64(n)
	if newEnd > fw.offset {
		fw.offset = newEnd
	}
	fw.bytesSinceSync += int64(n)

	return fw.offset, nil
}

// MaybeSync flushes data to disk when the buffered-write threshold is reached.
func (fw *FileWriter) MaybeSync() error {
	if fw.file == nil {
		return nil
	}
	if fw.syncEveryBytes <= 0 || fw.bytesSinceSync >= fw.syncEveryBytes {
		return fw.ForceSync()
	}
	return nil
}

// ForceSync flushes all buffered writes to disk.
func (fw *FileWriter) ForceSync() error {
	if fw.file == nil {
		return nil
	}
	if err := fw.file.Sync(); err != nil {
		return err
	}
	fw.bytesSinceSync = 0
	return nil
}

// Sync flushes the .part file to disk.
func (fw *FileWriter) Sync() error {
	return fw.ForceSync()
}

// CommittedOffset returns the current committed byte offset.
func (fw *FileWriter) CommittedOffset() int64 {
	return fw.offset
}

// PartPath returns the path to the .part file.
func (fw *FileWriter) PartPath() string {
	return fw.partPath
}

// ElapsedMs returns milliseconds since the first data was written.
func (fw *FileWriter) ElapsedMs() int64 {
	if !fw.hasWritten {
		return 0
	}
	return time.Since(fw.firstWrite).Milliseconds()
}

// Close closes the underlying file handle.
func (fw *FileWriter) Close() error {
	if fw.file != nil {
		err := fw.file.Close()
		fw.file = nil
		return err
	}
	return nil
}

// Cleanup removes the .part file. Called on SHA256 mismatch to discard
// corrupted data.
func (fw *FileWriter) Cleanup() error {
	if fw.file != nil {
		fw.file.Close()
		fw.file = nil
	}
	return os.Remove(fw.partPath)
}

// Finalize moves the .part staging file to its final destination.
// It creates the target directory structure: <receivePath>/<dirName>/<date>/
// and handles filename conflicts by appending a suffix.
// Returns the relative path from receivePath.
func (fw *FileWriter) Finalize(receivePath, dirName, date, filename, fileKey string) (string, error) {
	if fw.file != nil {
		fw.file.Close()
		fw.file = nil
	}

	// Defensive sanitize: dirName should already be sanitized from EnsureReceiveDirName,
	// but Finalize is the last gate before filesystem writes.
	dir := sanitizeDirName(dirName)
	if dir == "" {
		dir = "Unknown"
	}

	dir = filepath.Join(receivePath, dir, date)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create receive dir: %w", err)
	}

	finalPath := filepath.Join(dir, filename)

	// Handle filename conflicts
	if _, err := os.Stat(finalPath); err == nil {
		// File exists — add fileKey suffix to avoid overwrite
		ext := filepath.Ext(filename)
		base := strings.TrimSuffix(filename, ext)
		// Use first 8 chars of fileKey as disambiguator
		suffix := fileKey
		if len(suffix) > 8 {
			suffix = suffix[:8]
		}
		finalPath = filepath.Join(dir, fmt.Sprintf("%s_%s%s", base, suffix, ext))
	}

	if err := movePartToFinal(fw.partPath, finalPath); err != nil {
		return "", err
	}

	// Return path relative to receivePath
	rel, err := filepath.Rel(receivePath, finalPath)
	if err != nil {
		return filepath.Base(finalPath), nil
	}
	return rel, nil
}

func movePartToFinal(partPath, finalPath string) error {
	if err := os.Rename(partPath, finalPath); err != nil {
		if !isCrossDeviceRenameError(err) {
			return fmt.Errorf("rename part to final: %w", err)
		}
		if copyErr := copyPartToFinal(partPath, finalPath); copyErr != nil {
			return fmt.Errorf("rename part to final: %w; copy fallback: %w", err, copyErr)
		}
		if removeErr := os.Remove(partPath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return fmt.Errorf("remove copied part file: %w", removeErr)
		}
	}
	return nil
}

func isCrossDeviceRenameError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "cross-device link") ||
		strings.Contains(message, "different disk drive") ||
		strings.Contains(message, "not same device")
}

func copyPartToFinal(partPath, finalPath string) error {
	src, err := os.Open(partPath)
	if err != nil {
		return fmt.Errorf("open part file: %w", err)
	}
	defer src.Close()

	dst, err := os.OpenFile(finalPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o640)
	if err != nil {
		return fmt.Errorf("create final file: %w", err)
	}

	copied := false
	defer func() {
		if !copied {
			_ = os.Remove(finalPath)
		}
	}()

	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		return fmt.Errorf("copy data: %w", err)
	}
	if err := dst.Sync(); err != nil {
		_ = dst.Close()
		return fmt.Errorf("sync final file: %w", err)
	}
	if err := dst.Close(); err != nil {
		return fmt.Errorf("close final file: %w", err)
	}

	copied = true
	return nil
}

// SanitizeDirName replaces characters unsafe for directory names.
// Exported so handlers can compute the dir name to store in the DB.
func SanitizeDirName(name string) string {
	return sanitizeDirName(name)
}

// sanitizeDirName replaces characters unsafe for directory names.
func sanitizeDirName(name string) string {
	replacer := strings.NewReplacer(
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
	)
	return strings.TrimSpace(replacer.Replace(name))
}
