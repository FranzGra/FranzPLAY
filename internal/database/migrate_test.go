package database

import (
	"errors"
	"testing"
	"testing/fstest"
)

func files(names ...string) fstest.MapFS {
	fsys := fstest.MapFS{}
	for _, name := range names {
		fsys[name] = &fstest.MapFile{Data: []byte("-- " + name)}
	}
	return fsys
}

func TestLoadMigrationsInOrder(t *testing.T) {
	got, err := loadMigrations(files("0002_b.sql", "0001_a.sql", "0003_c.sql", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"0001_a.sql", "0002_b.sql", "0003_c.sql"}
	if len(got) != len(want) {
		t.Fatalf("got %d migrations, want %d", len(got), len(want))
	}
	for i, m := range got {
		if m.name != want[i] || m.version != i+1 || m.sql != "-- "+want[i] {
			t.Errorf("migration %d = %+v, want %s with version %d", i, m, want[i], i+1)
		}
	}
}

func TestLoadMigrationsRejectsBadFiles(t *testing.T) {
	tests := []struct {
		name  string
		files fstest.MapFS
	}{
		{"gap in numbers", files("0001_a.sql", "0003_c.sql")},
		{"same number twice", files("0001_a.sql", "0001_b.sql")},
		{"does not start at 1", files("0002_b.sql")},
		{"starts at 0", files("0000_zero.sql")},
		{"no description", files("0001.sql")},
		{"empty description", files("0001_.sql")},
		{"short number", files("1_a.sql")},
		{"not a number", files("abcd_a.sql")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := loadMigrations(tt.files)
			if !errors.Is(err, ErrBadMigrations) {
				t.Errorf("error = %v, want ErrBadMigrations", err)
			}
		})
	}
}

func TestPendingMigrations(t *testing.T) {
	all := []migration{{version: 1}, {version: 2}, {version: 3}}
	tests := []struct {
		current int
		want    []int
	}{
		{0, []int{1, 2, 3}},
		{1, []int{2, 3}},
		{3, nil},
	}
	for _, tt := range tests {
		got, err := pendingMigrations(tt.current, all)
		if err != nil {
			t.Fatalf("current %d: %v", tt.current, err)
		}
		var versions []int
		for _, m := range got {
			versions = append(versions, m.version)
		}
		if len(versions) != len(tt.want) {
			t.Fatalf("current %d: got %v, want %v", tt.current, versions, tt.want)
		}
		for i := range versions {
			if versions[i] != tt.want[i] {
				t.Errorf("current %d: got %v, want %v", tt.current, versions, tt.want)
			}
		}
	}
}

func TestPendingMigrationsRefusesNewerDatabase(t *testing.T) {
	_, err := pendingMigrations(4, []migration{{version: 1}, {version: 2}})
	if !errors.Is(err, ErrDatabaseTooNew) {
		t.Errorf("error = %v, want ErrDatabaseTooNew", err)
	}
}

func TestEmbeddedMigrationsAreValid(t *testing.T) {
	all, err := loadMigrations(migrationsFS())
	if err != nil {
		t.Fatal(err)
	}
	if len(all) == 0 {
		t.Fatal("no embedded migrations")
	}
}
