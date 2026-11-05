package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// publicAddresses are the addresses of a public link, all open to guests.
var publicAddresses = []string{"", "/stream", "/subtitles", "/cover", "/preview"}

// makeLink makes the public link of a video and returns its key.
func (s *liveSite) makeLink(cookie string, video int64) string {
	s.t.Helper()
	a := s.expect(cookie, "POST", fmt.Sprintf("/api/videos/%d/public-link", video), nil, http.StatusOK)
	var got struct{ Link *string }
	if err := json.Unmarshal(a.body, &got); err != nil || got.Link == nil {
		s.t.Fatalf("public link: %s %v", a.body, err)
	}
	key, ok := strings.CutPrefix(*got.Link, "/p/")
	if !ok {
		s.t.Fatalf("link = %q", *got.Link)
	}
	return key
}

// linkWorks reports whether a guest can open the video of a key.
func (s *liveSite) linkWorks(key string) bool {
	s.t.Helper()
	a := s.do("", "GET", "/api/public/"+key, nil)
	switch a.status {
	case http.StatusOK:
		return true
	case http.StatusNotFound:
		// A dead key opens nothing at all, not even the files.
		for _, end := range publicAddresses[1:] {
			if b := s.do("", "GET", "/api/public/"+key+end, nil); b.status != http.StatusNotFound {
				s.t.Errorf("dead key, %s: %d, want 404", end, b.status)
			}
		}
		return false
	default:
		s.t.Fatalf("GET /api/public/%s = %d %s", key, a.status, a.body)
		return false
	}
}

func TestPublicLinkFromStartToRevoke(t *testing.T) {
	if testing.Short() {
		t.Skip("starts the whole program")
	}
	s := startLiveSite(t)
	sea, mountains := s.videos["mare.mp4"], s.videos["monti.mp4"]

	key := s.makeLink(s.admin, sea)
	if !s.linkWorks(key) {
		t.Fatal("a new link does not work")
	}
	// The guest sees the video, and nothing that names the rest.
	a := s.expect("", "GET", "/api/public/"+key, nil, http.StatusOK)
	if strings.Contains(string(a.body), "videoId") || strings.Contains(string(a.body), "monti") {
		t.Errorf("the guest learns too much: %s", a.body)
	}
	if b := s.do("", "GET", "/api/public/"+key+"/stream", nil); b.status != http.StatusOK ||
		string(b.body) != "not really a video: mare.mp4" {
		t.Errorf("stream = %d %q, want the file of the link", b.status, b.body)
	}
	// The key opens its video only: never by id, never another one.
	for _, path := range []string{
		fmt.Sprintf("/api/videos/%d", sea),
		fmt.Sprintf("/api/videos/%d/stream?k=%s", sea, key),
		fmt.Sprintf("/api/videos/%d/stream", mountains),
		"/api/videos?k=" + key,
		"/api/public/" + key + "/../../videos/" + fmt.Sprint(mountains),
	} {
		// A redirect goes to the cleaned address, which asks for the login.
		b := s.do("", "GET", path, nil)
		if loc := b.header.Get("Location"); b.status/100 == 3 && loc != "" {
			b = s.do("", "GET", loc, nil)
		}
		if b.status != http.StatusUnauthorized && b.status != http.StatusNotFound {
			t.Errorf("guest GET %s = %d %s", path, b.status, b.body)
		}
	}
	// Keys that are not it.
	for _, other := range []string{
		strings.ToUpper(key), strings.ToLower(key), key[:len(key)-1], key + "A",
		"AAAAAAAAAAAAAAAAAAAAAA", "%27%20OR%201%3D1%20--%20%20%20%20%20%20%20", "*", "%25",
	} {
		if other == key {
			continue
		}
		if b := s.do("", "GET", "/api/public/"+other, nil); b.status != http.StatusNotFound {
			t.Errorf("GET /api/public/%s = %d, want 404", other, b.status)
		}
	}
	// Changing the link needs a login, whatever the guest holds.
	for _, method := range []string{"GET", "POST", "DELETE"} {
		s.expect("", method, fmt.Sprintf("/api/videos/%d/public-link", sea), nil, http.StatusUnauthorized)
	}

	// A new key replaces the old one, which stops at once.
	again := s.makeLink(s.admin, sea)
	if again == key || s.linkWorks(key) || !s.linkWorks(again) {
		t.Fatalf("after making it again: old works %v, new works %v", s.linkWorks(key), s.linkWorks(again))
	}

	// Hidden by the administrator: the link stops, and comes back with it.
	hidden := fmt.Sprintf("/api/admin/videos/%d/hidden", sea)
	s.expect(s.admin, "PUT", hidden, map[string]bool{"hidden": true}, http.StatusNoContent)
	if s.linkWorks(again) {
		t.Error("the link of a hidden video still works")
	}
	s.expect(s.admin, "PUT", hidden, map[string]bool{"hidden": false}, http.StatusNoContent)
	if !s.linkWorks(again) {
		t.Error("the link did not come back with the video")
	}

	// Revoked: dead, and the video has no link any more.
	s.expect(s.admin, "DELETE", fmt.Sprintf("/api/videos/%d/public-link", sea), nil, http.StatusNoContent)
	if s.linkWorks(again) {
		t.Error("a revoked link still works")
	}
	if a := s.expect(s.admin, "GET", fmt.Sprintf("/api/videos/%d/public-link", sea), nil, http.StatusOK); !strings.Contains(string(a.body), `"link":null`) {
		t.Errorf("after revoking: %s", a.body)
	}
	s.alive()
}

func TestPublicLinksFollowThePermissionOfTheirMaker(t *testing.T) {
	if testing.Short() {
		t.Skip("starts the whole program")
	}
	s := startLiveSite(t)
	sea := s.videos["mare.mp4"]
	link := fmt.Sprintf("/api/videos/%d/public-link", sea)

	// A person without the permission cannot make one.
	if a := s.do(s.user, "POST", link, nil); a.status != http.StatusForbidden {
		t.Errorf("without the permission: %d %s", a.status, a.body)
	}
	// With it, only for their own uploads: a video of the folders is not theirs.
	user := fmt.Sprintf("/api/users/%d", s.userID)
	s.expect(s.admin, "PUT", user, map[string]any{"role": "user", "canSharePublic": true}, http.StatusOK)
	for _, method := range []string{"GET", "POST", "DELETE"} {
		if a := s.do(s.user, method, link, nil); a.status != http.StatusNotFound {
			t.Errorf("%s on a folder video: %d %s", method, a.status, a.body)
		}
	}

	// A second administrator makes a link, then stops being one: the link
	// stops with the permission.
	created := s.expect(s.admin, "POST", "/api/users",
		map[string]any{"name": "Carla", "password": "carla-password-1", "role": "admin"}, http.StatusCreated)
	var carla struct{ ID int64 }
	if err := json.Unmarshal(created.body, &carla); err != nil {
		t.Fatal(err)
	}
	key := s.makeLink(s.login("Carla", "carla-password-1"), sea)
	if !s.linkWorks(key) {
		t.Fatal("Carla's link does not work")
	}
	s.expect(s.admin, "PUT", fmt.Sprintf("/api/users/%d", carla.ID),
		map[string]any{"role": "user", "canSharePublic": false}, http.StatusOK)
	if s.linkWorks(key) {
		t.Error("the link still works after its maker lost the permission")
	}
	// Given back, the old link does not come back to life.
	s.expect(s.admin, "PUT", fmt.Sprintf("/api/users/%d", carla.ID),
		map[string]any{"role": "admin"}, http.StatusOK)
	if s.linkWorks(key) {
		t.Error("a link revoked with the permission came back")
	}
	// And a deleted maker takes their links away.
	key = s.makeLink(s.login("Carla", "carla-password-1"), sea)
	s.expect(s.admin, "DELETE", fmt.Sprintf("/api/users/%d", carla.ID), nil, http.StatusNoContent)
	if s.linkWorks(key) {
		t.Error("the link of a deleted person still works")
	}
	s.alive()
}
