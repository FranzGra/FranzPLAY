// Package comments lets people write under a video and answer each
// other, one level deep like on YouTube.
package comments

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// maxLen is the longest comment, in characters: enough for a few
// paragraphs, too little to paste a whole book.
const maxLen = 2000

var errBadBody = fmt.Errorf("a comment must have from 1 to %d characters", maxLen)

// cleanBody controls the text of a new comment, once, when it arrives:
// spaces at the start and end go away, Windows line ends become "\n",
// more than one empty line in a row becomes one, and invisible control
// characters are dropped. An empty or too long comment is refused.
func cleanBody(body string) (string, error) {
	if !utf8.ValidString(body) {
		return "", errBadBody
	}
	body = strings.ReplaceAll(body, "\r\n", "\n")
	body = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || !unicode.IsControl(r) {
			return r
		}
		return -1
	}, body)
	lines := strings.Split(body, "\n")
	kept := make([]string, 0, len(lines))
	empty := 0
	for _, l := range lines {
		l = strings.TrimRightFunc(l, unicode.IsSpace)
		if l == "" {
			empty++
			if empty > 1 {
				continue
			}
		} else {
			empty = 0
		}
		kept = append(kept, l)
	}
	body = strings.TrimSpace(strings.Join(kept, "\n"))
	if n := utf8.RuneCountInString(body); n == 0 || n > maxLen {
		return "", errBadBody
	}
	return body, nil
}

// errNotYours means someone tried to delete a comment of another person.
var errNotYours = errors.New("only the author or an administrator can delete a comment")

// canDelete decides who may delete a comment: who wrote it, or an
// administrator.
func canDelete(userID int64, admin bool, authorID int64) bool {
	return admin || userID == authorID
}

// Comment is a comment as the interface shows it.
type Comment struct {
	ID        int64     `json:"id"`
	Author    Author    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	CanDelete bool      `json:"canDelete"` // the person looking may delete it
	Replies   []Comment `json:"replies"`   // oldest first; always empty in a reply
}

// Author is who wrote a comment.
type Author struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Avatar int64  `json:"avatar"` // version of their profile photo, 0 = none
}

// viewer is the person looking at the comments.
type viewer struct {
	id    int64
	admin bool
}

func (v viewer) comment(r row) Comment {
	return Comment{
		ID:        r.id,
		Author:    Author{ID: r.userID, Name: r.author, Avatar: r.avatar},
		Body:      r.body,
		CreatedAt: r.createdAt,
		CanDelete: canDelete(v.id, v.admin, r.userID),
		Replies:   []Comment{},
	}
}

// thread arranges the comments of a video (oldest first) as they are
// shown: the newest conversations on top, each with its replies in the
// order they were written.
func thread(rows []row, v viewer) []Comment {
	top := []Comment{}
	index := map[int64]int{}
	for _, r := range rows {
		if r.parentID == 0 {
			index[r.id] = len(top)
			top = append(top, v.comment(r))
		}
	}
	for _, r := range rows {
		if i, ok := index[r.parentID]; ok && r.parentID != 0 {
			top[i].Replies = append(top[i].Replies, v.comment(r))
		}
	}
	slices.Reverse(top)
	return top
}

// replyTarget decides which comment a reply goes under: replying to a
// reply joins the same conversation, as on YouTube. It refuses a parent
// of another video.
func replyTarget(parent row, videoID int64) (int64, error) {
	if parent.videoID != videoID {
		return 0, errCommentNotFound
	}
	if parent.parentID != 0 {
		return parent.parentID, nil
	}
	return parent.id, nil
}
