package sharing

import (
	"errors"
	"slices"
	"testing"
)

func TestClean(t *testing.T) {
	many := make([]int64, MaxPeople+1)
	for i := range many {
		many[i] = int64(i + 2)
	}
	for name, tc := range map[string]struct {
		ids  []int64
		want []int64
		err  error
	}{
		"nobody":          {nil, []int64{}, nil},
		"sorted, once":    {[]int64{5, 3, 5}, []int64{3, 5}, nil},
		"as many as can":  {many[:MaxPeople], many[:MaxPeople], nil},
		"too many":        {many, nil, ErrBadPeople},
		"the owner":       {[]int64{3, 1}, nil, ErrBadPeople},
		"not a person":    {[]int64{0}, nil, ErrBadPeople},
		"a negative id":   {[]int64{-4}, nil, ErrBadPeople},
		"too many, twice": {append(slices.Clone(many[:MaxPeople]), many[:MaxPeople]...), many[:MaxPeople], nil},
	} {
		got, err := Clean(tc.ids, 1)
		if !errors.Is(err, tc.err) || !slices.Equal(got, tc.want) {
			t.Errorf("%s: Clean = %v, %v; want %v, %v", name, got, err, tc.want, tc.err)
		}
	}
}

func TestAudienceOf(t *testing.T) {
	for _, tc := range []struct {
		private, shared, link bool
		want                  string
	}{
		{false, false, false, ForEveryone},
		{false, true, true, ForEveryone}, // public wins over anything left behind
		{true, false, false, ForMe},
		{true, true, false, ForPeople},
		{true, false, true, ForLink},
	} {
		if got := AudienceOf(tc.private, tc.shared, tc.link); got != tc.want {
			t.Errorf("AudienceOf(%v, %v, %v) = %q, want %q", tc.private, tc.shared, tc.link, got, tc.want)
		}
	}
}

func TestLinkKeys(t *testing.T) {
	seen := map[string]bool{}
	for range 100 {
		key, err := NewKey()
		if err != nil {
			t.Fatal(err)
		}
		if !ValidKey(key) || seen[key] {
			t.Fatalf("key %q: valid %v, seen before %v", key, ValidKey(key), seen[key])
		}
		seen[key] = true
	}
	for _, bad := range []string{"", "abc", "abcdefghijklmnopqrstu/", "abcdefghijklmnopqrstuvw", "abcdefghijklmnopqrstù"} {
		if ValidKey(bad) {
			t.Errorf("ValidKey(%q) = true", bad)
		}
	}
	if got := VideoLink(12, "k"); got != "/video/12?k=k" {
		t.Errorf("VideoLink = %q", got)
	}
}
