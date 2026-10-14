package library

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/users"
)

// adminSite serves the folders' API of ts for the person who.
func adminSite(ts *testScanner, who *users.Account) *http.ServeMux {
	mux := http.NewServeMux()
	a := admin{
		scanner: ts.Scanner, interval: time.Minute,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		account: func(context.Context) (users.Account, bool) {
			return *who, who.ID != 0
		},
	}
	a.routes(mux)
	return mux
}

func call(t *testing.T, mux *http.ServeMux, method, path string, want int) []byte {
	t.Helper()
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	if rec.Code != want {
		t.Fatalf("%s %s = %d, want %d; body %s", method, path, rec.Code, want, rec.Body)
	}
	return rec.Body.Bytes()
}

func readOverview(t *testing.T, mux *http.ServeMux) overview {
	t.Helper()
	var o overview
	if err := json.Unmarshal(call(t, mux, "GET", "/api/library", http.StatusOK), &o); err != nil {
		t.Fatal(err)
	}
	return o
}

func TestLibraryOverview(t *testing.T) {
	parent := t.TempDir()
	good := filepath.Join(parent, "good")
	disk := filepath.Join(parent, "disk")
	writeFile(t, good, "a.mp4", "a")
	writeFile(t, good, "b.mp4", "b")
	writeFile(t, disk, "c.mp4", "c")
	ts := newTestScanner(t, good, disk)
	admin := &users.Account{ID: 1, Name: "Admin", Role: users.Admin}
	mux := adminSite(ts, admin)

	// Before any scan: the folders, with nothing in them yet.
	o := readOverview(t, mux)
	if o.LastScan != nil || o.Interval != 60 || len(o.Folders) != 2 || o.Folders[0].Path != good {
		t.Fatalf("before the first scan: %+v", o)
	}

	ts.scan(t, Report{Added: 3})
	// The disk is unplugged: its folder is empty now.
	if err := os.RemoveAll(disk); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(disk, 0o750); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Unchanged: 2})
	o = readOverview(t, mux)
	if g := o.Folders[0]; g.Videos != 2 || g.Missing != 0 || g.Problem != "" || g.LooksUnplugged {
		t.Errorf("good folder = %+v", g)
	}
	if d := o.Folders[1]; d.Videos != 1 || !d.LooksUnplugged {
		t.Errorf("unplugged folder = %+v", d)
	}

	// The folder is gone altogether: a problem, said in the folder's row.
	if err := os.Remove(disk); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Unchanged: 2, Problems: 1})
	if d := readOverview(t, mux).Folders[1]; d.Problem == "" || d.LooksUnplugged {
		t.Errorf("missing folder = %+v", d)
	}
}

func TestLibraryIsForAdministrators(t *testing.T) {
	who := &users.Account{ID: 2, Name: "Giulia", Role: users.User}
	mux := adminSite(newTestScanner(t, t.TempDir()), who)
	call(t, mux, "GET", "/api/library", http.StatusForbidden)
	call(t, mux, "POST", "/api/library/scan", http.StatusForbidden)
	*who = users.Account{}
	call(t, mux, "GET", "/api/library", http.StatusUnauthorized)
}

func TestScanNow(t *testing.T) {
	lib := t.TempDir()
	ts := newTestScanner(t, lib)
	admin := &users.Account{ID: 1, Name: "Admin", Role: users.Admin}
	mux := adminSite(ts, admin)

	var mu sync.Mutex
	var told []bool
	ts.OnScanning(func(on bool) {
		mu.Lock()
		told = append(told, on)
		mu.Unlock()
	})
	scans := func() int {
		mu.Lock()
		defer mu.Unlock()
		return len(told) / 2
	}
	waitScans := func(n int) {
		t.Helper()
		for range 500 {
			if scans() >= n && !ts.Status().Scanning {
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
		t.Fatalf("scans = %d, want %d", scans(), n)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		ts.Run(ctx, time.Hour) // the interval never comes during the test
		close(done)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
	waitScans(1) // the first scan, right away
	if o := readOverview(t, mux); o.LastScan == nil || o.LastScan.Error != "" {
		t.Errorf("after the first scan: %+v", o.LastScan)
	}

	writeFile(t, lib, "nuovo.mp4", "new")
	call(t, mux, "POST", "/api/library/scan", http.StatusAccepted)
	waitScans(2)
	if o := readOverview(t, mux); o.LastScan.Added != 1 || o.Folders[0].Videos != 1 {
		t.Errorf("after scanning now: %+v %+v", o.LastScan, o.Folders)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(told) != 4 || !told[0] || told[1] || !told[2] || told[3] {
		t.Errorf("scanning told %v, want [true false true false]", told)
	}
}
