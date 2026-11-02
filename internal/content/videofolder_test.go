package content

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

const (
	fingerprintA = "v1:000000000000000000000000a1b2c3d4"
	// It ends like the one above: the same short code, another video.
	fingerprintB = "v1:111111111111111111111111a1b2c3d4"
)

func TestFolderName(t *testing.T) {
	tests := []struct{ path, want string }{
		{"mare.mp4", "mare [a1b2c3d4]"},
		{"Viaggi/2020/Il mare d'estate.mkv", "Il mare d'estate [a1b2c3d4]"},
		{`a<b>c:d"e\f|g?h*i.mp4`, "a b c d e f g h i [a1b2c3d4]"},
		{"tab\tqui.mp4", "tab qui [a1b2c3d4]"},
		{".nascosto.mp4", "nascosto [a1b2c3d4]"},
		{"punti... .mp4", "punti [a1b2c3d4]"},
		{"CON.mp4", "_CON [a1b2c3d4]"},
		{"nul.parte.mp4", "_nul.parte [a1b2c3d4]"},
		{"Lpt1.mp4", "_Lpt1 [a1b2c3d4]"},
		{"console.mp4", "console [a1b2c3d4]"},
		{"???.mp4", "video [a1b2c3d4]"},
		{"bad\xffname.mp4", "badname [a1b2c3d4]"},
	}
	for _, tt := range tests {
		if got := FolderName(tt.path, "a1b2c3d4"); got != tt.want {
			t.Errorf("FolderName(%q) = %q, want %q", tt.path, got, tt.want)
		}
	}
}

func TestFolderNameIsCutWithoutBreakingACharacter(t *testing.T) {
	for _, char := range []string{"a", "è", "日", "😀"} {
		for extra := range 5 {
			name := FolderName(strings.Repeat("a", extra)+strings.Repeat(char, 200)+".mp4", "a1b2c3d4")
			if !utf8.ValidString(name) || len(name) > maxFolderName+len(" [a1b2c3d4]") {
				t.Errorf("%q long %d, valid %v", name, len(name), utf8.ValidString(name))
			}
			if code, ok := codeOfFolder(name); !ok || code != "a1b2c3d4" {
				t.Errorf("code of %q = %q, %v", name, code, ok)
			}
		}
	}
}

func TestCodeOfFolder(t *testing.T) {
	tests := []struct {
		name string
		code string
		ok   bool
	}{
		{"Nome [a1b2c3d4]", "a1b2c3d4", true},
		{"Nome [vecchio] [a1b2c3d4]", "a1b2c3d4", true},
		{"[a1b2c3d4]", "", false}, // what File gives a folder that is not there
		{"Nome [A1B2C3D4]", "", false},
		{"Nome [a1b2]", "", false},
		{"Nome a1b2c3d4", "", false},
		{".new-123", "", false},
	}
	for _, tt := range tests {
		if code, ok := codeOfFolder(tt.name); code != tt.code || ok != tt.ok {
			t.Errorf("codeOfFolder(%q) = %q, %v", tt.name, code, ok)
		}
	}
}

func TestACodeIsTheEndOfTheFingerprint(t *testing.T) {
	if got := codes(fingerprintA)[0]; got != "a1b2c3d4" {
		t.Errorf("code = %q", got)
	}
	// A fingerprint that is not hexadecimal still gets a code a folder can have.
	for _, fingerprint := range []string{"fp", "fp-Viaggi/lago.mkv", "v1:Z"} {
		if got := codes(fingerprint)[0]; !validCode(got) {
			t.Errorf("code of %q = %q", fingerprint, got)
		}
	}
}

func TestEnsureFolderMakesItOnce(t *testing.T) {
	r := Root(t.TempDir())
	code, created, err := r.EnsureFolder(fingerprintA, "Viaggi/mare.mp4")
	if err != nil || !created || code != "a1b2c3d4" {
		t.Fatalf("EnsureFolder = %q, %v, %v", code, created, err)
	}
	dir := filepath.Join(r.VideoFolders(), "mare [a1b2c3d4]")
	m, err := readManifest(dir)
	if err != nil || m.Fingerprint != fingerprintA || m.Version != ManifestVersion {
		t.Errorf("video.json = %+v, %v", m, err)
	}
	// A subfolder of the library makes no subfolder here.
	entries, err := os.ReadDir(r.VideoFolders())
	if err != nil || len(entries) != 1 {
		t.Errorf("video folders = %v, %v", entries, err)
	}
	again, created, err := r.EnsureFolder(fingerprintA, "Viaggi/mare.mp4")
	if err != nil || created || again != code {
		t.Errorf("again = %q, %v, %v", again, created, err)
	}
}

// Two videos whose fingerprints end the same never share a folder.
func TestTwoFingerprintsWithOneCodeAreNotMixed(t *testing.T) {
	r := Root(t.TempDir())
	first, _, err := r.EnsureFolder(fingerprintA, "mare.mp4")
	if err != nil {
		t.Fatal(err)
	}
	second, created, err := r.EnsureFolder(fingerprintB, "lago.mp4")
	if err != nil || !created {
		t.Fatalf("second folder: %v, %v", created, err)
	}
	if first == second || len(second) <= len(first) || !strings.HasSuffix(second, first) {
		t.Fatalf("codes %q and %q", first, second)
	}
	for code, file := range map[string]string{first: "mare", second: "lago"} {
		if err := r.PutBytes(code, FileCover, []byte(file)); err != nil {
			t.Fatal(err)
		}
	}
	for code, want := range map[string]string{first: "mare", second: "lago"} {
		data, err := os.ReadFile(r.FileIn(code, FileCover))
		if err != nil || string(data) != want {
			t.Errorf("cover of %s = %q, %v; want %q", code, data, err, want)
		}
	}

	// The same answers after a restart, whichever folder is read first.
	indexes.Delete(r)
	if code, ok, err := r.FolderOf(fingerprintB); err != nil || !ok || code != second {
		t.Errorf("FolderOf second = %q, %v, %v", code, ok, err)
	}
	if code, ok, err := r.FolderOf(fingerprintA); err != nil || !ok || code != first {
		t.Errorf("FolderOf first = %q, %v, %v", code, ok, err)
	}
}

// A folder that cannot say whose it is, is nobody's: it is not used and it is
// not touched.
func TestAFolderWithoutItsFileIsNotAdopted(t *testing.T) {
	for name, data := range map[string]string{"no file": "", "broken file": "{not json"} {
		t.Run(name, func(t *testing.T) {
			r := Root(t.TempDir())
			stray := filepath.Join(r.VideoFolders(), "Altro [a1b2c3d4]")
			if err := os.MkdirAll(stray, 0o750); err != nil {
				t.Fatal(err)
			}
			if data != "" {
				if err := os.WriteFile(filepath.Join(stray, FileManifest), []byte(data), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			code, created, err := r.EnsureFolder(fingerprintA, "mare.mp4")
			if err != nil || !created || code == "a1b2c3d4" {
				t.Fatalf("EnsureFolder = %q, %v, %v", code, created, err)
			}
			if err := r.PutBytes(code, FileCover, []byte("x")); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(stray, FileCover)); !errors.Is(err, fs.ErrNotExist) {
				t.Errorf("file put in the folder of someone else: %v", err)
			}
		})
	}
}

// A folder that appears while FranzPLAY runs, copied by hand, is seen before
// another one is made with its name.
func TestAFolderThatAppearsIsSeen(t *testing.T) {
	r := Root(t.TempDir())
	if _, _, err := r.EnsureFolder(fingerprintB, "altro.mp4"); err != nil {
		t.Fatal(err)
	}
	copied := filepath.Join(r.VideoFolders(), "mare [00000000a1b2c3d4]")
	if err := os.MkdirAll(copied, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := writeManifest(copied, Manifest{Version: ManifestVersion, Fingerprint: fingerprintA}); err != nil {
		t.Fatal(err)
	}
	code, created, err := r.EnsureFolder(fingerprintA, "mare.mp4")
	if err != nil || created || code != "00000000a1b2c3d4" {
		t.Errorf("EnsureFolder = %q, %v, %v", code, created, err)
	}
}

func TestFollowName(t *testing.T) {
	r := Root(t.TempDir())
	code, _, err := r.EnsureFolder(fingerprintA, "mare.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.PutBytes(code, FileCover, []byte("jpeg")); err != nil {
		t.Fatal(err)
	}
	// Another folder in the library, same file name: nothing to do.
	if renamed, err := r.FollowName(fingerprintA, "Viaggi/mare.mp4"); err != nil || renamed {
		t.Errorf("moved: renamed %v, %v", renamed, err)
	}
	renamed, err := r.FollowName(fingerprintA, "Viaggi/Il mare d'estate.mp4")
	if err != nil || !renamed {
		t.Fatalf("renamed %v, %v", renamed, err)
	}
	want := filepath.Join(r.VideoFolders(), "Il mare d'estate [a1b2c3d4]")
	if r.FileIn(code, FileCover) != filepath.Join(want, FileCover) {
		t.Errorf("cover at %q", r.FileIn(code, FileCover))
	}
	if data, err := os.ReadFile(filepath.Join(want, FileCover)); err != nil || string(data) != "jpeg" {
		t.Errorf("cover = %q, %v", data, err)
	}
	// With no folder there is nothing to rename.
	if renamed, err := r.FollowName(fingerprintB, "lago.mp4"); err != nil || renamed {
		t.Errorf("no folder: renamed %v, %v", renamed, err)
	}
}

func TestAFolderRenamedByHandIsFound(t *testing.T) {
	r := Root(t.TempDir())
	code, _, err := r.EnsureFolder(fingerprintA, "mare.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.PutBytes(code, FileCover, []byte("jpeg")); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(r.VideoFolders(), "mare [a1b2c3d4]"), filepath.Join(r.VideoFolders(), "Mio nome [a1b2c3d4]")); err != nil {
		t.Fatal(err)
	}
	r.index().readAt = r.index().readAt.Add(-2 * readAgainAfter)
	if data, err := os.ReadFile(r.FileIn(code, FileCover)); err != nil || string(data) != "jpeg" {
		t.Errorf("cover = %q, %v", data, err)
	}
}

func TestPutLeavesNoWorkFiles(t *testing.T) {
	r := Root(t.TempDir())
	code, _, err := r.EnsureFolder(fingerprintA, "mare.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.PutBytes(code, InsideSubtitleFile(2), []byte("WEBVTT")); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(r.FileIn(code, "sottotitoli/traccia-2.vtt")); err != nil || string(data) != "WEBVTT" {
		t.Errorf("subtitle = %q, %v", data, err)
	}
	if entries, err := os.ReadDir(r.Work()); err != nil || len(entries) != 0 {
		t.Errorf("work folder = %v, %v", entries, err)
	}
	if err := r.PutBytes("deadbeef", FileCover, []byte("x")); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("no such folder: %v", err)
	}
	if err := writeFile(filepath.Join(r.Work(), ".new-1"), "half"); err != nil {
		t.Fatal(err)
	}
	if err := RemoveWork(r); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(r.Work()); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("work folder still there: %v", err)
	}
}

func writeFile(name, data string) error {
	if err := os.MkdirAll(filepath.Dir(name), 0o750); err != nil {
		return err
	}
	return os.WriteFile(name, []byte(data), 0o600)
}

func TestValuesOfTheDatabase(t *testing.T) {
	r := Root(t.TempDir())
	flat := filepath.Join(string(r), "covers")
	tests := []struct {
		value, code, file, version, address, name string
		stored                                    bool
	}{
		{value: "12-a1b2c3d4.jpg", address: "/api/covers/12-a1b2c3d4.jpg", name: "12-a1b2c3d4.jpg"},
		{
			value: "12-a1b2c3d4-s30.jpg", address: "/api/covers/12-a1b2c3d4-s30.jpg", name: "12-a1b2c3d4-s30.jpg",
		},
		{
			value: "a1b2c3d4/copertina.jpg", code: "a1b2c3d4", file: FileCover, stored: true,
			address: "/api/covers/a1b2c3d4.jpg", name: "a1b2c3d4.jpg",
		},
		{
			value: "a1b2c3d4/copertina.jpg?v=s30", code: "a1b2c3d4", file: FileCover, version: "s30", stored: true,
			address: "/api/covers/a1b2c3d4.jpg?v=s30", name: "a1b2c3d4.jpg",
		},
		{
			value: "a1b2c3d4/sottotitoli/traccia-2.vtt", code: "a1b2c3d4", file: "sottotitoli/traccia-2.vtt", stored: true,
			address: "/api/covers/a1b2c3d4.jpg", name: "a1b2c3d4.jpg",
		},
	}
	for _, tt := range tests {
		if IsStored(tt.value) != tt.stored || CodeOf(tt.value) != tt.code || FileOf(tt.value) != tt.file || Version(tt.value) != tt.version {
			t.Errorf("%q: stored %v, code %q, file %q, version %q", tt.value, IsStored(tt.value), CodeOf(tt.value), FileOf(tt.value), Version(tt.value))
		}
		if got := Address("/api/covers/", tt.value, ".jpg"); got != tt.address {
			t.Errorf("Address(%q) = %q, want %q", tt.value, got, tt.address)
		}
		if got := AddressName(tt.value, ".jpg"); got != tt.name {
			t.Errorf("AddressName(%q) = %q, want %q", tt.value, got, tt.name)
		}
	}
	// A value that wants to leave its place stays in the flat folder, or finds nothing.
	for _, value := range []string{"../franzplay.db", "../../etc/passwd", "a1b2c3d4/../../franzplay.db", `..\franzplay.db`} {
		got := r.File(value, flat)
		if rel, err := filepath.Rel(string(r), got); err != nil || strings.HasPrefix(rel, "..") {
			t.Errorf("File(%q) = %q", value, got)
		}
		if IsStored(value) {
			t.Errorf("%q is taken for a file of a folder", value)
		}
	}
	if got := r.File("12-a1b2c3d4.jpg", flat); got != filepath.Join(flat, "12-a1b2c3d4.jpg") {
		t.Errorf("old value at %q", got)
	}
}

func TestSameFile(t *testing.T) {
	tests := []struct {
		a, b string
		want bool
	}{
		{"a1b2c3d4/copertina.jpg?v=s30", "a1b2c3d4/copertina.jpg", true},
		{"a1b2c3d4/copertina.jpg?v=s30", "a1b2c3d4/copertina.jpg?v=s40", true},
		{"a1b2c3d4/copertina.jpg", "ffffffff/copertina.jpg", false},
		{"a1b2c3d4/copertina.jpg", "a1b2c3d4/timeline.jpg", false},
		{"12-a.jpg", "12-a.jpg", true},
		{"12-a.jpg", "12-b.jpg", false},
		{"12-a.jpg", "a1b2c3d4/copertina.jpg", false},
		{"a1b2c3d4/copertina.jpg", "", false},
	}
	for _, tt := range tests {
		if got := SameFile(tt.a, tt.b); got != tt.want {
			t.Errorf("SameFile(%q, %q) = %v", tt.a, tt.b, got)
		}
	}
}

func TestRemoveNotKept(t *testing.T) {
	r := Root(t.TempDir())
	code, _, err := r.EnsureFolder(fingerprintA, "mare.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.PutBytes(code, FileCover, []byte("jpeg")); err != nil {
		t.Fatal(err)
	}
	flat := r.Covers()
	if err := writeFile(filepath.Join(flat, "1-old.jpg"), "old"); err != nil {
		t.Fatal(err)
	}
	cover := Stored(code, FileCover, "")
	// The same file made again in its place, under another version, stays.
	if err := r.RemoveNotKept(Stored(code, FileCover, "s30"), cover, flat); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(r.File(cover, flat)); err != nil {
		t.Errorf("the file in use went: %v", err)
	}
	if err := r.RemoveNotKept("", cover, flat); err != nil {
		t.Errorf("nothing to remove: %v", err)
	}
	if err := r.RemoveNotKept("1-old.jpg", cover, flat); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(flat, "1-old.jpg")); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("old file still there: %v", err)
	}
	if err := r.Remove("1-old.jpg", flat); err != nil {
		t.Errorf("already gone: %v", err)
	}
}
