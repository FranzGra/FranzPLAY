package users

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestCheckAvatar(t *testing.T) {
	tests := []struct {
		name   string
		c      image.Config
		format string
		ok     bool
	}{
		{"square jpeg", image.Config{Width: 512, Height: 512}, "jpeg", true},
		{"square png", image.Config{Width: 64, Height: 64}, "png", true},
		{"largest", image.Config{Width: maxAvatarSide, Height: maxAvatarSide}, "jpeg", true},
		{"not square", image.Config{Width: 512, Height: 300}, "jpeg", false},
		{"too small", image.Config{Width: 32, Height: 32}, "png", false},
		{"too large", image.Config{Width: 5000, Height: 5000}, "jpeg", false},
		{"gif", image.Config{Width: 512, Height: 512}, "gif", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := checkAvatar(tt.c, tt.format)
			if (err == nil) != tt.ok || (err != nil && !errors.Is(err, errBadAvatar)) {
				t.Fatalf("checkAvatar = %v, want ok %v", err, tt.ok)
			}
		})
	}
}

// picture makes a picture file of the given size and format.
func picture(t *testing.T, w, h int, format string) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := range w {
		for y := range h {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 200, A: 255})
		}
	}
	var buf bytes.Buffer
	var err error
	if format == "png" {
		err = png.Encode(&buf, img)
	} else {
		err = jpeg.Encode(&buf, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// send uploads raw bytes as the profile photo.
func (b *browser) send(data []byte) *httptest.ResponseRecorder {
	b.site.t.Helper()
	req := httptest.NewRequest("PUT", "/api/me/avatar", bytes.NewReader(data))
	req.Header.Set("Content-Type", "image/jpeg")
	req.AddCookie(&http.Cookie{Name: cookieName, Value: b.cookie})
	rec := httptest.NewRecorder()
	b.site.handler.ServeHTTP(rec, req)
	return rec
}

func account(t *testing.T, rec *httptest.ResponseRecorder) Account {
	t.Helper()
	var a Account
	if err := json.Unmarshal(rec.Body.Bytes(), &a); err != nil {
		t.Fatalf("%v: %s", err, rec.Body)
	}
	return a
}

func TestProfilePhoto(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	if a := account(t, admin.do("GET", "/api/me", nil)); a.Avatar != 0 {
		t.Fatalf("a new user has photo %d", a.Avatar)
	}
	path := "/api/users/1/avatar"
	expect(t, admin.do("GET", path, nil), http.StatusNotFound)

	// What a browser would never send is refused.
	expect(t, admin.send([]byte("not a picture")), http.StatusBadRequest)
	expect(t, admin.send(picture(t, 300, 200, "jpeg")), http.StatusBadRequest)
	expect(t, admin.send(make([]byte, maxAvatarBytes+1)), http.StatusRequestEntityTooLarge)
	if _, err := os.Stat(filepath.Join(s.dataDir, avatarDir, "1.jpg")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("a refused photo was saved: %v", err)
	}

	rec := admin.send(picture(t, 128, 128, "png"))
	expect(t, rec, http.StatusOK)
	first := account(t, rec).Avatar
	if first != s.now.UnixMilli() {
		t.Fatalf("photo version %d, want the time of the change", first)
	}
	if a := account(t, admin.do("GET", "/api/me", nil)); a.Avatar != first {
		t.Fatalf("after the upload /api/me says photo %d", a.Avatar)
	}

	// Anyone logged in sees it, as a JPEG made again by FranzPLAY.
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Giulia", "password": "giulia-password", "role": "user",
	}), http.StatusCreated)
	giulia := s.browser()
	expect(t, giulia.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusOK)
	rec = giulia.do("GET", path+"?v="+strconv.FormatInt(first, 10), nil)
	expect(t, rec, http.StatusOK)
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("content type %q", ct)
	}
	c, format, err := image.DecodeConfig(rec.Body)
	if err != nil || format != "jpeg" || c.Width != 128 {
		t.Fatalf("photo sent back: %v %q %+v", err, format, c)
	}
	expect(t, s.browser().do("GET", path, nil), http.StatusUnauthorized)

	// A new photo has a new version, so browsers do not show the old one.
	s.now = s.now.Add(time.Second)
	rec = admin.send(picture(t, 256, 256, "jpeg"))
	expect(t, rec, http.StatusOK)
	if account(t, rec).Avatar == first {
		t.Fatal("a new photo kept the old version")
	}

	rec = admin.do("DELETE", "/api/me/avatar", nil)
	expect(t, rec, http.StatusOK)
	if a := account(t, rec); a.Avatar != 0 {
		t.Fatalf("after removing, photo %d", a.Avatar)
	}
	expect(t, giulia.do("GET", path, nil), http.StatusNotFound)
}

func TestDeletedAccountsLeaveNoPhoto(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	var marco int64
	for _, name := range []string{"Giulia", "Marco"} {
		rec := admin.do("POST", "/api/users", map[string]any{
			"name": name, "password": "a-good-password", "role": "user",
		})
		expect(t, rec, http.StatusCreated)
		marco = account(t, rec).ID
		b := s.browser()
		expect(t, b.do("POST", "/api/login", map[string]string{"name": name, "password": "a-good-password"}),
			http.StatusOK)
		expect(t, b.send(picture(t, 64, 64, "jpeg")), http.StatusOK)
		if name == "Giulia" {
			expect(t, b.do("DELETE", "/api/me", map[string]string{"password": "a-good-password"}), http.StatusNoContent)
		}
	}
	expect(t, admin.do("DELETE", "/api/users/"+strconv.FormatInt(marco, 10), nil), http.StatusNoContent)

	entries, err := os.ReadDir(filepath.Join(s.dataDir, avatarDir))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("photos left behind: %v", entries)
	}
}
