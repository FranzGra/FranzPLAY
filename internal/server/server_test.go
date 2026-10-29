package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeUI stands in for the web interface and answers "ui".
var fakeUI = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	_, _ = io.WriteString(w, "ui")
})

func newTestHandler() http.Handler {
	return New("test-version", slog.New(slog.NewTextHandler(io.Discard, nil)), fakeUI)
}

func TestHealth(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want JSON", ct)
	}
	var body healthResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Status != "ok" || body.Version != "test-version" {
		t.Errorf("body = %+v, want status ok and version test-version", body)
	}
}

func TestHealthRejectsOtherMethods(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/health", nil))

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
	if allow := rec.Header().Get("Allow"); allow != "GET, HEAD" {
		t.Errorf("Allow = %q, want %q", allow, "GET, HEAD")
	}
}

func TestUnknownAPIRouteIsNotFound(t *testing.T) {
	for _, target := range []string{"/api/nothing-here", "/api/", "/api/health/extra"} {
		t.Run(target, func(t *testing.T) {
			rec := httptest.NewRecorder()
			newTestHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))

			if rec.Code != http.StatusNotFound {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
			}
			var body struct{ Error string }
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || body.Error == "" {
				t.Errorf("body is not a JSON error: %v", err)
			}
		})
	}
}

func TestOtherAddressesGoToTheInterface(t *testing.T) {
	for _, target := range []string{"/", "/playlist", "/video/42", "/apix"} {
		t.Run(target, func(t *testing.T) {
			rec := httptest.NewRecorder()
			newTestHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))

			if rec.Body.String() != "ui" {
				t.Errorf("GET %s body = %q, want the interface", target, rec.Body.String())
			}
		})
	}
}

func TestEveryAnswerCarriesSecurityHeaders(t *testing.T) {
	want := map[string]string{
		"Content-Security-Policy": contentPolicy,
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "SAMEORIGIN",
		"Referrer-Policy":         "same-origin",
	}
	for _, target := range []string{"/", "/video/1", "/api/health", "/api/nothing-here"} {
		t.Run(target, func(t *testing.T) {
			rec := httptest.NewRecorder()
			newTestHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))

			for name, value := range want {
				if got := rec.Header().Get(name); got != value {
					t.Errorf("%s = %q, want %q", name, got, value)
				}
			}
		})
	}
}

func TestHandlerCanReplaceASecurityHeader(t *testing.T) {
	ui := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
	})
	rec := httptest.NewRecorder()
	New("v", slog.New(slog.NewTextHandler(io.Discard, nil)), ui).
		ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/p/abc", nil))

	if got := rec.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Errorf("Referrer-Policy = %q, want the handler's no-referrer", got)
	}
}
