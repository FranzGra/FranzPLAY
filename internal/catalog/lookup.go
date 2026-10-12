package catalog

import (
	"context"
	"database/sql"
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
