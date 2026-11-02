package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/config"
	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/database"
)

// startAndStop runs FranzPLAY until its server answers, then stops it, and
// gives what run() returned: its error, when it refuses to start. The start
// can be slow (the race detector, a busy machine): the test waits for it, not
// for a fixed time, and 30 seconds are only the limit.
func startAndStop(t *testing.T, env map[string]string, logOut io.Writer) error {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- run(ctx, func(k string) string { return env[k] }, logOut) }()
	client := &http.Client{Timeout: time.Second}
	limit := time.After(30 * time.Second)
	for {
		select {
		case err := <-done:
			return err
		case <-limit:
			cancel()
			t.Fatal("run() did not start in 30 seconds")
		case <-time.After(20 * time.Millisecond):
		}
		resp, err := client.Get("http://" + env[config.EnvAddr] + "/api/health")
		if err != nil {
			continue
		}
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			cancel()
			select {
			case err := <-done:
				return err
			case <-time.After(shutdownTimeout + time.Second):
				t.Fatal("run() did not stop")
			}
		}
	}
}

// A disk of contents not mounted is an empty folder: FranzPLAY must not start on
// it and make everything again there.
func TestRunRefusesContentsThatAreNotThere(t *testing.T) {
	dataDir, contentDir := t.TempDir(), t.TempDir()
	db, err := database.Open(context.Background(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (name, password_hash, role, created_at) VALUES ('franz', 'x', 'admin', 1)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{config.EnvAddr: freeAddr(t), config.EnvDataDir: dataDir, config.EnvContentDir: contentDir}
	if err := startAndStop(t, env, io.Discard); !errors.Is(err, content.ErrNoContents) {
		t.Errorf("run() = %v, want ErrNoContents", err)
	}

	// An empty video folder is the way to say: start again from nothing.
	if err := os.Mkdir(filepath.Join(contentDir, "video"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := startAndStop(t, env, io.Discard); err != nil {
		t.Errorf("run() = %v with an empty video folder", err)
	}
}

// Contents that cannot be read are not contents that are not there.
func TestRunRefusesContentsItCannotRead(t *testing.T) {
	contentDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(contentDir, "video"), []byte("in the way"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{config.EnvAddr: freeAddr(t), config.EnvDataDir: t.TempDir(), config.EnvContentDir: contentDir}
	if err := startAndStop(t, env, io.Discard); err == nil {
		t.Error("run() = nil on contents it cannot read")
	}
}

// A new installation, with its contents on another disk, starts as always, and
// again after that.
func TestRunStartsANewInstallationWithItsOwnContents(t *testing.T) {
	env := map[string]string{config.EnvAddr: freeAddr(t), config.EnvDataDir: t.TempDir(), config.EnvContentDir: t.TempDir()}
	for range 2 {
		if err := startAndStop(t, env, io.Discard); err != nil {
			t.Fatalf("run() = %v", err)
		}
	}
}

// After migrate-content, a content folder set no more sends FranzPLAY back to
// the data folder, which is not empty, but has not the folders of the videos:
// it starts, and the log says what is missing.
func TestRunSaysWhenTheFoldersOfTheVideosAreNotThere(t *testing.T) {
	dataDir := t.TempDir()
	db, err := database.Open(context.Background(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, '/videos')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at, cover)
		VALUES ('v1:000000000000000000000000aaaaaaaa', 1, 'mare.mp4', 1, 1, 'Il mare', 1, 'aaaaaaaa/copertina.jpg')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{config.EnvAddr: freeAddr(t), config.EnvDataDir: dataDir}
	var log bytes.Buffer
	if err := startAndStop(t, env, &log); err != nil {
		t.Fatalf("run() = %v", err)
	}
	if !strings.Contains(log.String(), "folders of videos the content folder does not have") ||
		!strings.Contains(log.String(), "aaaaaaaa") {
		t.Errorf("the log does not say the folders are missing: %s", log.String())
	}
}
