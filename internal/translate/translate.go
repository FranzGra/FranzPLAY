// Package translate asks a LibreTranslate server to translate subtitles, for
// who prefers one to the translator inside the image (package bergamot).
// LibreTranslate is free and runs at home, like FranzPLAY: nothing is sent
// to the internet unless the administrator points FranzPLAY at a server there.
package translate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// markup is the tags in a sentence: this server would translate them as words.
var markup = regexp.MustCompile(`</?[a-zA-Z][^>]*>`)

// Help is what the administrator needs to know of this translator, shown on
// the subtitles page when it does not answer.
var Help = struct{ Off, Down, Setup, After string }{
	Down: "LibreTranslate è impostato ma non risponde. All'accensione può metterci qualche minuto, " +
		"soprattutto la prima volta, quando scarica le lingue. Se dura, controlla che il suo container sia acceso " +
		"e che FRANZPLAY_TRANSLATE_URL abbia l'indirizzo giusto. Se togli quell'impostazione, " +
		"FranzPLAY traduce da solo.",
}

// batchSize is how many cues go in one request. LibreTranslate translates
// one text after the other on the processor: a whole film in one request
// would take minutes and time out, the old FranzPLAY found.
const batchSize = 40

// requestTimeout is the time one request may take.
const requestTimeout = 5 * time.Minute

// maxAnswer is the biggest answer read: 40 cues are a few kilobytes.
const maxAnswer = 4 << 20

// ErrRefused means the server will not translate, whatever we try again:
// a wrong key, or a language it does not have. Trying later does not help.
var ErrRefused = media.ErrRefused

// Client talks to one LibreTranslate server.
type Client struct {
	url    string // "http://localhost:5000", no slash at the end
	key    string // "" when the server asks for none
	client *http.Client
}

// New returns a client for the server at url.
func New(url, key string) *Client {
	return &Client{url: url, key: key, client: &http.Client{Timeout: requestTimeout}}
}

// Cues translates the text of cues from one language to another; the times
// stay the same. Languages are codes like "it" and "en".
func (c *Client) Cues(ctx context.Context, cues []video.Cue, from, to string) ([]video.Cue, error) {
	out := make([]video.Cue, 0, len(cues))
	for start := 0; start < len(cues); start += batchSize {
		batch := cues[start:min(start+batchSize, len(cues))]
		texts := make([]string, len(batch))
		for i, cue := range batch {
			texts[i] = markup.ReplaceAllString(cue.Text, "")
		}
		translated, err := c.texts(ctx, texts, from, to)
		if err != nil {
			return nil, fmt.Errorf("translate %s to %s: %w", from, to, err)
		}
		for i, cue := range batch {
			cue.Text = translated[i]
			out = append(out, cue)
		}
	}
	return out, nil
}

// texts translates a few texts with one request.
func (c *Client) texts(ctx context.Context, texts []string, from, to string) ([]string, error) {
	body, err := json.Marshal(map[string]any{"q": texts, "source": from, "target": to, "format": "text", "api_key": c.key})
	if err != nil {
		return nil, err
	}
	data, status, err := c.do(ctx, http.MethodPost, "/translate", body)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, answerError(status, data)
	}
	var answer struct {
		TranslatedText []string `json:"translatedText"`
	}
	if err := json.Unmarshal(data, &answer); err != nil {
		return nil, fmt.Errorf("unexpected answer: %w", err)
	}
	if len(answer.TranslatedText) != len(texts) {
		return nil, fmt.Errorf("unexpected answer: %d texts for %d", len(answer.TranslatedText), len(texts))
	}
	return answer.TranslatedText, nil
}

// Languages lists the codes of the languages the server translates to
// and from, to tell the administrator before anything is asked.
func (c *Client) Languages(ctx context.Context) ([]string, error) {
	data, status, err := c.do(ctx, http.MethodGet, "/languages", nil)
	if err != nil {
		return nil, fmt.Errorf("languages of the translator: %w", err)
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("languages of the translator: %w", answerError(status, data))
	}
	var languages []struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(data, &languages); err != nil {
		return nil, fmt.Errorf("languages of the translator: unexpected answer: %w", err)
	}
	codes := make([]string, len(languages))
	for i, l := range languages {
		codes[i] = l.Code
	}
	return codes, nil
}

// do sends one request and reads the answer.
func (c *Client) do(ctx context.Context, method, path string, body []byte) (_ []byte, status int, err error) {
	req, err := http.NewRequestWithContext(ctx, method, c.url+path, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { err = errors.Join(err, resp.Body.Close()) }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxAnswer+1))
	if err != nil {
		return nil, 0, err
	}
	if len(data) > maxAnswer {
		return nil, 0, errors.New("answer too big")
	}
	return data, resp.StatusCode, nil
}

// answerError explains an answer that is not a success. LibreTranslate
// says why in {"error": "..."}.
func answerError(status int, data []byte) error {
	var answer struct {
		Error string `json:"error"`
	}
	why := ""
	if json.Unmarshal(data, &answer) == nil && answer.Error != "" {
		r := []rune(strings.Join(strings.Fields(answer.Error), " "))
		why = ": " + string(r[:min(len(r), 200)])
	}
	err := fmt.Errorf("answered %d%s", status, why)
	if status == http.StatusBadRequest || status == http.StatusForbidden {
		return fmt.Errorf("%w: %w", ErrRefused, err)
	}
	return err
}
