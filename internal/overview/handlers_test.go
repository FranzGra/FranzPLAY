package overview

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

func TestOverviewCountsEverything(t *testing.T) {
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	_, err = db.Exec(`
		INSERT INTO libraries (id, path) VALUES (1, '/video');
		INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, category, added_at,
		                    missing_since, hidden_at, video_codec, audio_codec, converted, cover) VALUES
			(1, 'a', 1, 'Mare/gita.mp4', 1, 1, 'gita', 'Mare', 1, NULL, NULL, 'h264', 'aac', NULL, 'a.jpg'),
			(2, 'b', 1, 'Mare/film.mkv', 1, 1, 'film', 'Mare', 1, NULL, NULL, 'hevc', 'ac3', NULL, NULL),
			(3, 'c', 1, 'Monti/via.mkv', 1, 1, 'via', 'Monti', 1, NULL, NULL, 'hevc', 'ac3', 'c.mp4', 'c.jpg'),
			(4, 'd', 1, 'Casa/nuovo.mp4', 1, 1, 'nuovo', 'Casa', 1, NULL, 5, NULL, NULL, NULL, NULL),
			(5, 'e', 1, 'perso.mp4', 1, 1, 'perso', '', 1, 9, NULL, 'h264', 'aac', NULL, NULL);
		INSERT INTO users (id, name, password_hash, role, created_at) VALUES
			(1, 'Admin', 'x', 'admin', 1), (2, 'Giulia', 'x', 'user', 1);
		INSERT INTO jobs (video_id, kind, state, updated_at) VALUES
			(4, 'probe', 'pending', 1), (2, 'cover', 'failed', 1);`)
	if err != nil {
		t.Fatal(err)
	}
	a := api{db: db, logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		settings: Settings{Version: "1.2.3", DataDir: "/dati", Libraries: []string{"/video", "/mnt/usb"}, Tools: true},
		account:  func(context.Context) (users.Account, bool) { return users.Account{ID: 1, Role: users.Admin}, true },
		disk: func(dir string) (uint64, uint64, error) {
			if dir == "/mnt/usb" {
				return 0, 0, errors.New("not mounted")
			}
			return 1000, 600, nil
		}}
	mux := http.NewServeMux()
	a.routes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/overview", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d %s", rec.Code, rec.Body)
	}
	var o Overview
	if err := json.Unmarshal(rec.Body.Bytes(), &o); err != nil {
		t.Fatal(err)
	}
	want := Videos{Present: 4, Hidden: 1, Missing: 1, Analysed: 3, Playable: 2, NoCover: 1}
	if o.Videos != want {
		t.Errorf("videos = %+v, want %+v", o.Videos, want)
	}
	if o.Version != "1.2.3" || o.Categories != 2 || o.People != 2 || o.Admins != 1 || o.Comments != 0 ||
		o.Jobs != (Jobs{Waiting: 1, Failed: 1}) {
		t.Errorf("overview = %+v", o)
	}
	wantDisks := []Disk{
		{Folder: "/dati", Data: true, Total: 1000, Free: 600},
		{Folder: "/video", Total: 1000, Free: 600},
		{Folder: "/mnt/usb", Error: true},
	}
	if len(o.Disks) != 3 || o.Disks[0] != wantDisks[0] || o.Disks[1] != wantDisks[1] || o.Disks[2] != wantDisks[2] {
		t.Errorf("disks = %+v", o.Disks)
	}
	kinds := []ProblemKind{}
	for _, p := range o.Problems {
		kinds = append(kinds, p.Kind)
	}
	if len(kinds) != 3 || kinds[0] != DiskUnread || kinds[1] != FailedJobs || kinds[2] != MissingVideos {
		t.Errorf("problems = %v", kinds)
	}

	// Only administrators.
	a.account = func(context.Context) (users.Account, bool) { return users.Account{ID: 2, Role: users.User}, true }
	mux = http.NewServeMux()
	a.routes(mux)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/overview", nil))
	if rec.Code != http.StatusForbidden {
		t.Errorf("normal user: %d", rec.Code)
	}
}

func TestDiskSpaceOfARealFolder(t *testing.T) {
	total, free, err := diskSpace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if total == 0 || free > total {
		t.Errorf("total %d, free %d", total, free)
	}
	if _, _, err := diskSpace("/questa/cartella/non/esiste"); err == nil {
		t.Error("no error for a folder that does not exist")
	}
}
