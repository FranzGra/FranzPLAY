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
func Handler(files fs.FS, logger *slog.Logger) http.Handler {
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
					if acceptsGzip(r) {
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
		serveIndex(w, r, files, logger)
	})
}

// isFile reports whether name is a regular file in files.
func isFile(files fs.FS, name string) bool {
	info, err := fs.Stat(files, name)
	return err == nil && info.Mode().IsRegular()
}

// serveIndex sends index.html, which must always be checked for updates.
func serveIndex(w http.ResponseWriter, r *http.Request, files fs.FS, logger *slog.Logger) {
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
	if r.Method == http.MethodHead {
		return
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

// acceptsGzip reports whether the browser can read zipped files.
// Every browser in use today says so.
func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		coding, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(coding), "gzip") {
			return strings.ReplaceAll(params, " ", "") != "q=0"
		}
	}
	return false
}

// gzipCache keeps a zipped copy of each built file, made the first time a
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
	h := w.Header()
	if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
		h.Set("Content-Type", ct)
	}
	h.Set("Content-Encoding", "gzip")
	h.Set("Content-Length", strconv.Itoa(len(z)))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return nil
	}
	if _, err := w.Write(z); err != nil {
		// The status is already sent: a failed write only means the browser left.
		logger.DebugContext(r.Context(), "write interface file", "file", name, "error", err)
	}
	return nil
}
