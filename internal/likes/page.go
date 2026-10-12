package likes

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
)

// Pages of the liked videos.
const (
	defaultLimit = 24
	maxLimit     = 200
)

var errBadPage = errors.New("bad page")

// parsePage checks limit (1 to maxLimit) and offset (0 or more) of a
// request for the liked videos, once, here.
func parsePage(values url.Values) (limit, offset int, err error) {
	limit = defaultLimit
	if s := values.Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > maxLimit {
			return 0, 0, fmt.Errorf("%w: limit must be a number from 1 to %d", errBadPage, maxLimit)
		}
		limit = n
	}
	if s := values.Get("offset"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 {
			return 0, 0, fmt.Errorf("%w: offset must be a number from 0", errBadPage)
		}
		offset = n
	}
	return limit, offset, nil
}
