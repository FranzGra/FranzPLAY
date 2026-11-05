package catalog

import (
	"net/http"
	"net/url"
	"slices"
	"testing"
	"time"
)

func TestAdminFilters(t *testing.T) {
	s := newAdminSite(t) // now is the Unix second 1000
	day := int64(24 * 60 * 60)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := s.db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (5, 'Marta', 'x', 'user', 1)`)

	// A season inside its series: two categories, one inside the other.
	episode := s.addVideo(t, "Serie A/Stagione 1/e1.mp4", "e1", "Serie A/Stagione 1", 1000-2*day, true)
	trailer := s.addVideo(t, "Serie A/trailer.mp4", "trailer", "Serie A", 1000-10*day, true)
	film := s.addVideo(t, "x/lungo.mp4", "film", "Film", 1000-40*day, true)
	loose := s.addVideo(t, "senza.mp4", "loose", "", 1000-day, false)

	exec(`INSERT INTO folder_categories (name, shown) VALUES ('Serie A/Stagione 1', 'Stagione 1')`)
	exec(`INSERT INTO categories (name, label) VALUES ('Film', 'Cinema')`)
	exec(`UPDATE videos SET duration = 600, preview = 'p.jpg' WHERE id = ?`, trailer)
	exec(`UPDATE videos SET duration = 3600, uploaded_by = 5 WHERE id = ?`, film)
	exec(`UPDATE videos SET hidden_at = 1 WHERE id = ?`, trailer)
	// Subtitles inside the file, made by whisper, and made from an older
	// content of the file, which do not count.
	exec(`INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file) VALUES (?, 2, 'it', '', 0, 'a.vtt')`, episode)
	exec(`INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at)
		VALUES (?, 'it', '', 'small', 'fp-Serie A/trailer.mp4', 'b.vtt', 1)`, trailer)
	exec(`INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at)
		VALUES (?, 'en', '', 'small', 'old', 'c.vtt', 1)`, film)

	list := func(t *testing.T, query string) ([]int64, adminList) {
		t.Helper()
		got := decode[adminList](t, s.do(t, "GET", "/api/admin/videos?"+query, "", http.StatusOK))
		ids := []int64{}
		for _, v := range got.Videos {
			ids = append(ids, v.ID)
		}
		slices.Sort(ids)
		return ids, got
	}
	ids := func(id ...int64) []int64 {
		slices.Sort(id)
		return id
	}
	catShow := func(show string, names ...string) string {
		v := url.Values{"show": {show}}
		v["category"] = names
		return v.Encode()
	}
	cat := func(names ...string) string { return catShow("", names...) }

	cases := []struct {
		name  string
		query string
		want  []int64
	}{
		{"no filter", "show=", ids(episode, trailer, film, loose)},
		{"a series is not its seasons", cat("Serie A"), ids(trailer)},
		{"a season alone", cat("Serie A/Stagione 1"), ids(episode)},
		{"two categories at once", cat("Serie A", "Serie A/Stagione 1"), ids(episode, trailer)},
		{"the same category twice", cat("Film", "Film"), ids(film)},
		{"no category", cat(""), ids(loose)},
		{"a category nobody has", cat("Nessuna"), ids()},
		{"from the folders", "show=&source=folder", ids(episode, trailer, loose)},
		{"uploaded", "show=&source=upload", ids(film)},
		{"with subtitles", "show=&subtitles=with", ids(episode, trailer)},
		{"without subtitles, old ones do not count", "show=&subtitles=without", ids(film, loose)},
		{"without cover", "show=&missing=cover", ids(loose)},
		{"without previews", "show=&missing=preview", ids(episode, film, loose)},
		{"short, not the ones not read", "show=&length=short", ids(episode)},
		{"medium", "show=&length=medium", ids(trailer)},
		{"long", "show=&length=long", ids(film)},
		{"last 7 days", "show=&added=7", ids(episode, loose)},
		{"last 30 days", "show=&added=30", ids(episode, trailer, loose)},
		{"category and subtitles", cat("Serie A", "Serie A/Stagione 1", "Film") + "&subtitles=without", ids(film)},
		{"category and a pill", catShow("hidden", "Serie A", "Serie A/Stagione 1"), ids(trailer)},
		{"category and the eligible pill, hidden ones too", catShow("eligible", "Serie A", "Serie A/Stagione 1"), ids(episode, trailer)},
		{"search by the name people see", "show=&q=Cinema", ids(film)},
		{"search by a named category's own name finds nothing", "show=&q=Film", ids()},
		{"search by the name of a folder category", "show=&q=Stagione", ids(episode)},
		{"search and filters", "show=&q=Serie&length=medium", ids(trailer)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, l := list(t, c.query)
			if !slices.Equal(got, c.want) {
				t.Errorf("%s: videos %v, want %v", c.query, got, c.want)
			}
			if l.Total != len(c.want) {
				t.Errorf("%s: total %d, want %d", c.query, l.Total, len(c.want))
			}
		})
	}

	// The pills count with the filters on.
	_, l := list(t, catShow("hidden", "Serie A", "Serie A/Stagione 1"))
	if l.Counts[allVideos] != 2 || l.Counts[hiddenVideos] != 1 || l.Counts[eligibleVideos] != 2 || l.Counts[missingVideos] != 0 {
		t.Errorf("counts with two categories = %+v", l.Counts)
	}
	_, l = list(t, "source=upload")
	if l.Counts[allVideos] != 1 || l.Counts[eligibleVideos] != 1 {
		t.Errorf("counts of the uploads = %+v", l.Counts)
	}

	for _, bad := range []string{"source=disk", "subtitles=it", "missing=clip", "length=huge", "added=1",
		cat(make([]string, maxAdminCategories+1)...)} {
		s.do(t, "GET", "/api/admin/videos?"+bad, "", http.StatusBadRequest)
	}
}

func TestParseAdminNarrow(t *testing.T) {
	now := time.Unix(100*24*60*60, 0)
	cases := []struct {
		query string
		want  adminNarrow
	}{
		{"", adminNarrow{}},
		{"category=a&category=b%2Fc&category=a", adminNarrow{categories: []string{"a", "b/c"}}},
		{"category=", adminNarrow{categories: []string{""}}},
		{"added=7", adminNarrow{since: now.Unix() - 7*24*60*60}},
		{"added=30&length=long&missing=cover&subtitles=with&source=folder",
			adminNarrow{since: now.Unix() - 30*24*60*60, length: "long", missingArt: "cover", subtitles: "with", source: "folder"}},
	}
	for _, c := range cases {
		values, err := url.ParseQuery(c.query)
		if err != nil {
			t.Fatal(err)
		}
		got, err := parseAdminNarrow(values, now)
		if err != nil {
			t.Errorf("%q: %v", c.query, err)
			continue
		}
		if !slices.Equal(got.categories, c.want.categories) || got.source != c.want.source ||
			got.subtitles != c.want.subtitles || got.missingArt != c.want.missingArt ||
			got.length != c.want.length || got.since != c.want.since {
			t.Errorf("%q = %+v, want %+v", c.query, got, c.want)
		}
	}
}
