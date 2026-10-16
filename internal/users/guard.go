package users

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// cookieName is the name of the session cookie.
const cookieName = "franzplay_session"

// publicAPI are the API addresses that work without logging in.
var publicAPI = map[string]bool{
	"/api/health":     true,
	"/api/setup":      true,
	"/api/login":      true,
	"/api/join":       true, // with an invite code, instead of a login
	"/api/join/check": true,
	"/api/register":   true, // refused by itself unless the administrator allows it
	"/api/site":       true, // name and color, for the login page; changing them checks the role itself
	"/api/me":         true, // answers 401 itself, so the interface knows to show the login
}

// isPublicLink reports whether a request reads the video of a public
// link, under /api/public/: anybody may, and those addresses only ever
// open the one video of the key in them (see catalog.PublicRoutes).
func isPublicLink(r *http.Request) bool {
	return (r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.HasPrefix(r.URL.Path, "/api/public/")
}

type accountKey struct{}

// FromContext returns the logged-in user of a request, set by Protect.
func FromContext(ctx context.Context) (Account, bool) {
	a, ok := ctx.Value(accountKey{}).(Account)
	return a, ok
}

// NewContext returns ctx with a as its logged-in user, as Protect does.
// Tests use it to ask as someone.
func NewContext(ctx context.Context, a Account) context.Context {
	return context.WithValue(ctx, accountKey{}, a)
}

// Protect lets requests to the API through only for logged-in users. The
// web interface's own files stay public: it shows the login page itself.
//
// It also refuses requests that change something when they come from
// another site (a page elsewhere trying to act with the user's cookie).
func (s *Service) Protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !sameOrigin(r) {
			respond.Error(w, r, s.logger, http.StatusForbidden, "request from another site")
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		a, token, err := s.account(r)
		switch {
		case err == nil:
			ctx := NewContext(r.Context(), a)
			ctx = context.WithValue(ctx, tokenKey{}, token)
			next.ServeHTTP(w, r.WithContext(ctx))
		case publicAPI[r.URL.Path], isPublicLink(r):
			next.ServeHTTP(w, r)
		case errors.Is(err, errNoSession):
			respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		default:
			respond.InternalError(w, r, s.logger, err)
		}
	})
}

type tokenKey struct{}

// account finds the user of the request's session cookie.
func (s *Service) account(r *http.Request) (Account, string, error) {
	c, err := r.Cookie(cookieName)
	if err != nil || c.Value == "" || len(c.Value) > 100 {
		return Account{}, "", errNoSession
	}
	a, err := s.store.sessionAccount(r.Context(), hashToken(c.Value), s.now())
	return a, c.Value, err
}

// sameOrigin reports whether a request that changes something comes from
// FranzPLAY's own pages. Browsers send the Origin header with such
// requests; tools like curl do not send it and are allowed.
func sameOrigin(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	// Behind a reverse proxy, r.Host is the proxy's address for FranzPLAY
	// (like 10.10.0.1:8092), and the address the browser used arrives in
	// X-Forwarded-Host or Forwarded. Trusting them is safe: a page on
	// another site cannot set these headers (the browser would first ask
	// with a CORS preflight, which FranzPLAY never allows), and a tool that
	// sets them by hand does not have the user's cookie anyway.
	host := forwardedHost(r)
	return host != "" && strings.EqualFold(u.Host, host)
}

// forwardedHost returns the address the browser used, as a reverse proxy
// passes it: the first value of X-Forwarded-Host, else the host= of the
// first Forwarded entry. Empty when there is none.
func forwardedHost(r *http.Request) string {
	if h := r.Header.Get("X-Forwarded-Host"); h != "" {
		first, _, _ := strings.Cut(h, ",")
		return strings.TrimSpace(first)
	}
	first, _, _ := strings.Cut(r.Header.Get("Forwarded"), ",")
	for _, pair := range strings.Split(first, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(pair), "=")
		if ok && strings.EqualFold(key, "host") {
			return strings.Trim(value, `"`)
		}
	}
	return ""
}

// setCookie gives the browser its session cookie.
//   - HttpOnly: page scripts cannot read it, so an injected script cannot steal it.
//   - SameSite=Lax: other sites cannot send it with their requests.
//   - Secure: only over HTTPS, when FranzPLAY is reached through HTTPS.
func setCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(sessionLife.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS(r),
	})
}

func clearCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isHTTPS(r),
	})
}

// isHTTPS reports whether the browser reached FranzPLAY through HTTPS,
// directly or through a proxy in front of it.
func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}
