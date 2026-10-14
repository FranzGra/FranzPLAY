package sharing

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

// NewKey makes the secret part of a link: random, for an address.
func NewKey() (string, error) {
	b := make([]byte, 17) // 136 bits, cut to the 22 letters of keyLength
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("make link key: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b)[:keyLength], nil
}

// VideoLink is the address of the page of a video seen by link, with its
// key: who opens it may watch the video.
func VideoLink(id int64, key string) string {
	return fmt.Sprintf("/video/%d?k=%s", id, key)
}
