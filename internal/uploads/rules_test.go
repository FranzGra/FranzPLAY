package uploads

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/sharing"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

func TestCheck(t *testing.T) {
	uploader := users.Account{ID: 7, CanUpload: true, UploadQuota: 1000}
	room := Space{Quota: 1000, Used: 300, Reserved: 200} // 500 free
	for name, tc := range map[string]struct {
		account users.Account
		req     newUpload
		space   Space
		waiting int
		want    newUpload
		err     error
	}{
		"fits": {
			uploader, newUpload{Name: "mare.mp4", Title: " Al mare ", Size: 500}, room, 0,
			newUpload{Name: "mare.mp4", Title: "Al mare", Size: 500}, nil,
		},
		"title from the name": {
			uploader, newUpload{Name: "Gita in montagna.MOV", Size: 1}, room, 0,
			newUpload{Name: "Gita in montagna.MOV", Title: "Gita in montagna", Size: 1}, nil,
		},
		"folders are dropped": {
			uploader, newUpload{Name: `C:\Users\giulia\Video\mare.mp4`, Size: 1}, room, 0,
			newUpload{Name: "mare.mp4", Title: "mare", Size: 1}, nil,
		},
		"not allowed": {
			users.Account{ID: 7, UploadQuota: 1000}, newUpload{Name: "mare.mp4", Size: 1}, room, 0,
			newUpload{}, errNotAllowed,
		},
		"not a video":    {uploader, newUpload{Name: "foto.jpg", Size: 1}, room, 0, newUpload{}, errNotVideo},
		"hidden file":    {uploader, newUpload{Name: "._mare.mp4", Size: 1}, room, 0, newUpload{}, errNotVideo},
		"no name":        {uploader, newUpload{Name: "", Size: 1}, room, 0, newUpload{}, errBadName},
		"long name":      {uploader, newUpload{Name: strings.Repeat("a", 252) + ".mp4", Size: 1}, room, 0, newUpload{}, errBadName},
		"name new line":  {uploader, newUpload{Name: "a\nb.mp4", Size: 1}, room, 0, newUpload{}, errBadName},
		"long title":     {uploader, newUpload{Name: "a.mp4", Title: strings.Repeat("è", 201), Size: 1}, room, 0, newUpload{}, errBadTitle},
		"title new line": {uploader, newUpload{Name: "a.mp4", Title: "a\nb", Size: 1}, room, 0, newUpload{}, errBadTitle},
		"only extension": {uploader, newUpload{Name: " .mp4", Size: 1}, room, 0, newUpload{}, errNotVideo},
		"empty file":     {uploader, newUpload{Name: "a.mp4", Size: 0}, room, 0, newUpload{}, errBadSize},
		"negative size":  {uploader, newUpload{Name: "a.mp4", Size: -5}, room, 0, newUpload{}, errBadSize},
		"too many":       {uploader, newUpload{Name: "a.mp4", Size: 1}, room, maxWaiting, newUpload{}, errTooMany},
		"no space":       {uploader, newUpload{Name: "a.mp4", Size: 501}, room, 0, newUpload{}, errNoSpace},
		"over quota": {
			uploader, newUpload{Name: "a.mp4", Size: 1}, Space{Quota: 100, Used: 200}, 0, newUpload{}, errNoSpace,
		},
		"shared with some people": {
			uploader, newUpload{Name: "a.mp4", Size: 1, Private: true, SharedWith: []int64{9, 3, 9}}, room, 0,
			newUpload{Name: "a.mp4", Title: "a", Size: 1, Private: true, SharedWith: []int64{3, 9}}, nil,
		},
		"shared with nobody": {
			uploader, newUpload{Name: "a.mp4", Size: 1, Private: true, SharedWith: []int64{}}, room, 0,
			newUpload{Name: "a.mp4", Title: "a", Size: 1, Private: true}, nil,
		},
		"shared but for everybody": {
			uploader, newUpload{Name: "a.mp4", Size: 1, SharedWith: []int64{3}}, room, 0, newUpload{}, sharing.ErrNotPrivate,
		},
		"shared with myself": {
			uploader, newUpload{Name: "a.mp4", Size: 1, Private: true, SharedWith: []int64{7}}, room, 0, newUpload{}, sharing.ErrBadPeople,
		},
	} {
		got, err := check(tc.account, tc.req, tc.space, tc.waiting)
		if !errors.Is(err, tc.err) || !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: check = %+v, %v; want %+v, %v", name, got, err, tc.want, tc.err)
		}
	}
}

func TestSpaceFree(t *testing.T) {
	for _, tc := range []struct {
		space Space
		want  int64
	}{
		{Space{Quota: 10}, 10},
		{Space{Quota: 10, Used: 3, Reserved: 4}, 3},
		// The administrator lowered the quota below what is used.
		{Space{Quota: 10, Used: 30}, 0},
	} {
		if got := tc.space.Free(); got != tc.want {
			t.Errorf("%+v free = %d, want %d", tc.space, got, tc.want)
		}
	}
}

func TestFits(t *testing.T) {
	for name, tc := range map[string]struct {
		size, received, offset, length int64
		want                           error
	}{
		"first piece":         {100, 0, 0, 40, nil},
		"next piece":          {100, 40, 40, 40, nil},
		"last piece":          {100, 80, 80, 20, nil},
		"nothing, complete":   {100, 100, 100, 0, nil},
		"sent again":          {100, 40, 0, 40, errWrongPlace},
		"skips ahead":         {100, 40, 80, 20, errWrongPlace},
		"past the end":        {100, 80, 80, 30, errBigPiece},
		"bigger than a piece": {MaxPiece * 3, 0, 0, MaxPiece + 1, errBigPiece},
		"unknown length":      {100, 0, 0, -1, errNoLength},
		"empty piece":         {100, 0, 0, 0, errNoLength},
	} {
		if got := fits(tc.size, tc.received, tc.offset, tc.length); !errors.Is(got, tc.want) {
			t.Errorf("%s: fits = %v, want %v", name, got, tc.want)
		}
	}
}

func TestDestination(t *testing.T) {
	if got := destination(7, 12, "Mare.MP4"); got != "7/12.mp4" {
		t.Errorf("destination = %q, want 7/12.mp4", got)
	}
}
