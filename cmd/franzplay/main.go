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
	"os/exec"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/comments"
	"github.com/FranzGra/FranzPLAY/internal/config"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/events"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/library"
	"github.com/FranzGra/FranzPLAY/internal/likes"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/playlists"
	"github.com/FranzGra/FranzPLAY/internal/progress"
	"github.com/FranzGra/FranzPLAY/internal/server"
	"github.com/FranzGra/FranzPLAY/internal/users"
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
	// Background work: the job queue and the library scan. Both must end
	// before the database closes (deferred above, so it runs after this).
	hub := events.NewHub()
	// tell wraps a job that changes what the video lists show: when it
	// succeeds, the open pages hear about it.
	tell := func(h jobs.Handler) jobs.Handler {
		return func(ctx context.Context, videoID int64) error {
			if err := h(ctx, videoID); err != nil {
				return err
			}
			hub.Publish(events.Library)
			return nil
		}
	}
	handlers := map[jobs.Kind]jobs.Handler{}
	if ffprobe, err := exec.LookPath(cfg.FFprobe); err != nil {
		logger.Warn("ffprobe not found: videos will have no duration until it is installed",
			"setting", config.EnvFFprobe, "error", err)
	} else {
		handlers[jobs.Probe] = tell(media.NewProber(db, ffprobe).Handle)
	}
	if ffmpeg, err := exec.LookPath(cfg.FFmpeg); err != nil {
		logger.Warn("ffmpeg not found: videos will have no cover or previews until it is installed",
			"setting", config.EnvFFmpeg, "error", err)
	} else {
		handlers[jobs.Cover] = tell(media.NewCoverer(db, ffmpeg, cfg.DataDir).Handle)
		handlers[jobs.Preview] = media.NewPreviewer(db, ffmpeg, cfg.DataDir).Handle
	}
	// Before the worker starts, so it never sees a cover or a preview being made.
	if n, err := media.RemoveOrphanCovers(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused covers", "error", err)
	} else if n > 0 {
		logger.Info("removed unused covers", "count", n)
	}
	if n, err := media.RemoveOrphanPreviews(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused previews", "error", err)
	} else if n > 0 {
		logger.Info("removed unused previews", "count", n)
	}
	worker := jobs.NewWorker(db, handlers, logger)
	worker.OnChange(func() { hub.Publish(events.Jobs) })
	available := map[jobs.Kind]bool{}
	for k := range handlers {
		available[k] = true
	}
	scanner := library.NewScanner(db, cfg.Libraries, logger)
	scanner.OnNewJobs(worker.Wake)
	scanner.OnChange(func() { hub.Publish(events.Library) })
	scanner.OnScanning(func(bool) { hub.Publish(events.Scan) })

	bgCtx, stopBackground := context.WithCancel(ctx)
	var background sync.WaitGroup
	background.Go(func() { worker.Run(bgCtx) })
	background.Go(func() { scanner.Run(bgCtx, scanInterval) })
	defer func() {
		stopBackground()
		background.Wait()
	}()

	accounts, err := users.NewService(ctx, db, logger)
	if err != nil {
		return err
	}
	site := server.New(version, logger, webui.Handler(webui.Files(), logger),
		accounts.Routes,
		catalog.Routes(db, cfg.DataDir, logger),
		progress.Routes(db, catalog.NewLookup(db), logger),
		likes.Routes(db, logger),
		comments.Routes(db, logger),
		playlists.Routes(db, catalog.NewLookup(db), logger),
		jobs.Routes(db, available, worker.Wake, func() { hub.Publish(events.Jobs) }, logger),
		scanner.Routes(scanInterval, logger),
		hub.Routes(logger),
	)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           accounts.Protect(site),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		// No WriteTimeout: streaming a long video must not be cut off.
	}
	// Open event streams never end by themselves: close them when stopping.
	srv.RegisterOnShutdown(hub.Close)

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
