package sharing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Person is someone a thing is shared with, as the API shows them.
type Person struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Avatar int64  `json:"avatar"` // version of their profile photo, 0 = none
}

// Queryer is the database or a transaction.
type Queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Known checks that every id, already cleaned, is a person on FranzPLAY.
func Known(ctx context.Context, q Queryer, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	var n int
	if err := q.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE id IN (`+marks(len(ids))+`)`,
		anys(ids)...).Scan(&n); err != nil {
		return fmt.Errorf("check people: %w", err)
	}
	if n != len(ids) {
		return ErrUnknownPerson
	}
	return nil
}

// People reads the people a query returns as (thing, id, name, avatar)
// rows, grouped by thing. Each thing's people are in the query's order.
func People(ctx context.Context, q Queryer, query string, args ...any) (_ map[int64][]Person, err error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("read shares: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := map[int64][]Person{}
	for rows.Next() {
		var thing int64
		var p Person
		if err := rows.Scan(&thing, &p.ID, &p.Name, &p.Avatar); err != nil {
			return nil, fmt.Errorf("read shares: %w", err)
		}
		out[thing] = append(out[thing], p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read shares: %w", err)
	}
	return out, nil
}

// everyone returns every person but one, by name: the people that one can
// choose from.
func everyone(ctx context.Context, q Queryer, but int64) (_ []Person, err error) {
	rows, err := q.QueryContext(ctx, `SELECT id, name, avatar FROM users WHERE id != ?
		ORDER BY name COLLATE NOCASE, id`, but)
	if err != nil {
		return nil, fmt.Errorf("list people: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []Person{}
	for rows.Next() {
		var p Person
		if err := rows.Scan(&p.ID, &p.Name, &p.Avatar); err != nil {
			return nil, fmt.Errorf("list people: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list people: %w", err)
	}
	return out, nil
}

// marks returns n question marks for an IN list: "?,?,?".
func marks(n int) string { return strings.Repeat(",?", n)[1:] }

func anys(ids []int64) []any {
	out := make([]any, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}
