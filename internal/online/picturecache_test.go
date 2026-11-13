package online

import (
	"bytes"
	"context"
	"net/http"
	"net/url"
	"testing"
	"time"
)

func TestPictureCacheKeepsTheRecentlyUsed(t *testing.T) {
	now := time.Unix(1000, 0)
	c := newPictureCache(80, time.Hour, func() time.Time { return now })
	ten := bytes.Repeat([]byte("x"), 10)

	c.put("a", ten, "image/jpeg")
	c.put("b", ten, "image/png")
	if data, kind, ok := c.get("b"); !ok || kind != "image/png" || !bytes.Equal(data, ten) {
		t.Fatalf("b = %q %q %v", data, kind, ok)
	}
	if _, _, ok := c.get("nothing"); ok {
		t.Error("a picture never kept was found")
	}

	// Full: the least recently used goes first. "a" was used last, so
	// "b" goes when the eighth picture comes.
	c.get("b")
	c.get("a")
	for _, key := range []string{"c", "d", "e", "f", "g", "h"} {
		c.put(key, ten, "image/jpeg")
	}
	if c.size != 80 || c.order.Len() != 8 {
		t.Fatalf("size = %d with %d pictures, want 80 with 8", c.size, c.order.Len())
	}
	c.put("i", ten, "image/jpeg")
	if _, _, ok := c.get("b"); ok {
		t.Error("b stayed, but it was the least recently used")
	}
	if _, _, ok := c.get("a"); !ok {
		t.Error("a went, but it was used more recently than b")
	}
	if c.size != 80 {
		t.Errorf("size = %d, want 80", c.size)
	}

	// The same picture again replaces the old one.
	c.put("a", ten[:5], "image/webp")
	if data, kind, _ := c.get("a"); len(data) != 5 || kind != "image/webp" || c.size != 75 {
		t.Errorf("a again = %d bytes %s, size %d", len(data), kind, c.size)
	}
}

func TestPictureCacheForgetsOldAndBigPictures(t *testing.T) {
	now := time.Unix(1000, 0)
	c := newPictureCache(80, 30*time.Minute, func() time.Time { return now })

	c.put("old", []byte("x"), "image/jpeg")
	now = now.Add(29 * time.Minute)
	if _, _, ok := c.get("old"); !ok {
		t.Fatal("a picture was forgotten before its time")
	}
	now = now.Add(time.Minute)
	if _, _, ok := c.get("old"); ok {
		t.Error("a picture was kept after its time")
	}
	if c.size != 0 || c.order.Len() != 0 {
		t.Errorf("size = %d with %d pictures after the old one went", c.size, c.order.Len())
	}

	// One picture alone cannot push out all the others.
	c.put("big", make([]byte, 11), "image/jpeg")
	if _, _, ok := c.get("big"); ok {
		t.Error("a picture bigger than an eighth of the whole was kept")
	}
}

func TestSearchPictureDownloadedOnce(t *testing.T) {
	fx := newAdminFixture(t)
	turnTMDBOn(t, fx.fixture)
	fx.tm.answers["/t/p/w780/wide.jpg"] = jpegAnswer
	path := "/api/online/picture?source=tmdb&at=" + url.QueryEscape("/w780/wide.jpg")

	asked := len(fx.tm.asked)
	for range 3 {
		rec := fx.do("GET", path, "")
		if rec.Code != http.StatusOK || rec.Body.String() != string(aJPEG) || rec.Header().Get("Content-Type") != "image/jpeg" ||
			rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("picture = %d %q %v", rec.Code, rec.Body, rec.Header())
		}
	}
	if got := len(fx.tm.asked) - asked; got != 1 {
		t.Errorf("TMDB was asked %d times for the same picture, want 1", got)
	}

	// A picture kept is still not given once the source is turned off.
	if err := saveSources(context.Background(), fx.db, Sources{}); err != nil {
		t.Fatal(err)
	}
	if rec := fx.do("GET", path, ""); rec.Code != http.StatusConflict {
		t.Errorf("picture kept with TMDB off = %d, want 409", rec.Code)
	}

	// A refused or wrong answer is not kept.
	turnTMDBOn(t, fx.fixture)
	fx.tm.answers["/t/p/w780/page.jpg"] = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("<html>"))
	}
	for range 2 {
		if rec := fx.do("GET", "/api/online/picture?source=tmdb&at=/w780/page.jpg", ""); rec.Code != http.StatusBadGateway {
			t.Errorf("not a picture = %d, want 502", rec.Code)
		}
	}
	if _, _, ok := fx.pictures.get(fx.f.tmdb.images + "/w780/page.jpg"); ok {
		t.Error("something that is not a picture was kept")
	}
}
