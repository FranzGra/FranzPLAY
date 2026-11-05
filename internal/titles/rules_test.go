package titles

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"github.com/FranzGra/FranzPLAY/internal/database"
)

// TestFileTitleNeverShowsTheExtension: only the last extension goes, and a
// name made only of an extension stays as it is.
func TestFileTitleNeverShowsTheExtension(t *testing.T) {
	for _, tt := range []struct{ path, want string }{
		{"a.mp4", "a"},
		{"Film/a.MKV", "a"},
		{"Film/Il.mare.di.sera.mp4", "Il.mare.di.sera"},
		{"Film/doppia.mp4.mkv", "doppia.mp4"},
		{"Film/finisce col punto.", "finisce col punto"},
		{"Film/.nascosto.mp4", ".nascosto"},
		{"Film/.mp4", ".mp4"},
		{"Città/Perù 🎒 (2019).webm", "Perù 🎒 (2019)"},
		{"a/b/c/d/e/f.ts", "f"},
		{"Cartella.con.punti/senza estensione", "senza estensione"},
		{"", ""},
	} {
		if got := FileTitle(tt.path); got != tt.want {
			t.Errorf("FileTitle(%q) = %q, want %q", tt.path, got, tt.want)
		}
	}
}

func TestRules(t *testing.T) {
	for _, tt := range []struct {
		name  string
		rules []Rule
		in    string
		want  string
	}{
		{"plain text is not a regex", []Rule{{Find: "[1080p]", Replace: "", On: true}}, "Film [1080p]", "Film"},
		{"plain dot", []Rule{{Find: ".", Replace: " ", On: true}}, "a.b.c", "a b c"},
		{"groups", []Rule{{Find: `^(\d+)\s*-\s*(.+)$`, Replace: "$2 ($1)", Regex: true, On: true}}, "01 - Pilota", "Pilota (01)"},
		{"group next to text", []Rule{{Find: `(\w+)_x`, Replace: "${1}y", Regex: true, On: true}}, "ab_x", "aby"},
		{"no case", []Rule{{Find: `(?i)\bHDTV\b`, Replace: "", Regex: true, On: true}}, "Serie hdtv HDTV Hdtv", "Serie"},
		{"letters of every language", []Rule{{Find: `[^\p{L}\p{N} ]`, Replace: "", Regex: true, On: true}}, "Perù_città-2019!", "Perùcittà2019"},
		{"emoji kept", []Rule{{Find: "_", Replace: " ", On: true}}, "🎬_Film_🍿", "🎬 Film 🍿"},
		{"an empty match puts text everywhere", []Rule{{Find: `x*`, Replace: "-", Regex: true, On: true}}, "ab", "-a-b-"},
		{"spaces trimmed", []Rule{{Find: "[HD]", Replace: "", On: true}}, "  Film [HD]  ", "Film"},
		{"everything removed keeps the name", []Rule{{Find: `.`, Replace: "", Regex: true, On: true}}, "Film", "Film"},
		{"only spaces left keeps the name", []Rule{{Find: "a", Replace: " ", On: true}}, "aaa", "aaa"},
		{"later rules see earlier ones", []Rule{
			{Find: "_", Replace: " ", On: true},
			{Find: `\s{2,}`, Replace: " ", Regex: true, On: true},
		}, "a__b", "a b"},
		{"order matters", []Rule{
			{Find: `\s{2,}`, Replace: " ", Regex: true, On: true},
			{Find: "_", Replace: " ", On: true},
		}, "a__b", "a  b"},
		{"off rules are skipped", []Rule{{Find: "a", Replace: "b", On: false}}, "a", "a"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := compile(t, Settings{Rules: tt.rules}).Title(tt.in); got != tt.want {
				t.Errorf("Title(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// TestLongTitlesAreCutOnCharacters: a title cut to its limit is still valid
// text, even with characters of many bytes.
func TestLongTitlesAreCutOnCharacters(t *testing.T) {
	for _, tt := range []struct {
		name string
		rule Rule
		in   string
	}{
		{"accents", Rule{Find: "e", Replace: "è", On: true}, strings.Repeat("e", 300)},
		{"emoji", Rule{Find: "a", Replace: strings.Repeat("🎬", 50), On: true}, strings.Repeat("a", 100)},
		{"growing past each step", Rule{Find: "a", Replace: "ää", On: true}, strings.Repeat("a", 999)},
		{"a regex that matches everywhere", Rule{Find: `x*`, Replace: "ü", Regex: true, On: true}, strings.Repeat("a", 900)},
	} {
		got := compile(t, Settings{Rules: []Rule{tt.rule, tt.rule}}).Title(tt.in)
		if !utf8.ValidString(got) {
			t.Errorf("%s: the title is not valid text: %q", tt.name, got)
		}
		if n := utf8.RuneCountInString(got); n > maxTitle {
			t.Errorf("%s: %d characters, want at most %d", tt.name, n, maxTitle)
		}
		if got != strings.TrimSpace(got) {
			t.Errorf("%s: spaces at the ends: %q", tt.name, got)
		}
	}
}

func TestCleanLimits(t *testing.T) {
	ok := func(r Rule) Settings { return Settings{Rules: []Rule{r}} }
	for _, tt := range []struct {
		name  string
		s     Settings
		valid bool
	}{
		{"find at its limit", ok(Rule{Find: strings.Repeat("è", MaxFind)}), true},
		{"find too long in characters", ok(Rule{Find: strings.Repeat("è", MaxFind+1)}), false},
		{"replace at its limit", ok(Rule{Find: "a", Replace: strings.Repeat("🎬", MaxReplace)}), true},
		{"replace too long", ok(Rule{Find: "a", Replace: strings.Repeat("b", MaxReplace+1)}), false},
		{"a tab in replace", ok(Rule{Find: "a", Replace: "\t"}), false},
		{"a carriage return", ok(Rule{Find: "a\r"}), false},
		{"not UTF-8", ok(Rule{Find: "\xff"}), false},
		{"not UTF-8 in replace", ok(Rule{Find: "a", Replace: "\xc3"}), false},
		{"a bad regex, even off", ok(Rule{Find: "(", Regex: true, On: false}), false},
		{"the same text as plain", ok(Rule{Find: "("}), true},
		{"Perl's lookahead", ok(Rule{Find: "a(?=b)", Regex: true}), false},
		{"back references", ok(Rule{Find: `(a)\1`, Regex: true}), false},
		{"as many rules as allowed", Settings{Rules: repeatRule(MaxRules)}, true},
		{"no rules", Settings{}, true},
	} {
		got, err := tt.s.Clean()
		if (err == nil) != tt.valid {
			t.Errorf("%s: error %v, want valid %v", tt.name, err, tt.valid)
		}
		if err == nil && len(got.Rules) != len(tt.s.Rules) {
			t.Errorf("%s: %d rules kept of %d", tt.name, len(got.Rules), len(tt.s.Rules))
		}
		if got.Rules == nil && err == nil {
			t.Errorf("%s: nil rules are saved as null", tt.name)
		}
	}
}

func repeatRule(n int) []Rule {
	out := make([]Rule, n)
	for i := range out {
		out[i] = Rule{Find: fmt.Sprint(i), Replace: "", On: true}
	}
	return out
}

// TestARegexSavedBrokenIsAnError: rules saved by hand in the database that do
// not compile are an error for the scan, never a panic or rules half applied.
func TestARegexSavedBrokenIsAnError(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	for _, raw := range []string{
		`{"rules":[{"find":"_","replace":" ","on":true},{"find":"(","regex":true,"on":true}]}`,
		`not json`,
	} {
		if _, err := db.Exec(`INSERT INTO settings (key, value) VALUES ('titles.rules', ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`, raw); err != nil {
			t.Fatal(err)
		}
		c, _, err := LoadCleaner(ctx, db)
		if err == nil || c != nil {
			t.Errorf("%s: cleaner %v, error %v", raw, c, err)
		}
	}

	// A broken rule that is off is never compiled.
	if _, err := db.Exec(`UPDATE settings SET value = '{"rules":[{"find":"(","regex":true,"on":false}]}' WHERE key = 'titles.rules'`); err != nil {
		t.Fatal(err)
	}
	c, _, err := LoadCleaner(ctx, db)
	if err != nil || c.Title("a(b") != "a(b" {
		t.Errorf("an off rule: %v", err)
	}
	var re *RuleError
	if _, err := (Settings{Rules: []Rule{{Find: "(", Regex: true, On: true}}}).Compile(); !errors.As(err, &re) || re.Rule != 1 {
		t.Errorf("Compile of a bad regex = %v", err)
	}
}

// TestACleanerIsSharedSafely: the scan and a preview may use the same rules
// at once.
func TestACleanerIsSharedSafely(t *testing.T) {
	c := compile(t, presets())
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Go(func() {
			for j := range 200 {
				name := fmt.Sprintf("Video_%d.%d_[1080p]", i, j)
				if got, want := c.Title(name), fmt.Sprintf("Video %d %d", i, j); got != want {
					t.Errorf("Title(%q) = %q, want %q", name, got, want)
					return
				}
			}
		})
	}
	wg.Wait()
}

func BenchmarkTitle(b *testing.B) {
	s, err := presets().Clean()
	if err != nil {
		b.Fatal(err)
	}
	c, err := s.Compile()
	if err != nil {
		b.Fatal(err)
	}
	names := make([]string, 1000)
	for i := range names {
		names[i] = FileTitle(fmt.Sprintf("Serie_%d/Puntata.%03d_-_titolo_lungo_[1080p][x265].mkv", i%20, i))
	}
	b.ReportAllocs()
	for i := 0; b.Loop(); i++ {
		_ = c.Title(names[i%len(names)])
	}
}

func BenchmarkTitleSlowLookingRegex(b *testing.B) {
	s, err := (Settings{Rules: []Rule{{Find: `(a+)+$`, Replace: "x", Regex: true, On: true}}}).Clean()
	if err != nil {
		b.Fatal(err)
	}
	c, err := s.Compile()
	if err != nil {
		b.Fatal(err)
	}
	name := strings.Repeat("a", 1000) + "!"
	b.ReportAllocs()
	for b.Loop() {
		_ = c.Title(name)
	}
}
