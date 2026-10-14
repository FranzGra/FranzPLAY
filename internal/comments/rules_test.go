package comments

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestCleanBody(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"Bellissimo!", "Bellissimo!"},
		{"  ciao  \n", "ciao"},
		{"riga 1\r\nriga 2", "riga 1\nriga 2"},
		{"uno\n\n\n\ndue", "uno\n\ndue"},
		{"uno   \n  due", "uno\n  due"},
		{"a\x00b\x1bc", "abc"},
		{"tab\tok", "tab\tok"},
		{strings.Repeat("è", maxLen), strings.Repeat("è", maxLen)},
	}
	for _, tt := range tests {
		got, err := cleanBody(tt.in)
		if err != nil || got != tt.want {
			t.Errorf("cleanBody(%q) = %q, %v; want %q", tt.in, got, err, tt.want)
		}
	}
}

func TestCleanBodyRefuses(t *testing.T) {
	for _, in := range []string{"", "   ", "\n\n\t", "\x00\x01", strings.Repeat("a", maxLen+1), "\xff\xfe"} {
		if _, err := cleanBody(in); !errors.Is(err, errBadBody) {
			t.Errorf("cleanBody(%q): error = %v, want errBadBody", in, err)
		}
	}
}

func TestCanDelete(t *testing.T) {
	tests := []struct {
		user   int64
		admin  bool
		author int64
		want   bool
	}{
		{1, false, 1, true},
		{2, false, 1, false},
		{2, true, 1, true},
	}
	for _, tt := range tests {
		if got := canDelete(tt.user, tt.admin, tt.author); got != tt.want {
			t.Errorf("canDelete(%d, %v, %d) = %v, want %v", tt.user, tt.admin, tt.author, got, tt.want)
		}
	}
}

func TestThread(t *testing.T) {
	at := func(m int) time.Time { return time.Unix(int64(m)*60, 0).UTC() }
	rows := []row{
		{id: 1, userID: 1, author: "Giulia", body: "primo", createdAt: at(1)},
		{id: 2, userID: 2, author: "Marco", body: "secondo", createdAt: at(2)},
		{id: 3, userID: 2, parentID: 1, author: "Marco", body: "risposta a primo", createdAt: at(3)},
		{id: 4, userID: 1, parentID: 1, author: "Giulia", body: "grazie", createdAt: at(4)},
	}
	got := thread(rows, viewer{id: 2})
	if len(got) != 2 || got[0].ID != 2 || got[1].ID != 1 {
		t.Fatalf("conversations = %+v, want 2 then 1", got)
	}
	if len(got[0].Replies) != 0 || len(got[1].Replies) != 2 ||
		got[1].Replies[0].ID != 3 || got[1].Replies[1].ID != 4 {
		t.Errorf("replies = %+v", got[1].Replies)
	}
	// Marco may delete only his own comments.
	if !got[0].CanDelete || got[1].CanDelete || !got[1].Replies[0].CanDelete || got[1].Replies[1].CanDelete {
		t.Errorf("canDelete wrong: %+v", got)
	}
	if empty := thread(nil, viewer{}); empty == nil || len(empty) != 0 {
		t.Errorf("no comments: %#v, want an empty list", empty)
	}
}

func TestReplyTarget(t *testing.T) {
	top := row{id: 1, videoID: 7}
	reply := row{id: 2, videoID: 7, parentID: 1}
	if got, err := replyTarget(top, 7); got != 1 || err != nil {
		t.Errorf("answer a conversation: %d, %v", got, err)
	}
	if got, err := replyTarget(reply, 7); got != 1 || err != nil {
		t.Errorf("answer a reply: %d, %v, want the same conversation", got, err)
	}
	if _, err := replyTarget(top, 8); !errors.Is(err, errCommentNotFound) {
		t.Errorf("another video: %v", err)
	}
}
