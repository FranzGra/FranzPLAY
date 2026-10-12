package oldimport

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // the old server's clock zone must be known even where the system has no zone files
)

// oldZone is the clock of the old FranzPLAY: its docker-compose.yml sets
// TZ=Europe/Rome on the database, so DATETIME columns hold Italian time.
const oldZone = "Europe/Rome"

// The tables of the old database that the import reads.
var oldTables = []string{"Utenti", "Video", "Categorie", "Like", "Commenti", "Salvati", "Cronologia", "Accessi",
	"Impostazioni", "Sottotitoli"}

// ErrNotOldFranzPLAY means the file is a database copy, but not of the
// old FranzPLAY.
var ErrNotOldFranzPLAY = errors.New("the file has no Utenti and Video tables: is it a copy of the old FranzPLAY's database?")

type oldUser struct {
	id         int64
	name       string
	hash       string // bcrypt, from PHP
	admin      bool
	color      string // "#rrggbb" as written, maybe empty or wrong
	closedRows []string
	lastLogin  time.Time // zero = never
	photo      string    // file name in App_Data/User_Images, "" = none
}

type oldVideo struct {
	id       int64
	path     string // inside the old video folder, with "/"
	title    string
	category int64  // 0 = none
	manual   bool   // cover chosen by hand
	cover    string // its cover, inside the old video folder, with "/"; "" = none
}

type oldCategory struct {
	id         int64
	name, path string
}

// A mark is a like or a saved video: who, which, when.
type oldMark struct {
	user, video int64
	at          time.Time
}

type oldComment struct {
	id, user, video int64
	body            string
	at              time.Time
}

type oldProgress struct {
	user, video int64
	position    int64 // seconds
	at          time.Time
	inContinue  bool
}

type oldLogin struct {
	at      time.Time
	name    string
	address string
	ok      bool
}

// oldData is the old database, checked and with clear types (rule 8).
type oldData struct {
	users      []oldUser
	videos     []oldVideo
	categories []oldCategory
	likes      []oldMark
	saved      []oldMark
	comments   []oldComment
	progress   []oldProgress
	logins     []oldLogin
	settings   map[string]string
	subtitles  int // subtitles made by the old Whisper
	// problems are rows that could not be read: they are left out and
	// shown in the report.
	problems []string
}

// readOld turns the tables of the dump into oldData.
func readOld(d *Dump) (*oldData, error) {
	if d.Table("Utenti") == nil || d.Table("Video") == nil {
		return nil, ErrNotOldFranzPLAY
	}
	zone, err := time.LoadLocation(oldZone)
	if err != nil {
		return nil, fmt.Errorf("load time zone: %w", err)
	}
	o := &oldData{settings: map[string]string{}}
	r := reader{dump: d, zone: zone, data: o}

	err = errors.Join(
		r.each("Utenti", func(c cells) error {
			u := oldUser{id: c.int("id"), name: c.text("Nome_Utente"), hash: c.text("Password"),
				admin: c.bool("Admin"), color: c.optText("colore_Tema"), lastLogin: c.optTime("ultimo_Accesso"),
				photo: c.optText("Immagine_Profilo")}
			if prefs := c.optText("preferenze_home"); prefs != "" {
				rows, err := closedRows(prefs)
				if err != nil {
					return fmt.Errorf("home preferences of %s: %w", u.name, err)
				}
				u.closedRows = rows
			}
			if c.err == nil {
				o.users = append(o.users, u)
			}
			return c.err
		}),
		r.each("Video", func(c cells) error {
			v := oldVideo{id: c.int("id"), path: c.text("percorso_file"), title: c.text("Titolo"),
				category: c.optInt("id_Categoria"), manual: c.optText("copertina_origine") == "manuale",
				cover: c.optText("percorso_copertina")}
			if c.err == nil {
				o.videos = append(o.videos, v)
			}
			return c.err
		}),
		r.each("Categorie", func(c cells) error {
			k := oldCategory{id: c.int("id"), name: c.text("Nome"), path: c.text("Percorso")}
			if c.err == nil {
				o.categories = append(o.categories, k)
			}
			return c.err
		}),
		r.each("Like", func(c cells) error {
			m := oldMark{user: c.int("id_Utente"), video: c.int("id_Video"), at: c.optTime("data_ora_like")}
			if c.err == nil {
				o.likes = append(o.likes, m)
			}
			return c.err
		}),
		r.each("Salvati", func(c cells) error {
			m := oldMark{user: c.int("id_Utente"), video: c.int("id_Video"), at: c.optTime("data_ora_salvato")}
			if c.err == nil {
				o.saved = append(o.saved, m)
			}
			return c.err
		}),
		r.each("Commenti", func(c cells) error {
			m := oldComment{id: c.int("id"), user: c.int("id_Utente"), video: c.int("id_Video"),
				body: c.text("testo_commento"), at: c.optTime("data_ora_commento")}
			if c.err == nil {
				o.comments = append(o.comments, m)
			}
			return c.err
		}),
		r.each("Cronologia", func(c cells) error {
			p := oldProgress{user: c.int("id_Utente"), video: c.int("id_Video"), position: c.optInt("progresso_secondi"),
				at: c.optTime("ultimo_aggiornamento"), inContinue: c.bool("continua_a_guardare")}
			if p.position < 0 {
				p.position = 0
			}
			if c.err == nil {
				o.progress = append(o.progress, p)
			}
			return c.err
		}),
		r.each("Accessi", func(c cells) error {
			l := oldLogin{at: c.time("data_ora_tentativo"), name: c.optText("Nome_Utente"),
				address: c.text("indirizzo_Ip"), ok: c.bool("successo")}
			if c.err == nil {
				o.logins = append(o.logins, l)
			}
			return c.err
		}),
		r.each("Impostazioni", func(c cells) error {
			k, v := c.text("Chiave_Impostazione"), c.optText("Valore_Impostazione")
			if c.err == nil {
				o.settings[k] = v
			}
			return c.err
		}),
		r.each("Sottotitoli", func(c cells) error {
			if c.optText("stato") == "completato" {
				o.subtitles++
			}
			return c.err
		}),
	)
	if err != nil {
		return nil, err
	}
	return o, nil
}

// The rows of the old Home and the names of the same rows in the new one.
// The old "recent" (latest videos) is the new "latest".
var homeRows = map[string]string{"history": "continue", "saved": "saved", "liked": "liked", "recent": "latest"}

// closedRows reads the old Home preferences, like {"saved": false}: a row
// set to false was closed.
func closedRows(prefs string) ([]string, error) {
	var m map[string]any
	if err := json.Unmarshal([]byte(prefs), &m); err != nil {
		return nil, errors.New("not readable")
	}
	var closed []string
	for _, old := range []string{"history", "saved", "liked", "recent"} {
		if open, ok := m[old].(bool); ok && !open {
			closed = append(closed, homeRows[old])
		}
	}
	return closed, nil
}

// reader reads the rows of the dump's tables.
type reader struct {
	dump *Dump
	zone *time.Location
	data *oldData
}

// each calls fn for every row of a table; a table not in the file has no
// rows. A row that cannot be read is skipped and noted as a problem; a
// column missing from the table stops everything, as the file is not what
// the import expects.
func (r reader) each(table string, fn func(cells) error) error {
	t := r.dump.Table(table)
	if t == nil {
		return nil
	}
	for i, row := range t.Rows {
		c := cells{row: row, table: t, zone: r.zone, utc: r.dump.UTCTimestamps}
		if err := fn(c); err != nil {
			var missing missingColumn
			if errors.As(err, &missing) {
				return err
			}
			r.data.problems = append(r.data.problems, fmt.Sprintf("%s, riga %d: %v", t.Name, i+1, err))
		}
	}
	return nil
}

type missingColumn struct{ table, column string }

func (m missingColumn) Error() string {
	return fmt.Sprintf("table %s has no column %s: is it a copy of the old FranzPLAY's database?", m.table, m.column)
}

// cells reads the values of one row. The first error is kept in err and
// the following reads return zero values, so a row is read in a few lines
// and checked once.
type cells struct {
	row   Row
	table *Table
	zone  *time.Location
	utc   bool // TIMESTAMP columns are in UTC
	err   error
}

func (c *cells) get(col string, optional bool) (Value, bool) {
	if c.err != nil {
		return Value{}, false
	}
	v, ok := c.row[col]
	if !ok {
		if _, defined := c.table.Types[col]; optional && !defined && !c.hasColumn(col) {
			return Value{Null: true}, true // a column the old version added later
		}
		c.err = missingColumn{c.table.Name, col}
		return Value{}, false
	}
	if v.Null && !optional {
		c.err = fmt.Errorf("%s is empty", col)
		return Value{}, false
	}
	return v, true
}

func (c *cells) hasColumn(col string) bool {
	for _, name := range c.table.Columns {
		if name == col {
			return true
		}
	}
	return false
}

func (c *cells) text(col string) string {
	v, _ := c.get(col, false)
	return v.S
}

func (c *cells) optText(col string) string {
	v, _ := c.get(col, true)
	return v.S
}

func (c *cells) int(col string) int64 {
	v, ok := c.get(col, false)
	if !ok {
		return 0
	}
	n, err := strconv.ParseInt(v.S, 10, 64)
	if err != nil {
		c.err = fmt.Errorf("%s is not a whole number: %q", col, v.S)
	}
	return n
}

func (c *cells) optInt(col string) int64 {
	v, ok := c.get(col, true)
	if !ok || v.Null {
		return 0
	}
	n, err := strconv.ParseInt(v.S, 10, 64)
	if err != nil {
		c.err = fmt.Errorf("%s is not a whole number: %q", col, v.S)
	}
	return n
}

func (c *cells) bool(col string) bool {
	return c.optInt(col) != 0
}

func (c *cells) time(col string) time.Time {
	t := c.optTime(col)
	if t.IsZero() && c.err == nil {
		c.err = fmt.Errorf("%s is empty", col)
	}
	return t
}

// optTime reads a DATETIME or TIMESTAMP; NULL and MariaDB's "zero date"
// give the zero time.
func (c *cells) optTime(col string) time.Time {
	v, ok := c.get(col, true)
	if !ok || v.Null || strings.HasPrefix(v.S, "0000-00-00") {
		return time.Time{}
	}
	zone := c.zone
	if c.utc && strings.HasPrefix(c.table.Types[col], "timestamp") {
		zone = time.UTC
	}
	t, err := time.ParseInLocation("2006-01-02 15:04:05", v.S, zone)
	if err != nil {
		// A date with fractions of a second, like "2025-06-01 10:00:00.123".
		t, err = time.ParseInLocation("2006-01-02 15:04:05.999999", v.S, zone)
	}
	if err != nil {
		c.err = fmt.Errorf("%s is not a date: %q", col, v.S)
		return time.Time{}
	}
	return t
}
