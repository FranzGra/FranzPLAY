package recommend

import (
	"context"
	"testing"
)

// The copy of the library is read again exactly when what the rules see
// changes, and stays when only other details of a video change.
func TestStoreKeepsTheLibraryUntilItChanges(t *testing.T) {
	s := newSite(t)
	st := newStore(s.db)
	ctx := context.Background()
	mare := s.addVideo(t, "Gita al MARE", "Vacanze", 10)

	read := func() []Video {
		t.Helper()
		all, err := st.videos(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return all
	}
	same := func(a, b []Video) bool { return len(a) > 0 && len(b) > 0 && &a[0] == &b[0] }
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := s.db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}

	first := read()
	if len(first) != 1 || first[0].Title != "gita al mare" {
		t.Fatalf("videos = %+v, want the one video with its title in small letters", first)
	}
	if !same(first, read()) {
		t.Error("nothing changed, but the library was read again")
	}

	exec(`UPDATE videos SET size = 2 WHERE id = ?`, mare)
	if !same(first, read()) {
		t.Error("only the size changed, but the library was read again")
	}

	steps := []struct {
		name string
		do   func()
		want func([]Video) bool
	}{
		{"a new video", func() { s.addVideo(t, "Festa", "", 20) },
			func(v []Video) bool { return len(v) == 2 }},
		{"a new title", func() { exec(`UPDATE videos SET admin_title = 'Mare d''inverno' WHERE id = ?`, mare) },
			func(v []Video) bool { return v[0].Title == "mare d'inverno" || v[1].Title == "mare d'inverno" }},
		{"a new category", func() { exec(`UPDATE videos SET admin_category = 'Inverno' WHERE id = ?`, mare) },
			func(v []Video) bool { return v[0].Category == "Inverno" || v[1].Category == "Inverno" }},
		{"a hidden video", func() { exec(`UPDATE videos SET hidden_at = 1 WHERE id = ?`, mare) },
			func(v []Video) bool { return len(v) == 1 && v[0].ID != mare }},
		{"a removed video", func() { exec(`DELETE FROM videos WHERE id != ?`, mare) },
			func(v []Video) bool { return len(v) == 0 }},
	}
	for _, step := range steps {
		step.do()
		if got := read(); !step.want(got) {
			t.Errorf("after %s: videos = %+v", step.name, got)
		}
	}
}
