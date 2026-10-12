package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Lookup lets other features show videos as the catalog does, without
// knowing how they are stored.
type Lookup struct {
	store store
}

// NewLookup returns a Lookup on the catalog in db.
func NewLookup(db *sql.DB) Lookup { return Lookup{store: store{db: db}} }

// ByIDs returns the present videos among ids, in the same order. Missing
// or unknown ids are left out.
func (l Lookup) ByIDs(ctx context.Context, ids []int64) ([]Video, error) {
	return l.store.byIDs(ctx, ids)
}

// CanOpen reports whether the person with the id viewer may open a video:
// a visible one, or a private upload of theirs or shared with them. Likes
// and comments follow it, so the people who see a shared video can talk
// about it, and nobody else learns it is there.
func (l Lookup) CanOpen(ctx context.Context, videoID, viewer int64) (bool, error) {
	var one int
	err := l.store.db.QueryRowContext(ctx, `SELECT 1 FROM videos v WHERE v.id = ? AND `+watchable,
		videoID, viewer).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read video %d: %w", videoID, err)
	}
	return true, nil
}
