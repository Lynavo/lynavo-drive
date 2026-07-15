package disk

import (
	"os"
	"testing"
)

func TestCheck(t *testing.T) {
	info, err := Check(os.TempDir())
	if err != nil {
		t.Fatalf("Check failed: %v", err)
	}
	if info.TotalBytes == 0 {
		t.Error("TotalBytes should be > 0")
	}
	if info.AvailableBytes == 0 {
		t.Error("AvailableBytes should be > 0")
	}
}

func TestIsLow_HighThreshold(t *testing.T) {
	low, avail, err := IsLow(os.TempDir(), 1<<62) // very high threshold
	if err != nil {
		t.Fatalf("IsLow failed: %v", err)
	}
	if !low {
		t.Error("should be low with impossibly high threshold")
	}
	if avail == 0 {
		t.Error("available should be > 0")
	}
}

func TestIsLow_ZeroThreshold(t *testing.T) {
	low, _, err := IsLow(os.TempDir(), 0)
	if err != nil {
		t.Fatalf("IsLow failed: %v", err)
	}
	if low {
		t.Error("should not be low with zero threshold")
	}
}
