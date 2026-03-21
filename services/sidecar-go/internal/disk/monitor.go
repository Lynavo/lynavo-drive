package disk

import "syscall"

type DiskInfo struct {
	TotalBytes     uint64
	FreeBytes      uint64
	AvailableBytes uint64
}

func Check(path string) (*DiskInfo, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return nil, err
	}
	return &DiskInfo{
		TotalBytes:     stat.Blocks * uint64(stat.Bsize),
		FreeBytes:      stat.Bfree * uint64(stat.Bsize),
		AvailableBytes: stat.Bavail * uint64(stat.Bsize),
	}, nil
}

func IsLow(path string, threshold int64) (bool, uint64, error) {
	info, err := Check(path)
	if err != nil {
		return false, 0, err
	}
	return int64(info.AvailableBytes) < threshold, info.AvailableBytes, nil
}
