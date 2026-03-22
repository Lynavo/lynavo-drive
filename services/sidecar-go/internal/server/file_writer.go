package server

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// FileWriter manages writing to a .part staging file during an upload.
// It supports resuming from a previous offset if the .part file already exists.
type FileWriter struct {
	file         *os.File
	partPath     string
	offset       int64
	expectedSize int64
	startTime    time.Time
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

	return &FileWriter{
		file:         f,
		partPath:     partPath,
		offset:       offset,
		expectedSize: expectedSize,
		startTime:    time.Now(),
	}, nil
}

// WriteAt writes data at the specified offset in the .part file. It returns
// the new committed offset (end of written data).
func (fw *FileWriter) WriteAt(data []byte, offset int64) (int64, error) {
	n, err := fw.file.WriteAt(data, offset)
	if err != nil {
		return fw.offset, fmt.Errorf("write at offset %d: %w", offset, err)
	}

	newEnd := offset + int64(n)
	if newEnd > fw.offset {
		fw.offset = newEnd
	}

	return fw.offset, nil
}

// Sync flushes the .part file to disk.
func (fw *FileWriter) Sync() error {
	return fw.file.Sync()
}

// CommittedOffset returns the current committed byte offset.
func (fw *FileWriter) CommittedOffset() int64 {
	return fw.offset
}

// PartPath returns the path to the .part file.
func (fw *FileWriter) PartPath() string {
	return fw.partPath
}

// ElapsedMs returns the milliseconds since the writer was created.
func (fw *FileWriter) ElapsedMs() int64 {
	return time.Since(fw.startTime).Milliseconds()
}

// Close closes the underlying file handle.
func (fw *FileWriter) Close() error {
	if fw.file != nil {
		return fw.file.Close()
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
// It creates the target directory structure: <receivePath>/<deviceAlias>/<date>/
// and handles filename conflicts by appending a suffix.
// Returns the relative path from receivePath.
func (fw *FileWriter) Finalize(receivePath, deviceAlias, date, filename, fileKey string) (string, error) {
	if fw.file != nil {
		fw.file.Close()
		fw.file = nil
	}

	// Sanitize alias for use as directory name
	alias := sanitizeDirName(deviceAlias)
	if alias == "" {
		alias = "Unknown"
	}

	dir := filepath.Join(receivePath, alias, date)
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

	if err := os.Rename(fw.partPath, finalPath); err != nil {
		return "", fmt.Errorf("rename part to final: %w", err)
	}

	// Return path relative to receivePath
	rel, err := filepath.Rel(receivePath, finalPath)
	if err != nil {
		return filepath.Base(finalPath), nil
	}
	return rel, nil
}

// MigrateDeviceDir renames a device's receive directory when its display name changes.
// oldDirName is the previously stored sanitized name, newAlias is the current display name.
func MigrateDeviceDir(receivePath, oldDirName, newAlias string) {
	newDir := sanitizeDirName(newAlias)
	if newDir == "" || oldDirName == "" || oldDirName == newDir {
		return
	}
	oldPath := filepath.Join(receivePath, oldDirName)
	newPath := filepath.Join(receivePath, newDir)
	if info, err := os.Stat(oldPath); err == nil && info.IsDir() {
		if err := os.Rename(oldPath, newPath); err != nil {
			slog.Warn("failed to migrate device dir", "old", oldPath, "new", newPath, "err", err)
		} else {
			slog.Info("migrated device dir", "old", oldDirName, "new", newDir)
		}
	}
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
