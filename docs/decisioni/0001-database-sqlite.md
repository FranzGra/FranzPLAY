# 0001 · Database: SQLite scritto in Go puro, con migrazioni numerate

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Cosa abbiamo deciso

- Il database è **un solo file**, `franzplay.db`, dentro la cartella dati.
- Per leggerlo e scriverlo usiamo la libreria **`modernc.org/sqlite`**, versione fissata.
- Lo schema del database (le tabelle) vive **solo** in `internal/database/migrations/`, un file
  numerato per ogni modifica: `0001_settings.sql`, `0002_…sql` e così via.
- **Go 1.26** come versione minima: la 1.24 non riceve più correzioni di sicurezza e la
  libreria SQLite chiede la 1.26.

## Perché

**SQLite** è un database che sta in un file: niente programma separato da installare, niente
password, e il backup è una copia del file. Per un server di casa è la scelta più leggera.

**Perché questa libreria.** Ce ne sono due famose:

| | `modernc.org/sqlite` (scelta) | `mattn/go-sqlite3` |
|---|---|---|
| Scritta in | Go | C (serve un compilatore C) |
| Preparare il programma per il Raspberry da un PC | un comando | complicato |
| Velocità | un po' più lenta | più veloce |

Per una casa con qualche migliaio di video la differenza di velocità non si nota, mentre poter
preparare il programma per Raspberry, Windows e Mac con un solo comando ci semplifica tutto.
Il programma passa da circa 6 a circa 11 MB, e acceso senza fare niente usa circa 10 MB di memoria.

**Perché le migrazioni.** Una *migrazione* è una modifica al database scritta in un file e
numerata. Quando FranzPLAY parte, guarda a che numero è arrivato il database e applica solo i
file mancanti, in ordine. Ogni file si applica **tutto o niente**: se qualcosa va storto, il
database resta com'era (regola 6). Se il database è stato aggiornato da un FranzPLAY più nuovo,
quello vecchio si rifiuta di partire invece di rovinare i dati.

## Impostazioni del database

- `foreign_keys`: SQLite controlla i collegamenti tra tabelle (es. un commento deve appartenere a
  un video che esiste). Di base non lo fa, quindi lo accendiamo.
- `journal_mode=WAL`: modo di scrivere più sicuro se va via la corrente.
- `busy_timeout=5000`: se il file è occupato, aspetta fino a 5 secondi invece di dare errore.
- **Una connessione alla volta**: semplice, e SQLite scrive comunque una cosa alla volta. Se un
  giorno servirà più velocità in lettura, si potrà cambiare.
