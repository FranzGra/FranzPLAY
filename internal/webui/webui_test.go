package webui

import (
	"compress/gzip"
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
	Handler(files, slog.New(slog.NewTextHandler(io.Discard, nil)), nil).
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

func TestHandlerZipsBuiltCode(t *testing.T) {
	code := strings.Repeat("console.log('FranzPLAY');\n", 200)
	files := testFiles()
	files["assets/app-1a.js"] = &fstest.MapFile{Data: []byte(code)}
	files["assets/font-1a.woff2"] = &fstest.MapFile{Data: []byte("not text")}
	h := Handler(files, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)

	get := func(target, accept string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		if accept != "" {
			req.Header.Set("Accept-Encoding", accept)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	for range 2 { // the second time comes from the kept copy
		rec := get("/assets/app-1a.js", "gzip, deflate, br")
		if rec.Header().Get("Content-Encoding") != "gzip" {
			t.Fatalf("Content-Encoding = %q, want gzip", rec.Header().Get("Content-Encoding"))
		}
		if !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/javascript") {
			t.Errorf("Content-Type = %q, want JavaScript", rec.Header().Get("Content-Type"))
		}
		if rec.Header().Get("Vary") != "Accept-Encoding" {
			t.Errorf("Vary = %q, want Accept-Encoding", rec.Header().Get("Vary"))
		}
		if rec.Body.Len() >= len(code)/4 {
			t.Errorf("zipped size %d, want much smaller than %d", rec.Body.Len(), len(code))
		}
		zr, err := gzip.NewReader(rec.Body)
		if err != nil {
			t.Fatal(err)
		}
		plain, err := io.ReadAll(zr)
		if err != nil {
			t.Fatal(err)
		}
		if string(plain) != code {
			t.Error("unzipped body differs from the file")
		}
	}

	tests := []struct {
		name, target, accept string
	}{
		{"browser without gzip", "/assets/app-1a.js", ""},
		{"gzip refused", "/assets/app-1a.js", "gzip;q=0, br"},
		{"font is already compressed", "/assets/font-1a.woff2", "gzip"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := get(tt.target, tt.accept)
			if rec.Code != http.StatusOK || rec.Header().Get("Content-Encoding") != "" {
				t.Errorf("status %d, Content-Encoding %q; want the plain file",
					rec.Code, rec.Header().Get("Content-Encoding"))
			}
		})
	}
}

func TestHandlerSendsPrecompressedCopies(t *testing.T) {
	files := testFiles()
	files["assets/app-1a.js.br"] = &fstest.MapFile{Data: []byte("BROTLI")}
	files["assets/app-1a.js.gz"] = &fstest.MapFile{Data: []byte("GZIP")}
	files["assets/only-gz-1a.css"] = &fstest.MapFile{Data: []byte("body{}")}
	files["assets/only-gz-1a.css.gz"] = &fstest.MapFile{Data: []byte("GZIPCSS")}

	tests := []struct {
		name, target, accept, wantCoding, wantBody, wantType string
	}{
		{"brotli first", "/assets/app-1a.js", "gzip, deflate, br", "br", "BROTLI", "text/javascript"},
		{"brotli in any case", "/assets/app-1a.js", "BR;q=1.0", "br", "BROTLI", "text/javascript"},
		{"gzip when brotli refused", "/assets/app-1a.js", "gzip, br;q=0", "gzip", "GZIP", "text/javascript"},
		{"gzip only", "/assets/app-1a.js", "gzip", "gzip", "GZIP", "text/javascript"},
		{"no copy in brotli", "/assets/only-gz-1a.css", "br, gzip", "gzip", "GZIPCSS", "text/css"},
		{"plain for old browsers", "/assets/app-1a.js", "", "", "console.log(1)", "text/javascript"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.target, nil)
			if tt.accept != "" {
				req.Header.Set("Accept-Encoding", tt.accept)
			}
			rec := httptest.NewRecorder()
			Handler(files, slog.New(slog.NewTextHandler(io.Discard, nil)), nil).ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			if got := rec.Header().Get("Content-Encoding"); got != tt.wantCoding {
				t.Errorf("Content-Encoding = %q, want %q", got, tt.wantCoding)
			}
			if got := rec.Body.String(); got != tt.wantBody {
				t.Errorf("body = %q, want %q", got, tt.wantBody)
			}
			if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, tt.wantType) {
				t.Errorf("Content-Type = %q, want %s", got, tt.wantType)
			}
			if got := rec.Header().Get("Vary"); got != "Accept-Encoding" {
				t.Errorf("Vary = %q, want Accept-Encoding", got)
			}
			if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
				t.Errorf("Cache-Control = %q", got)
			}
		})
	}
}
