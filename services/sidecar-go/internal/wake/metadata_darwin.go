//go:build darwin

package wake

import (
	"net"
	"os/exec"
	"sync"
	"time"
)

const hardwareMACCacheTTL = 30 * time.Second

var (
	hardwareMACCacheMu        sync.Mutex
	hardwareMACCacheExpiresAt time.Time
	hardwareMACCacheValues    map[string]net.HardwareAddr
	networksetupOutput        = func() ([]byte, error) {
		return exec.Command("networksetup", "-listallhardwareports").Output()
	}
)

func hardwareMACsByInterfaceForPlatform() map[string]net.HardwareAddr {
	now := time.Now()

	hardwareMACCacheMu.Lock()
	if hardwareMACCacheValues != nil && now.Before(hardwareMACCacheExpiresAt) {
		values := cloneHardwareMACMap(hardwareMACCacheValues)
		hardwareMACCacheMu.Unlock()
		return values
	}
	hardwareMACCacheMu.Unlock()

	output, err := networksetupOutput()
	if err != nil {
		return nil
	}
	values := parseNetworksetupHardwarePortsOutput(string(output))

	hardwareMACCacheMu.Lock()
	hardwareMACCacheValues = cloneHardwareMACMap(values)
	hardwareMACCacheExpiresAt = now.Add(hardwareMACCacheTTL)
	hardwareMACCacheMu.Unlock()

	return values
}

func cloneHardwareMACMap(values map[string]net.HardwareAddr) map[string]net.HardwareAddr {
	if values == nil {
		return nil
	}
	clone := make(map[string]net.HardwareAddr, len(values))
	for name, mac := range values {
		clone[name] = append(net.HardwareAddr(nil), mac...)
	}
	return clone
}
