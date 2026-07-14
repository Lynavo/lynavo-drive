package config

import (
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	currentDataDirName = "Lynavo Drive"
)

type Config struct {
	HTTPPort   int    `yaml:"http_port"`
	TCPPort    int    `yaml:"tcp_port"`
	DataDir    string `yaml:"data_dir"`
	ReceiveDir string `yaml:"receive_dir"`
	// PersonalShareDir is the local personal directory exposed through /personal/*.
	// It is independent from RootDir/ReceiveDir so users can share a whole disk.
	PersonalShareDir string `yaml:"personal_share_dir"`
	LogLevel         string `yaml:"log_level"`
	DeviceName       string `yaml:"device_name"`
	// DeviceIP overrides the IP address advertised in the Bonjour/mDNS TXT
	// record.  Leave empty to let the sidecar auto-detect the best LAN address.
	// Useful on multi-homed Windows machines where auto-detection picks the
	// wrong interface (e.g. wired vs. WiFi on different subnets).
	// Can also be set via the LYNAVO_DEVICE_IP environment variable.
	DeviceIP              string `yaml:"device_ip"`
	LowDiskThresholdBytes int64  `yaml:"low_disk_threshold_bytes"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		HTTPPort:              39594,
		TCPPort:               39593,
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
		c.PersonalShareDir = defaultPersonalShareDir(c.RootDir())
	}
	if c.DeviceName == "" {
		hostname, _ := os.Hostname()
		// Remove .local suffix for friendlier display name
		c.DeviceName = strings.TrimSuffix(hostname, ".local")
	}
	// Environment variable takes precedence over the YAML value so that
	// developers can override the IP without touching the config file.
	if env := strings.TrimSpace(os.Getenv("LYNAVO_DEVICE_IP")); env != "" {
		c.DeviceIP = env
	}
}

func defaultDataDir() string {
	configDir, err := os.UserConfigDir()
	if err == nil && configDir != "" {
		return filepath.Join(configDir, currentDataDirName)
	}

	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", currentDataDirName)
}

func defaultPersonalShareDir(fallbackRoot string) string {
	home, err := os.UserHomeDir()
	if err == nil && strings.TrimSpace(home) != "" {
		return home
	}
	return filepath.Join(fallbackRoot, "personal")
}

func (c *Config) DBPath() string {
	return filepath.Join(c.DataDir, "sidecar.db")
}

func (c *Config) StagingDir() string {
	if c.ReceiveDir != "" {
		if c.usesManagedReceiveLayout() {
			return filepath.Join(c.RootDir(), "staging")
		}
		return filepath.Join(filepath.Dir(c.ReceiveDir), "staging")
	}
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
	return c.ReceiveDir != "" && !c.usesManagedReceiveLayout()
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
