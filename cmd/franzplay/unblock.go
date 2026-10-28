package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/FranzGra/FranzPLAY/internal/config"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// unblockCommand lifts every login block: "franzplay unblock". It is for
// when nobody who can lift them from the administration can log in. It
// may run while FranzPLAY is on.
const unblockCommand = "unblock"

// unblock clears the blocks in the database of the data folder set in
// FRANZPLAY_DATA_DIR, and says how many there were on out.
func unblock(ctx context.Context, args []string, getenv func(string) string, out io.Writer) (err error) {
	if len(args) != 0 {
		return errors.New("usage: franzplay " + unblockCommand)
	}
	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	// A new, empty data folder has nothing to unblock: never create one.
	if _, err := os.Stat(cfg.DataDir); err != nil {
		return fmt.Errorf("data folder %q: %w", cfg.DataDir, err)
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
	n, err := users.ClearBlocks(ctx, db)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(out, "Blocchi tolti: %d. Ora tutti possono riprovare ad accedere.\n", n)
	return err
}
