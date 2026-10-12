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

type accountKey struct{}

// FromContext returns the logged-in user of a request, set by Protect.
func FromContext(ctx context.Context) (Account, bool) {
	a, ok := ctx.Value(accountKey{}).(Account)
	return a, ok
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
			ctx := context.WithValue(r.Context(), accountKey{}, a)
			ctx = context.WithValue(ctx, tokenKey{}, token)
			next.ServeHTTP(w, r.WithContext(ctx))
		case publicAPI[r.URL.Path]:
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
	return strings.EqualFold(u.Host, r.Host)
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
