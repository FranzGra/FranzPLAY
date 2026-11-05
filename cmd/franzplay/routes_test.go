package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"net/http"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// access is who may use an API address.
type access int

const (
	// public addresses work without logging in.
	public access = iota
	// user addresses work for every logged-in person. Some still refuse a
	// person for their own reason (the permission to share in public, to
	// upload), never with "administrators only".
	user
	// admin addresses refuse everybody but the administrators.
	admin
)

func (a access) String() string {
	return [...]string{"public", "user", "admin"}[a]
}

// routeAccess is who may use each API address FranzPLAY registers. A new
// address makes TestEveryRouteIsClassified fail until it is written here:
// whoever adds it must decide who may use it, and the matrix then checks
// that the server does what this table says.
var routeAccess = map[string]access{
	// Before logging in: the login page, the first setup, the invites.
	"GET /api/health":        public,
	"GET /api/setup":         public,
	"POST /api/setup":        public,
	"POST /api/login":        public,
	"POST /api/login/method": public,
	"POST /api/join":         public,
	"POST /api/join/check":   public,
	"POST /api/register":     public,
	"GET /api/site":          public,
	// Logging out always works: it clears the cookie of a session over too.
	"POST /api/logout": public,
	// A public link: one video, by its key.
	"GET /api/public/{key}":                 public,
	"GET /api/public/{key}/stream":          public,
	"GET /api/public/{key}/subtitles":       public,
	"GET /api/public/{key}/subtitles/{sub}": public,
	"GET /api/public/{key}/cover":           public,
	"GET /api/public/{key}/preview":         public,

	// Me.
	"GET /api/me":                user,
	"DELETE /api/me":             user,
	"POST /api/me/password":      user,
	"PUT /api/me/credential":     user,
	"POST /api/me/check":         user,
	"PUT /api/me/name":           user,
	"PUT /api/me/color":          user,
	"PUT /api/me/skip":           user,
	"PUT /api/me/avatar":         user,
	"DELETE /api/me/avatar":      user,
	"GET /api/users/{id}/avatar": user,
	"GET /api/people":            user,
	"GET /api/events":            user,
	// Watching.
	"GET /api/videos":                            user,
	"GET /api/videos/{id}":                       user,
	"GET /api/videos/{id}/stream":                user,
	"GET /api/videos/{id}/subtitles":             user,
	"GET /api/videos/{id}/subtitles/{key}":       user,
	"GET /api/videos/{id}/audio":                 user,
	"GET /api/videos/{id}/audio/{stream}":        user,
	"GET /api/videos/{id}/audio/{stream}/stream": user,
	"POST /api/videos/{id}/prepare":              user,
	"GET /api/videos/{id}/similar":               user,
	"GET /api/videos/{id}/progress":              user,
	"POST /api/videos/{id}/progress":             user,
	"GET /api/videos/{id}/like":                  user,
	"PUT /api/videos/{id}/like":                  user,
	"DELETE /api/videos/{id}/like":               user,
	"GET /api/videos/{id}/comments":              user,
	"POST /api/videos/{id}/comments":             user,
	"DELETE /api/comments/{id}":                  user, // only one's own: checked inside
	"POST /api/videos/{id}/link":                 user,
	"GET /api/videos/{id}/public-link":           user, // with the permission to share in public
	"POST /api/videos/{id}/public-link":          user,
	"DELETE /api/videos/{id}/public-link":        user,
	"GET /api/categories":                        user,
	"GET /api/category-images/{name}":            user,
	"GET /api/category-pictures/{name}":          user,
	"GET /api/covers/{name}":                     user,
	"GET /api/previews/{name}":                   user,
	"GET /api/clips/{name}":                      user,
	"GET /api/clips-hd/{name}":                   user,
	"GET /api/channels":                          user,
	"GET /api/channels/{id}":                     user,
	"GET /api/continue":                          user,
	"DELETE /api/continue/{id}":                  user,
	"GET /api/history":                           user,
	"DELETE /api/history":                        user,
	"DELETE /api/history/{id}":                   user,
	"GET /api/recommended":                       user,
	"GET /api/likes":                             user,
	"GET /api/home":                              user,
	"PUT /api/home/rows/{row}":                   user,
	"PUT /api/home/look":                         user,
	"GET /api/playlists":                         user,
	"POST /api/playlists":                        user,
	"GET /api/playlists/shared":                  user,
	"GET /api/playlists/{id}":                    user,
	"PUT /api/playlists/{id}":                    user,
	"DELETE /api/playlists/{id}":                 user,
	"PUT /api/playlists/{id}/videos/{video}":     user,
	"DELETE /api/playlists/{id}/videos/{video}":  user,
	// Uploads: with the permission to upload.
	"GET /api/uploads":                user,
	"POST /api/uploads":               user,
	"PUT /api/uploads/{id}":           user,
	"DELETE /api/uploads/{id}":        user,
	"GET /api/uploads/videos":         user,
	"PUT /api/uploads/videos/{id}":    user,
	"DELETE /api/uploads/videos/{id}": user,

	// The administration.
	"PUT /api/site":                                        admin,
	"GET /api/overview":                                    admin,
	"GET /api/comments":                                    admin,
	"GET /api/updates":                                     admin,
	"PUT /api/updates":                                     admin,
	"GET /api/users":                                       admin,
	"POST /api/users":                                      admin,
	"PUT /api/users/{id}":                                  admin,
	"DELETE /api/users/{id}":                               admin,
	"PUT /api/users/{id}/password":                         admin,
	"GET /api/invites":                                     admin,
	"POST /api/invites":                                    admin,
	"DELETE /api/invites/{id}":                             admin,
	"GET /api/logins":                                      admin,
	"GET /api/logins/blocks":                               admin,
	"POST /api/logins/unblock":                             admin,
	"GET /api/registration":                                admin,
	"PUT /api/registration":                                admin,
	"GET /api/login-methods":                               admin,
	"PUT /api/login-methods":                               admin,
	"GET /api/jobs":                                        admin,
	"POST /api/jobs/retry":                                 admin,
	"POST /api/jobs/{id}/retry":                            admin,
	"PUT /api/jobs/{id}/priority":                          admin,
	"GET /api/jobs/video/{id}":                             admin,
	"PUT /api/jobs/video/{id}/priority":                    admin,
	"GET /api/library":                                     admin,
	"POST /api/library/scan":                               admin,
	"PUT /api/library/min-duration":                        admin,
	"GET /api/online":                                      admin,
	"PUT /api/online":                                      admin,
	"PUT /api/online/tmdb-key":                             admin,
	"PUT /api/online/tpdb-key":                             admin,
	"PUT /api/online/rules":                                admin,
	"GET /api/online/search":                               admin,
	"GET /api/online/picture":                              admin,
	"GET /api/online/proposals":                            admin,
	"GET /api/online/proposals/{id}/picture":               admin,
	"POST /api/online/proposals/{id}":                      admin,
	"DELETE /api/online/proposals/{id}":                    admin,
	"GET /api/admin/videos":                                admin,
	"GET /api/admin/videos/{id}":                           admin,
	"PUT /api/admin/videos/{id}/hidden":                    admin,
	"PUT /api/admin/videos/{id}/audience":                  admin,
	"POST /api/admin/videos/{id}/refresh":                  admin,
	"PUT /api/admin/videos/{id}/details":                   admin,
	"PUT /api/admin/videos/{id}/cover":                     admin,
	"PUT /api/admin/videos/{id}/cover-second":              admin,
	"DELETE /api/admin/videos/{id}/cover":                  admin,
	"PUT /api/admin/videos/{id}/clip":                      admin,
	"POST /api/admin/videos/{id}/clip/remake":              admin,
	"DELETE /api/admin/videos/{id}/clip":                   admin,
	"PUT /api/admin/videos/{id}/clip/moment":               admin,
	"GET /api/admin/clip-settings":                         admin,
	"PUT /api/admin/clip-settings":                         admin,
	"GET /api/admin/categories":                            admin,
	"PUT /api/admin/categories/{name}":                     admin,
	"PUT /api/admin/categories/{name}/image":               admin,
	"DELETE /api/admin/categories/{name}/image":            admin,
	"GET /api/admin/subtitles":                             admin,
	"GET /api/admin/subtitles/setup":                       admin,
	"POST /api/admin/subtitles/models/{name}":              admin,
	"DELETE /api/admin/subtitles/models/whisper/{name}":    admin,
	"DELETE /api/admin/subtitles/models/translator/{name}": admin,
	"DELETE /api/admin/subtitles/download":                 admin,
	"PUT /api/admin/subtitles/{id}":                        admin,
	"DELETE /api/admin/subtitles/{id}/request":             admin,
	"PUT /api/admin/subtitles/{id}/translation":            admin,
	"DELETE /api/admin/subtitles/{id}/translation":         admin,
	"DELETE /api/admin/subtitles/{id}/made/{lang}":         admin,
	"PUT /api/admin/subtitles/{id}/import/{lang}":          admin,
	"GET /api/admin/title-rules":                           admin,
	"POST /api/admin/title-rules/preview":                  admin,
	"PUT /api/admin/title-rules":                           admin,
}

// registeredRoutes reads, from the source code, every API address the
// program registers: each mux.HandleFunc or mux.Handle with a method. It
// reads the code rather than a list kept by hand, so an address added
// anywhere is seen.
func registeredRoutes(t *testing.T) []string {
	t.Helper()
	fset := token.NewFileSet()
	var out []string
	for _, dir := range []string{filepath.Join("..", "..", "internal"), "."} {
		err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			f, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
			if err != nil {
				return err
			}
			ast.Inspect(f, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok || len(call.Args) != 2 {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok || (sel.Sel.Name != "HandleFunc" && sel.Sel.Name != "Handle") {
					return true
				}
				lit, ok := call.Args[0].(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					t.Errorf("%s: a route registered without a plain string: write the pattern as a literal, so this test sees it",
						fset.Position(call.Pos()))
					return true
				}
				pattern, err := strconv.Unquote(lit.Value)
				if err != nil {
					t.Errorf("%s: %v", fset.Position(lit.Pos()), err)
					return true
				}
				method, path, ok := strings.Cut(pattern, " ")
				if ok && strings.HasPrefix(path, "/api/") && method == strings.ToUpper(method) {
					out = append(out, pattern)
				}
				return true
			})
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	slices.Sort(out)
	if len(out) < 100 {
		t.Fatalf("only %d routes found in the code: is the test reading the right folder?", len(out))
	}
	return out
}

func TestEveryRouteIsClassified(t *testing.T) {
	found := registeredRoutes(t)
	for i := 1; i < len(found); i++ {
		if found[i] == found[i-1] {
			t.Errorf("%s is registered twice", found[i])
		}
	}
	for _, r := range found {
		a, ok := routeAccess[r]
		if !ok {
			t.Errorf("%s is new: write in routeAccess who may use it (public, user or admin)", r)
			continue
		}
		// Whatever lives under /api/admin/ is for administrators.
		if _, path, _ := strings.Cut(r, " "); strings.HasPrefix(path, "/api/admin/") && a != admin {
			t.Errorf("%s is under /api/admin/ but classified %s", r, a)
		}
	}
	for r := range routeAccess {
		if !slices.Contains(found, r) {
			t.Errorf("%s is in routeAccess but no longer registered: remove it", r)
		}
	}
}

// pathValues fills the {names} of a pattern with values of things that
// do not exist: the matrix asks who may knock, not what is behind.
var pathValues = map[string]string{
	"id": "999999", "video": "999999", "stream": "1", "lang": "it", "row": "nothing",
	"name": "nothing", "sub": "nothing", "key": "AAAAAAAAAAAAAAAAAAAAAA",
}

// fill turns a pattern's path into an address.
func fill(t *testing.T, path string) string {
	t.Helper()
	var sb strings.Builder
	for {
		start := strings.IndexByte(path, '{')
		if start < 0 {
			sb.WriteString(path)
			return sb.String()
		}
		end := strings.IndexByte(path, '}')
		v, ok := pathValues[strings.TrimSuffix(path[start+1:end], "...")]
		if !ok {
			t.Fatalf("no value for %s in pathValues", path[start:end+1])
		}
		sb.WriteString(path[:start] + v)
		path = path[end+1:]
	}
}

// badJSON is the body sent to every address that changes something: a
// request cut halfway, so that no handler gets as far as changing anything.
const badJSON = `{"name": "x`

// TestPermissionMatrix asks every registered address as nobody, as a
// person and as an administrator, and checks the answer against
// routeAccess: nobody gets 401 except on the public ones, a person gets
// "administrators only" exactly on the admin ones, an administrator is
// never refused. Nobody ever gets a 500.
func TestPermissionMatrix(t *testing.T) {
	if testing.Short() {
		t.Skip("starts the whole program")
	}
	s := startLiveSite(t)
	for _, route := range registeredRoutes(t) {
		want, ok := routeAccess[route]
		if !ok {
			continue // TestEveryRouteIsClassified says so
		}
		method, pattern, _ := strings.Cut(route, " ")
		path := fill(t, pattern)
		var body any
		if method != http.MethodGet {
			body = badJSON
		}
		t.Run(route, func(t *testing.T) {
			s := *s
			s.t = t
			asAdminCookie, personCookie := s.admin, s.user
			if route == "POST /api/logout" {
				// Each logs out of a session of its own.
				asAdminCookie, personCookie = s.login("Admin", livePasswordAdmin), s.login("Bruno", livePasswordUser)
			}

			nobody := s.do("", method, path, body)
			switch {
			case want == public && nobody.status == http.StatusUnauthorized:
				t.Errorf("nobody: 401, but the address is public")
			case want != public && nobody.status != http.StatusUnauthorized:
				t.Errorf("nobody: %d %s, want 401", nobody.status, nobody.body)
			}

			asUser := s.do(personCookie, method, path, body)
			switch {
			case asUser.status == http.StatusUnauthorized:
				t.Errorf("a person: 401 %s", asUser.body)
			case want == admin && (asUser.status != http.StatusForbidden || asUser.errorText() != "administrators only"):
				t.Errorf("a person: %d %s, want 403 administrators only", asUser.status, asUser.body)
			case want != admin && asUser.errorText() == "administrators only":
				t.Errorf("a person: refused as a non-administrator, but the address is %s", want)
			case want != admin && asUser.status == http.StatusNotFound && asUser.errorText() == "not found":
				// The answer of addresses nobody registered (server.New).
				t.Errorf("a person: the server does not know the address: is it added in run()?")
			}

			asAdmin := s.do(asAdminCookie, method, path, body)
			if asAdmin.status == http.StatusUnauthorized || asAdmin.status == http.StatusForbidden {
				t.Errorf("an administrator: %d %s", asAdmin.status, asAdmin.body)
			}

			for who, a := range map[string]answer{"nobody": nobody, "a person": asUser, "an administrator": asAdmin} {
				if a.status >= 500 {
					t.Errorf("%s: %d %s", who, a.status, a.body)
				}
			}
		})
	}
	s.alive()
}

// TestUnexpectedMethodsAreRefused calls every address with the methods it
// does not have: none may do anything (2xx) or fail (5xx).
func TestUnexpectedMethodsAreRefused(t *testing.T) {
	if testing.Short() {
		t.Skip("starts the whole program")
	}
	s := startLiveSite(t)
	methods := map[string][]string{}
	for _, route := range registeredRoutes(t) {
		method, pattern, _ := strings.Cut(route, " ")
		methods[pattern] = append(methods[pattern], method)
	}
	for pattern, have := range methods {
		path := fill(t, pattern)
		for _, m := range []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "PROPFIND"} {
			if slices.Contains(have, m) {
				continue
			}
			// A path of one pattern can be another's {id}: PUT
			// /api/uploads/videos is PUT /api/uploads/{id}. Then the
			// method is expected after all.
			a := s.do(s.admin, m, path, badJSON)
			if a.status < 400 || a.status >= 500 {
				t.Errorf("%s %s = %d %s, want a refusal", m, path, a.status, a.body)
			}
		}
	}
	// TRACE echoes the request, cookies too: never.
	if a := s.do(s.admin, "TRACE", "/api/me", nil); a.status < 400 || strings.Contains(string(a.body), s.admin) {
		t.Errorf("TRACE /api/me = %d %s", a.status, a.body)
	}
	s.alive()
}
