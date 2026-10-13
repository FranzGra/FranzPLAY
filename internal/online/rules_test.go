package online

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

func at(day, hour, minute int) time.Time {
	return time.Date(2026, 10, day, hour, minute, 0, 0, time.UTC)
}

func TestRulesWait(t *testing.T) {
	order := slices.Clone(sourceNames)
	tests := []struct {
		name  string
		rules Rules
		now   time.Time
		asked int
		want  time.Time // zero: ask now
	}{
		{"at any time", Rules{From: 5, To: 5}, at(12, 13, 0), 1000, time.Time{}},
		{"inside the hours", Rules{From: 2, To: 6}, at(12, 3, 30), 0, time.Time{}},
		{"before the hours", Rules{From: 2, To: 6}, at(12, 1, 15), 0, at(12, 2, 0)},
		{"after the hours: tomorrow", Rules{From: 2, To: 6}, at(12, 6, 0), 0, at(13, 2, 0)},
		{"the night, late evening", Rules{From: 22, To: 6}, at(12, 23, 0), 0, time.Time{}},
		{"the night, early morning", Rules{From: 22, To: 6}, at(12, 5, 59), 0, time.Time{}},
		{"the night, by day", Rules{From: 22, To: 6}, at(12, 12, 0), 0, at(12, 22, 0)},
		{"under the daily limit", Rules{Daily: 3}, at(12, 12, 0), 2, time.Time{}},
		{"daily limit reached: tomorrow", Rules{Daily: 3}, at(12, 12, 0), 3, at(13, 0, 0)},
		{"daily limit reached: tomorrow's hours", Rules{From: 2, To: 6, Daily: 3}, at(12, 3, 0), 3, at(13, 2, 0)},
		{"daily limit reached in the night", Rules{From: 22, To: 6, Daily: 3}, at(12, 23, 0), 3, at(13, 0, 0)},
	}
	for _, tt := range tests {
		tt.rules.Order = order
		until, wait := tt.rules.wait(tt.now, tt.asked)
		if wait != !tt.want.IsZero() || !until.Equal(tt.want) {
			t.Errorf("%s: wait = %v, %v; want %v", tt.name, until, wait, tt.want)
		}
	}
}

func TestRulesValid(t *testing.T) {
	ok := Rules{From: 22, To: 6, Daily: 50, Order: []string{"tpdb", "youtube", "tmdb"}}
	if !ok.valid() {
		t.Errorf("%+v not valid", ok)
	}
	for _, r := range []Rules{
		{From: 24, Order: sourceNames},
		{To: -1, Order: sourceNames},
		{Daily: -1, Order: sourceNames},
		{Daily: maxDaily + 1, Order: sourceNames},
		{Order: []string{"youtube", "tmdb"}},
		{Order: []string{"youtube", "tmdb", "tmdb"}},
		{Order: []string{"youtube", "tmdb", "tpdb", "imdb"}},
	} {
		if r.valid() {
			t.Errorf("%+v valid", r)
		}
	}
	if got := parseRules(`{"from": 30}`); !slices.Equal(got.Order, sourceNames) || got.From != 0 {
		t.Errorf("rules not valid read as %+v, want the default", got)
	}
}

func TestAskedToday(t *testing.T) {
	now := at(12, 9, 0)
	for saved, want := range map[string]int{
		"": 0, "2026-10-12 7": 7, "2026-10-11 7": 0, "2026-10-12 x": 0, "2026-10-12 -2": 0,
	} {
		if got := askedOn(saved, now); got != want {
			t.Errorf("askedOn(%q) = %d, want %d", saved, got, want)
		}
	}
	if got := askedOn(askedText(now, 8), now); got != 8 {
		t.Errorf("saved 8, read %d", got)
	}
}

func setRules(t *testing.T, fx *fixture, r Rules) {
	t.Helper()
	if err := saveRules(context.Background(), fx.db, r); err != nil {
		t.Fatal(err)
	}
}

func TestSourcesAreAskedInOrder(t *testing.T) {
	const film = "Il sorpasso (1962).mkv"
	fx := newFixture(t, film, false)
	turnTPDBOn(t, fx, film)
	turnTMDBOn(t, fx)
	if err := saveSources(context.Background(), fx.db, Sources{TMDB: true, TPDB: true}); err != nil {
		t.Fatal(err)
	}

	// TMDB first, and it finds the film: ThePornDB is not asked.
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got := fx.read(t); got.title != "Il sorpasso" || len(fx.tp.asked) != 0 {
		t.Fatalf("video = %+v, ThePornDB asked %v", got, fx.tp.addresses())
	}

	// TMDB finds nothing: the next source is asked.
	fx.tm.answers["/3/search/movie?it-IT"] = answer(http.StatusOK, `{"results": []}`)
	fx.tm.answers["/3/search/movie?en-US"] = answer(http.StatusOK, `{"results": []}`)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got := fx.read(t); got.title != "Una scena" {
		t.Fatalf("video = %+v, want what ThePornDB found", got)
	}

	// ThePornDB first: TMDB is not asked at all.
	setRules(t, fx, Rules{Order: []string{"tpdb", "tmdb", "youtube"}})
	fx.tm.asked = nil
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if len(fx.tm.asked) != 0 {
		t.Errorf("TMDB asked %v, want ThePornDB only", fx.tm.paths())
	}
}

func TestQuestionsWaitForTheHoursAndTheDailyLimit(t *testing.T) {
	fx := newFixture(t, "Gita [dQw4w9WgXcQ].mp4", true)
	fx.f.now = func() time.Time { return time.Date(2026, 10, 12, 12, 0, 0, 0, time.Local) }
	setRules(t, fx, Rules{From: 2, To: 6, Order: sourceNames})

	err := fx.f.Handle(context.Background(), fx.id)
	var later *jobs.LaterError
	if !errors.As(err, &later) || !later.Until.Equal(time.Date(2026, 10, 13, 2, 0, 0, 0, time.Local)) {
		t.Fatalf("outside the hours: %v, want to wait until tomorrow at 2", err)
	}
	if len(fx.yt.asked) != 0 {
		t.Fatalf("asked %v outside the hours", fx.yt.asked)
	}

	setRules(t, fx, Rules{Daily: 1, Order: sourceNames})
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	asked := len(fx.yt.asked)
	err = fx.f.Handle(context.Background(), fx.id)
	if !errors.As(err, &later) || !later.Until.Equal(time.Date(2026, 10, 13, 0, 0, 0, 0, time.Local)) {
		t.Fatalf("over the daily limit: %v, want to wait until tomorrow", err)
	}
	if len(fx.yt.asked) != asked {
		t.Errorf("asked %v over the daily limit", fx.yt.asked[asked:])
	}

	// A video no source on can know is not counted.
	setRules(t, fx, Rules{Daily: 1, Order: sourceNames})
	if _, err := fx.db.Exec(`UPDATE videos SET path = 'senza codice.mp4'`); err != nil {
		t.Fatal(err)
	}
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Errorf("a video no source can know: %v", err)
	}
}

func TestAdministratorSavesTheRules(t *testing.T) {
	fx := newAdminFixture(t)
	if _, err := fx.db.Exec(`INSERT INTO jobs (video_id, kind, state, run_after, updated_at)
		VALUES (?, 'online', 'pending', 99999999999, 1)`, fx.id); err != nil {
		t.Fatal(err)
	}
	rec := fx.do("PUT", "/api/online/rules",
		`{"from": 22, "to": 6, "daily": 100, "order": ["tpdb", "tmdb", "youtube"], "confirm": true}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(),
		`"rules":{"from":22,"to":6,"daily":100,"order":["tpdb","tmdb","youtube"],"confirm":true}`) {
		t.Fatalf("PUT rules = %d %s", rec.Code, rec.Body)
	}
	// The question waiting for the old rules looks again at once.
	var runAfter int64
	if err := fx.db.QueryRow(`SELECT run_after FROM jobs WHERE video_id = ?`, fx.id).Scan(&runAfter); err != nil || runAfter != 0 {
		t.Errorf("run_after = %d, %v; want 0", runAfter, err)
	}
	if fx.woken != 1 {
		t.Errorf("worker woken %d times, want 1", fx.woken)
	}

	for _, body := range []string{
		`{"from": 25, "to": 6, "daily": 0, "order": ["tpdb", "tmdb", "youtube"]}`,
		`{"from": 1, "to": 6, "daily": 0, "order": ["tpdb"]}`,
		`{"from": 1, "to": 6, "daily": 0, "order": ["tpdb", "tmdb", "youtube"], "mode": "x"}`,
	} {
		if rec := fx.do("PUT", "/api/online/rules", body); rec.Code != http.StatusBadRequest {
			t.Errorf("PUT %s = %d, want 400", body, rec.Code)
		}
	}
	if rec := fx.do("GET", "/api/online", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"daily":100`) {
		t.Errorf("rules not kept after refused changes: %s", rec.Body)
	}
}
