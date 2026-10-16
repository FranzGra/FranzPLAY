// Package webui serves the React interface that is built into the program.
//
// "make web" builds the interface into dist/app. The files are then embedded
// in the Go program, so FranzPLAY stays a single file to install.
package webui

import (
	"bytes"
	"compress/gzip"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
)

//go:embed all:dist
var embedded embed.FS

// Files returns the built interface embedded in the program.
// It is empty if the interface was not built before compiling.
func Files() fs.FS {
	files, err := fs.Sub(embedded, "dist/app")
	if err != nil {
		// fs.Sub only fails on an invalid path, and "dist/app" is valid.
		panic(err)
	}
	return files
}

// notBuiltMessage is shown when the program was compiled without the interface.
const notBuiltMessage = "FranzPLAY: the web interface was not built. Run \"make web\" and compile again.\n"

// Handler serves the interface from files.
//
// Real files (scripts, styles, fonts) are served as they are. Any other address,
// like /playlist or /video/42, gets index.html: the interface itself then shows
// the right page. Addresses that look like a file but do not exist get 404.
//
// preview, when not nil, describes the pages that have a link preview of
// their own (see Preview); their index.html carries it.
func Handler(files fs.FS, logger *slog.Logger, preview Previewer) http.Handler {
	zipped := &gzipCache{files: files}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name != "" && name != "index.html" && isFile(files, name) {
			if strings.HasPrefix(name, "assets/") {
				// Built files have a fingerprint in their name, so they never change.
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				if compressible(name) {
					// Caches between here and the browser must keep both versions apart.
					w.Header().Add("Vary", "Accept-Encoding")
					if servePrecompressed(w, r, files, name, logger) {
						return
					}
					if accepts(r, "gzip") {
						err := zipped.serve(w, r, name, logger)
						if err == nil {
							return
						}
						// Zipping failed: the plain file below still works.
						logger.ErrorContext(r.Context(), "compress interface file", "file", name, "error", err)
					}
				}
			}
			http.ServeFileFS(w, r, files, name)
			return
		}
		if path.Ext(name) != "" && name != "index.html" {
			http.NotFound(w, r)
			return
		}
		serveIndex(w, r, files, preview, logger)
	})
}

// isFile reports whether name is a regular file in files.
func isFile(files fs.FS, name string) bool {
	info, err := fs.Stat(files, name)
	return err == nil && info.Mode().IsRegular()
}

// serveIndex sends index.html, which must always be checked for updates.
func serveIndex(w http.ResponseWriter, r *http.Request, files fs.FS, preview Previewer, logger *slog.Logger) {
	index, err := fs.ReadFile(files, "index.html")
	if errors.Is(err, fs.ErrNotExist) {
		http.Error(w, notBuiltMessage, http.StatusServiceUnavailable)
		return
	}
	if err != nil {
		logger.ErrorContext(r.Context(), "read index.html", "error", err)
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if strings.HasPrefix(r.URL.Path, "/p/") {
		// The address of a public link holds its secret: never pass it on
		// to the sites its page links to.
		w.Header().Set("Referrer-Policy", "no-referrer")
	}
	if r.Method == http.MethodHead {
		return
	}
	if preview != nil {
		if p, ok := preview(r); ok {
			index = withPreview(index, p, r)
		}
	}
	if _, err := w.Write(index); err != nil {
		logger.DebugContext(r.Context(), "write index.html", "error", err)
	}
}

// compressible reports whether a built file is text that shrinks well when
// zipped. Fonts and pictures are already compressed.
func compressible(name string) bool {
	switch path.Ext(name) {
	case ".js", ".css", ".svg", ".json", ".txt", ".html":
		return true
	}
	return false
}

// accepts reports whether the browser can read files compressed with coding
// ("gzip" or "br"). Every browser in use today reads both.
func accepts(r *http.Request, coding string) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		got, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(got), coding) {
			return strings.ReplaceAll(params, " ", "") != "q=0"
		}
	}
	return false
}

// precompressed lists the copies the build writes next to each file
// ("make web" makes them), best first: brotli is about 15% smaller than gzip.
var precompressed = []struct{ coding, ext string }{
	{"br", ".br"},
	{"gzip", ".gz"},
}

// servePrecompressed sends the best copy of name, compressed at build time,
// that the browser can read. It reports false when there is none, so the
// caller compresses or sends the plain file instead.
func servePrecompressed(w http.ResponseWriter, r *http.Request, files fs.FS, name string, logger *slog.Logger) bool {
	for _, p := range precompressed {
		if !accepts(r, p.coding) || !isFile(files, name+p.ext) {
			continue
		}
		data, err := fs.ReadFile(files, name+p.ext)
		if err != nil {
			logger.ErrorContext(r.Context(), "read compressed interface file", "file", name+p.ext, "error", err)
			continue
		}
		send(w, r, name, p.coding, data, logger)
		return true
	}
	return false
}

// send writes data, the content of name compressed with coding.
func send(w http.ResponseWriter, r *http.Request, name, coding string, data []byte, logger *slog.Logger) {
	h := w.Header()
	if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
		h.Set("Content-Type", ct)
	}
	h.Set("Content-Encoding", coding)
	h.Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	if _, err := w.Write(data); err != nil {
		// The status is already sent: a failed write only means the browser left.
		logger.DebugContext(r.Context(), "write interface file", "file", name, "error", err)
	}
}

// gzipCache keeps a zipped copy of each built file that has none from the
// build (an interface built without the precompress step), made the first time a
// browser asks for it. The interface code shrinks to about a third, so pages
// open faster on a phone or away from home; zipping once keeps the work off
// the Raspberry's processor for every later visit.
type gzipCache struct {
	files fs.FS
	mu    sync.Mutex
	done  map[string][]byte
}

// zipped returns the zipped bytes of name, making them the first time.
func (c *gzipCache) zipped(name string) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if z, ok := c.done[name]; ok {
		return z, nil
	}
	plain, err := fs.ReadFile(c.files, name)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", name, err)
	}
	var buf bytes.Buffer
	zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if err != nil {
		return nil, fmt.Errorf("zip %s: %w", name, err)
	}
	if _, err := zw.Write(plain); err != nil {
		return nil, fmt.Errorf("zip %s: %w", name, err)
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("zip %s: %w", name, err)
	}
	if c.done == nil {
		c.done = map[string][]byte{}
	}
	c.done[name] = buf.Bytes()
	return buf.Bytes(), nil
}

// serve sends the zipped copy of name.
func (c *gzipCache) serve(w http.ResponseWriter, r *http.Request, name string, logger *slog.Logger) error {
	z, err := c.zipped(name)
	if err != nil {
		return err
	}
	send(w, r, name, "gzip", z, logger)
	return nil
}
