package config

import (
	"errors"
	"path/filepath"
	"testing"
)

// fakeEnv returns a getenv function that reads from a map.
func fakeEnv(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(fakeEnv(nil))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Addr != DefaultAddr {
		t.Errorf("Addr = %q, want %q", cfg.Addr, DefaultAddr)
	}
	if cfg.DataDir != DefaultDataDir {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, DefaultDataDir)
	}
}

func TestLoadFromEnv(t *testing.T) {
	cfg, err := Load(fakeEnv(map[string]string{
		EnvAddr:    " 127.0.0.1:9000 ",
		EnvDataDir: "/srv/franzplay//dati/",
	}))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Addr != "127.0.0.1:9000" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, "127.0.0.1:9000")
	}
	if want := filepath.Clean("/srv/franzplay/dati"); cfg.DataDir != want {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, want)
	}
}

func TestLoadRejectsBadAddr(t *testing.T) {
	for _, addr := range []string{"8090", "localhost", ":abc", ":70000", ":-1"} {
		t.Run(addr, func(t *testing.T) {
			_, err := Load(fakeEnv(map[string]string{EnvAddr: addr}))
			if !errors.Is(err, ErrInvalidConfig) {
				t.Errorf("Load() with %s=%q error = %v, want ErrInvalidConfig", EnvAddr, addr, err)
			}
		})
	}
}
