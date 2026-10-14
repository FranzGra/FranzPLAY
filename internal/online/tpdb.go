package online

import (
	"context"
	"fmt"
	"net/http"
	"net/url"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// tpdb asks ThePornDB (theporndb.net) about videos by their fingerprint,
// with the key the administrator entered.
type tpdb struct {
	client *http.Client
	api    string // https://api.theporndb.net
}

// newTPDB returns the client of ThePornDB's real address.
func newTPDB(client *http.Client) tpdb {
	return tpdb{client: client, api: "https://api.theporndb.net"}
}

// noHash is a fingerprint no file has, to try a key.
const noHash = "0000000000000000"

// lookup asks ThePornDB about the video with this fingerprint (an
// OSHash). ok is false when ThePornDB does not surely know it.
func (t tpdb) lookup(ctx context.Context, key, hash string) (_ found, ok bool, err error) {
	data, err := t.search(ctx, key, url.Values{"hash": {hash}, "hash_type": {"OSHASH"}})
	if err != nil {
		return found{}, false, err
	}
	scene, ok, err := video.ParseTPDBScenes(data, hash)
	if err != nil || !ok {
		return found{}, false, err
	}
	f := found{details: scene.Details}
	if scene.Picture != "" {
		// The picture comes from ThePornDB's picture server: no key for it.
		image, status, err := get(ctx, t.client, scene.Picture, nil, maxImage, "image/")
		switch {
		case err != nil:
			return found{}, false, fmt.Errorf("tpdb picture: %w", err)
		case status == http.StatusOK:
			f.image = image
		case status != http.StatusNotFound:
			return found{}, false, fmt.Errorf("tpdb picture: answered %d", status)
		}
	}
	return f, true, nil
}

// checkKey asks ThePornDB if a key is valid, before it is saved.
func (t tpdb) checkKey(ctx context.Context, key string) error {
	_, err := t.search(ctx, key, url.Values{"hash": {noHash}, "hash_type": {"OSHASH"}})
	return err
}

// find asks ThePornDB for the scenes these words describe, for the
// administrator to choose from.
func (t tpdb) find(ctx context.Context, key, words string) ([]video.Scene, error) {
	data, err := t.search(ctx, key, url.Values{"q": {words}, "per_page": {"12"}})
	if err != nil {
		return nil, err
	}
	scenes, err := video.ParseTPDBSearch(data)
	if err != nil {
		return nil, fmt.Errorf("tpdb search: %w", err)
	}
	return scenes, nil
}

// search asks ThePornDB for the scenes that match q.
func (t tpdb) search(ctx context.Context, key string, q url.Values) ([]byte, error) {
	header := http.Header{"Authorization": {"Bearer " + key}, "Accept": {"application/json"}}
	data, status, err := get(ctx, t.client, t.api+"/scenes?"+q.Encode(), header, maxLongAnswer, "application/json")
	if err != nil {
		return nil, fmt.Errorf("tpdb: %w", err)
	}
	switch status {
	case http.StatusOK:
		return data, nil
	case http.StatusNotFound:
		return []byte(`{"data": []}`), nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, fmt.Errorf("tpdb: %w", errKeyRefused)
	default:
		// Too many questions, or ThePornDB having a bad moment: try later.
		return nil, fmt.Errorf("tpdb: answered %d", status)
	}
}
