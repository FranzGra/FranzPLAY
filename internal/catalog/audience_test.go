package catalog

import (
	"database/sql"
	"net/http"
	"strconv"
	"testing"
)

// A private video whose owner did not come back with it (a database lost, an
// account gone) is closed to everybody: the administrator gives it an owner, or
// opens it to everybody.
func TestAnAdministratorDecidesWhoSeesAVideoWithNoOwner(t *testing.T) {
	s := newAdminSite(t)
	if _, err := s.db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at) VALUES
		(1, 'Admin', 'x', 'admin', 1), (2, 'Marco', 'x', 'user', 1)`); err != nil {
		t.Fatal(err)
	}
	given := s.addVideo(t, "a.mp4", "a", "", 1, true)
	opened := s.addVideo(t, "b.mp4", "b", "", 2, true)
	owned := s.addVideo(t, "c.mp4", "c", "", 3, true)
	open := s.addVideo(t, "d.mp4", "d", "", 4, true)
	if _, err := s.db.Exec(`UPDATE videos SET private = 1, link_key = 'k' WHERE id IN (?, ?)`, given, opened); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE videos SET private = 1, uploaded_by = 2 WHERE id = ?`, owned); err != nil {
		t.Fatal(err)
	}
	path := func(id int64) string { return "/api/admin/videos/" + strconv.FormatInt(id, 10) + "/audience" }

	s.do(t, "PUT", path(given), `{"owner":2}`, http.StatusNoContent)
	s.do(t, "PUT", path(opened), `{"everyone":true}`, http.StatusNoContent)
	if s.changed != 2 {
		t.Errorf("pages told %d times, want 2", s.changed)
	}
	var owner sql.NullInt64
	var private bool
	if err := s.db.QueryRow(`SELECT uploaded_by, private FROM videos WHERE id = ?`, given).Scan(&owner, &private); err != nil {
		t.Fatal(err)
	}
	if owner.Int64 != 2 || !private {
		t.Errorf("given: owner %+v, private %v", owner, private)
	}
	var link sql.NullString
	if err := s.db.QueryRow(`SELECT private, link_key FROM videos WHERE id = ?`, opened).Scan(&private, &link); err != nil {
		t.Fatal(err)
	}
	if private || link.Valid {
		t.Errorf("opened: private %v, link %+v", private, link)
	}

	// Only for a private video with no owner: the rest is the uploader's choice.
	s.do(t, "PUT", path(owned), `{"everyone":true}`, http.StatusConflict)
	s.do(t, "PUT", path(open), `{"owner":2}`, http.StatusConflict)
	s.do(t, "PUT", path(999), `{"owner":2}`, http.StatusNotFound)
	if _, err := s.db.Exec(`UPDATE videos SET private = 1, uploaded_by = NULL WHERE id = ?`, open); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{``, `{}`, `{"owner":2,"everyone":true}`, `{"everyone":false}`, `{"owner":0}`, `{"owner":2,"x":1}`} {
		s.do(t, "PUT", path(open), body, http.StatusBadRequest)
	}
	s.do(t, "PUT", path(open), `{"owner":77}`, http.StatusBadRequest) // nobody
}
