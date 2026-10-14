// Package oldimport brings the people, likes, comments, history and lists
// of the old FranzPLAY (PHP and MariaDB) into the new one, on the day of
// the switch. It reads a copy of the old database saved as an SQL file
// (by mariadb-dump or phpMyAdmin): the old database itself is never
// touched, so nothing there can be changed or lost.
package oldimport

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"strings"
)

// Value is one cell of a row: a text, a number written as text, or NULL.
type Value struct {
	Null bool
	S    string
}

// Row is one row of a table, by column name.
type Row map[string]Value

// Table is a table of the old database, as saved in the file.
type Table struct {
	Name    string
	Columns []string          // in the order of CREATE TABLE
	Types   map[string]string // column → type in small letters, like "datetime" or "varchar(255)"
	Rows    []Row
}

// Dump is what the file holds of the tables that were asked for.
type Dump struct {
	Tables map[string]*Table // by name in small letters
	// UTCTimestamps says the file was written with TIME_ZONE '+00:00', as
	// mariadb-dump does: TIMESTAMP columns are then in UTC, while DATETIME
	// columns are always written as the old server's clock showed them.
	UTCTimestamps bool
}

// Table returns a table by name, ignoring capitals; nil when the file did
// not have it.
func (d *Dump) Table(name string) *Table {
	return d.Tables[strings.ToLower(name)]
}

// ErrNotADump means the file is not an SQL file of a database.
var ErrNotADump = errors.New("the file is not an SQL copy of a database")

// maxStatement is the longest statement accepted. mariadb-dump writes
// INSERTs of about 1 MB; this stops a wrong file from filling the memory
// of a Raspberry Pi.
const maxStatement = 64 << 20

// Read reads an SQL dump and keeps the definition and rows of the tables
// named in want (capitals ignored). Other tables are read and dropped.
func Read(r io.Reader, want ...string) (*Dump, error) {
	wanted := map[string]bool{}
	for _, w := range want {
		wanted[strings.ToLower(w)] = true
	}
	d := &Dump{Tables: map[string]*Table{}}
	lx := lexer{r: bufio.NewReaderSize(r, 64<<10)}
	statements := 0
	for {
		st, err := lx.statement()
		if err != nil {
			return nil, err
		}
		if st == nil {
			break
		}
		if len(st) == 0 {
			continue
		}
		statements++
		if err := d.apply(st, wanted); err != nil {
			return nil, fmt.Errorf("statement %d: %w", statements, err)
		}
	}
	if statements == 0 {
		return nil, ErrNotADump
	}
	return d, nil
}

// apply takes what it needs from one statement.
func (d *Dump) apply(st statement, wanted map[string]bool) error {
	switch {
	case st.is(0, "SET") && len(st) >= 4 && strings.EqualFold(st[1].s, "TIME_ZONE") && st[2].s == "=":
		// Only switching to UTC counts: at its end the file switches back
		// to the old setting, after all the rows.
		if st[3].kind == tString && (st[3].s == "+00:00" || strings.EqualFold(st[3].s, "UTC")) {
			d.UTCTimestamps = true
		}
	case st.is(0, "CREATE") && st.is(1, "TABLE"):
		name, rest, err := tableName(st[2:])
		if err != nil {
			return err
		}
		if !wanted[strings.ToLower(name)] {
			return nil
		}
		t, err := createTable(name, rest)
		if err != nil {
			return fmt.Errorf("table %s: %w", name, err)
		}
		d.Tables[strings.ToLower(name)] = t
	case st.is(0, "INSERT") || st.is(0, "REPLACE"):
		i := 1
		for i < len(st) && (st.is(i, "IGNORE") || st.is(i, "LOW_PRIORITY") || st.is(i, "DELAYED") || st.is(i, "HIGH_PRIORITY")) {
			i++
		}
		if st.is(i, "INTO") {
			i++
		}
		name, rest, err := tableName(st[i:])
		if err != nil {
			return err
		}
		if !wanted[strings.ToLower(name)] {
			return nil
		}
		t := d.Table(name)
		if t == nil {
			// phpMyAdmin can save only the data: the columns must then
			// be listed in the INSERT.
			t = &Table{Name: name, Types: map[string]string{}}
			d.Tables[strings.ToLower(name)] = t
		}
		if err := t.insert(rest); err != nil {
			return fmt.Errorf("table %s: %w", name, err)
		}
	}
	return nil
}

// tableName reads `name` or `db`.`name`, and returns what follows.
func tableName(st statement) (string, statement, error) {
	if st.is(0, "IF") && st.is(1, "NOT") && st.is(2, "EXISTS") {
		st = st[3:]
	}
	if len(st) == 0 || (st[0].kind != tIdent && st[0].kind != tWord) {
		return "", nil, errors.New("table name missing")
	}
	name := st[0].s
	st = st[1:]
	if len(st) >= 2 && st[0].s == "." && st[0].kind == tPunct {
		name = st[1].s
		st = st[2:]
	}
	return name, st, nil
}

// createTable reads the columns of a CREATE TABLE: each part between the
// outer parentheses that starts with a name is a column; KEY, PRIMARY
// KEY, CONSTRAINT and the like are not.
func createTable(name string, st statement) (*Table, error) {
	if len(st) == 0 || st[0].s != "(" {
		return nil, errors.New("column list missing")
	}
	t := &Table{Name: name, Types: map[string]string{}}
	for _, part := range splitTop(st[1:]) {
		if len(part) < 2 || part[0].kind != tIdent && (part[0].kind != tWord || isKeyWord(part[0].s)) {
			continue
		}
		col := part[0].s
		typ := strings.ToLower(part[1].s)
		if len(part) > 2 && part[2].s == "(" {
			// Keep the size, like "varchar(255)".
			var sb strings.Builder
			sb.WriteString(typ)
			for _, tk := range part[2:] {
				sb.WriteString(tk.s)
				if tk.s == ")" {
					break
				}
			}
			typ = strings.ToLower(sb.String())
		}
		t.Columns = append(t.Columns, col)
		t.Types[col] = typ
	}
	if len(t.Columns) == 0 {
		return nil, errors.New("no columns")
	}
	return t, nil
}

func isKeyWord(s string) bool {
	switch strings.ToUpper(s) {
	case "PRIMARY", "KEY", "UNIQUE", "INDEX", "FULLTEXT", "SPATIAL", "CONSTRAINT", "FOREIGN", "CHECK", "PERIOD", "SYSTEM":
		return true
	}
	return false
}

// splitTop reads a list "a, b (c, d), e)" up to its closing parenthesis
// and splits it at the commas that are not inside parentheses.
func splitTop(st statement) []statement {
	var parts []statement
	depth, start := 0, 0
	for i, tk := range st {
		if tk.kind != tPunct {
			continue
		}
		switch tk.s {
		case "(":
			depth++
		case ")":
			if depth == 0 {
				return append(parts, st[start:i])
			}
			depth--
		case ",":
			if depth == 0 {
				parts = append(parts, st[start:i])
				start = i + 1
			}
		}
	}
	return append(parts, st[start:])
}

// insert reads "[(`a`, `b`)] VALUES (1, 'x'), (2, NULL)".
func (t *Table) insert(st statement) error {
	columns := t.Columns
	if len(st) > 0 && st[0].s == "(" && st[0].kind == tPunct {
		columns = nil
		for _, part := range splitTop(st[1:]) {
			if len(part) != 1 {
				return errors.New("unreadable column list")
			}
			columns = append(columns, part[0].s)
		}
		st = st[len(columns)*2+1:]
		if len(t.Columns) == 0 {
			t.Columns = columns
		}
	}
	if len(columns) == 0 {
		return errors.New("rows without the table's definition: save the whole table, not only its data")
	}
	if !st.is(0, "VALUES") && !st.is(0, "VALUE") {
		return errors.New("VALUES missing")
	}
	st = st[1:]
	for len(st) > 0 {
		if st[0].s != "(" || st[0].kind != tPunct {
			return errors.New("row missing")
		}
		parts := splitTop(st[1:])
		if len(parts) != len(columns) {
			return fmt.Errorf("a row has %d values for %d columns", len(parts), len(columns))
		}
		row := make(Row, len(columns))
		used := 1
		for i, part := range parts {
			v, err := value(part)
			if err != nil {
				return fmt.Errorf("column %s: %w", columns[i], err)
			}
			row[columns[i]] = v
			used += len(part) + 1 // the value and the comma or ")" after it
		}
		t.Rows = append(t.Rows, row)
		st = st[used:]
		if len(st) > 0 {
			if st[0].s != "," || st[0].kind != tPunct {
				return errors.New("comma missing between rows")
			}
			st = st[1:]
		}
	}
	return nil
}

// value reads one value: NULL, a number, a text, maybe with a character
// set before it (_binary 'x', _utf8mb4'x').
func value(part statement) (Value, error) {
	if len(part) == 2 && part[0].kind == tWord && strings.HasPrefix(part[0].s, "_") && part[1].kind == tString {
		part = part[1:]
	}
	if len(part) == 2 && part[0].kind == tPunct && part[0].s == "-" && part[1].kind == tWord {
		return Value{S: "-" + part[1].s}, nil
	}
	if len(part) != 1 {
		return Value{}, errors.New("unreadable value")
	}
	tk := part[0]
	switch tk.kind {
	case tString:
		return Value{S: tk.s}, nil
	case tWord:
		switch strings.ToUpper(tk.s) {
		case "NULL":
			return Value{Null: true}, nil
		case "TRUE":
			return Value{S: "1"}, nil
		case "FALSE":
			return Value{S: "0"}, nil
		}
		if hex, ok := strings.CutPrefix(strings.ToLower(tk.s), "0x"); ok {
			b, err := decodeHex(hex)
			if err != nil {
				return Value{}, err
			}
			return Value{S: string(b)}, nil
		}
		return Value{S: tk.s}, nil
	}
	return Value{}, errors.New("unreadable value")
}

func decodeHex(s string) ([]byte, error) {
	if len(s)%2 == 1 {
		s = "0" + s
	}
	b := make([]byte, len(s)/2)
	for i := range b {
		hi, ok1 := hexDigit(s[2*i])
		lo, ok2 := hexDigit(s[2*i+1])
		if !ok1 || !ok2 {
			return nil, errors.New("unreadable hexadecimal value")
		}
		b[i] = hi<<4 | lo
	}
	return b, nil
}

func hexDigit(c byte) (byte, bool) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', true
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10, true
	}
	return 0, false
}
