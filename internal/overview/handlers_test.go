package overview

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/users"
	"github.com/FranzGra/FranzPLAY/internal/video"
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
		INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, folder_category, added_at,
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
	want := Videos{Present: 4, Eligible: 4, Hidden: 1, Missing: 1, Analysed: 3, Playable: 2, NoCover: 1}
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

func TestOverviewListsTheDamagedFiles(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, t.TempDir())
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
		INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, folder_category, added_at, too_short, missing_since) VALUES
			(1, 'a', 1, 'Mare/gita.mp4', 1, 1, 'gita', 'Mare', 1, 0, NULL),
			(2, 'b', 1, 'Mare/rotto.mp4', 2048, 1, 'rotto', 'Mare', 1, 0, NULL),
			(3, 'c', 1, 'audio.mp4', 10, 1, 'audio', '', 1, 0, NULL),
			(4, 'd', 1, 'corto.mp4', 10, 1, 'corto', '', 1, 1, NULL),
			(5, 'e', 1, 'corto-rotto.mp4', 10, 1, 'corto rotto', '', 1, 1, NULL),
			(6, 'f', 1, 'perso.mp4', 10, 1, 'perso', '', 1, 0, 9),
			(7, 'g', 1, 'riprova.mp4', 10, 1, 'riprova', '', 1, 0, NULL);
		INSERT INTO jobs (video_id, kind, state, last_error, updated_at) VALUES
			(2, 'probe', 'failed', 'read video 2: ffprobe: exit status 1: moov atom not found', 1),
			(3, 'probe', 'failed', 'video 3: no video stream: permanent failure', 1),
			(5, 'probe', 'failed', 'read video 5: ffprobe: exit status 1: Permission denied', 1),
			(6, 'probe', 'failed', 'read video 6: gone', 1),
			(7, 'probe', 'pending', 'read video 7: first attempt', 1),
			(1, 'cover', 'failed', 'a cover that failed does not make the file damaged', 1);`)
	if err != nil {
		t.Fatal(err)
	}
	a := api{db: db, logger: slog.New(slog.NewTextHandler(io.Discard, nil)), inContainer: true,
		account: func(context.Context) (users.Account, bool) { return users.Account{ID: 1, Role: users.Admin}, true },
		disk:    func(string) (uint64, uint64, error) { return 1000, 600, nil }}
	o, err := a.build(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !o.InContainer {
		t.Error("the page is not told the paths are the container's")
	}
	if v := o.Videos; v.Present != 6 || v.Eligible != 2 || v.Short != 1 || v.Problems != 3 {
		t.Errorf("videos = %+v, want 6 = 2 eligible + 1 short + 3 problems", v)
	}
	wantFiles := []DamagedFile{
		{ID: 2, Title: "rotto", Path: filepath.Join("/video", "Mare", "rotto.mp4"), Size: 2048, Kind: video.FileDamaged,
			Detail: "exit status 1: moov atom not found"},
		{ID: 3, Title: "audio", Path: filepath.Join("/video", "audio.mp4"), Size: 10, Kind: video.FileNoVideo,
			Detail: "no video stream: permanent failure"},
		{ID: 5, Title: "corto rotto", Path: filepath.Join("/video", "corto-rotto.mp4"), Size: 10, Kind: video.FileUnreadable,
			Detail: "exit status 1: Permission denied"},
	}
	if !slices.Equal(sortedByID(o.Damaged), wantFiles) {
		t.Errorf("damaged = %+v\nwant %+v", o.Damaged, wantFiles)
	}

	// Removed from the disk: the scan marks it missing, and it leaves the list.
	if _, err := db.Exec(`UPDATE videos SET missing_since = 5 WHERE id = 2`); err != nil {
		t.Fatal(err)
	}
	// Replaced by a good file: the scan asks to read it again, and it leaves too.
	if err := jobs.Enqueue(ctx, db, 3, jobs.Probe, false, time.Unix(5, 0)); err != nil {
		t.Fatal(err)
	}
	o, err = a.build(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(o.Damaged) != 1 || o.Damaged[0].ID != 5 || o.Videos.Problems != 1 {
		t.Errorf("after removing and replacing: %+v, problems %d", o.Damaged, o.Videos.Problems)
	}
}

func sortedByID(files []DamagedFile) []DamagedFile {
	out := slices.Clone(files)
	slices.SortFunc(out, func(a, b DamagedFile) int { return cmp.Compare(a.ID, b.ID) })
	return out
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
