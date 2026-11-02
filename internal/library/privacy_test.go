package library

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// A hide whose video.json could not be written is in the copy only. With nothing
// that says which is newer, the more closed of the two wins.
func TestPutBackAfterRestoreKeepsTheMoreClosed(t *testing.T) {
	db, root, id := restoredFixture(t)
	ctx := context.Background()
	if _, err := content.EnsureVideoFolder(ctx, db, root, id, restoredPrint); err != nil {
		t.Fatal(err)
	}
	if err := content.SaveManifest(ctx, db, root, id); err != nil { // open
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE videos SET hidden_at = 77, private = 1 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if err := PutBackAfterRestore(ctx, db, root, true, time.Time{}, time.Unix(1000, 0), slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	var hidden sql.NullInt64
	var private bool
	if err := db.QueryRow(`SELECT hidden_at, private FROM videos WHERE id = ?`, id).Scan(&hidden, &private); err != nil {
		t.Fatal(err)
	}
	if !hidden.Valid || !private {
		t.Errorf("hidden %+v, private %v: a video.json behind the database opened it", hidden, private)
	}
}

// Contents not readable say nothing about the rows, and the work stays to do.
func TestPutBackAfterRestoreWaitsForContentsItCanRead(t *testing.T) {
	db, root, _ := restoredFixture(t)
	if err := os.MkdirAll(string(root), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root.VideoFolders(), []byte("in the way"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := PutBackAfterRestore(context.Background(), db, root, true, time.Time{}, time.Unix(1000, 0), slog.New(slog.DiscardHandler)); err == nil {
		t.Error("no error")
	}
	var pending int
	if err := db.QueryRow(`SELECT count(*) FROM settings WHERE key = ?`, keyAfterRestore).Scan(&pending); err != nil || pending != 1 {
		t.Errorf("the work was marked as done: %d, %v", pending, err)
	}
}

// With a database lost and contents that cannot be read, a scan cannot know which
// videos are hidden: it adds nothing rather than show them.
func TestAScanAddsNothingWhenContentsCannotBeRead(t *testing.T) {
	fx := newAdoptFixture(t)
	fx.addVideo(t, "mare.mp4")
	if err := os.MkdirAll(filepath.Dir(fx.root.VideoFolders()), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fx.root.VideoFolders(), []byte("in the way"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.Scan(context.Background()); err == nil {
		t.Error("no error")
	}
	var videos int
	fx.one(t, `SELECT count(*) FROM videos`, &videos)
	if videos != 0 {
		t.Errorf("%d videos came in with their hiding unknown", videos)
	}
}

// A new account with the same name is not the person who uploaded a private
// video on another installation.
func TestAnAccountWithTheSameNameIsNotTheOwner(t *testing.T) {
	fx := newAdoptFixture(t)
	if _, err := fx.db.Exec(`INSERT INTO users (name, password_hash, role, created_at) VALUES ('franz', 'x', 'user', 5)`); err != nil {
		t.Fatal(err)
	}
	fp := fx.addVideo(t, "mare.mp4")
	fx.folderFor(t, fp, "mare", func(m *content.Manifest) {
		m.Title = "Il mio caricato"
		m.Choices.Title, m.Choices.Category = nil, nil
		m.Access = &content.Access{Private: true, UploadedBy: "franz"}
	})
	fx.firstScan(t)
	var owner sql.NullInt64
	var private bool
	var shown string
	fx.one(t, `SELECT uploaded_by, private, shown_title FROM videos`, &owner, &private, &shown)
	if owner.Valid || !private {
		t.Errorf("owner %+v, private %v: it must stay closed until an administrator decides", owner, private)
	}
	if shown != "Il mio caricato" {
		t.Errorf("title %q", shown)
	}
}

// A video.json saved after the copy was made is the proof: it opens a video the
// copy has closed.
func TestPutBackAfterRestoreTrustsAVideoJSONNewerThanTheCopy(t *testing.T) {
	db, root, id := restoredFixture(t)
	ctx := context.Background()
	if _, err := content.EnsureVideoFolder(ctx, db, root, id, restoredPrint); err != nil {
		t.Fatal(err)
	}
	if err := content.SaveManifest(ctx, db, root, id); err != nil { // open, saved now
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE videos SET hidden_at = 77, private = 1 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	copyMadeAt := time.Now().Add(-time.Hour)
	if err := PutBackAfterRestore(ctx, db, root, true, copyMadeAt, time.Unix(1000, 0), slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	var hidden sql.NullInt64
	var private bool
	if err := db.QueryRow(`SELECT hidden_at, private FROM videos WHERE id = ?`, id).Scan(&hidden, &private); err != nil {
		t.Fatal(err)
	}
	if hidden.Valid || private {
		t.Errorf("hidden %+v, private %v: the newer video.json lost", hidden, private)
	}
}

// The same account, with the name and the time it was made, is the owner again.
func TestTheSameAccountIsTheOwnerAgain(t *testing.T) {
	fx := newAdoptFixture(t)
	if _, err := fx.db.Exec(`INSERT INTO users (name, password_hash, role, created_at) VALUES ('franz', 'x', 'user', 5)`); err != nil {
		t.Fatal(err)
	}
	fp := fx.addVideo(t, "mare.mp4")
	fx.folderFor(t, fp, "mare", func(m *content.Manifest) {
		m.Access = &content.Access{Private: true, UploadedBy: "franz", UploadedBySince: 5}
	})
	fx.firstScan(t)
	var owner sql.NullInt64
	fx.one(t, `SELECT uploaded_by FROM videos`, &owner)
	if !owner.Valid {
		t.Error("the account that uploaded the video lost it")
	}
}
