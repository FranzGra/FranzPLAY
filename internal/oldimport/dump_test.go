package oldimport

import (
	"errors"
	"os"
	"strings"
	"testing"
)

// testdata/mariadb-dump.sql was written by a real mariadb-dump, from the
// old FranzPLAY's schema (01_DBMS.sql and 02_migrations.sql) filled with
// a few people, videos and tricky texts.
func readFixture(t *testing.T, tables ...string) *Dump {
	t.Helper()
	f, err := os.Open("testdata/mariadb-dump.sql")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close() //nolint:errcheck // read only
	d, err := Read(f, tables...)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestReadMariaDBDump(t *testing.T) {
	d := readFixture(t, "Utenti", "Commenti", "like", "Cronologia")
	if !d.UTCTimestamps {
		t.Error("the file sets TIME_ZONE '+00:00', not seen")
	}
	if d.Table("Video") != nil || d.Table("Accessi") != nil {
		t.Error("tables not asked for were kept")
	}

	users := d.Table("utenti")
	if users == nil || len(users.Rows) != 3 {
		t.Fatalf("Utenti = %+v", users)
	}
	want := []string{"id", "Nome_Utente", "Password", "Email", "ResetToken", "ResetTokenExpiry", "Immagine_Profilo",
		"ultimo_Accesso", "colore_Tema", "preferenze_home", "Admin"}
	if strings.Join(users.Columns, ",") != strings.Join(want, ",") {
		t.Errorf("columns = %v, want %v", users.Columns, want)
	}
	first := users.Rows[0]
	if first["Nome_Utente"].S != "Paolo" || first["Admin"].S != "1" ||
		first["Password"].S != "$2y$10$FRx/ktSH1VVy7vVPqX7NIOQg2EGYNH/ntGZ1h8WtckxhdWnUDvzVy" ||
		first["preferenze_home"].S != `{"saved": false, "recent": true}` {
		t.Errorf("first user = %v", first)
	}
	if !users.Rows[1]["Email"].Null || users.Rows[1]["Nome_Utente"].Null {
		t.Errorf("NULL not read: %v", users.Rows[1])
	}

	comments := d.Table("Commenti")
	if got := comments.Rows[0]["testo_commento"].S; got != "Che bello! L'acqua era \"fredda\"\nVero 😄 \\ fine" {
		t.Errorf("text with escapes = %q", got)
	}
	if got := comments.Rows[1]["testo_commento"].S; got != "Sì, freddissima" {
		t.Errorf("accented text = %q", got)
	}
	if got := len(comments.Rows[3]["testo_commento"].S); got != 2500 {
		t.Errorf("long text has %d characters", got)
	}

	history := d.Table("Cronologia")
	if history.Types["ultimo_aggiornamento"] != "timestamp" || history.Types["progresso_secondi"] != "int(11)" {
		t.Errorf("types = %v", history.Types)
	}
	if len(d.Table("Like").Rows) != 4 {
		t.Errorf("likes = %d", len(d.Table("Like").Rows))
	}
}

// phpMyAdmin writes the column names in every INSERT and uses other quotes.
func TestReadPhpMyAdminExport(t *testing.T) {
	const export = `-- phpMyAdmin SQL Dump
-- version 5.2.1
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

/*!40101 SET NAMES utf8mb4 */;

CREATE TABLE ` + "`Like`" + ` (
  ` + "`id_Utente`" + ` int(11) NOT NULL,
  ` + "`id_Video`" + ` int(11) NOT NULL,
  ` + "`data_ora_like`" + ` datetime DEFAULT current_timestamp() COMMENT 'Quando, (con virgola)'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO ` + "`Like`" + ` (` + "`id_Video`, `id_Utente`, `data_ora_like`" + `) VALUES
(7, 1, '2025-01-02 03:04:05'),
(8, -2, NULL);
# a comment like this one
INSERT INTO ` + "`Commenti`" + ` (` + "`id`, `testo_commento`" + `) VALUES (1, 'it''s ok');
COMMIT;
`
	d, err := Read(strings.NewReader(export), "Like", "Commenti")
	if err != nil {
		t.Fatal(err)
	}
	if !d.UTCTimestamps {
		t.Error("time_zone \"+00:00\" not seen")
	}
	likes := d.Table("Like")
	if len(likes.Rows) != 2 || likes.Rows[0]["id_Video"].S != "7" || likes.Rows[0]["id_Utente"].S != "1" ||
		likes.Rows[1]["id_Utente"].S != "-2" || !likes.Rows[1]["data_ora_like"].Null {
		t.Errorf("likes = %v", likes.Rows)
	}
	if likes.Types["data_ora_like"] != "datetime" {
		t.Errorf("types = %v", likes.Types)
	}
	// Only the data, without CREATE TABLE: the INSERT names the columns.
	if got := d.Table("Commenti").Rows[0]["testo_commento"].S; got != "it's ok" {
		t.Errorf("comment = %q", got)
	}
}

func TestReadValues(t *testing.T) {
	sql := "CREATE TABLE t (`a` blob, `b` int, `c` varchar(9));\n" +
		"INSERT INTO t VALUES (0x4869, TRUE, _binary 'x'),(_utf8mb4'y', FALSE, 'tab\\there');"
	d, err := Read(strings.NewReader(sql), "t")
	if err != nil {
		t.Fatal(err)
	}
	rows := d.Table("t").Rows
	if rows[0]["a"].S != "Hi" || rows[0]["b"].S != "1" || rows[0]["c"].S != "x" ||
		rows[1]["a"].S != "y" || rows[1]["b"].S != "0" || rows[1]["c"].S != "tab\there" {
		t.Errorf("rows = %v", rows)
	}
}

func TestReadRefusesWrongFiles(t *testing.T) {
	for name, sql := range map[string]string{
		"empty":            "",
		"only comments":    "-- nothing here\n/* really */\n",
		"open text":        "INSERT INTO t VALUES ('never closed",
		"open comment":     "/* never closed",
		"wrong count":      "CREATE TABLE t (`a` int, `b` int); INSERT INTO t VALUES (1);",
		"no definition":    "INSERT INTO t VALUES (1, 2);",
		"bad hexadecimal":  "CREATE TABLE t (`a` blob); INSERT INTO t VALUES (0xZZ);",
		"missing comma":    "CREATE TABLE t (`a` int); INSERT INTO t VALUES (1) (2);",
		"two values":       "CREATE TABLE t (`a` int); INSERT INTO t VALUES (1 2);",
		"no values at all": "CREATE TABLE t (`a` int); INSERT INTO t SELECT 1;",
	} {
		if _, err := Read(strings.NewReader(sql), "t"); err == nil {
			t.Errorf("%s: no error", name)
		} else if name == "empty" || name == "only comments" {
			if !errors.Is(err, ErrNotADump) {
				t.Errorf("%s: err = %v, want ErrNotADump", name, err)
			}
		}
	}
}

func TestReadIgnoresOtherTables(t *testing.T) {
	// Rows of tables not asked for are not even checked.
	d, err := Read(strings.NewReader("INSERT INTO other VALUES (1, 2);"), "t")
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Tables) != 0 {
		t.Errorf("tables = %v", d.Tables)
	}
}
