//go:build darwin

package wake

import (
	"net"
	"testing"
	"time"
)

func TestHardwareMACsByInterfaceForPlatformCachesNetworksetupOutput(t *testing.T) {
	hardwareMACCacheMu.Lock()
	originalOutput := networksetupOutput
	originalExpiresAt := hardwareMACCacheExpiresAt
	originalValues := hardwareMACCacheValues
	networksetupOutput = nil
	hardwareMACCacheExpiresAt = time.Time{}
	hardwareMACCacheValues = nil
	hardwareMACCacheMu.Unlock()

	t.Cleanup(func() {
		hardwareMACCacheMu.Lock()
		networksetupOutput = originalOutput
		hardwareMACCacheExpiresAt = originalExpiresAt
		hardwareMACCacheValues = originalValues
		hardwareMACCacheMu.Unlock()
	})

	calls := 0
	networksetupOutput = func() ([]byte, error) {
		calls++
		return []byte(`
Hardware Port: Wi-Fi
Device: en1
Ethernet Address: d0:11:e5:e0:a2:94
`), nil
	}

	first := hardwareMACsByInterfaceForPlatform()
	second := hardwareMACsByInterfaceForPlatform()

	if calls != 1 {
		t.Fatalf("networksetup calls = %d, want 1", calls)
	}
	if first["en1"].String() != "d0:11:e5:e0:a2:94" {
		t.Fatalf("first en1 MAC = %q, want d0:11:e5:e0:a2:94", first["en1"])
	}
	if second["en1"].String() != "d0:11:e5:e0:a2:94" {
		t.Fatalf("second en1 MAC = %q, want d0:11:e5:e0:a2:94", second["en1"])
	}

	first["en1"] = net.HardwareAddr{0, 0, 0, 0, 0, 1}
	third := hardwareMACsByInterfaceForPlatform()
	if third["en1"].String() != "d0:11:e5:e0:a2:94" {
		t.Fatalf("cached en1 MAC mutated to %q", third["en1"])
	}
}
