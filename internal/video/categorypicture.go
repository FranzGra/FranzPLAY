package video

import (
	"path"
	"slices"
	"strings"
)

// A picture in the folder of a category, with one of these names, is the
// picture of the category instead of a plain colored card, as in Jellyfin
// and Kodi. A category may have two: a tall one (poster) and a wide one
// (landscape). Which is which is said by the picture itself, tall or wide;
// the name only says which one wins when there are more. It is only read
// (rule 1).

// posterNames are the names meant for the tall picture, best first.
var posterNames = []string{"poster", "cover", "folder", "categoria", "category", "copertina"}

// landscapeNames are the names meant for the wide picture, best first.
var landscapeNames = []string{"landscape", "backdrop", "fanart", "thumb", "sfondo", "background"}

// IsCategoryPicture reports whether a file, in the folder of a category,
// is a picture of the category: "poster.jpg", "Fanart.PNG" and so on.
func IsCategoryPicture(name string) bool {
	_, ok := categoryPictureName(name)
	return ok
}

// categoryPictureName is the name of a picture without its extension, in
// lower case, if it is one of the names of a category picture.
func categoryPictureName(name string) (string, bool) {
	if !IsImage(name) {
		return "", false
	}
	base := strings.ToLower(strings.TrimSuffix(name, path.Ext(name)))
	if slices.Contains(posterNames, base) || slices.Contains(landscapeNames, base) {
		return base, true
	}
	return "", false
}

// CategoryPicture is a picture of a category, with its size in pixels.
type CategoryPicture struct {
	Name   string // the file name alone, like "poster.jpg"
	Width  int
	Height int
}

// Wide reports whether the picture is wider than tall.
func (p CategoryPicture) Wide() bool { return p.Width > p.Height }

// PickCategoryPictures picks, among the pictures of a category's folder,
// the tall one (poster) and the wide one (landscape). A picture goes
// where its shape says, whatever its name: a wide "poster.jpg" is a wide
// picture. Among pictures of the same shape, the name meant for that
// shape wins (fanart.jpg over a wide poster.jpg), then the order of the
// names, then the order given. ok is false where there is none.
func PickCategoryPictures(pictures []CategoryPicture) (poster, landscape CategoryPicture, hasPoster, hasLandscape bool) {
	bestPoster, bestLandscape := -1, -1
	for _, p := range pictures {
		base, ok := categoryPictureName(p.Name)
		if !ok || p.Width <= 0 || p.Height <= 0 {
			continue
		}
		if p.Wide() {
			if r := rank(base, landscapeNames, posterNames); !hasLandscape || r < bestLandscape {
				landscape, bestLandscape, hasLandscape = p, r, true
			}
		} else {
			if r := rank(base, posterNames, landscapeNames); !hasPoster || r < bestPoster {
				poster, bestPoster, hasPoster = p, r, true
			}
		}
	}
	return poster, landscape, hasPoster, hasLandscape
}

// rank is the place of a name: first the names meant for the shape, then
// the others.
func rank(base string, meant, others []string) int {
	if i := slices.Index(meant, base); i >= 0 {
		return i
	}
	return len(meant) + slices.Index(others, base)
}
