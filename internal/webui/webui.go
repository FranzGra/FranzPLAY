// Package webui serves the React interface that is built into the program.
//
// "make web" builds the interface into dist/app. The files are then embedded
// in the Go program, so FranzPLAY stays a single file to install.
package webui

import (
	"embed"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"
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
