package translate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// fakeServer pretends to be LibreTranslate: it writes each text in upper
// case, and counts the requests.
func fakeServer(t *testing.T, requests *int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*requests++
		if r.Method != http.MethodPost || r.URL.Path != "/translate" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("request %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			Q      []string `json:"q"`
			Source string   `json:"source"`
			Target string   `json:"target"`
			Format string   `json:"format"`
			Key    string   `json:"api_key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Source != "it" || body.Target != "en" || body.Format != "text" || body.Key != "k" {
			t.Errorf("body %+v", body)
		}
		out := make([]string, len(body.Q))
		for i, q := range body.Q {
			out[i] = strings.ToUpper(q)
		}
		if err := json.NewEncoder(w).Encode(map[string]any{"translatedText": out}); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestCuesInBatches(t *testing.T) {
	var requests int
	srv := fakeServer(t, &requests)
	var cues, want []video.Cue
	for i := range 85 {
		start := time.Duration(i) * time.Second
		cues = append(cues, video.Cue{Start: start, End: start + time.Second, Text: fmt.Sprintf("riga %d", i)})
		want = append(want, video.Cue{Start: start, End: start + time.Second, Text: fmt.Sprintf("RIGA %d", i)})
	}
	got, err := New(srv.URL, "k").Cues(context.Background(), cues, "it", "en")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v", got)
	}
	if requests != 3 { // 40 + 40 + 5
		t.Errorf("requests = %d, want 3", requests)
	}
}

func TestCuesErrors(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		body    string
		refused bool
	}{
		{"bad key", http.StatusForbidden, `{"error": "Invalid API key"}`, true},
		{"unknown language", http.StatusBadRequest, `{"error": "xx is not supported"}`, true},
		{"busy", http.StatusTooManyRequests, `{"error": "Slowdown"}`, false},
		{"broken", http.StatusInternalServerError, `oops`, false},
		{"too few texts", http.StatusOK, `{"translatedText": []}`, false},
		{"not json", http.StatusOK, `<html>`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				if _, err := w.Write([]byte(tt.body)); err != nil {
					t.Error(err)
				}
			}))
			defer srv.Close()
			_, err := New(srv.URL, "").Cues(context.Background(), []video.Cue{{Text: "ciao"}}, "it", "en")
			if err == nil {
				t.Fatal("no error")
			}
			if errors.Is(err, ErrRefused) != tt.refused {
				t.Errorf("err = %v, refused should be %v", err, tt.refused)
			}
		})
	}
}

func TestCuesNoServer(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	srv.Close()
	if _, err := New(srv.URL, "").Cues(context.Background(), []video.Cue{{Text: "ciao"}}, "it", "en"); err == nil || errors.Is(err, ErrRefused) {
		t.Errorf("err = %v, want a failure worth trying again", err)
	}
}

func TestLanguages(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/languages" {
			http.NotFound(w, r)
			return
		}
		if _, err := w.Write([]byte(`[{"code":"en","name":"English","targets":["it"]},{"code":"it","name":"Italian","targets":["en"]}]`)); err != nil {
			t.Error(err)
		}
	}))
	defer srv.Close()
	got, err := New(srv.URL, "").Languages(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"en", "it"}) {
		t.Errorf("got %v", got)
	}
}
