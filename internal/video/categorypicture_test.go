package video

import "testing"

func TestIsCategoryPicture(t *testing.T) {
	for name, want := range map[string]bool{
		"poster.jpg": true, "Poster.JPG": true, "cover.png": true, "folder.jpg": true,
		"categoria.webp": true, "fanart.jpg": true, "backdrop.jpeg": true, "landscape.png": true,
		"thumb.jpg": true, "sfondo.jpg": true,
		"mare.jpg": false, "poster.gif": false, "._poster.jpg": false, "poster": false,
		"mare-poster.jpg": false, "poster.mp4": false,
	} {
		if got := IsCategoryPicture(name); got != want {
			t.Errorf("IsCategoryPicture(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestPickCategoryPictures(t *testing.T) {
	tall := func(name string) CategoryPicture { return CategoryPicture{Name: name, Width: 600, Height: 900} }
	wide := func(name string) CategoryPicture { return CategoryPicture{Name: name, Width: 1280, Height: 720} }
	tests := []struct {
		name          string
		pictures      []CategoryPicture
		wantPoster    string
		wantLandscape string
	}{
		{"none", nil, "", ""},
		{"a poster", []CategoryPicture{tall("poster.jpg")}, "poster.jpg", ""},
		{"a fanart", []CategoryPicture{wide("fanart.jpg")}, "", "fanart.jpg"},
		{"both", []CategoryPicture{wide("fanart.jpg"), tall("poster.jpg")}, "poster.jpg", "fanart.jpg"},
		// The shape decides, not the name.
		{"a wide poster", []CategoryPicture{wide("poster.jpg")}, "", "poster.jpg"},
		{"a tall backdrop", []CategoryPicture{tall("backdrop.jpg")}, "backdrop.jpg", ""},
		{"a square one is tall", []CategoryPicture{{Name: "cover.jpg", Width: 500, Height: 500}}, "cover.jpg", ""},
		// The name meant for the shape wins, then the order of the names.
		{"fanart beats a wide poster", []CategoryPicture{wide("poster.jpg"), wide("fanart.jpg")}, "", "fanart.jpg"},
		{"poster beats folder", []CategoryPicture{tall("folder.jpg"), tall("poster.png")}, "poster.png", ""},
		{"landscape beats backdrop", []CategoryPicture{wide("backdrop.jpg"), wide("landscape.jpg")}, "", "landscape.jpg"},
		{"same name: the first", []CategoryPicture{tall("poster.jpg"), tall("Poster.png")}, "poster.jpg", ""},
		{"not a category picture", []CategoryPicture{tall("mare.jpg")}, "", ""},
		{"size unknown", []CategoryPicture{{Name: "poster.jpg"}}, "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			poster, landscape, hasPoster, hasLandscape := PickCategoryPictures(tt.pictures)
			if poster.Name != tt.wantPoster || hasPoster != (tt.wantPoster != "") {
				t.Errorf("poster = %q, %v; want %q", poster.Name, hasPoster, tt.wantPoster)
			}
			if landscape.Name != tt.wantLandscape || hasLandscape != (tt.wantLandscape != "") {
				t.Errorf("landscape = %q, %v; want %q", landscape.Name, hasLandscape, tt.wantLandscape)
			}
		})
	}
}
