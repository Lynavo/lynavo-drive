package config

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/mattn/go-sqlite3"
	"gopkg.in/yaml.v3"
)

const (
	currentDataDirName = "Vivi Drop"
	legacyDataDirName  = "小豹闪传"
	freshDBMaxBytes    = 8 * 1024
)

type Config struct {
	HTTPPort   int    `yaml:"http_port"`
	TCPPort    int    `yaml:"tcp_port"`
	DataDir    string `yaml:"data_dir"`
	ReceiveDir string `yaml:"receive_dir"`
	// PersonalShareDir is the account-scoped directory exposed through /personal/*.
	// It is independent from RootDir/ReceiveDir so users can share a whole disk.
	PersonalShareDir string `yaml:"personal_share_dir"`
	LogLevel         string `yaml:"log_level"`
	DeviceName       string `yaml:"device_name"`
	// DeviceIP overrides the IP address advertised in the Bonjour/mDNS TXT
	// record.  Leave empty to let the sidecar auto-detect the best LAN address.
	// Useful on multi-homed Windows machines where auto-detection picks the
	// wrong interface (e.g. wired vs. WiFi on different subnets).
	// Can also be set via the SYNCFLOW_DEVICE_IP environment variable.
	DeviceIP              string `yaml:"device_ip"`
	LowDiskThresholdBytes int64  `yaml:"low_disk_threshold_bytes"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		HTTPPort:              39394,
		TCPPort:               39393,
		LogLevel:              "info",
		LowDiskThresholdBytes: 500 * 1024 * 1024,
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg.setDefaults()
			return cfg, nil
		}
		return nil, err
	}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	cfg.setDefaults()
	return cfg, nil
}

func (c *Config) setDefaults() {
	if c.DataDir == "" {
		c.DataDir = defaultDataDir()
	}
	if c.ReceiveDir == "" {
		c.ReceiveDir = filepath.Join(c.DataDir, "received")
	}
	if c.PersonalShareDir == "" {
		c.PersonalShareDir = filepath.Join(c.RootDir(), "personal")
	}
	if c.DeviceName == "" {
		hostname, _ := os.Hostname()
		// Remove .local suffix for friendlier display name
		c.DeviceName = strings.TrimSuffix(hostname, ".local")
	}
	// Environment variable takes precedence over the YAML value so that
	// developers can override the IP without touching the config file.
	if env := strings.TrimSpace(os.Getenv("SYNCFLOW_DEVICE_IP")); env != "" {
		c.DeviceIP = env
	}
}

func defaultDataDir() string {
	configDir, err := os.UserConfigDir()
	if err == nil && configDir != "" {
		return selectDataDir(
			filepath.Join(configDir, currentDataDirName),
			filepath.Join(configDir, legacyDataDirName),
		)
	}

	home, _ := os.UserHomeDir()
	return selectDataDir(
		filepath.Join(home, ".config", currentDataDirName),
		filepath.Join(home, ".config", legacyDataDirName),
	)
}

func selectDataDir(preferredPath string, legacyPath string) string {
	if shouldPreferLegacyDataDir(preferredPath, legacyPath) {
		if migrateLegacyDataDir(preferredPath, legacyPath) {
			return preferredPath
		}
		return legacyPath
	}
	if isDir(preferredPath) {
		return preferredPath
	}
	if isDir(legacyPath) {
		if migrateLegacyDataDir(preferredPath, legacyPath) {
			return preferredPath
		}
		return legacyPath
	}
	return preferredPath
}

func migrateLegacyDataDir(preferredPath string, legacyPath string) bool {
	if !isDir(legacyPath) {
		return false
	}

	if !isDir(preferredPath) {
		return os.Rename(legacyPath, preferredPath) == nil
	}

	preferredState := inspectDataDirState(preferredPath)
	if preferredState.hasMeaningfulState() {
		return false
	}

	backupPath := preferredPath + ".pre-legacy-migration"
	if _, err := os.Stat(backupPath); err == nil {
		return false
	} else if !os.IsNotExist(err) {
		return false
	}

	if err := os.Rename(preferredPath, backupPath); err != nil {
		return false
	}

	if err := os.Rename(legacyPath, preferredPath); err != nil {
		_ = os.Rename(backupPath, preferredPath)
		return false
	}

	return true
}

func shouldPreferLegacyDataDir(preferredPath string, legacyPath string) bool {
	legacyState := inspectDataDirState(legacyPath)
	if !legacyState.hasDB {
		return false
	}

	preferredState := inspectDataDirState(preferredPath)
	if !preferredState.hasDB {
		return true
	}

	if legacyState.hasMeaningfulState() && !preferredState.hasMeaningfulState() {
		return true
	}

	if preferredState.hasMeaningfulState() {
		return false
	}

	return preferredState.dbSize <= freshDBMaxBytes && legacyState.dbSize > preferredState.dbSize
}

type dataDirState struct {
	hasDB         bool
	dbSize        int64
	sessions      int
	uploads       int
	pairedDevices int
	shareStatus   string
}

func (s dataDirState) hasMeaningfulState() bool {
	return s.sessions > 0 ||
		s.uploads > 0 ||
		s.pairedDevices > 0 ||
		(s.shareStatus != "" && s.shareStatus != "unknown")
}

func inspectDataDirState(dirPath string) dataDirState {
	size, hasDB := dbSize(dirPath)
	if !hasDB {
		return dataDirState{}
	}

	state := dataDirState{
		hasDB:  true,
		dbSize: size,
	}

	db, err := sql.Open("sqlite3", filepath.Join(dirPath, "sidecar.db"))
	if err != nil {
		return state
	}
	defer db.Close()

	row := db.QueryRow(`
		SELECT
			(SELECT COUNT(*) FROM sessions),
			(SELECT COUNT(*) FROM uploads),
			(SELECT COUNT(*) FROM paired_devices),
			COALESCE((SELECT share_status FROM share_config WHERE id = 1), '')
	`)
	if err := row.Scan(&state.sessions, &state.uploads, &state.pairedDevices, &state.shareStatus); err != nil {
		return state
	}

	return state
}

func dbSize(dirPath string) (int64, bool) {
	info, err := os.Stat(filepath.Join(dirPath, "sidecar.db"))
	if err != nil || info.IsDir() {
		return 0, false
	}
	return info.Size(), true
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func (c *Config) DBPath() string {
	return filepath.Join(c.DataDir, "sidecar.db")
}

func (c *Config) StagingDir() string {
	if c.ReceiveDir != "" {
		if c.usesManagedReceiveLayout() || c.usesLegacyDataReceiveLayout() {
			return filepath.Join(c.RootDir(), "staging")
		}
		return filepath.Join(filepath.Dir(c.ReceiveDir), "staging")
	}
	return filepath.Join(c.DataDir, "staging")
}

func (c *Config) LegacyStagingDir() string {
	return filepath.Join(c.DataDir, "staging")
}

func (c *Config) LogDir() string {
	return filepath.Join(c.DataDir, "logs")
}

func (c *Config) RootDir() string {
	if c.usesPersonalReceiveLayout() {
		return filepath.Dir(filepath.Dir(c.ReceiveDir))
	}
	if c.usesManagedReceiveLayout() {
		return filepath.Dir(c.ReceiveDir)
	}
	return c.DataDir
}

func (c *Config) PersonalDir() string {
	if strings.TrimSpace(c.PersonalShareDir) != "" {
		return c.PersonalShareDir
	}
	return filepath.Join(c.RootDir(), "personal")
}

func (c *Config) SharedDir() string {
	return filepath.Join(c.RootDir(), "shared")
}

func (c *Config) usesCustomReceiveLayout() bool {
	return c.ReceiveDir != "" && !c.usesManagedReceiveLayout() && !c.usesLegacyDataReceiveLayout()
}

func (c *Config) usesPersonalReceiveLayout() bool {
	if c.ReceiveDir == "" {
		return false
	}
	return filepath.Base(c.ReceiveDir) == "received" &&
		filepath.Base(filepath.Dir(c.ReceiveDir)) == "personal"
}

func (c *Config) usesManagedReceiveLayout() bool {
	if c.ReceiveDir == "" {
		return false
	}
	return filepath.Base(c.ReceiveDir) == "received"
}

func (c *Config) usesLegacyDataReceiveLayout() bool {
	if c.ReceiveDir == "" || c.DataDir == "" {
		return false
	}
	return filepath.Clean(c.ReceiveDir) == filepath.Join(filepath.Clean(c.DataDir), "received")
}
