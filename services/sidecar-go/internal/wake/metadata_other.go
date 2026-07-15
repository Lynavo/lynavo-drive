//go:build !darwin

package wake

import "net"

func hardwareMACsByInterfaceForPlatform() map[string]net.HardwareAddr {
	return nil
}
