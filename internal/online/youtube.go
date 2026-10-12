package online

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// maxAnswer is the biggest answer read from a source: a title in JSON is
// a few hundred bytes.
const maxAnswer = 64 << 10

// maxImage is the biggest picture downloaded. YouTube's largest covers
// weigh about 200 KB.
const maxImage = 4 << 20

// found is what a source knows about a video.
type found struct {
	details video.Details
	image   []byte // a JPEG, PNG or WebP; nil when the source has none
}

// youTube asks YouTube, without any key: its oEmbed address gives the
// title and the channel, its picture server the cover.
type youTube struct {
	client *http.Client
	oEmbed string // https://www.youtube.com/oembed
	images string // https://i.ytimg.com/vi
}

// coverNames are YouTube's covers of a video, the best first. Not every
// video has the biggest one.
var coverNames = []string{"maxresdefault.jpg", "hqdefault.jpg"}

// lookup asks YouTube about the video with this code. ok is false when
// YouTube does not know it (removed, or private): nothing to show.
func (y youTube) lookup(ctx context.Context, id string) (_ found, ok bool, err error) {
	q := url.Values{"url": {"https://www.youtube.com/watch?v=" + id}, "format": {"json"}}
	data, status, err := get(ctx, y.client, y.oEmbed+"?"+q.Encode(), maxAnswer, "application/json")
	if err != nil {
		return found{}, false, fmt.Errorf("youtube %s: %w", id, err)
	}
	switch status {
	case http.StatusOK:
	case http.StatusNotFound, http.StatusUnauthorized, http.StatusForbidden, http.StatusBadRequest:
		return found{}, false, nil
	default:
		// Too many questions, or YouTube having a bad moment: try later.
		return found{}, false, fmt.Errorf("youtube %s: answered %d", id, status)
	}
	details, err := video.ParseOEmbed(data)
	if err != nil {
		return found{}, false, fmt.Errorf("youtube %s: %w", id, err)
	}
	f := found{details: details}
	for _, name := range coverNames {
		image, status, err := get(ctx, y.client, y.images+"/"+id+"/"+name, maxImage, "image/")
		if err != nil {
			return found{}, false, fmt.Errorf("youtube %s cover: %w", id, err)
		}
		if status == http.StatusOK {
			f.image = image
			break
		}
		if status != http.StatusNotFound {
			return found{}, false, fmt.Errorf("youtube %s cover: answered %d", id, status)
		}
	}
	return f, true, nil
}

// errWrongContent means a source answered with something unexpected,
// like a web page instead of a picture.
var errWrongContent = errors.New("unexpected content")

// get downloads an address. The body is read only when the answer is 200
// and of the expected type, and never beyond limit bytes.
func get(ctx context.Context, client *http.Client, address string, limit int64, wantType string) (_ []byte, status int, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("User-Agent", "FranzPLAY (https://github.com/FranzGra/FranzPLAY)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { err = errors.Join(err, resp.Body.Close()) }()
	if resp.StatusCode != http.StatusOK {
		return nil, resp.StatusCode, nil
	}
	if got := resp.Header.Get("Content-Type"); !strings.HasPrefix(got, wantType) {
		return nil, 0, fmt.Errorf("%w: %q instead of %s", errWrongContent, got, wantType)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, 0, err
	}
	if int64(len(data)) > limit {
		return nil, 0, fmt.Errorf("%w: more than %d bytes", errWrongContent, limit)
	}
	return data, http.StatusOK, nil
}
