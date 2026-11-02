package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/FranzGra/FranzPLAY/internal/config"
	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/overview"
)

// migrateContentCommand copies the old files to the new folders, with FranzPLAY
// stopped: "franzplay migrate-content [--apply | --remove-old]". With no option it
// only says what it would do, and changes nothing.
const migrateContentCommand = "migrate-content"

var errMigrateUsage = errors.New("usage: franzplay " + migrateContentCommand + " [--apply | --remove-old]")

// migrateContent runs the command on the folders of the settings.
func migrateContent(ctx context.Context, args []string, getenv func(string) string, out io.Writer) (err error) {
	flags := flag.NewFlagSet(migrateContentCommand, flag.ContinueOnError)
	flags.SetOutput(out)
	apply := flags.Bool("apply", false, "copy the files and update the database")
	removeOld := flags.Bool("remove-old", false, "delete the old files that were copied, after checking them again")
	if err := flags.Parse(args); err != nil {
		return errMigrateUsage
	}
	if flags.NArg() != 0 || (*apply && *removeOld) {
		return errMigrateUsage
	}

	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	// Never a new, empty database: there would be nothing to transfer.
	if _, err := os.Stat(filepath.Join(cfg.DataDir, database.FileName)); err != nil {
		return fmt.Errorf("database in %q: %w", cfg.DataDir, err)
	}
	unlock, err := database.Lock(cfg.DataDir)
	switch {
	case errors.Is(err, database.ErrInUse):
		return fmt.Errorf("%w: stop it first (docker compose stop franzplay)", err)
	case errors.Is(err, database.ErrNoLock):
		fmt.Fprintf(out, "Attenzione: non posso controllare che FranzPLAY sia fermo (%v). Assicurati che lo sia.\n", err) //nolint:errcheck // a message to the person
	case err != nil:
		return err
	}
	defer func() { err = errors.Join(err, unlock()) }()

	t := content.Transfer{Root: content.Root(cfg.ContentDir), Data: content.Root(cfg.DataDir),
		Free: overview.FreeSpace, Backup: database.Backup, Out: out}

	// The first look only reads: not even the files next to the database change,
	// so a plan or a refusal leaves everything as it was.
	if t.DB, err = database.OpenToRead(ctx, cfg.DataDir, content.TransferSchema); err != nil {
		return err
	}
	if database.HasJournal(cfg.DataDir) {
		fmt.Fprintln(out, "Attenzione: FranzPLAY non è stato chiuso bene: i numeri possono essere un po' indietro.") //nolint:errcheck // a message to the person
	}
	switch {
	case *apply:
		err = t.CheckSpace(ctx)
	case !*removeOld:
		err = t.DryRun(ctx)
	}
	if err = errors.Join(err, t.DB.Close()); err != nil || (!*apply && !*removeOld) {
		return err
	}

	if err := os.MkdirAll(cfg.ContentDir, 0o750); err != nil {
		return fmt.Errorf("create content folder %q: %w", cfg.ContentDir, err)
	}
	if t.DB, err = database.Open(ctx, cfg.DataDir); err != nil {
		return err
	}
	defer func() {
		if closeErr := t.DB.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close database: %w", closeErr))
		}
	}()
	if *apply {
		return t.Apply(ctx)
	}
	return t.RemoveOld(ctx)
}
