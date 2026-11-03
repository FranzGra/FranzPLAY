// Package titles keeps the administrator's rules that turn the name of a
// video file into the title people see: "Il_mio_video_[1080p]" becomes
// "Il mio video". The files are never renamed (rule 1): only the title
// shown changes. A title the administrator wrote by hand, or one read from
// a file next to the video, always wins over the one made from the name.
//
// The rules can also clean the names of the category folders.
package titles

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"regexp/syntax"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Rule is one change made to the name of a file: every Find becomes
// Replace. With Regex, Find is a regular expression (Go's syntax, which
// never takes long: its time grows with the name, never explodes) and
// Replace may use $1, $2… Rules that are not On are kept but skipped.
type Rule struct {
	Find    string `json:"find"`
	Replace string `json:"replace"`
	Regex   bool   `json:"regex"`
	On      bool   `json:"on"`
}

// Settings are the rules, applied one after the other in this order, and
// whether they clean the names of the categories too.
type Settings struct {
	Rules      []Rule `json:"rules"`
	Categories bool   `json:"categories"`
}

// The limits: a few short rules are all a title needs, and they keep the
// work of a rescan small.
const (
	MaxRules   = 30
	MaxFind    = 200
	MaxReplace = 200
	// maxStep is the longest a name may grow while the rules run: a rule
	// that matches everywhere cannot make it huge.
	maxStep = 1000
	// maxTitle is the longest title kept, as the administrator's own.
	maxTitle = 200
)

// RuleError says which rule is wrong and why, in words for the
// administrator. Rule counts from 1.
type RuleError struct {
	Rule   int
	Reason string
}

func (e *RuleError) Error() string { return fmt.Sprintf("Regola %d: %s", e.Rule, e.Reason) }

// ErrTooManyRules is returned for more than MaxRules rules.
var ErrTooManyRules = fmt.Errorf("Al massimo %d regole.", MaxRules)

// Clean checks settings sent from outside: every rule must have something
// to look for, be one line, not too long, and a regular expression must
// be valid. It returns them as they will be saved.
func (s Settings) Clean() (Settings, error) {
	if len(s.Rules) > MaxRules {
		return Settings{}, ErrTooManyRules
	}
	out := Settings{Rules: make([]Rule, 0, len(s.Rules)), Categories: s.Categories}
	for i, r := range s.Rules {
		bad := func(reason string) (Settings, error) { return Settings{}, &RuleError{Rule: i + 1, Reason: reason} }
		switch {
		case r.Find == "":
			return bad("scrivi il testo da cercare.")
		case !utf8.ValidString(r.Find) || !utf8.ValidString(r.Replace):
			return bad("il testo non è valido.")
		case utf8.RuneCountInString(r.Find) > MaxFind:
			return bad(fmt.Sprintf("il testo da cercare può avere al massimo %d caratteri.", MaxFind))
		case utf8.RuneCountInString(r.Replace) > MaxReplace:
			return bad(fmt.Sprintf("il testo che lo sostituisce può avere al massimo %d caratteri.", MaxReplace))
		case hasControl(r.Find) || hasControl(r.Replace):
			return bad("il testo deve stare su una riga.")
		}
		if r.Regex {
			if _, err := regexp.Compile(r.Find); err != nil {
				return bad("l'espressione regolare non è valida (" + regexProblem(err) + ").")
			}
		}
		out.Rules = append(out.Rules, r)
	}
	return out, nil
}

func hasControl(s string) bool {
	return strings.IndexFunc(s, unicode.IsControl) >= 0
}

// regexProblem is the reason Go gives, without the expression repeated.
func regexProblem(err error) string {
	var bad *syntax.Error
	if errors.As(err, &bad) {
		return string(bad.Code)
	}
	return err.Error()
}

// step is a compiled rule.
type step struct {
	re      *regexp.Regexp // nil: plain text
	find    string
	replace string
}

// Cleaner applies the rules that are on. A nil Cleaner changes nothing.
type Cleaner struct {
	steps      []step
	categories bool
}

// Compile prepares the rules that are on. The settings must be clean.
func (s Settings) Compile() (*Cleaner, error) {
	c := &Cleaner{categories: s.Categories}
	for i, r := range s.Rules {
		if !r.On {
			continue
		}
		st := step{find: r.Find, replace: r.Replace}
		if r.Regex {
			re, err := regexp.Compile(r.Find)
			if err != nil {
				return nil, &RuleError{Rule: i + 1, Reason: "l'espressione regolare non è valida (" + regexProblem(err) + ")."}
			}
			st.re = re
		}
		c.steps = append(c.steps, st)
	}
	return c, nil
}

// Title turns a name, already without its extension, into a title. When
// the rules leave nothing, the name stays as it is: a video always has a
// title.
func (c *Cleaner) Title(name string) string {
	if c == nil || len(c.steps) == 0 {
		return name
	}
	s := name
	for _, st := range c.steps {
		if st.re != nil {
			s = st.re.ReplaceAllString(s, st.replace)
		} else {
			s = strings.ReplaceAll(s, st.find, st.replace)
		}
		if len(s) > maxStep {
			s = cut(s, maxStep)
		}
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return name
	}
	if utf8.RuneCountInString(s) > maxTitle {
		s = strings.TrimSpace(string([]rune(s)[:maxTitle]))
	}
	return s
}

// Category turns the name of a category folder into the name people see,
// when the administrator asked the rules to clean the categories too.
func (c *Cleaner) Category(name string) string {
	if c == nil || !c.categories {
		return name
	}
	return c.Title(name)
}

// cut shortens s to at most n bytes without breaking a character.
func cut(s string, n int) string {
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// FileTitle is the title of a video file before any rule: its name
// without the extension. "Viaggi/Il_mare.mp4" gives "Il_mare". relPath
// uses "/" as separator.
func FileTitle(relPath string) string {
	name := relPath
	if i := strings.LastIndexByte(name, '/'); i >= 0 {
		name = name[i+1:]
	}
	if i := strings.LastIndexByte(name, '.'); i > 0 {
		name = name[:i]
	}
	return name
}

// Preset is a ready rule the administrator can add with one click.
type Preset struct {
	Name string `json:"name"`
	Rule Rule   `json:"rule"`
}

// Presets are the ready rules. They are only offered: nothing changes
// until the administrator adds one and saves.
var Presets = []Preset{
	{Name: "Trattini bassi in spazi", Rule: Rule{Find: "_", Replace: " ", On: true}},
	{Name: "Punti in spazi", Rule: Rule{Find: ".", Replace: " ", On: true}},
	{Name: "Trattini in spazi", Rule: Rule{Find: "-", Replace: " ", On: true}},
	{Name: "Togli i tag tra quadre, come [1080p]", Rule: Rule{Find: `\[[^\]]*\]`, Replace: "", Regex: true, On: true}},
	{Name: "Spazi doppi in uno solo", Rule: Rule{Find: `\s{2,}`, Replace: " ", Regex: true, On: true}},
}

// key is where the settings are kept, in the settings table, as JSON.
const key = "titles.rules"

// Load reads the settings; never saved means no rules.
func Load(ctx context.Context, db *sql.DB) (Settings, error) {
	var raw string
	err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{Rules: []Rule{}}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("read title rules: %w", err)
	}
	var s Settings
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return Settings{}, fmt.Errorf("read title rules: %w", err)
	}
	if s.Rules == nil {
		s.Rules = []Rule{}
	}
	return s, nil
}

// LoadCleaner reads the settings and prepares them. Rules saved that do
// not work any more (they cannot: they were checked) change nothing.
func LoadCleaner(ctx context.Context, db *sql.DB) (*Cleaner, string, error) {
	s, err := Load(ctx, db)
	if err != nil {
		return nil, "", err
	}
	c, err := s.Compile()
	if err != nil {
		return nil, "", fmt.Errorf("title rules: %w", err)
	}
	version, err := json.Marshal(s)
	if err != nil {
		return nil, "", fmt.Errorf("title rules: %w", err)
	}
	return c, string(version), nil
}

// Save writes clean settings.
func Save(ctx context.Context, db *sql.DB, s Settings) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return fmt.Errorf("save title rules: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, string(raw)); err != nil {
		return fmt.Errorf("save title rules: %w", err)
	}
	return nil
}
