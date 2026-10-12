package oldimport

import (
	"reflect"
	"testing"
)

func TestMatchVideos(t *testing.T) {
	current := []newVideo{
		{1, "Vacanze/Mare 2019.mp4"},
		{2, "Altro/Mare 2019.mp4"},
		{3, "Film/Roma.mp4"},
		{4, "Serie/Film/Roma.mp4"},
		{5, "Tom & Jerry #2.mp4"},
		{6, "Uno/clip.mp4"},
		{7, "Due/clip.mp4"},
	}
	old := []oldVideo{
		{id: 10, path: "Vacanze/Mare 2019.mp4"},      // same path: the most parts in common
		{id: 11, path: "Tom & Jerry #2.mp4"},         // signs in the name are fine
		{id: 12, path: "Casa/Vacanze/Mare 2019.mp4"}, // the new folder is below the old one
		{id: 13, path: "Film/Roma.mp4"},              // two new videos share "Film/Roma.mp4"
		{id: 14, path: "Tre/clip.mp4"},               // only the name fits, twice
		{id: 15, path: "Sparito.mp4"},                // not there
		{id: 16, path: "/Vacanze//Mare 2019.mp4"},    // odd slashes
		{id: 17, path: ""},
	}
	m := matchVideos(old, current)
	if want := map[int64]int64{10: 1, 11: 5, 12: 1, 16: 1}; !reflect.DeepEqual(m.byOld, want) {
		t.Errorf("matches = %v, want %v", m.byOld, want)
	}
	ids := func(vs []oldVideo) []int64 {
		var out []int64
		for _, v := range vs {
			out = append(out, v.id)
		}
		return out
	}
	if got := ids(m.ambiguous); !reflect.DeepEqual(got, []int64{13, 14}) {
		t.Errorf("ambiguous = %v", got)
	}
	if got := ids(m.missing); !reflect.DeepEqual(got, []int64{15, 17}) {
		t.Errorf("missing = %v", got)
	}
}

// The new folder can also be a folder inside the old one: then the new
// paths are shorter, and the file name with its folders still decides.
func TestMatchVideosFromASmallerFolder(t *testing.T) {
	m := matchVideos([]oldVideo{{id: 1, path: "Vacanze/2019/Mare.mp4"}}, []newVideo{{9, "2019/Mare.mp4"}})
	if m.byOld[1] != 9 {
		t.Errorf("matches = %v", m.byOld)
	}
}
