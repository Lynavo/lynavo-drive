package config

import (
	"os"
	"path/filepath"

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
		home, _ := os.UserHomeDir()
		c.DataDir = filepath.Join(home, "Library", "Application Support", "SyncFlow")
	}
	if c.ReceiveDir == "" {
		c.ReceiveDir = filepath.Join(c.DataDir, "received")
	}
	if c.DeviceName == "" {
		c.DeviceName, _ = os.Hostname()
	}
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
