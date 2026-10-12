package main

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
)

const oldDump = "../../internal/oldimport/testdata/mariadb-dump.sql"

func TestImportOld(t *testing.T) {
	dataDir := t.TempDir()
	db, err := database.Open(context.Background(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, '/video');
		INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at)
		VALUES ('a', 1, 'Vacanze/Mare 2019.mp4', 1, 0, 'Mare', 0)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	getenv := func(k string) string {
		if k == "FRANZPLAY_DATA_DIR" {
			return dataDir
		}
		return ""
	}
	count := func() int {
		db, err := database.Open(context.Background(), dataDir)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close() //nolint:errcheck // test
		var n int
		if err := db.QueryRow(`SELECT count(*) FROM users`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	var out bytes.Buffer
	if err := importOld(context.Background(), []string{"-try", oldDump}, getenv, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out.String(), "PROVA") || count() != 0 {
		t.Fatalf("a try saved something:\n%s", out.String())
	}

	out.Reset()
	if err := importOld(context.Background(), []string{oldDump}, getenv, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out.String(), "Importazione finita.") || count() != 3 {
		t.Fatalf("import:\n%s", out.String())
	}
}

func TestImportOldNeedsAFileAndAFranzPLAY(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nothing")
	getenv := func(k string) string {
		if k == "FRANZPLAY_DATA_DIR" {
			return missing
		}
		return ""
	}
	var out bytes.Buffer
	for _, args := range [][]string{nil, {"a.sql", "b.sql"}, {"-what", "a.sql"}} {
		if err := importOld(context.Background(), args, getenv, &out); !errors.Is(err, errUsage) {
			t.Errorf("%v: err = %v, want errUsage", args, err)
		}
	}
	if err := importOld(context.Background(), []string{oldDump}, getenv, &out); err == nil || !strings.Contains(err.Error(), "data folder") {
		t.Errorf("missing data folder: err = %v", err)
	}
}
