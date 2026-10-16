package users

import (
	"context"
	"errors"
	"fmt"
	"slices"
)

// SkipChoices are how far, in seconds, a person may choose to have the
// player jump forward or back. DefaultSkip is the one everybody starts with.
var SkipChoices = []int{5, 10, 15, 20, 30}

// DefaultSkip is the jump of a person who never chose one.
const DefaultSkip = 15

// errBadSkip means a jump is not one of SkipChoices.
var errBadSkip = errors.New("the jump must be 5, 10, 15, 20 or 30 seconds")

// setSkipSeconds changes how far the player jumps for a user.
func (s *Service) setSkipSeconds(ctx context.Context, a Account, seconds int) (Account, error) {
	if !slices.Contains(SkipChoices, seconds) {
		return Account{}, errBadSkip
	}
	res, err := s.store.db.ExecContext(ctx, `UPDATE users SET skip_seconds = ? WHERE id = ?`, seconds, a.ID)
	if err != nil {
		return Account{}, fmt.Errorf("set skip seconds: %w", err)
	}
	if err := oneRow(res, "set skip seconds"); err != nil {
		return Account{}, err
	}
	a.SkipSeconds = seconds
	return a, nil
}
