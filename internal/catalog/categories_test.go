package catalog

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"testing"
)

func TestCleanColor(t *testing.T) {
	tests := []struct {
		in, want string
		ok       bool
	}{
		{"", "", true},
		{" #2997FF ", "#2997ff", true},
		{"#abc", "", false},
		{"red", "", false},
		{"#2997ff; background: url(x)", "", false},
	}
	for _, tt := range tests {
		got, err := cleanColor(tt.in)
		if got != tt.want || (err == nil) != tt.ok {
			t.Errorf("cleanColor(%q) = %q, %v", tt.in, got, err)
		}
	}
}

// categoryAddress is the administrator's address of a category.
func categoryAddress(name string) string {
	return "/api/admin/categories/" + url.PathEscape(name)
}

func (s *adminSite) putCategoryImage(t *testing.T, name string, data []byte, want int) {
	t.Helper()
	rec := httptest.NewRecorder()
	s.admin.ServeHTTP(rec, httptest.NewRequest("PUT", categoryAddress(name)+"/image", bytes.NewReader(data)))
	if rec.Code != want {
		t.Fatalf("PUT image of %q = %d, want %d; body %s", name, rec.Code, want, rec.Body)
	}
}

func (s *adminSite) categoryImages(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(s.dataDir, CategoryImagesDir))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestAdministratorRenamesAndColorsACategory(t *testing.T) {
	s := newAdminSite(t)
	mare := s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	s.addVideo(t, "Vacanze 2024/monti.mp4", "mountains", "Vacanze 2024", 200, true)
	s.addVideo(t, "Corsi/go.mp4", "go", "Corsi", 300, true)

	s.do(t, "PUT", categoryAddress("Viaggi"), `{"label": "Vacanze", "color": "#E11D48"}`, http.StatusNoContent)
	if s.changed != 1 {
		t.Errorf("pages told %d times, want 1", s.changed)
	}
	got := decode[[]Category](t, s.get(t, "/api/categories"))
	want := []Category{{Name: "Corsi", Videos: 1}, {Name: "Vacanze", Videos: 1, Color: "#e11d48"},
		{Name: "Vacanze 2024", Videos: 1}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("categories = %+v, want %+v", got, want)
	}
	// Videos show the new name, and the category's page finds them by it.
	v := decode[Video](t, s.get(t, "/api/videos/"+strconv.FormatInt(mare, 10)))
	if v.Category != "Vacanze" {
		t.Errorf("video category = %q, want Vacanze", v.Category)
	}
	list := decode[listResponse](t, s.get(t, "/api/videos?category=Vacanze"))
	if list.Total != 1 || list.Videos[0].ID != mare {
		t.Errorf("videos of Vacanze = %+v", list)
	}
	if list := decode[listResponse](t, s.get(t, "/api/videos?q=vacanze")); list.Total != 2 {
		t.Errorf("search for vacanze found %d videos, want 2", list.Total)
	}

	// The same name for two categories: they show as one.
	s.do(t, "PUT", categoryAddress("Vacanze 2024"), `{"label": "Vacanze"}`, http.StatusNoContent)
	got = decode[[]Category](t, s.get(t, "/api/categories"))
	if len(got) != 2 || got[1].Name != "Vacanze" || got[1].Videos != 2 {
		t.Errorf("merged categories = %+v", got)
	}

	// The administrator still sees each one as the videos have it.
	admin := decode[[]AdminCategory](t, s.do(t, "GET", "/api/admin/categories", "", http.StatusOK))
	if len(admin) != 3 || admin[2].Name != "Viaggi" || admin[2].Label != "Vacanze" || admin[2].Color != "#e11d48" {
		t.Errorf("admin categories = %+v", admin)
	}

	// Back to its own name, without a color.
	s.do(t, "PUT", categoryAddress("Viaggi"), `{"label": "", "color": ""}`, http.StatusNoContent)
	if v := decode[Video](t, s.get(t, "/api/videos/"+strconv.FormatInt(mare, 10))); v.Category != "Viaggi" {
		t.Errorf("video category = %q, want Viaggi again", v.Category)
	}
}

func TestCategoryImage(t *testing.T) {
	s := newAdminSite(t)
	s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	libraryBefore := listFiles(t, s.library)

	s.putCategoryImage(t, "Viaggi", jpegImage, http.StatusNoContent)
	first := s.categoryImages(t)
	got := decode[[]Category](t, s.get(t, "/api/categories"))
	if len(first) != 1 || got[0].Image == nil || *got[0].Image != "/api/category-images/"+first[0] {
		t.Fatalf("images %q, categories %+v", first, got)
	}
	// Served like the covers.
	rec := s.get(t, *got[0].Image)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Errorf("image answered %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}

	// A new image replaces the old one.
	s.putCategoryImage(t, "Viaggi", jpegImage, http.StatusNoContent)
	if second := s.categoryImages(t); len(second) != 1 || second[0] == first[0] {
		t.Errorf("images after the second upload = %q, first %q", second, first)
	}
	s.do(t, "DELETE", categoryAddress("Viaggi")+"/image", "", http.StatusNoContent)
	if files := s.categoryImages(t); len(files) != 0 {
		t.Errorf("images after removing = %q", files)
	}
	if got := decode[[]Category](t, s.get(t, "/api/categories")); got[0].Image != nil {
		t.Errorf("category still has an image: %+v", got[0])
	}
	if after := listFiles(t, s.library); !slices.Equal(after, libraryBefore) {
		t.Errorf("video folder changed: %q, before %q", after, libraryBefore)
	}
}

func TestCategoryRefusals(t *testing.T) {
	s := newAdminSite(t)
	s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)

	s.do(t, "PUT", categoryAddress("Nessuna"), `{"label": "X"}`, http.StatusNotFound)
	s.do(t, "PUT", categoryAddress("Viaggi"), `{"color": "red"}`, http.StatusBadRequest)
	s.do(t, "PUT", categoryAddress("Viaggi"), `{"label": "a\nb"}`, http.StatusBadRequest)
	s.do(t, "PUT", categoryAddress("Viaggi"), `{"label": "X", "image": "x"}`, http.StatusBadRequest)
	s.putCategoryImage(t, "Viaggi", pngImage, http.StatusUnsupportedMediaType)
	s.putCategoryImage(t, "Viaggi", append(slices.Clone(jpegImage), make([]byte, maxCategoryImage)...),
		http.StatusRequestEntityTooLarge)
	s.putCategoryImage(t, "Nessuna", jpegImage, http.StatusNotFound)
	if files := s.categoryImages(t); len(files) != 0 {
		t.Errorf("refused images were kept: %q", files)
	}

	s.who.Role = "user"
	s.do(t, "GET", "/api/admin/categories", "", http.StatusForbidden)
	s.do(t, "PUT", categoryAddress("Viaggi"), `{"label": "X"}`, http.StatusForbidden)
	s.putCategoryImage(t, "Viaggi", jpegImage, http.StatusForbidden)
}

func TestRemoveOrphanCategoryImages(t *testing.T) {
	s := newAdminSite(t)
	s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	s.putCategoryImage(t, "Viaggi", jpegImage, http.StatusNoContent)
	kept := s.categoryImages(t)
	dir := filepath.Join(s.dataDir, CategoryImagesDir)
	for _, name := range []string{"1-old.jpg", ".new-123"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	n, err := RemoveOrphanCategoryImages(context.Background(), s.db, s.dataDir)
	if err != nil || n != 2 {
		t.Fatalf("removed %d, %v; want 2", n, err)
	}
	if files := s.categoryImages(t); !slices.Equal(files, kept) {
		t.Errorf("images = %q, want %q", files, kept)
	}
}

func TestCategoryWithASlashInItsName(t *testing.T) {
	s := newAdminSite(t)
	id := s.addVideo(t, "mare.mp4", "sea", "", 100, true)
	if _, err := s.db.Exec(`UPDATE videos SET admin_category = 'Estate 2024/25' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	s.do(t, "PUT", categoryAddress("Estate 2024/25"), `{"label": "Estate"}`, http.StatusNoContent)
	if got := decode[[]Category](t, s.get(t, "/api/categories")); len(got) != 1 || got[0].Name != "Estate" {
		t.Errorf("categories = %+v", got)
	}
}
