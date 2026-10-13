package database

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// TestEveryLinkToAVideoHasAnIndex: deleting a video deletes its rows in the
// tables that point to it. Without an index on the link, SQLite reads the
// whole table for each video deleted, and forgetting a disk freezes the site.
func TestEveryLinkToAVideoHasAnIndex(t *testing.T) {
	db, err := Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})

	type link struct{ table, column, parent string }
	var links []link
	rows, err := db.Query(`
		SELECT m.name, f."from", f."table"
		FROM sqlite_master m, pragma_foreign_key_list(m.name) f
		WHERE m.type = 'table' AND f."table" IN ('videos', 'comments')`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var l link
		if err := rows.Scan(&l.table, &l.column, &l.parent); err != nil {
			t.Fatal(err)
		}
		links = append(links, l)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if len(links) < 10 {
		t.Fatalf("found only %d links to videos: the query is wrong", len(links))
	}

	for _, l := range links {
		var indexed bool
		// An index helps when the link is its first column.
		err := db.QueryRow(fmt.Sprintf(`
			SELECT count(*) > 0 FROM pragma_index_list('%s') i, pragma_index_info(i.name) c
			WHERE c.seqno = 0 AND c.name = ?`, l.table), l.column).Scan(&indexed)
		if err != nil {
			t.Fatal(err)
		}
		if !indexed {
			t.Errorf("%s.%s points to %s but has no index", l.table, l.column, l.parent)
		}
	}
}

// TestVisibleVideosAreCountedFromTheSmallIndex: Home and search count the
// visible videos on every visit; reading the whole table would be slow.
func TestVisibleVideosAreCountedFromTheSmallIndex(t *testing.T) {
	db, err := Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	for _, q := range []string{
		`SELECT count(*) FROM videos v WHERE v.visible`,
		`SELECT v.id FROM videos v WHERE v.visible`,
		`SELECT v.category, count(*) FROM videos v WHERE v.visible AND v.category != '' GROUP BY v.category`,
	} {
		var plan []string
		rows, err := db.Query(`EXPLAIN QUERY PLAN ` + q)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var id, parent, unused int
			var detail string
			if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
				t.Fatal(err)
			}
			plan = append(plan, detail)
		}
		if err := rows.Close(); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(strings.Join(plan, "; "), "videos_shown") {
			t.Errorf("%s\nplan %q, want it to use videos_shown", q, plan)
		}
	}
}
