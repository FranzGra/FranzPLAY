package library

import (
	"reflect"
	"testing"
)

func loc(path string) location { return location{library: 1, path: path} }

func k(id int64, fp, path string, size, mod int64) known {
	return known{id: id, fingerprint: fp, loc: loc(path), size: size, modTime: mod}
}

func f(path string, size, mod int64) found { return found{loc: loc(path), size: size, modTime: mod} }

func idf(path string, size, mod int64, fp string) identified {
	return identified{found: f(path, size, mod), fingerprint: fp}
}

func trustAll(int64) bool  { return true }
func trustNone(int64) bool { return false }

func TestCompare(t *testing.T) {
	missing := k(3, "c", "c.mp4", 30, 300)
	missing.missing = true
	knownVideos := []known{k(1, "a", "a.mp4", 10, 100), k(2, "b", "b.mp4", 20, 200), missing}
	files := []found{
		f("a.mp4", 10, 100), // unchanged
		f("b.mp4", 20, 999), // date changed
		f("c.mp4", 30, 300), // same place as a missing video: must be identified
		f("new.mp4", 5, 50), // never seen
	}

	unchanged, toIdentify := compare(knownVideos, files)

	if !reflect.DeepEqual(unchanged, []int64{1}) {
		t.Errorf("unchanged = %v, want [1]", unchanged)
	}
	want := []found{files[1], files[2], files[3]}
	if !reflect.DeepEqual(toIdentify, want) {
		t.Errorf("toIdentify = %v, want %v", toIdentify, want)
	}
}

func TestReconcile(t *testing.T) {
	missingC := k(3, "c", "old/c.mp4", 30, 300)
	missingC.missing = true

	tests := []struct {
		name      string
		known     []known
		unchanged []int64
		files     []identified
		trusted   func(int64) bool
		want      changes
	}{
		{
			name:  "new video",
			files: []identified{idf("a.mp4", 10, 100, "a")},
			want:  changes{added: []identified{idf("a.mp4", 10, 100, "a")}},
		},
		{
			name:      "unchanged video stays",
			known:     []known{k(1, "a", "a.mp4", 10, 100)},
			unchanged: []int64{1},
			want:      changes{unchanged: []int64{1}},
		},
		{
			name:  "renamed video keeps its identity",
			known: []known{k(1, "a", "a.mp4", 10, 100)},
			files: []identified{idf("Viaggi/mare.mp4", 10, 100, "a")},
			want: changes{updates: []update{
				{id: 1, kind: moved, file: idf("Viaggi/mare.mp4", 10, 100, "a")},
			}},
		},
		{
			name:  "same content, only the date changed",
			known: []known{k(1, "a", "a.mp4", 10, 100)},
			files: []identified{idf("a.mp4", 10, 555, "a")},
			want: changes{updates: []update{
				{id: 1, kind: touched, file: idf("a.mp4", 10, 555, "a")},
			}},
		},
		{
			name:  "file replaced with a new version keeps its history",
			known: []known{k(1, "a", "a.mp4", 10, 100)},
			files: []identified{idf("a.mp4", 12, 200, "a2")},
			want: changes{updates: []update{
				{id: 1, kind: replaced, file: idf("a.mp4", 12, 200, "a2")},
			}},
		},
		{
			name:  "missing video comes back",
			known: []known{missingC},
			files: []identified{idf("c.mp4", 30, 300, "c")},
			want: changes{updates: []update{
				{id: 3, kind: moved, file: idf("c.mp4", 30, 300, "c"), wasMissing: true},
			}},
		},
		{
			name:  "video not found is gone",
			known: []known{k(1, "a", "a.mp4", 10, 100)},
			want:  changes{gone: []int64{1}},
		},
		{
			name:    "video not found in an untrusted library is kept",
			known:   []known{k(1, "a", "a.mp4", 10, 100)},
			trusted: trustNone,
			want:    changes{},
		},
		{
			name:  "already missing video is not marked again",
			known: []known{missingC},
			want:  changes{},
		},
		{
			name:      "copy of a video already in place is a duplicate",
			known:     []known{k(1, "a", "a.mp4", 10, 100)},
			unchanged: []int64{1},
			files:     []identified{idf("copy.mp4", 10, 100, "a")},
			want: changes{
				unchanged:  []int64{1},
				duplicates: []identified{idf("copy.mp4", 10, 100, "a")},
			},
		},
		{
			name:  "two copies of a new video count once",
			files: []identified{idf("b.mp4", 10, 100, "n"), idf("a.mp4", 10, 100, "n")},
			want: changes{
				added:      []identified{idf("a.mp4", 10, 100, "n")},
				duplicates: []identified{idf("b.mp4", 10, 100, "n")},
			},
		},
		{
			name:  "moved video and its copy: first path wins, the other is a duplicate",
			known: []known{k(1, "a", "a.mp4", 10, 100)},
			files: []identified{idf("z.mp4", 10, 100, "a"), idf("b.mp4", 10, 100, "a")},
			want: changes{
				updates:    []update{{id: 1, kind: moved, file: idf("b.mp4", 10, 100, "a")}},
				duplicates: []identified{idf("z.mp4", 10, 100, "a")},
			},
		},
		{
			name: "two videos swap names",
			known: []known{
				k(1, "a", "x.mp4", 10, 100),
				k(2, "b", "y.mp4", 20, 200),
			},
			files: []identified{idf("x.mp4", 20, 200, "b"), idf("y.mp4", 10, 100, "a")},
			want: changes{updates: []update{
				{id: 2, kind: moved, file: idf("x.mp4", 20, 200, "b")},
				{id: 1, kind: moved, file: idf("y.mp4", 10, 100, "a")},
			}},
		},
		{
			name:  "video moved away and a new video put in its place",
			known: []known{k(1, "a", "x.mp4", 10, 100)},
			files: []identified{idf("x.mp4", 50, 500, "new"), idf("old/x.mp4", 10, 100, "a")},
			want: changes{
				updates: []update{{id: 1, kind: moved, file: idf("old/x.mp4", 10, 100, "a")}},
				added:   []identified{idf("x.mp4", 50, 500, "new")},
			},
		},
		{
			name:  "video moved to another library",
			known: []known{k(1, "a", "a.mp4", 10, 100)},
			files: []identified{{found: found{loc: location{library: 2, path: "a.mp4"}, size: 10, modTime: 100}, fingerprint: "a"}},
			want: changes{updates: []update{{
				id: 1, kind: moved,
				file: identified{found: found{loc: location{library: 2, path: "a.mp4"}, size: 10, modTime: 100}, fingerprint: "a"},
			}}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trusted := tt.trusted
			if trusted == nil {
				trusted = trustAll
			}
			got := reconcile(tt.known, tt.unchanged, tt.files, trusted)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("reconcile()\n got  %+v\n want %+v", got, tt.want)
			}
		})
	}
}

func TestLibraryTrusted(t *testing.T) {
	tests := []struct {
		name                    string
		readOK                  bool
		filesFound, videosKnown int
		want                    bool
	}{
		{"read fine with files", true, 5, 10, true},
		{"new empty library", true, 0, 0, true},
		{"empty but had videos: maybe a disk not mounted", true, 0, 10, false},
		{"errors while reading", false, 5, 10, false},
	}
	for _, tt := range tests {
		if got := libraryTrusted(tt.readOK, tt.filesFound, tt.videosKnown); got != tt.want {
			t.Errorf("%s: libraryTrusted() = %v, want %v", tt.name, got, tt.want)
		}
	}
}
