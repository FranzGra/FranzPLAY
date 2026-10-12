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
	EnvAddr      = "FRANZPLAY_ADDR"
	EnvDataDir   = "FRANZPLAY_DATA_DIR"
	EnvLibraries = "FRANZPLAY_LIBRARIES"
	EnvFFprobe   = "FRANZPLAY_FFPROBE"
)

// Default values, used when a variable is not set.
const (
	DefaultAddr    = ":8090"
	DefaultDataDir = "data"
	DefaultFFprobe = "ffprobe" // found through PATH
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
	// Libraries are the video folders, as absolute paths. FranzPLAY only
	// reads them: it never creates, renames or deletes anything inside.
	Libraries []string
	// FFprobe is the ffprobe program: a name looked up in PATH, or a full path.
	FFprobe string
}

// Load builds a Config from environment variables.
// getenv is usually os.Getenv; tests pass a fake one.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		Addr:    valueOr(getenv(EnvAddr), DefaultAddr),
		DataDir: valueOr(getenv(EnvDataDir), DefaultDataDir),
		FFprobe: valueOr(getenv(EnvFFprobe), DefaultFFprobe),
	}

	if err := checkAddr(cfg.Addr); err != nil {
		return Config{}, fmt.Errorf("%w: %s=%q: %w", ErrInvalidConfig, EnvAddr, cfg.Addr, err)
	}
	cfg.DataDir = filepath.Clean(cfg.DataDir)

	libraries, err := parseLibraries(getenv(EnvLibraries), cfg.DataDir)
	if err != nil {
		return Config{}, fmt.Errorf("%w: %s: %w", ErrInvalidConfig, EnvLibraries, err)
	}
	cfg.Libraries = libraries

	return cfg, nil
}

// parseLibraries reads the list of video folders. Folders are separated like
// in PATH: ";" on Windows, ":" elsewhere. Each folder becomes an absolute path.
//
// Two layouts are refused, because they would break the rule that video
// folders are read-only or would show the same video twice:
//   - a library inside another library;
//   - the data folder inside a library, or a library inside the data folder.
func parseLibraries(value, dataDir string) ([]string, error) {
	absData, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("data folder %q: %w", dataDir, err)
	}
	var libraries []string
	for _, entry := range filepath.SplitList(value) {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		dir, err := filepath.Abs(entry)
		if err != nil {
			return nil, fmt.Errorf("folder %q: %w", entry, err)
		}
		if within(dir, absData) || within(absData, dir) {
			return nil, fmt.Errorf("folder %q and the data folder %q must be separate, one cannot contain the other", dir, absData)
		}
		for _, other := range libraries {
			if within(dir, other) || within(other, dir) {
				return nil, fmt.Errorf("folders %q and %q overlap", other, dir)
			}
		}
		libraries = append(libraries, dir)
	}
	return libraries, nil
}

// within reports whether path is dir itself or somewhere inside it.
// Both must be absolute and clean.
func within(dir, path string) bool {
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
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
