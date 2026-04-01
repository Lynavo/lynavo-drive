package config

import (
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	HTTPPort              int    `yaml:"http_port"`
	TCPPort               int    `yaml:"tcp_port"`
	DataDir               string `yaml:"data_dir"`
	ReceiveDir            string `yaml:"receive_dir"`
	LogLevel              string `yaml:"log_level"`
	DeviceName            string `yaml:"device_name"`
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
	if c.DeviceName == "" {
		hostname, _ := os.Hostname()
		// Remove .local suffix for friendlier display name
		c.DeviceName = strings.TrimSuffix(hostname, ".local")
	}
}

func defaultDataDir() string {
	configDir, err := os.UserConfigDir()
	if err == nil && configDir != "" {
		return filepath.Join(configDir, "小豹闪传")
	}

	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "小豹闪传")
}

func (c *Config) DBPath() string {
	return filepath.Join(c.DataDir, "sidecar.db")
}

func (c *Config) StagingDir() string {
	return filepath.Join(c.DataDir, "staging")
}

func (c *Config) LogDir() string {
	return filepath.Join(c.DataDir, "logs")
}
