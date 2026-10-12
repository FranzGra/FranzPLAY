package config

import (
	"errors"
	"path/filepath"
	"testing"
)

// fakeEnv returns a getenv function that reads from a map.
func fakeEnv(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(fakeEnv(nil))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Addr != DefaultAddr {
		t.Errorf("Addr = %q, want %q", cfg.Addr, DefaultAddr)
	}
	if cfg.DataDir != DefaultDataDir {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, DefaultDataDir)
	}
	if cfg.FFprobe != DefaultFFprobe || cfg.FFmpeg != DefaultFFmpeg {
		t.Errorf("FFprobe, FFmpeg = %q, %q; want the defaults", cfg.FFprobe, cfg.FFmpeg)
	}
}

func TestLoadFromEnv(t *testing.T) {
	cfg, err := Load(fakeEnv(map[string]string{
		EnvAddr:    " 127.0.0.1:9000 ",
		EnvDataDir: "/srv/franzplay//dati/",
		EnvFFprobe: " /opt/ffmpeg/bin/ffprobe ",
		EnvFFmpeg:  "/opt/ffmpeg/bin/ffmpeg",
	}))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Addr != "127.0.0.1:9000" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, "127.0.0.1:9000")
	}
	if cfg.FFprobe != "/opt/ffmpeg/bin/ffprobe" || cfg.FFmpeg != "/opt/ffmpeg/bin/ffmpeg" {
		t.Errorf("FFprobe, FFmpeg = %q, %q", cfg.FFprobe, cfg.FFmpeg)
	}
	if want := filepath.Clean("/srv/franzplay/dati"); cfg.DataDir != want {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, want)
	}
}

func TestLoadRejectsBadAddr(t *testing.T) {
	for _, addr := range []string{"8090", "localhost", ":abc", ":70000", ":-1"} {
		t.Run(addr, func(t *testing.T) {
			_, err := Load(fakeEnv(map[string]string{EnvAddr: addr}))
			if !errors.Is(err, ErrInvalidConfig) {
				t.Errorf("Load() with %s=%q error = %v, want ErrInvalidConfig", EnvAddr, addr, err)
			}
		})
	}
}

func TestLoadLibraries(t *testing.T) {
	root := t.TempDir()
	movies := filepath.Join(root, "videos", "movies")
	family := filepath.Join(root, "family")
	list := " " + movies + string(filepath.ListSeparator) + string(filepath.ListSeparator) + family + "/ "

	cfg, err := Load(fakeEnv(map[string]string{
		EnvLibraries: list,
		EnvDataDir:   filepath.Join(root, "franzplay-data"),
	}))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	want := []string{movies, family}
	if len(cfg.Libraries) != len(want) {
		t.Fatalf("Libraries = %q, want %q", cfg.Libraries, want)
	}
	for i := range want {
		if cfg.Libraries[i] != want[i] {
			t.Errorf("Libraries[%d] = %q, want %q", i, cfg.Libraries[i], want[i])
		}
	}
}

func TestLoadLibrariesMakesPathsAbsolute(t *testing.T) {
	cfg, err := Load(fakeEnv(map[string]string{EnvLibraries: "videos"}))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if len(cfg.Libraries) != 1 || !filepath.IsAbs(cfg.Libraries[0]) {
		t.Errorf("Libraries = %q, want one absolute path", cfg.Libraries)
	}
}

func TestLoadNoLibraries(t *testing.T) {
	cfg, err := Load(fakeEnv(nil))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if len(cfg.Libraries) != 0 {
		t.Errorf("Libraries = %q, want none", cfg.Libraries)
	}
}

func TestLoadRejectsOverlappingFolders(t *testing.T) {
	root := t.TempDir()
	videos := filepath.Join(root, "videos")
	data := filepath.Join(root, "data")
	sep := string(filepath.ListSeparator)
	tests := []struct {
		name      string
		libraries string
		dataDir   string
	}{
		{"data folder inside a library", videos, filepath.Join(videos, "franzplay")},
		{"library inside the data folder", filepath.Join(data, "videos"), data},
		{"library is the data folder", data, data},
		{"library inside another", videos + sep + filepath.Join(videos, "trips"), data},
		{"same library twice", videos + sep + videos, data},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Load(fakeEnv(map[string]string{EnvLibraries: tt.libraries, EnvDataDir: tt.dataDir}))
			if !errors.Is(err, ErrInvalidConfig) {
				t.Errorf("Load() error = %v, want ErrInvalidConfig", err)
			}
		})
	}
}

func TestLoadAcceptsSiblingFoldersWithSimilarNames(t *testing.T) {
	root := t.TempDir()
	// "videos-data" starts with "videos" but is not inside it.
	_, err := Load(fakeEnv(map[string]string{
		EnvLibraries: filepath.Join(root, "videos"),
		EnvDataDir:   filepath.Join(root, "videos-data"),
	}))
	if err != nil {
		t.Errorf("Load() unexpected error: %v", err)
	}
}

func TestLoadWhisperAndTranslate(t *testing.T) {
	cfg, err := Load(fakeEnv(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Whisper != DefaultWhisper || cfg.TranslateURL != "" || cfg.TranslateKey != "" {
		t.Errorf("defaults = %q, %q, %q", cfg.Whisper, cfg.TranslateURL, cfg.TranslateKey)
	}
	cfg, err = Load(fakeEnv(map[string]string{
		EnvWhisper:      " /opt/whisper/whisper-cli ",
		EnvTranslate:    " http://192.168.1.5:5000/ ",
		EnvTranslateKey: " secret ",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Whisper != "/opt/whisper/whisper-cli" || cfg.TranslateURL != "http://192.168.1.5:5000" || cfg.TranslateKey != "secret" {
		t.Errorf("got %q, %q, %q", cfg.Whisper, cfg.TranslateURL, cfg.TranslateKey)
	}
}

func TestLoadRejectsBadTranslateURL(t *testing.T) {
	for _, value := range []string{"localhost:5000", "ftp://host", "http://", "http://user:pw@host", "http://host/?a=1", "::"} {
		t.Run(value, func(t *testing.T) {
			_, err := Load(fakeEnv(map[string]string{EnvTranslate: value}))
			if !errors.Is(err, ErrInvalidConfig) {
				t.Errorf("Load() with %s=%q error = %v, want ErrInvalidConfig", EnvTranslate, value, err)
			}
		})
	}
}
