package database

import (
	"errors"
	"testing"
)

func TestOnlyOneFranzPLAYUsesADataFolder(t *testing.T) {
	dir := t.TempDir()
	unlock, err := Lock(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Lock(dir); !errors.Is(err, ErrInUse) {
		t.Fatalf("second Lock = %v, want ErrInUse", err)
	}
	if err := unlock(); err != nil {
		t.Fatal(err)
	}
	// Once the first lets go, the folder can be used again.
	again, err := Lock(dir)
	if err != nil {
		t.Fatalf("Lock after unlock = %v", err)
	}
	if err := again(); err != nil {
		t.Fatal(err)
	}
}
