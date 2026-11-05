package titles

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
)

func presets() Settings {
	var s Settings
	for _, p := range Presets {
		s.Rules = append(s.Rules, p.Rule)
	}
	return s
}

func compile(t *testing.T, s Settings) *Cleaner {
	t.Helper()
	s, err := s.Clean()
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.Compile()
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestPresetsMakeATitle(t *testing.T) {
	c := compile(t, presets())
	for name, want := range map[string]string{
		"Il_mio_video_[1080p].mp4":        "Il mio video",
		"Viaggi/Il.mare.di.sera.[4K].mkv": "Il mare di sera",
		"Lezione-01 - introduzione.webm":  "Lezione 01 introduzione",
		"[Gruppo] Puntata__1.avi":         "Puntata 1",
		"senza_estensione":                "senza estensione",
		"[solo un tag].mp4":               "[solo un tag]", // nothing left: the name stays
	} {
		if got := c.Title(FileTitle(name)); got != want {
			t.Errorf("%q: title %q, want %q", name, got, want)
		}
	}
}

func TestNoRulesKeepTheNameWithoutExtension(t *testing.T) {
	var c *Cleaner
	if got := c.Title(FileTitle("Film/Il_mio_video_[1080p].mp4")); got != "Il_mio_video_[1080p]" {
		t.Errorf("title = %q", got)
	}
	if got := FileTitle(".nascosto"); got != ".nascosto" {
		t.Errorf("a name starting with a dot = %q", got)
	}
}

func TestRulesRunInOrderAndOnlyWhenOn(t *testing.T) {
	c := compile(t, Settings{Rules: []Rule{
		{Find: "a", Replace: "b", On: true},
		{Find: "b", Replace: "c", On: true},
		{Find: "c", Replace: "X", On: false},
	}})
	if got := c.Title("aab"); got != "ccc" {
		t.Errorf("title = %q, want ccc", got)
	}
}

func TestCategoriesOnlyWhenAsked(t *testing.T) {
	rules := []Rule{{Find: "_", Replace: " ", On: true}}
	if got := compile(t, Settings{Rules: rules}).Category("Serie_TV"); got != "Serie_TV" {
		t.Errorf("without the option: %q", got)
	}
	if got := compile(t, Settings{Rules: rules, Categories: true}).Category("Serie_TV"); got != "Serie TV" {
		t.Errorf("with the option: %q", got)
	}
}

func TestBadRulesAreRefusedWithTheirNumber(t *testing.T) {
	for _, tt := range []struct {
		name string
		rule Rule
		want string
	}{
		{"nothing to find", Rule{Find: "", On: true}, "Regola 2: scrivi"},
		{"bad regex", Rule{Find: "([a-z]", Regex: true, On: true}, "Regola 2: l'espressione regolare non è valida"},
		{"two lines", Rule{Find: "a\nb", On: true}, "Regola 2: il testo deve stare su una riga"},
		{"too long", Rule{Find: strings.Repeat("a", MaxFind+1), On: true}, "Regola 2: il testo da cercare"},
		{"huge repetition", Rule{Find: "(a{1000}){1000}", Regex: true, On: true}, "Regola 2: l'espressione regolare"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Settings{Rules: []Rule{{Find: "_", Replace: " ", On: true}, tt.rule}}.Clean()
			var re *RuleError
			if !errors.As(err, &re) || !strings.HasPrefix(err.Error(), tt.want) {
				t.Errorf("error = %v, want one starting with %q", err, tt.want)
			}
		})
	}
	if _, err := (Settings{Rules: make([]Rule, MaxRules+1)}).Clean(); !errors.Is(err, ErrTooManyRules) {
		t.Errorf("too many rules: %v", err)
	}
}

// TestASlowLookingRegexIsFast: Go's expressions take a time that grows
// with the name, never explodes, even for the ones that hang other engines.
func TestASlowLookingRegexIsFast(t *testing.T) {
	c := compile(t, Settings{Rules: []Rule{{Find: `(a+)+$`, Replace: "x", Regex: true, On: true}}})
	name := strings.Repeat("a", 5000) + "!"
	if got := c.Title(name); len(got) > maxTitle {
		t.Errorf("the title is %d bytes long", len(got))
	}
}

func TestATitleNeverGrowsTooMuch(t *testing.T) {
	c := compile(t, Settings{Rules: []Rule{{Find: "a", Replace: strings.Repeat("b", MaxReplace), On: true}}})
	got := c.Title(strings.Repeat("a", 200))
	if n := len([]rune(got)); n > maxTitle {
		t.Errorf("title of %d characters", n)
	}
}

func TestSaveAndLoad(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	s, err := Load(ctx, db)
	if err != nil || len(s.Rules) != 0 || s.Rules == nil {
		t.Fatalf("never saved: %+v, %v", s, err)
	}
	_, before, err := LoadCleaner(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	want, err := presets().Clean()
	if err != nil {
		t.Fatal(err)
	}
	want.Categories = true
	if err := Save(ctx, db, want); err != nil {
		t.Fatal(err)
	}
	got, err := Load(ctx, db)
	if err != nil || len(got.Rules) != len(want.Rules) || !got.Categories || got.Rules[3] != want.Rules[3] {
		t.Fatalf("loaded %+v, %v", got, err)
	}
	if _, after, _ := LoadCleaner(ctx, db); after == before {
		t.Error("the version of the rules did not change")
	}
}
