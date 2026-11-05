package library

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/titles"
)

// bigLibrary writes n small videos in folders folders, two levels deep, with
// a cover next to every tenth video and a file that is no video in each
// folder, as a library of years of holidays.
func bigLibrary(tb testing.TB, n, folders int) string {
	tb.Helper()
	lib := tb.TempDir()
	for f := range folders {
		dir := filepath.Join(lib, fmt.Sprintf("Raccolta %d", f%10), fmt.Sprintf("Viaggio_%d [2025]", f))
		if err := os.MkdirAll(dir, 0o750); err != nil {
			tb.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "note.txt"), []byte("x"), 0o600); err != nil {
			tb.Fatal(err)
		}
	}
	for i := range n {
		f := i % folders
		dir := filepath.Join(lib, fmt.Sprintf("Raccolta %d", f%10), fmt.Sprintf("Viaggio_%d [2025]", f))
		name := fmt.Sprintf("Giorno_%05d_[1080p]", i)
		if err := os.WriteFile(filepath.Join(dir, name+".mp4"), fmt.Appendf(nil, "video %d", i), 0o600); err != nil {
			tb.Fatal(err)
		}
		if i%10 == 0 {
			if err := os.WriteFile(filepath.Join(dir, name+".jpg"), []byte("cover"), 0o600); err != nil {
				tb.Fatal(err)
			}
		}
	}
	return lib
}

// benchScanner is newTestScanner for benchmarks too.
func benchScanner(tb testing.TB, lib string) *Scanner {
	tb.Helper()
	db, err := database.Open(context.Background(), tb.TempDir())
	if err != nil {
		tb.Fatal(err)
	}
	tb.Cleanup(func() { _ = db.Close() })
	s := NewScanner(db, []string{lib}, slog.New(slog.DiscardHandler))
	clock := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	return s
}

// TestScanOfABigLibrary: thousands of videos are added once, every folder
// with videos is a category, and the next scan finds nothing to do.
func TestScanOfABigLibrary(t *testing.T) {
	if testing.Short() {
		t.Skip("a big library")
	}
	const videos, folders = 3000, 150
	s := benchScanner(t, bigLibrary(t, videos, folders))
	r, err := s.Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r != (Report{Added: videos}) {
		t.Fatalf("first scan = %+v", r)
	}
	var categories, names int
	if err := s.store.db.QueryRow(`SELECT count(DISTINCT folder_category) FROM videos`).Scan(&categories); err != nil {
		t.Fatal(err)
	}
	if err := s.store.db.QueryRow(`SELECT count(*) FROM folder_categories`).Scan(&names); err != nil {
		t.Fatal(err)
	}
	if categories != folders || names != folders {
		t.Errorf("%d categories, %d names, want %d", categories, names, folders)
	}
	if r, err := s.Scan(context.Background()); err != nil || r != (Report{Unchanged: videos}) {
		t.Errorf("second scan = %+v, %v", r, err)
	}
}

func BenchmarkList(b *testing.B) {
	lib := bigLibrary(b, 5000, 200)
	fsys := os.DirFS(lib)
	b.ReportAllocs()
	for b.Loop() {
		if l := list(fsys, 1); len(l.files) != 5000 {
			b.Fatalf("%d files", len(l.files))
		}
	}
}

// BenchmarkScanFirst is the first scan of a library of 5000 videos: every
// file read for its fingerprint, every video added.
func BenchmarkScanFirst(b *testing.B) {
	lib := bigLibrary(b, 5000, 200)
	for b.Loop() {
		b.StopTimer()
		s := benchScanner(b, lib)
		b.StartTimer()
		if r, err := s.Scan(context.Background()); err != nil || r.Added != 5000 {
			b.Fatalf("%+v, %v", r, err)
		}
	}
}

// BenchmarkScanUnchanged is the scan of every few minutes: 5000 videos, none
// changed.
func BenchmarkScanUnchanged(b *testing.B) {
	s := benchScanner(b, bigLibrary(b, 5000, 200))
	if _, err := s.Scan(context.Background()); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	for b.Loop() {
		if r, err := s.Scan(context.Background()); err != nil || r.Unchanged != 5000 {
			b.Fatalf("%+v, %v", r, err)
		}
	}
}

// BenchmarkRetitle makes again the titles and the categories of 5000
// videos, as a save of the rules does, switching between two sets of rules
// so every video changes each time.
func BenchmarkRetitle(b *testing.B) {
	s := benchScanner(b, bigLibrary(b, 5000, 200))
	if _, err := s.Scan(context.Background()); err != nil {
		b.Fatal(err)
	}
	var sets [2]titles.Settings
	for _, p := range titles.Presets {
		sets[0].Rules = append(sets[0].Rules, p.Rule)
	}
	sets[0].Categories = true
	sets[1].Rules = []titles.Rule{}
	for i := range sets {
		clean, err := sets[i].Clean()
		if err != nil {
			b.Fatal(err)
		}
		sets[i] = clean
	}
	i := 0
	for b.Loop() {
		b.StopTimer()
		if err := titles.Save(context.Background(), s.store.db, sets[i%2]); err != nil {
			b.Fatal(err)
		}
		b.StartTimer()
		if n, err := s.Retitle(context.Background()); err != nil || n != 5000 {
			b.Fatalf("%d, %v", n, err)
		}
		i++
	}
}

func BenchmarkCategoryNames(b *testing.B) {
	keys := make([]string, 0, 2000)
	for i := range 2000 {
		// Many folders of one name, as the seasons of many series.
		keys = append(keys, fmt.Sprintf("Serie %d/Stagione %d", i/10, i%10))
	}
	b.ReportAllocs()
	for b.Loop() {
		if got := categoryNames(keys, nil); len(got) != len(keys) {
			b.Fatal(len(got))
		}
	}
}
