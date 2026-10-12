package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/FranzGra/FranzPLAY/internal/config"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/oldimport"
)

// importOldCommand brings the data of the old FranzPLAY, once, on the day
// of the switch: "franzplay import-old [-try] [-photos folder] old-database.sql".
const importOldCommand = "import-old"

// errUsage means the command was written wrongly; the flag package has
// already said how to write it.
var errUsage = errors.New("usage: franzplay " + importOldCommand + " [-try] [-photos folder] old-database.sql")

// importOld runs the import into the database of the data folder set in
// FRANZPLAY_DATA_DIR, and writes its report on out.
func importOld(ctx context.Context, args []string, getenv func(string) string, out io.Writer) (err error) {
	flags := flag.NewFlagSet(importOldCommand, flag.ContinueOnError)
	flags.SetOutput(out)
	try := flags.Bool("try", false, "show what would be imported, without saving anything")
	photos := flags.String("photos", "", "the old FranzPLAY's folder of profile photos (App_Data/User_Images)")
	if err := flags.Parse(args); err != nil {
		return errUsage
	}
	if flags.NArg() != 1 {
		return errUsage
	}

	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	// The data folder must already exist: the import goes into a
	// FranzPLAY that has run and found its videos, never a new empty one.
	if _, err := os.Stat(cfg.DataDir); err != nil {
		return fmt.Errorf("data folder %q: %w", cfg.DataDir, err)
	}
	file, err := os.Open(flags.Arg(0))
	if err != nil {
		return fmt.Errorf("open old database copy: %w", err)
	}
	defer file.Close() //nolint:errcheck // read only: closing cannot lose data

	db, err := database.Open(ctx, cfg.DataDir)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := db.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close database: %w", closeErr))
		}
	}()

	report, err := oldimport.Import(ctx, db, file, oldimport.Options{Try: *try, PhotosDir: *photos, DataDir: cfg.DataDir})
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	return report.Write(out)
}
