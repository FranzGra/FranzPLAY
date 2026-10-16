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

func TestHandlerWritesLinkPreview(t *testing.T) {
	files := fstest.MapFS{"index.html": {Data: []byte(
		`<!doctype html><html><head><meta charset="utf-8" /><title>FranzPLAY</title></head><body></body></html>`)}}
	preview := func(r *http.Request) (Preview, bool) {
		if r.URL.Path != "/p/key" {
			return Preview{}, false
		}
		return Preview{Title: `Mare & "sole" <b>`, Description: "Un video di Giulia · 4:05",
			Image: "/api/public/key/cover", SiteName: "FranzPLAY"}, true
	}
	h := Handler(files, slog.New(slog.NewTextHandler(io.Discard, nil)), preview)
	get := func(target string, header ...string) string {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		for i := 0; i+1 < len(header); i += 2 {
			req.Header.Set(header[i], header[i+1])
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d", target, rec.Code)
		}
		return rec.Body.String()
	}

	page := get("/p/key", "X-Forwarded-Proto", "https", "X-Forwarded-Host", "play.example.org, inner")
	for _, want := range []string{
		`<title>Mare &amp; &#34;sole&#34; &lt;b&gt;</title>`,
		`<meta property="og:title" content="Mare &amp; &#34;sole&#34; &lt;b&gt;" />`,
		`<meta property="og:description" content="Un video di Giulia · 4:05" />`,
		`<meta property="og:image" content="https://play.example.org/api/public/key/cover" />`,
		`<meta property="og:url" content="https://play.example.org/p/key" />`,
		`<meta property="og:site_name" content="FranzPLAY" />`,
		`<meta name="twitter:card" content="summary_large_image" />`,
	} {
		if !strings.Contains(page, want) {
			t.Errorf("page lacks %s:\n%s", want, page)
		}
	}
	if strings.Contains(page, "<b>") {
		t.Errorf("a title is written as HTML: %s", page)
	}
	if strings.Index(page, "og:title") > strings.Index(page, "</head>") {
		t.Errorf("the tags are not in the head: %s", page)
	}

	// Without a proxy, the address the visitor used.
	if page := get("/p/key"); !strings.Contains(page, `content="http://example.com/api/public/key/cover"`) {
		t.Errorf("image address without a proxy:\n%s", page)
	}
	// Other pages, and a link without a preview, stay as they are.
	for _, target := range []string{"/", "/video/1", "/p/other"} {
		if page := get(target); strings.Contains(page, "og:") || !strings.Contains(page, "<title>FranzPLAY</title>") {
			t.Errorf("GET %s changed the page: %s", target, page)
		}
	}
}

func TestPreviewWithoutImage(t *testing.T) {
	page := string(withPreview([]byte("<head><title>x</title></head>"), Preview{Title: "Mare"},
		httptest.NewRequest(http.MethodGet, "/p/key", nil)))
	if strings.Contains(page, "og:image") || strings.Contains(page, "og:description") ||
		!strings.Contains(page, `content="summary"`) {
		t.Errorf("page = %s", page)
	}
}
