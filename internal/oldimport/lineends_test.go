package oldimport

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

// TestReadIgnoresTheLineEnds: a dump saved on Windows (CRLF) reads like the
// same dump with LF, so the fixture works whatever the checkout did to it.
func TestReadIgnoresTheLineEnds(t *testing.T) {
	data, err := os.ReadFile("testdata/mariadb-dump.sql")
	if err != nil {
		t.Fatal(err)
	}
	lf := strings.ReplaceAll(string(data), "\r\n", "\n")
	crlf := strings.ReplaceAll(lf, "\n", "\r\n")
	tables := []string{"Utenti", "Video", "Commenti", "like", "Cronologia"}
	a, err := Read(strings.NewReader(lf), tables...)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Read(strings.NewReader(crlf), tables...)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range tables {
		if a.Table(name) == nil {
			t.Fatalf("%s not read", name)
		}
		if !reflect.DeepEqual(a.Table(name), b.Table(name)) {
			t.Errorf("%s differs between LF and CRLF", name)
		}
	}
	if a.UTCTimestamps != b.UTCTimestamps {
		t.Error("the time zone is read differently")
	}
}
