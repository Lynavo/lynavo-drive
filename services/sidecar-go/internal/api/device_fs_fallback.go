package api

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	internalserver "github.com/lynavo/lynavo-drive/services/sidecar-go/internal/server"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
)

func (s *Server) deviceDirPath(deviceID string) string {
	dirName := deviceID

	device, err := s.store.GetPairedDevice(deviceID)
	if err == nil {
		switch {
		case device.ReceiveDirName != nil && *device.ReceiveDirName != "":
			dirName = *device.ReceiveDirName
		case device.DeviceAlias != nil && *device.DeviceAlias != "":
			dirName = internalserver.SanitizeDirName(*device.DeviceAlias)
		case device.ClientName != "":
			dirName = internalserver.SanitizeDirName(device.ClientName)
		}
	}

	return filepath.Join(s.config.ReceiveDir, dirName)
}

func (s *Server) filesystemDates(deviceID string) ([]string, error) {
	deviceDir := s.deviceDirPath(deviceID)
	entries, err := os.ReadDir(deviceDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []string{}, nil
		}
		return nil, err
	}

	dates := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if _, err := time.Parse("2006-01-02", name); err == nil {
			dates = append(dates, name)
		}
	}

	sort.Slice(dates, func(i, j int) bool {
		return dates[i] > dates[j]
	})
	return dates, nil
}

func mergeDateKeys(primary, fallback []string) []string {
	seen := make(map[string]struct{}, len(primary)+len(fallback))
	merged := make([]string, 0, len(primary)+len(fallback))

	for _, date := range append(primary, fallback...) {
		if date == "" {
			continue
		}
		if _, ok := seen[date]; ok {
			continue
		}
		seen[date] = struct{}{}
		merged = append(merged, date)
	}

	sort.Slice(merged, func(i, j int) bool {
		return merged[i] > merged[j]
	})
	return merged
}

type uploadWithTime struct {
	upload store.Upload
	ts     time.Time
}

func (s *Server) filesystemUploadsPage(
	deviceID, date, sortField, sortDirection string,
	page, pageSize int,
) (store.UploadPage, error) {
	dateDir := filepath.Join(s.deviceDirPath(deviceID), date)
	entries, err := os.ReadDir(dateDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return store.UploadPage{
				Items:    []store.Upload{},
				Page:     max(page, 1),
				PageSize: clampPageSize(pageSize),
			}, nil
		}
		return store.UploadPage{}, err
	}

	files := make([]uploadWithTime, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return store.UploadPage{}, err
		}
		if !info.Mode().IsRegular() {
			continue
		}

		fullPath := filepath.Join(dateDir, entry.Name())
		relPath, err := filepath.Rel(s.config.ReceiveDir, fullPath)
		if err != nil {
			relPath = filepath.Base(fullPath)
		}

		completedAt := info.ModTime().UTC().Format(time.RFC3339)
		finalPath := relPath
		files = append(files, uploadWithTime{
			ts: info.ModTime(),
			upload: store.Upload{
				FileKey:              relPath,
				ClientID:             deviceID,
				OriginalFilename:     entry.Name(),
				FileSize:             info.Size(),
				Status:               "completed",
				FinalPath:            &finalPath,
				ActiveTransmissionMs: 0,
				CompletedAt:          &completedAt,
				UpdatedAt:            completedAt,
			},
		})
	}

	sortFilesystemUploads(files, sortField, sortDirection)

	totalBytes := int64(0)
	totalTransmissionMs := int64(0)
	for _, file := range files {
		totalBytes += file.upload.FileSize
		totalTransmissionMs += file.upload.ActiveTransmissionMs
	}

	page = max(page, 1)
	pageSize = clampPageSize(pageSize)
	start := min((page-1)*pageSize, len(files))
	end := min(start+pageSize, len(files))

	uploads := make([]store.Upload, 0, end-start)
	for _, file := range files[start:end] {
		uploads = append(uploads, file.upload)
	}

	return store.UploadPage{
		Items:                     uploads,
		Page:                      page,
		PageSize:                  pageSize,
		TotalItems:                len(files),
		TotalBytes:                totalBytes,
		TotalActiveTransmissionMs: totalTransmissionMs,
	}, nil
}

func (s *Server) filesystemUploads(deviceID, date string) ([]store.Upload, error) {
	page, err := s.filesystemUploadsPage(deviceID, date, "completedAt", "desc", 1, 10000)
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}

// filesystemUploadsPageRange scans multiple date directories within [startDate, endDate].
func (s *Server) filesystemUploadsPageRange(
	deviceID, startDate, endDate, sortField, sortDirection string,
	page, pageSize int,
) (store.UploadPage, error) {
	if endDate == "" || endDate == startDate {
		return s.filesystemUploadsPage(deviceID, startDate, sortField, sortDirection, page, pageSize)
	}

	allDates, err := s.filesystemDates(deviceID)
	if err != nil {
		return store.UploadPage{}, err
	}

	// Collect files from all date directories in range
	var allFiles []uploadWithTime
	totalBytes := int64(0)
	totalTransmissionMs := int64(0)
	for _, d := range allDates {
		if d < startDate || d > endDate {
			continue
		}
		singlePage, err := s.filesystemUploadsPage(deviceID, d, sortField, sortDirection, 1, 10000)
		if err != nil {
			continue
		}
		for _, u := range singlePage.Items {
			info, _ := os.Stat(filepath.Join(s.deviceDirPath(deviceID), d, u.OriginalFilename))
			ts := time.Now()
			if info != nil {
				ts = info.ModTime()
			}
			allFiles = append(allFiles, uploadWithTime{upload: u, ts: ts})
		}
		totalBytes += singlePage.TotalBytes
		totalTransmissionMs += singlePage.TotalActiveTransmissionMs
	}

	sortFilesystemUploads(allFiles, sortField, sortDirection)

	page = max(page, 1)
	pageSize = clampPageSize(pageSize)
	start := min((page-1)*pageSize, len(allFiles))
	end := min(start+pageSize, len(allFiles))

	uploads := make([]store.Upload, 0, end-start)
	for _, f := range allFiles[start:end] {
		uploads = append(uploads, f.upload)
	}

	return store.UploadPage{
		Items:                     uploads,
		Page:                      page,
		PageSize:                  pageSize,
		TotalItems:                len(allFiles),
		TotalBytes:                totalBytes,
		TotalActiveTransmissionMs: totalTransmissionMs,
	}, nil
}

func sortFilesystemUploads(files []uploadWithTime, sortField, sortDirection string) {
	desc := strings.ToLower(sortDirection) != "asc"

	sort.Slice(files, func(i, j int) bool {
		a := files[i].upload
		b := files[j].upload

		switch sortField {
		case "name":
			aName := strings.ToLower(a.OriginalFilename)
			bName := strings.ToLower(b.OriginalFilename)
			if aName != bName {
				if desc {
					return aName > bName
				}
				return aName < bName
			}
		case "size":
			if a.FileSize != b.FileSize {
				if desc {
					return a.FileSize > b.FileSize
				}
				return a.FileSize < b.FileSize
			}
		case "createdAt":
			aCreated := ""
			bCreated := ""
			if a.CreatedAtRemote != nil {
				aCreated = *a.CreatedAtRemote
			}
			if b.CreatedAtRemote != nil {
				bCreated = *b.CreatedAtRemote
			}
			if aCreated != bCreated {
				if desc {
					return aCreated > bCreated
				}
				return aCreated < bCreated
			}
		case "duration":
			if a.ActiveTransmissionMs != b.ActiveTransmissionMs {
				if desc {
					return a.ActiveTransmissionMs > b.ActiveTransmissionMs
				}
				return a.ActiveTransmissionMs < b.ActiveTransmissionMs
			}
		default:
			if !files[i].ts.Equal(files[j].ts) {
				if desc {
					return files[i].ts.After(files[j].ts)
				}
				return files[i].ts.Before(files[j].ts)
			}
		}

		if desc {
			return a.FileKey > b.FileKey
		}
		return a.FileKey < b.FileKey
	})
}

func clampPageSize(pageSize int) int {
	if pageSize < 1 {
		return 200
	}
	return pageSize
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
