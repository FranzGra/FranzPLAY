package config

import (
	"errors"
	"net/netip"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestLoadAddrAtTheLimits(t *testing.T) {
	for addr, ok := range map[string]bool{
		":0":                  true, // any free port
		":65535":              true,
		":65536":              false,
		":-1":                 false,
		"[::1]:8090":          true,
		"::1:8090":            false, // IPv6 without brackets
		"localhost":           false, // no port
		":http":               false, // names are not numbers
		"  :8090  ":           true,  // trimmed
		":08090":              true,  // leading zero, still 8090
		"0.0.0.0:8090":        true,
		":99999999999":        false,
		"127.0.0.1:":          false,
		"host:80:90":          false,
		"[fe80::1%eth0]:8090": true,
	} {
		_, err := Load(fakeEnv(map[string]string{EnvAddr: addr}))
		if (err == nil) != ok {
			t.Errorf("%s=%q: error %v, want ok %v", EnvAddr, addr, err, ok)
		}
		if err != nil && !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("%q: error %v is not ErrInvalidConfig", addr, err)
		}
	}
}

func TestTrustedProxiesAtTheLimits(t *testing.T) {
	tests := []struct {
		value string
		want  []string // nil: refused
	}{
		{"", []string{}},
		{" , ,, ", []string{}},
		{"10.0.0.5/8", []string{"10.0.0.0/8"}},
		{"::ffff:10.0.0.1", []string{"10.0.0.1/32"}},
		{"fd00::1", []string{"fd00::1/128"}},
		{"fd00::1/64", []string{"fd00::/64"}},
		{"0.0.0.0/0", []string{"0.0.0.0/0"}},
		{"10.0.0.1, 10.0.0.1", []string{"10.0.0.1/32", "10.0.0.1/32"}},
		{"10.0.0.1/33", nil},
		{"fd00::/129", nil},
		{"10.0.0.256", nil},
		{"proxy.local", nil},
		{"10.0.0.1;10.0.0.2", nil},
		{"10.0.0.1 10.0.0.2", nil},
		{"http://10.0.0.1", nil},
		{"10.0.0.1:80", nil},
	}
	for _, tt := range tests {
		cfg, err := Load(fakeEnv(map[string]string{EnvProxies: tt.value}))
		if tt.want == nil {
			if err == nil || !errors.Is(err, ErrInvalidConfig) || !strings.Contains(err.Error(), EnvProxies) {
				t.Errorf("%q: error %v, want a refusal naming %s", tt.value, err, EnvProxies)
			}
			continue
		}
		if err != nil {
			t.Errorf("%q: %v", tt.value, err)
			continue
		}
		got := []string{}
		for _, p := range cfg.TrustedProxies {
			got = append(got, p.String())
		}
		if !slices.Equal(got, tt.want) {
			t.Errorf("%q = %v, want %v", tt.value, got, tt.want)
		}
	}
}

// A proxy written as a mapped address must match the address the server
// sees, which is never mapped: otherwise the proxy would not be trusted.
func TestTrustedProxyMatchesThePlainAddress(t *testing.T) {
	cfg, err := Load(fakeEnv(map[string]string{EnvProxies: "::ffff:10.0.0.1"}))
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.TrustedProxies[0].Contains(netip.MustParseAddr("10.0.0.1")) {
		t.Errorf("%v does not contain 10.0.0.1", cfg.TrustedProxies)
	}
}

func TestSetupCodeSpellings(t *testing.T) {
	for value, want := range map[string]bool{
		"1": true, "t": true, "TRUE": true, "True": true, " true ": true, //nolint:gocritic // the spaces are the test
		"0": false, "f": false, "FALSE": false, "false": false,
	} {
		cfg, err := Load(fakeEnv(map[string]string{EnvSetupCode: value}))
		if err != nil || cfg.SetupCode != want {
			t.Errorf("%q: %v %v, want %v", value, cfg.SetupCode, err, want)
		}
	}
	for _, value := range []string{"yes", "no", "on", "off", "2", "si"} {
		if _, err := Load(fakeEnv(map[string]string{EnvSetupCode: value})); !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("%q: error %v, want a refusal", value, err)
		}
	}
}

func TestLoadRefusesTheDataFolderAsALibrary(t *testing.T) {
	data := t.TempDir()
	for _, library := range []string{data, data + string(filepath.Separator), filepath.Join(data, ".")} {
		_, err := Load(fakeEnv(map[string]string{EnvDataDir: data, EnvLibraries: library}))
		if !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("library %q equal to the data folder: error %v", library, err)
		}
	}
	// The same folder twice is an overlap too.
	videos := t.TempDir()
	list := videos + string(filepath.ListSeparator) + videos
	if _, err := Load(fakeEnv(map[string]string{EnvLibraries: list})); !errors.Is(err, ErrInvalidConfig) {
		t.Errorf("the same library twice: error %v", err)
	}
	// The content folder equal to a library is refused.
	if _, err := Load(fakeEnv(map[string]string{EnvLibraries: videos, EnvContentDir: videos})); !errors.Is(err, ErrInvalidConfig) {
		t.Errorf("content folder equal to a library: error %v", err)
	}
}

func TestTranslateURLAtTheLimits(t *testing.T) {
	for value, want := range map[string]string{
		"http://localhost:5000/":   "http://localhost:5000",
		" https://tr.example/x/  ": "https://tr.example/x", //nolint:gocritic // the spaces are the test
		"":                         "",
	} {
		cfg, err := Load(fakeEnv(map[string]string{EnvTranslate: value}))
		if err != nil || cfg.TranslateURL != want {
			t.Errorf("%q = %q %v, want %q", value, cfg.TranslateURL, err, want)
		}
	}
	for _, value := range []string{
		"localhost:5000", "ftp://x", "http://", "http://u:p@x", "http://x/?k=1", "http://x/#a", "http://%zz",
	} {
		if _, err := Load(fakeEnv(map[string]string{EnvTranslate: value})); !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("%q: error %v, want a refusal", value, err)
		}
	}
}

// The key of the translation server never appears in an error.
func TestErrorsDoNotShowTheTranslateKey(t *testing.T) {
	_, err := Load(fakeEnv(map[string]string{EnvTranslateKey: "secret-key-123", EnvAddr: "bad"}))
	if err == nil || strings.Contains(err.Error(), "secret-key-123") {
		t.Errorf("error %v", err)
	}
}
