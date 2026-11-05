package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/config"
)

// The passwords of the people of a live site.
const (
	livePasswordAdmin = "admin-password-1"
	livePasswordUser  = "bruno-password-1"
)

// liveSite is a whole FranzPLAY started by run(), as people use it: an
// administrator ("Admin") and a person ("Bruno", no extra permission),
// both logged in, and one video in the folder.
type liveSite struct {
	t       *testing.T
	base    string // "http://127.0.0.1:port"
	admin   string // session cookies
	user    string
	userID  int64
	videos  map[string]int64 // id by file name
	dataDir string
	logs    *syncBuffer
	client  *http.Client
}

// answer is a response already read.
type answer struct {
	status int
	header http.Header
	body   []byte
}

// errorText is the error of an API answer, "" when it is not one.
func (a answer) errorText() string {
	var e struct{ Error string }
	if json.Unmarshal(a.body, &e) != nil {
		return ""
	}
	return e.Error
}

// startLiveSite runs FranzPLAY on a free port with its own folders. The
// programs it may call are named so that none is found: no job runs and
// nothing goes on the internet, whatever the machine has installed.
func startLiveSite(t *testing.T) *liveSite {
	t.Helper()
	videos := t.TempDir()
	for _, name := range liveVideos {
		if err := os.WriteFile(filepath.Join(videos, name), []byte("not really a video: "+name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	dataDir := filepath.Join(t.TempDir(), "dati")
	addr := freeAddr(t)
	missing := "franzplay-test-no-such-program"
	env := map[string]string{
		config.EnvAddr: addr, config.EnvDataDir: dataDir, config.EnvLibraries: videos,
		config.EnvFFmpeg: missing, config.EnvFFprobe: missing, config.EnvWhisper: missing, config.EnvTranslator: missing,
	}
	s := &liveSite{t: t, base: "http://" + addr, dataDir: dataDir, logs: &syncBuffer{},
		client: &http.Client{
			Timeout: 20 * time.Second,
			// A redirect is an answer to check, not to follow.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- run(ctx, func(k string) string { return env[k] }, s.logs) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("run() = %v", err)
			}
		// Generous: with -race on a busy machine the background work
		// (scan, manifests, backups) takes long to notice the stop.
		case <-time.After(shutdownTimeout + time.Minute):
			t.Errorf("run() did not stop; log:\n%s", s.logs.String())
		}
	})
	if err := waitForHealth(addr); err != nil {
		t.Fatalf("%v; log:\n%s", err, s.logs.String())
	}

	setup := s.do("", "POST", "/api/setup", map[string]string{"name": "Admin", "password": livePasswordAdmin})
	if setup.status != http.StatusCreated {
		t.Fatalf("setup = %d %s", setup.status, setup.body)
	}
	s.admin = sessionOf(t, setup)
	// GitHub is never asked during a test.
	s.expect(s.admin, "PUT", "/api/updates", map[string]bool{"enabled": false}, http.StatusOK)
	created := s.expect(s.admin, "POST", "/api/users",
		map[string]any{"name": "Bruno", "password": livePasswordUser, "role": "user"}, http.StatusCreated)
	var bruno struct{ ID int64 }
	if err := json.Unmarshal(created.body, &bruno); err != nil || bruno.ID == 0 {
		t.Fatalf("new user: %s %v", created.body, err)
	}
	s.userID = bruno.ID
	s.user = s.login("Bruno", livePasswordUser)
	s.waitForVideo()
	return s
}

// liveVideos are the files of the video folder of a live site.
var liveVideos = []string{"mare.mp4", "monti.mp4"}

// waitForVideo waits until the scan at start has found every video, and
// remembers their ids by file name.
func (s *liveSite) waitForVideo() {
	s.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		a := s.do(s.admin, "GET", "/api/admin/videos", nil)
		var list struct {
			Videos []struct {
				ID   int64
				Path string
			}
		}
		if a.status == http.StatusOK && json.Unmarshal(a.body, &list) == nil && len(list.Videos) == len(liveVideos) {
			s.videos = map[string]int64{}
			for _, v := range list.Videos {
				s.videos[filepath.Base(v.Path)] = v.ID
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	s.t.Fatalf("the videos of the folder were not found; log:\n%s", s.logs.String())
}

// login opens a new session and returns its cookie.
func (s *liveSite) login(name, password string) string {
	s.t.Helper()
	a := s.do("", "POST", "/api/login", map[string]string{"name": name, "password": password})
	if a.status != http.StatusOK {
		s.t.Fatalf("login %s = %d %s", name, a.status, a.body)
	}
	return sessionOf(s.t, a)
}

func sessionOf(t *testing.T, a answer) string {
	t.Helper()
	resp := http.Response{Header: a.header}
	for _, c := range resp.Cookies() {
		if c.Name == "franzplay_session" && c.Value != "" {
			return c.Value
		}
	}
	t.Fatalf("no session cookie in %v", a.header)
	return ""
}

// do sends a request with the session cookie (none when ""). body is sent
// as it is when it is a string or []byte, as JSON otherwise.
func (s *liveSite) do(cookie, method, path string, body any, header ...string) answer {
	s.t.Helper()
	var r io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		r = strings.NewReader(b)
	case []byte:
		r = bytes.NewReader(b)
	default:
		data, err := json.Marshal(b)
		if err != nil {
			s.t.Fatal(err)
		}
		r = bytes.NewReader(data)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, s.base+path, r)
	if err != nil {
		s.t.Fatalf("%s %s: %v", method, path, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(header); i += 2 {
		if strings.EqualFold(header[i], "Host") {
			req.Host = header[i+1]
			continue
		}
		req.Header.Set(header[i], header[i+1])
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: "franzplay_session", Value: cookie})
	}
	resp, err := s.client.Do(req)
	if err != nil {
		s.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close() //nolint:errcheck // read only
	out := answer{status: resp.StatusCode, header: resp.Header}
	// The event stream never ends by itself: its first answer is enough.
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		out.body, err = io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		if err != nil {
			s.t.Fatalf("%s %s: read: %v", method, path, err)
		}
	}
	return out
}

// expect is do that wants one status.
func (s *liveSite) expect(cookie, method, path string, body any, status int) answer {
	s.t.Helper()
	a := s.do(cookie, method, path, body)
	if a.status != status {
		s.t.Fatalf("%s %s = %d, want %d; body %s", method, path, a.status, status, a.body)
	}
	return a
}

// alive checks that the site still answers and wrote no panic in its log.
func (s *liveSite) alive() {
	s.t.Helper()
	if a := s.do("", "GET", "/api/health", nil); a.status != http.StatusOK {
		s.t.Fatalf("health = %d after the requests", a.status)
	}
	if strings.Contains(s.logs.String(), "panic") {
		s.t.Fatalf("a panic in the log:\n%s", s.logs.String())
	}
}
