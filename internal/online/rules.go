package online

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Rules are the administrator's limits on the questions to the internet:
// when they may be asked, how many a day, which source first, and if
// what is found waits for their yes.
type Rules struct {
	// From and To are the hours questions may be asked in, from From up to
	// To, on the clock of the machine FranzPLAY runs on. From 22 to 6 is
	// the night; the same hour twice means at any time.
	From int `json:"from"`
	To   int `json:"to"`
	// Daily is the most videos asked about in a day; 0 means no limit.
	Daily int `json:"daily"`
	// Order are the sources, the one asked first first. When a source
	// finds nothing, the next one that can know the video is asked.
	Order []string `json:"order"`
	// Confirm keeps what is found as a proposal the administrator accepts
	// or discards ("chiedi conferma"); otherwise it is used at once.
	Confirm bool `json:"confirm"`
}

// maxDaily is the highest daily limit accepted.
const maxDaily = 100_000

// sourceNames are the sources, in the order they are asked unless the
// administrator chooses another one.
var sourceNames = []string{"youtube", "tmdb", "tpdb"}

// defaultRules ask at any time, with no limit.
func defaultRules() Rules {
	return Rules{Order: slices.Clone(sourceNames)}
}

// valid says if the rules make sense: real hours, a limit that is not
// negative, and every source once in the order.
func (r Rules) valid() bool {
	if r.From < 0 || r.From > 23 || r.To < 0 || r.To > 23 || r.Daily < 0 || r.Daily > maxDaily {
		return false
	}
	order := slices.Clone(r.Order)
	slices.Sort(order)
	return slices.Equal(order, []string{"tmdb", "tpdb", "youtube"})
}

// open says if questions may be asked at this time of day.
func (r Rules) open(t time.Time) bool {
	h := t.Hour()
	switch {
	case r.From == r.To:
		return true
	case r.From < r.To:
		return h >= r.From && h < r.To
	default: // across midnight
		return h >= r.From || h < r.To
	}
}

// nextOpening is the first moment from t on when questions may be asked.
func (r Rules) nextOpening(t time.Time) time.Time {
	if r.open(t) {
		return t
	}
	start := time.Date(t.Year(), t.Month(), t.Day(), r.From, 0, 0, 0, t.Location())
	if !start.After(t) {
		start = start.AddDate(0, 0, 1)
	}
	return start
}

// wait says until when a question must wait, now that askedToday videos
// were already asked about today. ok is false when it may be asked now.
func (r Rules) wait(now time.Time, askedToday int) (until time.Time, ok bool) {
	if r.Daily > 0 && askedToday >= r.Daily {
		tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location())
		return r.nextOpening(tomorrow), true
	}
	if !r.open(now) {
		return r.nextOpening(now), true
	}
	return time.Time{}, false
}

// The keys of the rules and of the count of today's questions.
const (
	keyRules = "online.rules"
	keyAsked = "online.asked" // "2006-01-02 17": the day, and how many videos were asked about
)

// parseRules reads the rules as saved. Rules that are not valid, or
// none, are the default ones: they only ever limit, so the default is
// what FranzPLAY did before there were rules.
func parseRules(value string) Rules {
	var r Rules
	if value == "" || json.Unmarshal([]byte(value), &r) != nil || !r.valid() {
		return defaultRules()
	}
	return r
}

// saveRules writes the rules.
func saveRules(ctx context.Context, db querier, r Rules) error {
	data, err := json.Marshal(r)
	if err != nil {
		return fmt.Errorf("save online rules: %w", err)
	}
	if err := saveSetting(ctx, db, keyRules, string(data)); err != nil {
		return fmt.Errorf("save online rules: %w", err)
	}
	return nil
}

// askedOn reads how many videos were asked about on the day of now, from
// the saved count.
func askedOn(saved string, now time.Time) int {
	day, count, ok := strings.Cut(saved, " ")
	if !ok || day != now.Format(time.DateOnly) {
		return 0
	}
	n, err := strconv.Atoi(count)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// askedText is the count to save after asking about n videos today.
func askedText(now time.Time, n int) string {
	return now.Format(time.DateOnly) + " " + strconv.Itoa(n)
}
