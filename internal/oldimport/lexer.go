package oldimport

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"strings"
)

// The kinds of pieces an SQL statement is made of.
type tokenKind int

const (
	tWord   tokenKind = iota // a key word, a name without quotes or a number
	tIdent                   // a `quoted name`
	tString                  // a 'text' or "text", already unescaped
	tPunct                   // ( ) , . = and the other signs
)

type token struct {
	kind tokenKind
	s    string
}

type statement []token

// is reports whether the i-th piece is the key word w.
func (st statement) is(i int, w string) bool {
	return i < len(st) && st[i].kind == tWord && strings.EqualFold(st[i].s, w)
}

// lexer cuts an SQL file into statements, one at a time, so that a big
// file never sits in memory all at once.
type lexer struct {
	r    *bufio.Reader
	size int // characters of the current statement
}

var errTooLong = errors.New("a statement is too long: is this the right file?")

// statement returns the next statement without its ";", an empty one for
// ";;", and nil at the end of the file. Comments are skipped, but the
// inside of /*!40101 … */ is read: MariaDB runs it, and mariadb-dump
// writes "SET TIME_ZONE" there.
func (lx *lexer) statement() (statement, error) {
	var st statement
	lx.size = 0
	for {
		c, err := lx.r.ReadByte()
		if errors.Is(err, io.EOF) {
			if len(st) == 0 {
				return nil, nil
			}
			return st, nil
		}
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		lx.size++
		if lx.size > maxStatement {
			return nil, errTooLong
		}
		switch {
		case c == ';':
			if st == nil {
				st = statement{}
			}
			return st, nil
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
		case c == '#':
			if err := lx.skipLine(); err != nil {
				return nil, err
			}
		case c == '-' && lx.peekIs('-'):
			if err := lx.skipLine(); err != nil {
				return nil, err
			}
		case c == '/' && lx.peekIs('*'):
			if err := lx.comment(); err != nil {
				return nil, err
			}
		case c == '*' && lx.peekIs('/'):
			// The end of a /*! … */ whose inside was read as SQL.
			_, _ = lx.r.ReadByte()
		case c == '\'' || c == '"':
			s, err := lx.quoted(c, true)
			if err != nil {
				return nil, err
			}
			st = append(st, token{tString, s})
		case c == '`':
			s, err := lx.quoted('`', false)
			if err != nil {
				return nil, err
			}
			st = append(st, token{tIdent, s})
		case isWordByte(c):
			st = append(st, token{tWord, lx.word(c)})
		default:
			st = append(st, token{tPunct, string(c)})
		}
	}
}

func (lx *lexer) peekIs(c byte) bool {
	b, err := lx.r.Peek(1)
	return err == nil && b[0] == c
}

func (lx *lexer) skipLine() error {
	for {
		c, err := lx.r.ReadByte()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read file: %w", err)
		}
		if c == '\n' {
			return nil
		}
	}
}

// comment skips a /* comment */, the "/" already read. For /*!NNNNN
// only the mark and the version are skipped: the rest is read as SQL.
func (lx *lexer) comment() error {
	_, _ = lx.r.ReadByte() // the "*"
	if lx.peekIs('!') {
		_, _ = lx.r.ReadByte()
		// The version, like 40101. The end of the file here is not an
		// error yet: the next read finds it.
		for {
			b, err := lx.r.Peek(1)
			if err != nil {
				return nil //nolint:nilerr // see above
			}
			if b[0] < '0' || b[0] > '9' {
				return nil
			}
			_, _ = lx.r.ReadByte()
		}
	}
	star := false
	for {
		c, err := lx.r.ReadByte()
		if errors.Is(err, io.EOF) {
			return errors.New("a comment is never closed")
		}
		if err != nil {
			return fmt.Errorf("read file: %w", err)
		}
		lx.size++
		if lx.size > maxStatement {
			return errTooLong
		}
		if star && c == '/' {
			return nil
		}
		star = c == '*'
	}
}

// quoted reads up to the closing quote, the opening one already read. A
// doubled quote stands for itself; in texts, a backslash starts an escape
// as MariaDB writes them (\n, \', \\, \0…).
func (lx *lexer) quoted(q byte, escapes bool) (string, error) {
	var sb strings.Builder
	for {
		c, err := lx.r.ReadByte()
		if errors.Is(err, io.EOF) {
			return "", errors.New("a text is never closed")
		}
		if err != nil {
			return "", fmt.Errorf("read file: %w", err)
		}
		lx.size++
		if lx.size > maxStatement {
			return "", errTooLong
		}
		switch {
		case c == q:
			if !lx.peekIs(q) {
				return sb.String(), nil
			}
			_, _ = lx.r.ReadByte()
			sb.WriteByte(q)
		case c == '\\' && escapes:
			e, err := lx.r.ReadByte()
			if err != nil {
				return "", errors.New("a text is never closed")
			}
			sb.WriteString(unescape(e))
		default:
			sb.WriteByte(c)
		}
	}
}

// unescape gives what a backslash and the letter e stand for.
func unescape(e byte) string {
	switch e {
	case '0':
		return "\x00"
	case 'n':
		return "\n"
	case 'r':
		return "\r"
	case 't':
		return "\t"
	case 'b':
		return "\b"
	case 'Z':
		return "\x1a"
	case '%', '_':
		// In MariaDB "\%" and "\_" keep their backslash.
		return "\\" + string(e)
	}
	return string(e) // \' \" \\ and any other letter
}

func isWordByte(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '$' || c >= 0x80
}

// word reads a key word, a name or a number. A number keeps its dot
// ("1.5"); a name stops at it ("db.table").
func (lx *lexer) word(first byte) string {
	var sb strings.Builder
	sb.WriteByte(first)
	number := first >= '0' && first <= '9'
	for {
		b, err := lx.r.Peek(1)
		if err != nil || !isWordByte(b[0]) && (!number || b[0] != '.') {
			return sb.String()
		}
		_, _ = lx.r.ReadByte()
		lx.size++
		sb.WriteByte(b[0])
	}
}
