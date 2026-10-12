// Command franzplay starts the FranzPLAY server.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/config"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/library"
	"github.com/FranzGra/FranzPLAY/internal/server"
	"github.com/FranzGra/FranzPLAY/internal/webui"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

// shutdownTimeout is how long open requests get to finish when FranzPLAY stops.
const shutdownTimeout = 10 * time.Second

// scanInterval is how often the video folders are checked for changes.
// A check of an unchanged folder only reads names, sizes and dates, so it is cheap.
const scanInterval = time.Minute

func main() {
	// Stop cleanly on Ctrl+C or when the system asks the program to stop.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	err := run(ctx, os.Getenv, os.Stderr)
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, "franzplay:", err)
		os.Exit(1)
	}
}

// run starts the server and blocks until ctx is cancelled or the server fails.
// It takes its inputs as arguments, so tests can run it without touching the real environment.
func run(ctx context.Context, getenv func(string) string, logOut io.Writer) (err error) {
	logger := slog.New(slog.NewTextHandler(logOut, nil))

	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		return fmt.Errorf("create data folder %q: %w", cfg.DataDir, err)
	}

	db, err := database.Open(ctx, cfg.DataDir)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := db.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close database: %w", closeErr))
		}
	}()

	if len(cfg.Libraries) == 0 {
		logger.Warn("no video folder set: FranzPLAY will show no videos", "setting", config.EnvLibraries)
	}
	scanCtx, stopScan := context.WithCancel(ctx)
	scanDone := make(chan struct{})
	go func() {
		defer close(scanDone)
		library.NewScanner(db, cfg.Libraries, logger).Run(scanCtx, scanInterval)
	}()
	// The scan must end before the database closes (deferred above, so it runs after this).
	defer func() {
		stopScan()
		<-scanDone
	}()

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(version, logger, webui.Handler(webui.Files(), logger)),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		// No WriteTimeout: streaming a long video must not be cut off.
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("FranzPLAY started", "version", version, "addr", cfg.Addr, "data_dir", cfg.DataDir,
			"libraries", cfg.Libraries)
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		return fmt.Errorf("web server: %w", err)
	case <-ctx.Done():
	}

	logger.Info("FranzPLAY stopping")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("stop web server: %w", err)
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("web server: %w", err)
	}
	logger.Info("FranzPLAY stopped")
	return nil
}
