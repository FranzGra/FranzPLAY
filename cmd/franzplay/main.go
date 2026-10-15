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
	"slices"
	"sync"
	"syscall"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/autosubs"
	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/channels"
	"github.com/FranzGra/FranzPLAY/internal/comments"
	"github.com/FranzGra/FranzPLAY/internal/config"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/events"
	"github.com/FranzGra/FranzPLAY/internal/home"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/library"
	"github.com/FranzGra/FranzPLAY/internal/likes"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/online"
	"github.com/FranzGra/FranzPLAY/internal/overview"
	"github.com/FranzGra/FranzPLAY/internal/playlists"
	"github.com/FranzGra/FranzPLAY/internal/progress"
	"github.com/FranzGra/FranzPLAY/internal/recommend"
	"github.com/FranzGra/FranzPLAY/internal/server"
	"github.com/FranzGra/FranzPLAY/internal/sharing"
	"github.com/FranzGra/FranzPLAY/internal/site"
	"github.com/FranzGra/FranzPLAY/internal/translate"
	"github.com/FranzGra/FranzPLAY/internal/updates"
	"github.com/FranzGra/FranzPLAY/internal/uploads"
	"github.com/FranzGra/FranzPLAY/internal/users"
	"github.com/FranzGra/FranzPLAY/internal/webui"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

// release is the version of the official release this program was built
// from ("1.2.3"), set at build time with -ldflags "-X main.release=...".
// Empty for a build from a commit: a development build.
var release = ""

// remuxPlayers is how many videos can play at once with another sound
// track. Each one is an ffmpeg copying the picture: light, but not free
// on a Raspberry Pi.
const remuxPlayers = 3

// shutdownTimeout is how long open requests get to finish when FranzPLAY stops.
const shutdownTimeout = 10 * time.Second

// cleanInterval is how often unfinished uploads nobody continues are looked for.
const cleanInterval = time.Hour

// scanInterval is how often the video folders are checked for changes.
// A check of an unchanged folder only reads names, sizes and dates, so it is cheap.
const scanInterval = time.Minute

func main() {
	// Stop cleanly on Ctrl+C or when the system asks the program to stop.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	var err error
	if len(os.Args) > 1 && os.Args[1] == importOldCommand {
		err = importOld(ctx, os.Args[2:], os.Getenv, os.Stdout)
	} else {
		err = run(ctx, os.Getenv, os.Stderr)
	}
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
	// Reading the details files next to the videos needs no other program.
	handlers := map[jobs.Kind]jobs.Handler{
		jobs.Details: tell(media.NewDetailer(db).Handle),
		// Asks the internet only when the administrator turned a source on.
		jobs.Online: tell(online.NewFetcher(db, cfg.DataDir).Handle),
	}
	var remux catalog.Remuxer // stays nil without ffmpeg and ffprobe
	// The whisper models can be downloaded from the administration.
	downloader := autosubs.NewDownloader(cfg.DataDir, autosubs.ModelsURL, func() { hub.Publish(events.Jobs) }, logger)
	subtitles := autosubs.Options{DataDir: cfg.DataDir, Downloader: downloader}
	translatorClient := translate.New(cfg.TranslateURL, cfg.TranslateKey)
	if cfg.TranslateURL != "" {
		subtitles.Translator = translatorClient
	}
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
		// A ready clip plays on the video's card: the pages hear about it.
		handlers[jobs.Clip] = tell(media.NewClipper(db, ffmpeg, cfg.DataDir).Handle)
		if ffprobe, err := exec.LookPath(cfg.FFprobe); err == nil {
			// A ready copy makes a video playable: the pages hear about it.
			handlers[jobs.Convert] = tell(media.NewConverter(db, ffmpeg, ffprobe, cfg.DataDir).Handle)
			handlers[jobs.Tracks] = media.NewTracker(db, ffprobe, ffmpeg, cfg.DataDir).Handle
			remux = media.NewRemuxer(ffmpeg, remuxPlayers)
		}
		// Automatic subtitles are optional: without whisper, they are off.
		if whisper, err := exec.LookPath(cfg.Whisper); err != nil {
			logger.Info("whisper not found: automatic subtitles are off", "setting", config.EnvWhisper)
		} else {
			subtitles.Whisper = true
			var translator media.Translator // stays nil without a translator
			if cfg.TranslateURL != "" {
				translator = translatorClient
			}
			transcriber := media.NewTranscriber(db, ffmpeg, whisper, cfg.DataDir, translator)
			transcriber.OnStage(func() { hub.Publish(events.Jobs) })
			handlers[jobs.Transcribe] = transcriber.Handle
		}
	}
	// Before the worker starts, so it never sees a file being made.
	if n, err := media.RemoveOrphanCovers(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused covers", "error", err)
	} else if n > 0 {
		logger.Info("removed unused covers", "count", n)
	}
	if n, err := media.RemoveOrphanOwnCovers(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused uploaded covers", "error", err)
	} else if n > 0 {
		logger.Info("removed unused uploaded covers", "count", n)
	}
	if n, err := media.RemoveOrphanOwnClips(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused uploaded clips", "error", err)
	} else if n > 0 {
		logger.Info("removed unused uploaded clips", "count", n)
	}
	if n, err := catalog.RemoveOrphanCategoryImages(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused category images", "error", err)
	} else if n > 0 {
		logger.Info("removed unused category images", "count", n)
	}
	if n, err := media.RemoveOrphanPreviews(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused previews", "error", err)
	} else if n > 0 {
		logger.Info("removed unused previews", "count", n)
	}
	if n, err := media.RemoveOrphanClips(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused clips", "error", err)
	} else if n > 0 {
		logger.Info("removed unused clips", "count", n)
	}
	if n, err := media.RemoveOrphanSubtitles(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused subtitles", "error", err)
	} else if n > 0 {
		logger.Info("removed unused subtitles", "count", n)
	}
	if n, err := media.RemoveOrphanAutoSubtitles(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused automatic subtitles", "error", err)
	} else if n > 0 {
		logger.Info("removed unused automatic subtitles", "count", n)
	}
	if n, err := online.RemoveOrphans(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused pictures from the internet", "error", err)
	} else if n > 0 {
		logger.Info("removed unused pictures from the internet", "count", n)
	}
	if n, err := media.RemoveOrphanConverted(ctx, db, cfg.DataDir); err != nil {
		logger.Error("remove unused copies", "error", err)
	} else if n > 0 {
		logger.Info("removed unused copies", "count", n)
	}
	worker := jobs.NewWorker(db, handlers, logger)
	worker.OnChange(func() { hub.Publish(events.Jobs) })
	available := map[jobs.Kind]bool{}
	for k := range handlers {
		available[k] = true
	}
	// Videos uploaded from the browser live in the data folder, which the
	// scanner reads like the video folders.
	uploader, err := uploads.NewService(db, cfg.DataDir, logger)
	if err != nil {
		return err
	}
	uploadsFolder, err := uploads.Folder(cfg.DataDir)
	if err != nil {
		return err
	}
	scanner := library.NewScanner(db, append(slices.Clone(cfg.Libraries), uploadsFolder), logger)
	scanner.OnNewJobs(worker.Wake)
	scanner.OnChange(func() { hub.Publish(events.Library) })
	scanner.OnScanning(func(bool) { hub.Publish(events.Scan) })
	uploader.OnChange(func() { worker.Wake(); hub.Publish(events.Library) })

	updater := updates.New(db, release, version, logger)

	bgCtx, stopBackground := context.WithCancel(ctx)
	var background sync.WaitGroup
	background.Go(func() { worker.Run(bgCtx) })
	background.Go(func() { scanner.Run(bgCtx, scanInterval) })
	background.Go(func() { downloader.Run(bgCtx) })
	background.Go(func() { cleanUploads(bgCtx, uploader, logger) })
	background.Go(func() { updater.Run(bgCtx) })
	defer func() {
		stopBackground()
		background.Wait()
	}()

	accounts, err := users.NewService(ctx, db, cfg.DataDir, cfg.SetupCode, logger)
	if err != nil {
		return err
	}
	site := server.New(version, logger, webui.Handler(webui.Files(), logger),
		accounts.Routes,
		catalog.Routes(db, cfg.DataDir, logger),
		catalog.PublicRoutes(db, cfg.DataDir, logger),
		catalog.AudioRoutes(db, cfg.DataDir, remux, logger),
		catalog.PrepareRoutes(db, cfg.DataDir, func() { worker.Wake(); hub.Publish(events.Jobs) }, logger),
		catalog.AdminRoutes(db, cfg.DataDir,
			func() { hub.Publish(events.Library) },
			func() { worker.Wake(); hub.Publish(events.Jobs) },
			logger),
		progress.Routes(db, catalog.NewLookup(db), logger),
		recommend.Routes(db, catalog.NewLookup(db), logger),
		likes.Routes(db, catalog.NewLookup(db), logger),
		home.Routes(db, logger),
		comments.Routes(db, catalog.NewLookup(db), logger),
		playlists.Routes(db, catalog.NewLookup(db), logger),
		channels.Routes(db, playlists.PublicLists(db, catalog.NewLookup(db)), logger),
		sharing.Routes(db, logger),
		sharing.PublicRoutes(db, logger),
		jobs.Routes(db, available, worker.Wake, func() { hub.Publish(events.Jobs) }, logger),
		autosubs.Routes(db, subtitles, func() { worker.Wake(); hub.Publish(events.Jobs) }, logger),
		scanner.Routes(scanInterval, logger),
		uploader.Routes,
		online.Routes(db, cfg.DataDir, func() { worker.Wake(); hub.Publish(events.Jobs) }, logger),
		site.Routes(db, logger),
		overview.Routes(db, overview.Settings{Version: version, DataDir: cfg.DataDir,
			Libraries: cfg.Libraries, Tools: available[jobs.Probe] && available[jobs.Cover]}, logger),
		updater.Routes(logger),
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
		logger.Info("FranzPLAY started", "version", version, "release", release, "addr", cfg.Addr, "data_dir", cfg.DataDir,
			"libraries", cfg.Libraries)
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		return fmt.Errorf("web server: %w", err)
	case <-ctx.Done():
	}

	logger.Info("FranzPLAY stopping")
	if err := stopServer(srv, shutdownTimeout, logger); err != nil {
		return err
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("web server: %w", err)
	}
	logger.Info("FranzPLAY stopped")
	return nil
}

// stopServer lets the requests in progress finish, for at most timeout.
// A video being watched never finishes by itself, so after timeout the
// connections still open are closed: that is a normal stop, not an error.
func stopServer(srv *http.Server, timeout time.Duration, logger *slog.Logger) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	err := srv.Shutdown(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		if err != nil {
			return fmt.Errorf("stop web server: %w", err)
		}
		return nil
	}
	logger.Info("closing the videos still playing")
	if err := srv.Close(); err != nil {
		return fmt.Errorf("stop web server: %w", err)
	}
	return nil
}

// cleanUploads removes the uploads nobody continues, now and then every
// cleanInterval, until ctx is cancelled.
func cleanUploads(ctx context.Context, uploader *uploads.Service, logger *slog.Logger) {
	ticker := time.NewTicker(cleanInterval)
	defer ticker.Stop()
	for {
		if n, err := uploader.Clean(ctx); err != nil {
			logger.ErrorContext(ctx, "clean unfinished uploads", "error", err)
		} else if n > 0 {
			logger.InfoContext(ctx, "removed unfinished uploads", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
