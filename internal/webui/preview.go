package webui

import (
	"html"
	"net/http"
	"strings"
)

// Preview is what a chat app (WhatsApp, Telegram…) shows under an address
// someone sends: a picture, a title and a line of text. Those apps do not
// run the interface's code; they read only the <meta> tags of the page, so
// the server writes them into index.html for the addresses that have one.
type Preview struct {
	Title       string
	Description string // "" = none
	// Image is the address of the picture on this site, like
	// "/api/public/…/cover"; "" = none.
	Image    string
	SiteName string // "" = none
}

// Previewer describes the page at the address of r; false means the page
// has no preview of its own and gets index.html as it is.
type Previewer func(r *http.Request) (Preview, bool)

// withPreview returns index with the title and the <meta> tags of p.
// Every value is escaped: titles and descriptions come from people.
func withPreview(index []byte, p Preview, r *http.Request) []byte {
	page := string(index)
	esc := html.EscapeString

	// The tab's own title, for the apps that read only that.
	if start := strings.Index(page, "<title>"); start >= 0 {
		if end := strings.Index(page[start:], "</title>"); end >= 0 {
			page = page[:start] + "<title>" + esc(p.Title) + page[start+end:]
		}
	}

	var tags strings.Builder
	meta := func(attr, name, content string) {
		if content == "" {
			return
		}
		tags.WriteString(`<meta ` + attr + `="` + name + `" content="` + esc(content) + `" />`)
	}
	site := origin(r)
	meta("property", "og:type", "video.other")
	meta("property", "og:url", site+r.URL.Path)
	meta("property", "og:title", p.Title)
	meta("property", "og:description", p.Description)
	meta("name", "description", p.Description)
	meta("property", "og:site_name", p.SiteName)
	if p.Image != "" {
		// The apps load the picture from their own servers: the address
		// must be whole, with the site's name.
		meta("property", "og:image", site+p.Image)
		meta("property", "og:image:alt", p.Title)
		meta("name", "twitter:card", "summary_large_image")
	} else {
		meta("name", "twitter:card", "summary")
	}

	if at := strings.Index(page, "</head>"); at >= 0 {
		page = page[:at] + tags.String() + page[at:]
	} else {
		page = tags.String() + page
	}
	return []byte(page)
}

// origin is the start of the site's addresses as the visitor reached it,
// like "https://play.example.org": behind a reverse proxy the scheme and
// the name come from the headers it adds.
func origin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(firstValue(r.Header.Get("X-Forwarded-Proto")), "https") {
		scheme = "https"
	}
	host := firstValue(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	return scheme + "://" + host
}

// firstValue is the first of the values a chain of proxies may join with commas.
func firstValue(header string) string {
	first, _, _ := strings.Cut(header, ",")
	return strings.TrimSpace(first)
}
