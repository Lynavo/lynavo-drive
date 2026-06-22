package api

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/store"
)

type proxyWakeRequest struct {
	ClientID         string `json:"clientId"`
	MACAddress       string `json:"macAddress"`
	BroadcastAddress string `json:"broadcastAddress"`
	Ports            []int  `json:"ports"`
}

// Peer proxy wake is an optional assisted-wake path for multi-desktop setups.
// It is not a general Wake-on-WAN solution and does not help when the user has
// only one sleeping computer. The endpoint may only send Wake-on-LAN magic
// packets for authenticated, paired clients and bounded wake targets.
func (s *Server) handleProxyWake(w http.ResponseWriter, r *http.Request) {
	accountID, ok := s.authorizePersonalAccountRequestAccountID(w, r)
	if !ok {
		return
	}

	var req proxyWakeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	clientID := strings.TrimSpace(req.ClientID)
	if clientID == "" {
		writeError(w, http.StatusBadRequest, "clientId is required")
		return
	}
	device, err := s.store.GetPairedDevice(clientID)
	if err != nil {
		if errors.Is(err, store.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusForbidden, "client is not paired")
			return
		}
		slog.Warn("proxy wake paired client lookup failed", "clientID", clientID, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to verify paired client")
		return
	}
	if device == nil || device.RevokedAt != nil {
		writeError(w, http.StatusForbidden, "client is not paired")
		return
	}

	mac, err := net.ParseMAC(strings.TrimSpace(req.MACAddress))
	if err != nil || len(mac) != 6 {
		writeError(w, http.StatusBadRequest, "invalid macAddress")
		return
	}
	broadcastAddress := strings.TrimSpace(req.BroadcastAddress)
	ports, err := normalizedWakePorts(req.Ports)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.isAllowedProxyWakeTarget(accountID, mac, broadcastAddress, ports) {
		writeError(w, http.StatusBadRequest, "unsafe wake target")
		return
	}

	packet := buildWakeMagicPacket(mac)
	sender := s.wakeSender
	if sender == nil {
		sender = udpWakePacketSender{}
	}

	sent := 0
	for _, port := range ports {
		addr := net.JoinHostPort(broadcastAddress, strconv.Itoa(port))
		if err := sender.SendWakePacket(addr, packet); err != nil {
			slog.Warn("proxy wake packet send failed",
				"clientID", clientID,
				"mac", maskedWakeMACAddress(req.MACAddress),
				"destination", addr,
				"err", err,
			)
			writeError(w, http.StatusBadGateway, "failed to send wake packet")
			return
		}
		sent++
	}

	slog.Info("proxy wake packets sent",
		"clientID", clientID,
		"mac", maskedWakeMACAddress(req.MACAddress),
		"broadcastAddress", broadcastAddress,
		"ports", intListLogSummary(ports),
		"packets", sent,
	)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "sentPackets": sent})
}

func buildWakeMagicPacket(mac net.HardwareAddr) []byte {
	packet := make([]byte, 0, 102)
	packet = append(packet, bytes.Repeat([]byte{0xff}, 6)...)
	for i := 0; i < 16; i++ {
		packet = append(packet, mac...)
	}
	return packet
}

func normalizedWakePorts(ports []int) ([]int, error) {
	if len(ports) == 0 {
		return nil, fmt.Errorf("ports are required")
	}
	seen := make(map[int]bool, len(ports))
	normalized := make([]int, 0, len(ports))
	for _, port := range ports {
		if port != 7 && port != 9 {
			return nil, fmt.Errorf("unsupported wake port")
		}
		if seen[port] {
			return nil, fmt.Errorf("duplicate wake port")
		}
		seen[port] = true
		normalized = append(normalized, port)
	}
	return normalized, nil
}

func (s *Server) isAllowedProxyWakeTarget(accountID string, mac net.HardwareAddr, address string, requestedPorts []int) bool {
	ip := net.ParseIP(strings.TrimSpace(address))
	if ip == nil {
		return false
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	targets := s.allowedProxyWakeTargets(accountID)
	for _, target := range targets {
		targetMAC, err := net.ParseMAC(strings.TrimSpace(target.MACAddress))
		if err != nil || len(targetMAC) != 6 || !bytes.Equal(targetMAC, mac) {
			continue
		}
		targetBroadcast := strings.TrimSpace(target.BroadcastAddress)
		if targetBroadcast == "" || targetBroadcast != address {
			continue
		}
		if wakePortsAllowedByTarget(requestedPorts, target.Ports) {
			return true
		}
	}
	return false
}

func (s *Server) allowedProxyWakeTargets(accountID string) []protocol.WakeTarget {
	targets := make([]protocol.WakeTarget, 0)
	if capability := s.wakeCapability(); capability != nil {
		targets = append(targets, capability.Targets...)
	}
	if s.proxyWakeTargets != nil {
		targets = append(targets, s.proxyWakeTargets.ProxyWakeTargets(accountID)...)
	}
	return targets
}

func wakePortsAllowedByTarget(requested []int, targetPorts []int) bool {
	if len(requested) == 0 || len(targetPorts) == 0 {
		return false
	}
	allowed := make(map[int]bool, len(targetPorts))
	for _, port := range targetPorts {
		allowed[port] = true
	}
	for _, port := range requested {
		if !allowed[port] {
			return false
		}
	}
	return true
}
