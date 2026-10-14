package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/config"
	"github.com/FranzGra/FranzPLAY/internal/database"
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

// syncBuffer collects the program's log while it runs.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func TestRunStartsAndStopsCleanly(t *testing.T) {
	addr := freeAddr(t)
	dataDir := filepath.Join(t.TempDir(), "dati")
	videos := t.TempDir()
	if err := os.WriteFile(filepath.Join(videos, "mare.mp4"), []byte("sea"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{config.EnvAddr: addr, config.EnvDataDir: dataDir, config.EnvLibraries: videos}
	var logs syncBuffer

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- run(ctx, func(k string) string { return env[k] }, &logs) }()

	if err := waitForHealth(addr); err != nil {
		cancel()
		t.Fatal(err)
	}
	if info, err := os.Stat(dataDir); err != nil || !info.IsDir() {
		t.Errorf("data folder %q was not created: %v", dataDir, err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, database.FileName)); err != nil {
		t.Errorf("database was not created in the data folder: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(logs.String(), "added=1") && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if !strings.Contains(logs.String(), "added=1") {
		t.Errorf("the video folder was not scanned at start; log:\n%s", logs.String())
	}
	if !strings.Contains(logs.String(), "no administrator yet") || strings.Contains(logs.String(), "setup_code=") {
		t.Errorf("a new FranzPLAY should say the site creates the administrator, with no code; log:\n%s", logs.String())
	}
	resp, err := http.Get("http://" + addr + "/api/videos")
	if err != nil {
		t.Fatal(err)
	}
	if err := resp.Body.Close(); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("GET /api/videos without login = %d, want 401", resp.StatusCode)
	}
	// The name and color of the site are for the login page too.
	resp, err = http.Get("http://" + addr + "/api/site")
	if err != nil {
		t.Fatal(err)
	}
	if err := resp.Body.Close(); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("GET /api/site without login = %d, want 200", resp.StatusCode)
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

// TestStopWhileSomeoneIsWatching: a video being watched never ends by
// itself. Stopping must still end cleanly, not with an error.
func TestStopWhileSomeoneIsWatching(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	playing := make(chan struct{})
	srv := &http.Server{
		ReadHeaderTimeout: time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			// A stream that goes on until the person leaves.
			for {
				if _, err := w.Write(bytes.Repeat([]byte("v"), 64<<10)); err != nil {
					return
				}
				select {
				case playing <- struct{}{}:
				default:
				}
			}
		}),
	}
	served := make(chan error, 1)
	go func() { served <- srv.Serve(l) }()

	resp, err := http.Get("http://" + l.Addr().String() + "/video")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck // the server closes it
	<-playing
	// The person paused: nothing more is read.

	start := time.Now()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := stopServer(srv, 200*time.Millisecond, logger); err != nil {
		t.Errorf("stop with a video playing: %v", err)
	}
	if took := time.Since(start); took > 5*time.Second {
		t.Errorf("stop took %v", took)
	}
	if err := <-served; !errors.Is(err, http.ErrServerClosed) {
		t.Errorf("server ended with %v", err)
	}
}
