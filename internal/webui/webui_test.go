package webui

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

const indexHTML = "<!doctype html><title>FranzPLAY</title>"

func testFiles() fstest.MapFS {
	return fstest.MapFS{
		"index.html":       {Data: []byte(indexHTML)},
		"assets/app-1a.js": {Data: []byte("console.log(1)")},
		"favicon.svg":      {Data: []byte("<svg></svg>")},
	}
}

func serve(t *testing.T, files fstest.MapFS, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	Handler(files, slog.New(slog.NewTextHandler(io.Discard, nil))).
		ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestHandler(t *testing.T) {
	tests := []struct {
		name       string
		target     string
		wantStatus int
		wantBody   string
		wantCache  string
	}{
		{name: "home", target: "/", wantStatus: 200, wantBody: indexHTML, wantCache: "no-cache"},
		{name: "index.html itself", target: "/index.html", wantStatus: 200, wantBody: indexHTML, wantCache: "no-cache"},
		{name: "page address", target: "/playlist", wantStatus: 200, wantBody: indexHTML, wantCache: "no-cache"},
		{name: "nested page address", target: "/video/42", wantStatus: 200, wantBody: indexHTML, wantCache: "no-cache"},
		{name: "folder", target: "/assets/", wantStatus: 200, wantBody: indexHTML, wantCache: "no-cache"},
		{name: "built asset", target: "/assets/app-1a.js", wantStatus: 200, wantBody: "console.log(1)", wantCache: "public, max-age=31536000, immutable"},
		{name: "other file", target: "/favicon.svg", wantStatus: 200, wantBody: "<svg></svg>"},
		{name: "missing file", target: "/assets/missing.js", wantStatus: 404},
		{name: "path escape", target: "/../../etc/passwd", wantStatus: 200, wantBody: indexHTML, wantCache: "no-cache"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(t, testFiles(), http.MethodGet, tt.target)
			if rec.Code != tt.wantStatus {
				t.Fatalf("GET %s status = %d, want %d", tt.target, rec.Code, tt.wantStatus)
			}
			if tt.wantBody != "" && rec.Body.String() != tt.wantBody {
				t.Errorf("GET %s body = %q, want %q", tt.target, rec.Body.String(), tt.wantBody)
			}
			if got := rec.Header().Get("Cache-Control"); got != tt.wantCache {
				t.Errorf("GET %s Cache-Control = %q, want %q", tt.target, got, tt.wantCache)
			}
		})
	}
}

func TestHandlerHead(t *testing.T) {
	rec := serve(t, testFiles(), http.MethodHead, "/playlist")
	if rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Errorf("HEAD /playlist = %d with %d bytes, want 200 with no body", rec.Code, rec.Body.Len())
	}
}

func TestHandlerRejectsWrites(t *testing.T) {
	rec := serve(t, testFiles(), http.MethodPost, "/")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST / status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandlerWithoutBuiltInterface(t *testing.T) {
	rec := serve(t, fstest.MapFS{}, http.MethodGet, "/")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if !strings.Contains(rec.Body.String(), "make web") {
		t.Errorf("body = %q, want a hint to run make web", rec.Body.String())
	}
}

func TestFilesWorksWithOrWithoutBuild(t *testing.T) {
	// Files must not fail whether or not the interface was built.
	if Files() == nil {
		t.Fatal("Files() returned nil")
	}
}
