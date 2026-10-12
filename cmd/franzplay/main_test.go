package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/config"
)

// freeAddr asks the system for a free local port.
func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find free port: %v", err)
	}
	addr := l.Addr().String()
	if err := l.Close(); err != nil {
		t.Fatalf("close probe listener: %v", err)
	}
	return addr
}

// waitForHealth polls /api/health until it answers 200 or the deadline passes.
func waitForHealth(addr string) error {
	client := &http.Client{Timeout: time.Second}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.Get("http://" + addr + "/api/health")
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	return fmt.Errorf("server at %s did not become healthy", addr)
}

func TestRunStartsAndStopsCleanly(t *testing.T) {
	addr := freeAddr(t)
	dataDir := filepath.Join(t.TempDir(), "dati")
	env := map[string]string{config.EnvAddr: addr, config.EnvDataDir: dataDir}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- run(ctx, func(k string) string { return env[k] }, io.Discard) }()

	if err := waitForHealth(addr); err != nil {
		cancel()
		t.Fatal(err)
	}
	if info, err := os.Stat(dataDir); err != nil || !info.IsDir() {
		t.Errorf("data folder %q was not created: %v", dataDir, err)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("run() returned %v, want nil after a clean stop", err)
		}
	case <-time.After(shutdownTimeout + time.Second):
		t.Fatal("run() did not stop after cancel")
	}
}

func TestRunRejectsBadConfig(t *testing.T) {
	env := map[string]string{config.EnvAddr: "not-an-address"}
	err := run(context.Background(), func(k string) string { return env[k] }, io.Discard)
	if !errors.Is(err, config.ErrInvalidConfig) {
		t.Errorf("run() error = %v, want ErrInvalidConfig", err)
	}
}

func TestRunFailsWhenPortIsBusy(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = l.Close() })

	env := map[string]string{config.EnvAddr: l.Addr().String(), config.EnvDataDir: t.TempDir()}
	if err := run(context.Background(), func(k string) string { return env[k] }, io.Discard); err == nil {
		t.Error("run() returned nil, want an error when the port is already in use")
	}
}
