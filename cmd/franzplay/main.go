// Command franzplay starts the FranzPLAY server.
package main

import (
	"context"
	"database/sql"
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
	"github.com/FranzGra/FranzPLAY/internal/bergamot"
	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/channels"
	"github.com/FranzGra/FranzPLAY/internal/comments"
	"github.com/FranzGra/FranzPLAY/internal/config"
	"github.com/FranzGra/FranzPLAY/internal/content"
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
	switch {
	case len(os.Args) > 1 && os.Args[1] == importOldCommand:
		err = importOld(ctx, os.Args[2:], os.Getenv, os.Stdout)
	case len(os.Args) > 1 && os.Args[1] == unblockCommand:
		err = unblock(ctx, os.Args[2:], os.Getenv, os.Stdout)
	case len(os.Args) > 1 && os.Args[1] == migrateContentCommand:
		err = migrateContent(ctx, os.Args[2:], os.Getenv, os.Stdout)
	default:
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
	if err := os.MkdirAll(cfg.ContentDir, 0o750); err != nil {
		return fmt.Errorf("create content folder %q: %w", cfg.ContentDir, err)
	}
	root := content.Root(cfg.ContentDir)

	// One owner (rule 4): before touching the database or any file.
	unlock, err := database.Lock(cfg.DataDir)
	switch {
	case errors.Is(err, database.ErrNoLock):
		logger.Warn("cannot lock the data folder: make sure only one FranzPLAY uses it", "error", err)
	case err != nil:
		return err
	}
	defer func() { err = errors.Join(err, unlock()) }()

	// Before opening it: opening would make an empty database.
	restored, err := database.RestoreIfMissing(ctx, cfg.DataDir, root.Database(), logger)
	if err != nil {
		return err
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
	// Before anything reads or writes the contents.
	if err := content.CheckAtStart(ctx, db, root, cfg.ContentDir != cfg.DataDir); err != nil {
		return err
	}
	// A content folder with something in it, but not the one the database knows.
	if err := content.WarnMissingFolders(ctx, db, root, logger); err != nil {
		logger.Warn("check the folders of the videos", "error", err)
	}

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
		jobs.Details: tell(media.NewDetailer(db, root).Handle),
		// Asks the internet only when the administrator turned a source on.
		jobs.Online: tell(online.NewFetcher(db, root).Handle),
	}
	var remux catalog.Remuxer                        // stays nil without ffmpeg and ffprobe
	var categoryPictures *media.CategoryPictureMaker // stays nil without ffmpeg
	// The whisper models can be downloaded from the administration.
	downloader := autosubs.NewDownloader(root, autosubs.ModelsURL, func() { hub.Publish(events.Jobs) }, logger)
	subtitles := autosubs.Options{Content: root, Downloader: downloader}
	// The translator is the one part that knows which engine translates:
	// the rest of FranzPLAY speaks to media.Translator and autosubs.Languages,
	// and shows the words the engine gives for its own state. A server, if one
	// is named; otherwise the program inside the image.
	var translator media.Translator // stays nil without a translator
	if cfg.TranslateURL != "" {
		client := translate.New(cfg.TranslateURL, cfg.TranslateKey)
		subtitles.Translator = client
		subtitles.TranslatorHelp = autosubs.TranslatorHelp(translate.Help)
		translator = client
	} else if program, err := exec.LookPath(cfg.Translator); err != nil {
		logger.Info("translator not found: subtitles cannot be translated", "setting", config.EnvTranslator)
		subtitles.TranslatorHelp = autosubs.TranslatorHelp(bergamot.Help)
	} else {
		engine := bergamot.New(program, root, func() { hub.Publish(events.Jobs) }, logger)
		subtitles.Translator = engine
		subtitles.TranslatorHelp = autosubs.TranslatorHelp(bergamot.Help)
		subtitles.TranslatorModels = engine
		translator = engine
	}
	// Translating needs no other program. Without a translator the job fails
	// and says why, rather than waiting in the queue forever.
	handlers[jobs.Translate] = media.NewTranscriber(db, "", "", root, translator).HandleTranslation
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
		handlers[jobs.Cover] = tell(media.NewCoverer(db, ffmpeg, root).Handle)
		categoryPictures = media.NewCategoryPictureMaker(db, ffmpeg, root)
		handlers[jobs.Preview] = media.NewPreviewer(db, ffmpeg, root).Handle
		// A ready clip plays on the video's card: the pages hear about it.
		handlers[jobs.Clip] = tell(media.NewClipper(db, ffmpeg, root).Handle)
		if ffprobe, err := exec.LookPath(cfg.FFprobe); err == nil {
			// A ready copy makes a video playable: the pages hear about it.
			handlers[jobs.Convert] = tell(media.NewConverter(db, ffmpeg, ffprobe, root).Handle)
			handlers[jobs.Tracks] = media.NewTracker(db, ffprobe, ffmpeg, root).Handle
			remux = media.NewRemuxer(ffmpeg, remuxPlayers)
		}
		// Automatic subtitles are optional: without whisper, they are off.
		if whisper, err := exec.LookPath(cfg.Whisper); err != nil {
			logger.Info("whisper not found: automatic subtitles are off", "setting", config.EnvWhisper)
		} else {
			subtitles.Whisper = true
			picker := media.NewWhisperPicker(whisper)
			subtitles.WhisperStatus = picker.Status
			logger.Info("whisper found", "program", picker.Program())
			transcriber := media.NewTranscriber(db, ffmpeg, whisper, root, translator)
			transcriber.UseWhisper(picker)
			transcriber.OnStage(func() { hub.Publish(events.Jobs) })
			handlers[jobs.Transcribe] = transcriber.Handle
			subtitles.ModelInUse = transcriber.ModelInUse
		}
	}
	// Before the worker starts, so it never sees a file being made.
	if err := content.RemoveWork(root); err != nil {
		logger.Error("remove unfinished work", "error", err)
	}
	copyMadeAt, _ := database.RestoreMark(cfg.DataDir)
	if err := library.PutBackAfterRestore(ctx, db, root, restored, copyMadeAt, time.Now(), logger); err != nil {
		return err
	}
	// The database says it now: the mark next to it is no longer needed.
	if err := database.ClearRestoreMark(cfg.DataDir); err != nil {
		return err
	}
	if err := content.RestoreCategories(ctx, db, root, cfg.Libraries, logger); err != nil {
		logger.Warn("what was chosen for the categories not put back", "error", err)
	}
	cleanAtStart(ctx, db, root, logger)
	worker := jobs.NewWorker(db, handlers, logger)
	worker.OnChange(func() { hub.Publish(events.Jobs) })
	// Every job done goes in video.json, so that a database lost finds it there.
	worker.OnJobDone(func(ctx context.Context, videoID int64) {
		if err := content.SaveManifest(ctx, db, root, videoID); err != nil {
			logger.WarnContext(ctx, "write video.json", "video", videoID, "error", err)
		}
	})
	subtitles.Running = worker.Running // how far a transcription is
	available := map[jobs.Kind]bool{}
	for k := range handlers {
		available[k] = true
	}
	// Videos uploaded from the browser live in the content folder, which the
	// scanner reads like the video folders.
	uploader, err := uploads.NewService(db, root, logger)
	if err != nil {
		return err
	}
	uploadsFolder, err := uploads.Folder(root)
	if err != nil {
		return err
	}
	oldUploads, err := uploads.OldFolders(ctx, db, root, content.Root(cfg.DataDir))
	if err != nil {
		return err
	}
	uploader.KeepOldFolders(oldUploads)
	scanner := library.NewScanner(db, append(append(slices.Clone(cfg.Libraries), uploadsFolder), oldUploads...), logger)
	scanner.OnNewJobs(worker.Wake)
	scanner.OnChange(func() { hub.Publish(events.Library) })
	scanner.ReuseFrom(func(ctx context.Context, fingerprints []string) (map[string]*content.Reused, error) {
		return root.Reuse(ctx, fingerprints, logger)
	})
	scanner.OnScanned(func(ctx context.Context, moved, replaced []int64) {
		content.AfterScan(ctx, db, root, moved, replaced, logger)
	})
	scanner.OnScanning(func(bool) { hub.Publish(events.Scan) })
	if categoryPictures != nil {
		scanner.OnCategoryPictures(func(ctx context.Context) {
			n, err := categoryPictures.Make(ctx)
			if err != nil && ctx.Err() == nil {
				logger.WarnContext(ctx, "pictures of the categories", "error", err)
			}
			if n > 0 {
				hub.Publish(events.Library)
			}
		})
	}
	uploader.OnChange(func() { worker.Wake(); hub.Publish(events.Library) })

	updater := updates.New(db, release, version, logger)

	bgCtx, stopBackground := context.WithCancel(ctx)
	var background sync.WaitGroup
	background.Go(func() { worker.Run(bgCtx) })
	background.Go(func() { scanner.Run(bgCtx, scanInterval) })
	background.Go(func() { downloader.Run(bgCtx) })
	background.Go(func() { cleanUploads(bgCtx, uploader, logger) })
	background.Go(func() { updater.Run(bgCtx) })
	background.Go(func() { database.RunBackups(bgCtx, db, root.Database(), time.Now, logger) })
	background.Go(func() {
		if err := content.SaveAllManifests(bgCtx, db, root, logger); err != nil && bgCtx.Err() == nil {
			logger.Warn("write every video.json", "error", err)
		}
	})
	defer func() {
		stopBackground()
		background.Wait()
	}()

	accounts, err := users.NewService(ctx, db, root, cfg.SetupCode, logger)
	if err != nil {
		return err
	}
	accounts.SetTrustedProxies(cfg.TrustedProxies)
	site := server.New(version, logger, webui.Handler(webui.Files(), logger, catalog.LinkPreview(db, logger)),
		accounts.Routes,
		catalog.Routes(db, root, logger),
		catalog.PublicRoutes(db, root, logger),
		catalog.AudioRoutes(db, root, remux, logger),
		catalog.PrepareRoutes(db, root, func() { worker.Wake(); hub.Publish(events.Jobs) }, logger),
		catalog.AdminRoutes(db, root,
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
		jobs.Routes(db, available, jobs.Live{Running: worker.Running, Others: downloader.Jobs},
			worker.Wake, func() { hub.Publish(events.Jobs) }, logger),
		autosubs.Routes(db, subtitles, func() { worker.Wake(); hub.Publish(events.Jobs) }, logger),
		scanner.Routes(scanInterval, logger),
		uploader.Routes,
		online.Routes(db, root, func() { worker.Wake(); hub.Publish(events.Jobs) }, logger),
		site.Routes(db, logger),
		overview.Routes(db, overview.Settings{Version: version, DataDir: cfg.DataDir, ContentDir: cfg.ContentDir, Content: root,
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
		logger.Info("FranzPLAY started", "version", version, "release", release, "addr", cfg.Addr, "data_dir", cfg.DataDir, "content_dir", cfg.ContentDir,
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

// cleanAtStart deletes what nobody uses any more, as far as the database can say
// so (see content.PlanCleaning). It must run before the job worker and the web
// server start.
func cleanAtStart(ctx context.Context, db *sql.DB, root content.Root, logger *slog.Logger) {
	plan, err := content.PlanCleaning(ctx, db, root, time.Now(), logger)
	if err != nil {
		logger.Error("nothing deleted at start", "error", err)
		return
	}
	if plan.Folders {
		if n, err := content.RemoveRetiredFolders(ctx, db, root, time.Now()); err != nil {
			logger.Error("remove folders of videos gone", "error", err)
		} else if n > 0 {
			logger.Info("removed folders of videos gone", "count", n)
		}
	}
	if !plan.Flat {
		return
	}
	for _, clean := range []struct {
		what     string
		remove   func(context.Context, *sql.DB, content.Root) (int, error)
		category bool
	}{
		{"covers", media.RemoveOrphanCovers, false},
		{"uploaded covers", media.RemoveOrphanOwnCovers, false},
		{"uploaded clips", media.RemoveOrphanOwnClips, false},
		{"category pictures", media.RemoveOrphanCategoryPictures, true},
		{"category images", catalog.RemoveOrphanCategoryImages, true},
		{"previews", media.RemoveOrphanPreviews, false},
		{"clips", media.RemoveOrphanClips, false},
		{"subtitles", media.RemoveOrphanSubtitles, false},
		{"automatic subtitles", media.RemoveOrphanAutoSubtitles, false},
		{"pictures from the internet", online.RemoveOrphans, false},
		{"copies", media.RemoveOrphanConverted, false},
	} {
		if clean.category && !plan.Categories {
			continue
		}
		if n, err := clean.remove(ctx, db, root); err != nil {
			logger.Error("remove unused files", "what", clean.what, "error", err)
		} else if n > 0 {
			logger.Info("removed unused files", "what", clean.what, "count", n)
		}
	}
}
