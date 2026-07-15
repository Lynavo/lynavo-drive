//go:build windows

package disk

import (
	"path/filepath"

	"golang.org/x/sys/windows"
)

type DiskInfo struct {
	TotalBytes     uint64
	FreeBytes      uint64
	AvailableBytes uint64
}

func Check(path string) (*DiskInfo, error) {
	directoryName, err := windows.UTF16PtrFromString(filepath.Clean(path))
	if err != nil {
		return nil, err
	}

	var availableBytes uint64
	var totalBytes uint64
	var freeBytes uint64

	if err := windows.GetDiskFreeSpaceEx(
		directoryName,
		&availableBytes,
		&totalBytes,
		&freeBytes,
	); err != nil {
		return nil, err
	}

	return &DiskInfo{
		TotalBytes:     totalBytes,
		FreeBytes:      freeBytes,
		AvailableBytes: availableBytes,
	}, nil
}

func IsLow(path string, threshold int64) (bool, uint64, error) {
	info, err := Check(path)
	if err != nil {
		return false, 0, err
	}
	return int64(info.AvailableBytes) < threshold, info.AvailableBytes, nil
}
