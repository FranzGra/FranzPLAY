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
	"github.com/FranzGra/FranzPLAY/internal/server"
	"github.com/FranzGra/FranzPLAY/internal/webui"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

// shutdownTimeout is how long open requests get to finish when FranzPLAY stops.
const shutdownTimeout = 10 * time.Second

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
func run(ctx context.Context, getenv func(string) string, logOut io.Writer) error {
	logger := slog.New(slog.NewTextHandler(logOut, nil))

	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		return fmt.Errorf("create data folder %q: %w", cfg.DataDir, err)
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(version, logger, webui.Handler(webui.Files(), logger)),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		// No WriteTimeout: streaming a long video must not be cut off.
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("FranzPLAY started", "version", version, "addr", cfg.Addr, "data_dir", cfg.DataDir)
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
