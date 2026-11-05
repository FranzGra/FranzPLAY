package home

import (
	"net/http"
	"slices"
	"strconv"
	"sync"
	"testing"
)

// Two devices of the same person change the Home at once, and another
// person changes theirs: every answer is a whole layout, the rows stay
// in a fixed order, and nothing passes from one person to the other.
func TestTwoDevicesChangeTheHomeAtOnce(t *testing.T) {
	s := newSite(t)
	var wg sync.WaitGroup
	errs := make(chan string, 400)
	for device := range 2 {
		wg.Go(func() {
			for i := range 40 {
				row := rows[(i+device)%len(rows)]
				open := strconv.FormatBool(i%2 == device)
				if rec := s.do(giulia, http.MethodPut, "/api/home/rows/"+string(row), `{"open":`+open+`}`); rec.Code != http.StatusOK {
					errs <- "row: " + rec.Body.String()
				}
				size := strconv.Itoa(1 + (i+device)%5)
				if rec := s.do(giulia, http.MethodPut, "/api/home/look", `{"columns":0,"size":`+size+`,"sections":"one"}`); rec.Code != http.StatusOK {
					errs <- "look: " + rec.Body.String()
				}
			}
		})
	}
	wg.Go(func() {
		for range 40 {
			if rec := s.do(marco, http.MethodPut, "/api/home/rows/latest", `{"open":false}`); rec.Code != http.StatusOK {
				errs <- "Marco: " + rec.Body.String()
			}
		}
	})
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Error(e)
	}

	closed := s.layout(t, s.do(giulia, http.MethodGet, "/api/home", ""))
	if !slices.IsSorted(closed) || len(slices.Compact(slices.Clone(closed))) != len(closed) {
		t.Errorf("Giulia's closed rows = %v, want each once, in order", closed)
	}
	if l := s.look(t, s.do(giulia, http.MethodGet, "/api/home", "")); l.check() != nil {
		t.Errorf("Giulia's look = %+v, not a valid look", l)
	}
	if got := s.layout(t, s.do(marco, http.MethodGet, "/api/home", "")); !slices.Equal(got, []Row{Latest}) {
		t.Errorf("Marco's closed rows = %v, want only latest", got)
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM home_look WHERE user_id = ?`, giulia).Scan(&n); err != nil || n != 1 {
		t.Errorf("Giulia's looks = %d (%v), want 1", n, err)
	}
}
