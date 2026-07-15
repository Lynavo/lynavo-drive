package share

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Status represents the current state of SMB share detection.
type Status string

const (
	StatusUnknown           Status = "unknown"
	StatusNeedsManualEnable Status = "needs_manual_enable"
	StatusShareRegistered   Status = "share_registered"
	StatusReady             Status = "ready"
	StatusError             Status = "error"
)

// Result holds the outcome of a share detection check.
type Result struct {
	Enabled   bool    `json:"enabled"`
	SmbURL    *string `json:"smbUrl"`
	ShareName *string `json:"shareName,omitempty"`
	Status    Status  `json:"status"`
	Error     *string `json:"lastError,omitempty"`
}

type sharePoint struct {
	Name      string
	Path      string
	SMBShared bool
}

type windowsSmbShare struct {
	Name    string `json:"Name"`
	Path    string `json:"Path"`
	Special bool   `json:"Special"`
}

var commandOutput = func(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
}

// Detect verifies whether the current receive path is exposed via SMB sharing.
// macOS uses `sharing -l`; Windows uses `Get-SmbShare`. Both paths normalize
// into sharePoint entries and then use the same status mapping.
func Detect(receivePath, shareName string) Result {
	switch runtime.GOOS {
	case "darwin":
		return detectDarwinShares(receivePath, shareName)
	case "windows":
		return detectWindowsShares(receivePath, shareName)
	default:
		return Result{
			ShareName: strPtr(shareName),
			Status:    StatusNeedsManualEnable,
		}
	}
}

// IsAccessibleStatus reports whether a persisted share status represents an
// SMB configuration that can be advertised to mobile clients.
func IsAccessibleStatus(status string) bool {
	return status == string(StatusReady) || status == string(StatusShareRegistered)
}

// IsAccessibleConfig reports whether the persisted share config has both a
// usable status and an address to advertise.
func IsAccessibleConfig(status, smbURL string) bool {
	return IsAccessibleStatus(status) && strings.TrimSpace(smbURL) != ""
}

func detectDarwinShares(receivePath, shareName string) Result {
	sharesOut, err := commandOutput("sharing", "-l")
	if err != nil {
		errMsg := fmt.Sprintf("cannot list shares: %v", err)
		return Result{Status: StatusError, Error: &errMsg}
	}

	shares := parseSharePoints(string(sharesOut))
	return detectFromSharePoints(receivePath, shareName, shares, GetLocalIP())
}

func detectWindowsShares(receivePath, shareName string) Result {
	script := "Get-SmbShare | Select-Object -Property Name,Path,Special | ConvertTo-Json -Depth 2 -Compress"
	sharesOut, err := commandOutput("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	if err != nil {
		sharesOut, err = commandOutput("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	}
	if err != nil {
		errMsg := fmt.Sprintf("cannot list Windows SMB shares: %v", err)
		return Result{ShareName: strPtr(shareName), Status: StatusError, Error: &errMsg}
	}

	shares, err := parseWindowsSmbShares(sharesOut)
	if err != nil {
		errMsg := fmt.Sprintf("cannot parse Windows SMB shares: %v", err)
		return Result{ShareName: strPtr(shareName), Status: StatusError, Error: &errMsg}
	}
	return detectFromSharePoints(receivePath, shareName, shares, GetLocalIP())
}

func detectFromSharePoints(receivePath, shareName string, shares []sharePoint, localIP string) Result {
	smbShares := make([]sharePoint, 0, len(shares))
	for _, share := range shares {
		if share.SMBShared {
			smbShares = append(smbShares, share)
		}
	}
	if len(smbShares) == 0 {
		return Result{Status: StatusNeedsManualEnable}
	}

	normalizedReceivePath := filepath.Clean(receivePath)
	var nameAndPathMatch *sharePoint
	var pathMatch *sharePoint
	var nameMatch *sharePoint

	for i := range smbShares {
		share := &smbShares[i]
		if sharePathCoversReceivePath(share.Path, normalizedReceivePath) {
			if pathMatch == nil {
				pathMatch = share
			}
			if share.Name == shareName {
				nameAndPathMatch = share
				break
			}
		}
		if share.Name == shareName && nameMatch == nil {
			nameMatch = share
		}
	}

	switch {
	case nameAndPathMatch != nil:
		return Result{
			Enabled:   true,
			SmbURL:    buildSMBURL(localIP, nameAndPathMatch.Name),
			ShareName: strPtr(nameAndPathMatch.Name),
			Status:    StatusReady,
		}
	case pathMatch != nil:
		return Result{
			Enabled:   true,
			SmbURL:    buildSMBURL(localIP, pathMatch.Name),
			ShareName: strPtr(pathMatch.Name),
			Status:    StatusReady,
		}
	case nameMatch != nil:
		return Result{
			Enabled:   true,
			SmbURL:    buildSMBURL(localIP, nameMatch.Name),
			ShareName: strPtr(nameMatch.Name),
			Status:    StatusShareRegistered,
		}
	default:
		firstShare := smbShares[0]
		return Result{
			Enabled:   true,
			SmbURL:    buildSMBURL(localIP, firstShare.Name),
			ShareName: strPtr(firstShare.Name),
			Status:    StatusShareRegistered,
		}
	}
}

func parseSharePoints(output string) []sharePoint {
	scanner := bufio.NewScanner(strings.NewReader(output))
	entries := make([]sharePoint, 0)
	var current *sharePoint
	inSMBBlock := false

	flush := func() {
		if current == nil {
			return
		}
		if current.Name != "" || current.Path != "" {
			entries = append(entries, *current)
		}
		current = nil
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch {
		case inSMBBlock && line == "}":
			inSMBBlock = false
			continue
		case inSMBBlock && strings.HasPrefix(line, "shared:"):
			current.SMBShared = strings.TrimSpace(strings.TrimPrefix(line, "shared:")) == "1"
			continue
		case inSMBBlock:
			continue
		}

		switch {
		case strings.HasPrefix(line, "name:"):
			flush()
			current = &sharePoint{
				Name: normalizeShareToken(strings.TrimSpace(strings.TrimPrefix(line, "name:"))),
			}
		case current != nil && strings.HasPrefix(line, "path:"):
			current.Path = filepath.Clean(strings.TrimSpace(strings.TrimPrefix(line, "path:")))
		case current != nil && strings.HasPrefix(line, "smb:"):
			current.SMBShared = true
			inSMBBlock = true
		}
	}
	flush()
	return entries
}

func parseWindowsSmbShares(output []byte) ([]sharePoint, error) {
	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" || trimmed == "null" {
		return nil, nil
	}

	var rawShares []windowsSmbShare
	if strings.HasPrefix(trimmed, "[") {
		if err := json.Unmarshal([]byte(trimmed), &rawShares); err != nil {
			return nil, err
		}
	} else {
		var rawShare windowsSmbShare
		if err := json.Unmarshal([]byte(trimmed), &rawShare); err != nil {
			return nil, err
		}
		rawShares = append(rawShares, rawShare)
	}

	shares := make([]sharePoint, 0, len(rawShares))
	for _, rawShare := range rawShares {
		name := normalizeShareToken(strings.TrimSpace(rawShare.Name))
		path := strings.TrimSpace(rawShare.Path)
		if name == "" || path == "" || rawShare.Special || strings.HasSuffix(name, "$") {
			continue
		}
		shares = append(shares, sharePoint{
			Name:      name,
			Path:      normalizePathForGOOS(path, "windows"),
			SMBShared: true,
		})
	}
	return shares, nil
}

func normalizeShareToken(value string) string {
	return strings.Trim(value, "\"“”")
}

func sharePathCoversReceivePath(sharePath, receivePath string) bool {
	return sharePathCoversReceivePathForGOOS(sharePath, receivePath, runtime.GOOS)
}

func sharePathCoversReceivePathForGOOS(sharePath, receivePath string, goos string) bool {
	normalizedSharePath := normalizePathForGOOS(sharePath, goos)
	normalizedReceivePath := normalizePathForGOOS(receivePath, goos)
	if pathEqual(normalizedSharePath, normalizedReceivePath, goos) {
		return true
	}
	prefix := normalizedSharePath + pathSeparatorForGOOS(goos)
	return pathHasPrefix(normalizedReceivePath, prefix, goos)
}

func normalizePathForGOOS(path string, goos string) string {
	path = strings.TrimSpace(path)
	if goos == "windows" {
		path = strings.ReplaceAll(path, "/", `\`)
		path = filepath.Clean(path)
		return strings.TrimRight(path, `\`)
	}
	return filepath.Clean(path)
}

func pathSeparatorForGOOS(goos string) string {
	if goos == "windows" {
		return `\`
	}
	return string(filepath.Separator)
}

func pathEqual(left, right, goos string) bool {
	if goos == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func pathHasPrefix(path, prefix, goos string) bool {
	if goos == "windows" {
		return strings.HasPrefix(strings.ToLower(path), strings.ToLower(prefix))
	}
	return strings.HasPrefix(path, prefix)
}

func buildSMBURL(localIP, shareName string) *string {
	if localIP == "" || shareName == "" {
		return nil
	}
	smbURL := fmt.Sprintf("smb://%s/%s", localIP, shareName)
	return &smbURL
}

func strPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// GetLocalIP returns the first non-loopback IPv4 address found on the host.
func GetLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			return ipnet.IP.String()
		}
	}
	return ""
}
