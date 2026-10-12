// Package config reads FranzPLAY's settings from environment variables.
//
// Settings are checked once, here, when the program starts.
// The rest of the program receives a Config that is already valid.
package config

import (
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"strconv"
	"strings"
)

// Environment variable names.
const (
	EnvAddr    = "FRANZPLAY_ADDR"
	EnvDataDir = "FRANZPLAY_DATA_DIR"
)

// Default values, used when a variable is not set.
const (
	DefaultAddr    = ":8090"
	DefaultDataDir = "data"
)

// ErrInvalidConfig is returned when a setting has a value FranzPLAY cannot use.
var ErrInvalidConfig = errors.New("invalid configuration")

// Config holds every setting FranzPLAY needs to start.
type Config struct {
	// Addr is the address the web server listens on, like ":8090" or "127.0.0.1:8090".
	Addr string
	// DataDir is FranzPLAY's own folder: database, covers, previews, backups.
	// Nothing outside this folder is ever written.
	DataDir string
}

// Load builds a Config from environment variables.
// getenv is usually os.Getenv; tests pass a fake one.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		Addr:    valueOr(getenv(EnvAddr), DefaultAddr),
		DataDir: valueOr(getenv(EnvDataDir), DefaultDataDir),
	}

	if err := checkAddr(cfg.Addr); err != nil {
		return Config{}, fmt.Errorf("%w: %s=%q: %w", ErrInvalidConfig, EnvAddr, cfg.Addr, err)
	}
	cfg.DataDir = filepath.Clean(cfg.DataDir)

	return cfg, nil
}

// valueOr returns value without surrounding spaces, or fallback if it is empty.
func valueOr(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

// checkAddr makes sure addr looks like "host:port" with a valid port number.
func checkAddr(addr string) error {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 0 || n > 65535 {
		return fmt.Errorf("port %q is not a number between 0 and 65535", port)
	}
	return nil
}
