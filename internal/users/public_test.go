package users

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSharingInPublicIsOffUntilTheAdministratorAllowsIt(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	if me := whoAmI(t, admin); me.CanSharePublic || !me.MaySharePublic() {
		t.Errorf("administrator: canSharePublic %v, may %v; want off but allowed", me.CanSharePublic, me.MaySharePublic())
	}
	rec := admin.do("POST", "/api/users", map[string]any{"name": "Giulia", "password": "giulia-password", "role": "user"})
	expect(t, rec, http.StatusCreated)
	var giulia Account
	if err := json.Unmarshal(rec.Body.Bytes(), &giulia); err != nil {
		t.Fatal(err)
	}
	user := s.browser()
	expect(t, user.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusOK)
	if got := whoAmI(t, user); got.CanSharePublic || got.MaySharePublic() {
		t.Fatalf("a new person may share in public: %+v", got)
	}

	// Only the administrator turns it on.
	expect(t, user.do("PUT", "/api/users/"+itoa(giulia.ID), map[string]any{"role": "user", "canSharePublic": true}),
		http.StatusForbidden)
	expect(t, admin.do("PUT", "/api/users/"+itoa(giulia.ID), map[string]any{"role": "user", "canSharePublic": true}),
		http.StatusOK)
	if got := whoAmI(t, user); !got.CanSharePublic {
		t.Fatalf("after the change Giulia is %+v", got)
	}
	// Leaving it out keeps it.
	expect(t, admin.do("PUT", "/api/users/"+itoa(giulia.ID), map[string]any{"role": "user", "canUpload": true}),
		http.StatusOK)
	if got := whoAmI(t, user); !got.CanSharePublic || !got.CanUpload {
		t.Fatalf("a change without canSharePublic took it away: %+v", got)
	}

	// Giulia made a link; the administrator takes the permission away: her
	// links are revoked, an administrator's are not.
	if _, err := s.db.Exec(`INSERT INTO libraries (id, path) VALUES (1, '/v')`); err != nil {
		t.Fatal(err)
	}
	for i, by := range []int64{giulia.ID, whoAmI(t, admin).ID} {
		if _, err := s.db.Exec(`INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, added_at)
			VALUES (?, ?, 1, ?, 1, 1, 't', 1)`, i+1, "fp"+itoa(int64(i)), "v"+itoa(int64(i))); err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.Exec(`INSERT INTO public_links (video_id, token, created_by, created_at) VALUES (?, ?, ?, 1)`,
			i+1, "key"+itoa(int64(i)), by); err != nil {
			t.Fatal(err)
		}
	}
	expect(t, admin.do("PUT", "/api/users/"+itoa(giulia.ID), map[string]any{"role": "user", "canSharePublic": false}),
		http.StatusOK)
	var left []int64
	rows, err := s.db.Query(`SELECT created_by FROM public_links`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var by int64
		if err := rows.Scan(&by); err != nil {
			t.Fatal(err)
		}
		left = append(left, by)
	}
	if len(left) != 1 || left[0] == giulia.ID {
		t.Errorf("links left = %v, want only the administrator's", left)
	}
	if got := whoAmI(t, user); got.CanSharePublic {
		t.Errorf("Giulia still may share in public")
	}
}

func TestPublicLinkAddressesNeedNoLogin(t *testing.T) {
	s := newSite(t)
	b := s.browser()
	// Not a feature here: 404 from the site, not 401 from the guard.
	expect(t, b.do("GET", "/api/public/abcdefghijklmnopqrstuv", nil), http.StatusNotFound)
	expect(t, b.do("GET", "/api/public/abcdefghijklmnopqrstuv/stream", nil), http.StatusNotFound)
	// Only reading: anything else still needs the login.
	expect(t, b.do("POST", "/api/public/abcdefghijklmnopqrstuv", nil), http.StatusUnauthorized)
	expect(t, b.do("GET", "/api/publicx", nil), http.StatusUnauthorized)
}
