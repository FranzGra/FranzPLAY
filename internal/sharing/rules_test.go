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
