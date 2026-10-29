package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
)

func TestUnblock(t *testing.T) {
	dataDir := t.TempDir()
	db, err := database.Open(context.Background(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO login_blocks (key, failures, level, blocked_until, last_failure)
		VALUES ('account:admin', 3, 5, 9999999999, 1), ('address:203.0.113.9', 20, 2, 9999999999, 1)`); err != nil {
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

	var out bytes.Buffer
	if err := unblock(context.Background(), nil, getenv, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "Blocchi tolti: 2") {
		t.Errorf("output = %q", out.String())
	}
	db, err = database.Open(context.Background(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close() //nolint:errcheck // read only
	var left int
	if err := db.QueryRow(`SELECT count(*) FROM login_blocks`).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Errorf("%d blocks left", left)
	}

	if err := unblock(context.Background(), []string{"extra"}, getenv, &out); err == nil {
		t.Error("an extra word was accepted")
	}
}
