package online

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// confirming is an administrator's fixture with YouTube on and the
// confirm mode chosen.
func confirming(t *testing.T) *adminFixture {
	t.Helper()
	fx := newAdminFixture(t)
	if err := saveSources(context.Background(), fx.db, Sources{YouTube: true}); err != nil {
		t.Fatal(err)
	}
	setRules(t, fx.fixture, Rules{Order: sourceNames, Confirm: true})
	return fx
}

func (fx *adminFixture) proposalPicture(t *testing.T) string {
	t.Helper()
	image, err := fx.f.proposalImage(context.Background(), fx.id)
	if err != nil {
		t.Fatal(err)
	}
	return image
}

func exists(t *testing.T, dir, name string) bool {
	t.Helper()
	_, err := os.Stat(filepath.Join(dir, Dir, name))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	return err == nil
}

func TestConfirmKeepsWhatIsFoundUntilUsed(t *testing.T) {
	fx := confirming(t)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got := fx.read(t); got.title != "dal nome" || got.cover.Valid || got.coverJobs != 0 {
		t.Fatalf("video = %+v, want nothing used before the administrator says yes", got)
	}
	picture := fx.proposalPicture(t)
	if picture == "" || !exists(t, fx.dataDir, picture) {
		t.Fatalf("proposed picture %q not saved", picture)
	}

	rec := fx.do("GET", "/api/online/proposals", "")
	want := `{"proposals":[{"videoId":1,"video":"dal nome","source":"youtube","title":"Gita in montagna",` +
		`"author":"Famiglia Rossi","date":"","description":"","picture":true}]}`
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != want {
		t.Fatalf("GET proposals = %d %s", rec.Code, rec.Body)
	}
	if rec := fx.do("GET", "/api/online", ""); !strings.Contains(rec.Body.String(), `"proposals":1`) {
		t.Errorf("status = %s, want one proposal counted", rec.Body)
	}
	if rec := fx.do("GET", "/api/online/proposals/1/picture", ""); rec.Code != http.StatusOK || rec.Body.String() != "a jpeg" {
		t.Errorf("GET picture = %d %q", rec.Code, rec.Body)
	}

	// Cleaning the data folder keeps the picture waiting for a yes.
	if n, err := RemoveOrphans(context.Background(), fx.db, fx.dataDir); err != nil || n != 0 {
		t.Fatalf("removed %d, %v; want the proposed picture kept", n, err)
	}

	if rec := fx.do("POST", "/api/online/proposals/1", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("POST = %d %s", rec.Code, rec.Body)
	}
	got := fx.read(t)
	if got.title != "Gita in montagna" || got.author.String != "Famiglia Rossi" || !got.cover.Valid || got.coverJobs != 1 {
		t.Fatalf("video = %+v, want what was proposed and the cover made again", got)
	}
	if !exists(t, fx.dataDir, got.cover.String) || exists(t, fx.dataDir, picture) {
		t.Errorf("pictures: the one used must stay, the proposed one go")
	}
	if fx.woken != 1 {
		t.Errorf("worker woken %d times, want 1 for the cover", fx.woken)
	}
	if rec := fx.do("GET", "/api/online/proposals", ""); strings.TrimSpace(rec.Body.String()) != `{"proposals":[]}` {
		t.Errorf("after use = %s", rec.Body)
	}
	if rec := fx.do("POST", "/api/online/proposals/1", ""); rec.Code != http.StatusNotFound {
		t.Errorf("used twice = %d, want 404", rec.Code)
	}
}

func TestDiscardedProposalChangesNothing(t *testing.T) {
	fx := confirming(t)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	picture := fx.proposalPicture(t)
	if rec := fx.do("DELETE", "/api/online/proposals/1", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE = %d %s", rec.Code, rec.Body)
	}
	if got := fx.read(t); got.title != "dal nome" || got.cover.Valid {
		t.Errorf("video = %+v, want unchanged", got)
	}
	if exists(t, fx.dataDir, picture) {
		t.Error("discarded picture still there")
	}
	for _, path := range []string{"/api/online/proposals/1", "/api/online/proposals/x"} {
		if rec := fx.do("DELETE", path, ""); rec.Code != http.StatusNotFound {
			t.Errorf("DELETE %s = %d, want 404", path, rec.Code)
		}
	}
}

func TestConfirmKeepsWhatWasUsedWhenNothingIsFound(t *testing.T) {
	fx := confirming(t)
	setRules(t, fx.fixture, Rules{Order: sourceNames})
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	before := fx.read(t)

	setRules(t, fx.fixture, Rules{Order: sourceNames, Confirm: true})
	fx.yt.oEmbed = answer(http.StatusNotFound, `Not Found`)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got := fx.read(t); got.title != before.title || got.cover != before.cover {
		t.Errorf("video = %+v, want %+v kept: finding nothing is not a proposal", got, before)
	}
	if picture := fx.proposalPicture(t); picture != "" {
		t.Errorf("proposal %q for nothing found", picture)
	}
}

func TestProposalForAnotherContentIsNotShown(t *testing.T) {
	fx := confirming(t)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'another-content' WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	if rec := fx.do("GET", "/api/online/proposals", ""); strings.TrimSpace(rec.Body.String()) != `{"proposals":[]}` {
		t.Errorf("GET = %s, want the proposal for the old content hidden", rec.Body)
	}
	if rec := fx.do("POST", "/api/online/proposals/1", ""); rec.Code != http.StatusNotFound {
		t.Errorf("POST = %d, want 404", rec.Code)
	}
	if got := fx.read(t); got.onlineTitle.Valid {
		t.Errorf("video = %+v, want nothing used", got)
	}
}
