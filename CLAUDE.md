# FranzPLAY: istruzioni per chi lavora al progetto

Questo file lo legge per primo chiunque lavori a FranzPLAY, persona o IA.
La visione completa (cosa, per chi, funzioni e priorità, decisioni prese) è in
[`docs/visione.md`](docs/visione.md): leggila prima di proporre funzioni o cambiare architettura.

## In breve

FranzPLAY è **uno YouTube personale**, gratuito e open source, da installare a casa: si mettono i
video in una cartella e si guardano, commentano e condividono con familiari e amici.
Deve girare bene su un **Raspberry Pi 4 con 2 GB** di RAM.

- Server: **un solo programma in Go**, con database **SQLite**.
- Interfaccia: **React + TypeScript** in `web/`, inclusa dentro il programma. **Tema scuro**
  come tema principale. Stile **bello, moderno e minimale**: superfici di vetro alla Apple
  Liquid Glass, pulizia e componenti alla shadcn/ui. **Non** Material UI.
- Tempo reale: **SSE** (il server avvisa il browser), niente WebSocket.
- Video: **ffmpeg / ffprobe**, lanciati solo dal programma.

## Lavorare con Francesco

Francesco sta imparando Go e il modo moderno di scrivere software costruendo FranzPLAY.

- **Spiega prima di scrivere**: cosa stai per fare e perché, in **italiano semplice**, con pochi
  termini tecnici. Ogni termine nuovo si spiega la prima volta che compare.
- **Passi piccoli**: una pull request = una cosa sola, con i suoi test.
- **Qualità prima della velocità**: codice ordinato, pensato, pulito e testato. Niente fretta.
- Quando ha senso, proponi a Francesco un **piccolo esercizio** su un pezzo vero del progetto.
- La soluzione **più semplice che funziona**; si complica solo quando serve davvero.

## Le regole che non si discutono

Ognuna viene da un danno vero visto nella versione vecchia. Ognuna deve avere un test che la prova.

1. **Le cartelle video sono in sola lettura.** Mai rinominare, convertire sul posto, cancellare o
   creare file lì dentro. Tutto ciò che il programma produce va nella **cartella dati**
   (`FRANZPLAY_DATA_DIR`), anche i video caricati dagli utenti.
2. **Un video si riconosce dal contenuto**, non dal percorso: spostarlo non fa perdere niente.
3. **Prima di cancellare, dubitare.** Cartella vuota = forse disco non montato: non si cancella.
   Un video mancante si segna come mancante e sparisce davvero solo dopo giorni.
4. **Un solo padrone**: un solo programma possiede database e coda dei lavori. Lo schema del
   database vive in un posto solo, con migrazioni numerate.
5. **Un lavoro pesante alla volta** (ffmpeg), deciso dal programma in base alla macchina.
6. **Scritture "tutto o niente"**: file temporaneo, rinominato solo a lavoro finito.
7. **Gli errori non si nascondono**: ogni errore si gestisce o si restituisce, mai ignorato.
   Mai rispondere "fatto" se non è vero.
8. **Dati con tipi chiari**: durate in secondi (`video.Duration`), stati come elenco chiuso.
   Ciò che arriva da fuori si controlla **una volta, all'ingresso**.
9. **Sicuro dall'installazione**: segreti generati al primo avvio, mai nel codice.
10. **Leggero per scelta**: pochissime dipendenze, versioni fissate. Prima di aggiungerne una,
    chiedersi quanto pesa sul Raspberry.

## Come è organizzato il codice

```
cmd/franzplay/      avvio del programma: collega i pezzi, nient'altro
internal/config/    impostazioni lette dalle variabili d'ambiente
internal/database/  apre il database SQLite; lo schema vive in migrations/, file numerati
internal/library/   trova i video nelle cartelle (sola lettura) e aggiorna il catalogo
internal/jobs/      coda dei lavori pesanti nel database, eseguiti uno alla volta
internal/media/     lancia ffprobe e ffmpeg (solo da qui)
internal/server/    le rotte HTTP dell'API
internal/respond/   risposte dell'API, tutte in JSON e tutte uguali
internal/catalog/   l'API dei video: elenco, un video, categorie, copertine, streaming
internal/video/     tipi e decisioni sui video (nucleo puro, senza disco né database)
internal/webui/     serve l'interfaccia web inclusa nel programma
web/                l'interfaccia: React + TypeScript (vedi sotto)
docs/               visione, decisioni (docs/decisioni/) e guida per provare sul PC
```

- **Cartelle per funzionalità** (`catalog/`, `comments/`, `playlists/`…), non per tipo di file.
  Ogni cartella contiene tutto quello che le serve, test compresi.
- **Nucleo puro e guscio**: le decisioni sono funzioni che non toccano disco, database o orologio,
  e si provano con test velocissimi. Il guscio legge e scrive, e chiede al nucleo cosa fare.
- **Interfacce piccole** al posto dell'ereditarietà, definite da chi le usa.
- Tutto in `internal/`: nessun pacchetto è pensato per essere importato da fuori.

### L'interfaccia (`web/`)

```
web/src/app/          cornice (barra in alto, menu, barra del telefono) e indirizzi delle pagine
web/src/features/     una cartella per funzionalità: home/, playlists/, profile/, video/…
web/src/components/   pezzi riusabili (icone, stato vuoto…)
web/src/api/          chiamate al server; ogni risposta si controlla all'ingresso
web/src/styles/       colori, misure e caratteri, tutti in un posto solo (variabili CSS)
```

- **Niente dati finti** nell'interfaccia: una pagina senza dati mostra uno stato vuoto che spiega
  cosa comparirà.
- Sul telefono la barra in basso ha **solo tre tasti**: Home, Playlist, Profilo.
  "Carica un video" sta nella pagina Profilo. Non esistono iscrizioni ai canali.
- Stili con **CSS Modules** (`Nome.module.css` accanto al componente) e i colori solo da
  `styles/global.css`. Per un pannello di vetro si usa la classe `glass`.
- Niente Tailwind né librerie di componenti: l'aspetto di shadcn/ui si ottiene con componenti
  nostri, così le dipendenze restano poche (regola 10).
- Test con Vitest e Testing Library, accanto al codice (`Nome.test.tsx`).
- Formattazione e lint con **Biome**, tipi stretti con TypeScript.

## Convenzioni

- **Lingua**: codice, nomi e commenti nel codice in **inglese**. Documenti per Francesco e
  conversazioni in **italiano semplice**.
- **Formattazione**: `make fmt` (gofmt + goimports). Non si discute di spazi.
- **Test**: accanto al codice (`xxx_test.go`), a tabella quando ci sono più casi.
  Ogni bug corretto riceve prima un test che lo riproduce.
- **Errori**: si avvolgono con contesto (`fmt.Errorf("open database: %w", err)`) e si
  confrontano con `errors.Is` / `errors.As`.
- **Log**: `log/slog`, con coppie chiave-valore, mai frasi costruite a mano.
- **Configurazione**: variabili d'ambiente `FRANZPLAY_*`, lette solo in `internal/config`.
- **Commit**: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `docs:`, `test:`, `refactor:`, `ci:`, `chore:`).
- **Decisioni importanti**: una paginetta in `docs/decisioni/` con cosa si è deciso e perché.

## Comandi

```sh
make run     # avvia FranzPLAY su http://localhost:8090
make test    # tutti i test
make lint    # controlli automatici
make fmt     # formatta il codice
make check   # tutto quello che controlla la CI: lancialo prima di ogni push
make web     # prepara l'interfaccia (serve Node.js 22)
make web-dev # interfaccia in modalità sviluppo su http://localhost:5173 (insieme a make run)
make build   # il programma completo, interfaccia compresa, in bin/franzplay
```

Impostazioni:

| Variabile | Default | Cosa fa |
|---|---|---|
| `FRANZPLAY_ADDR` | `:8090` | Indirizzo e porta del sito |
| `FRANZPLAY_DATA_DIR` | `data` | Cartella dati di FranzPLAY |
| `FRANZPLAY_LIBRARIES` | nessuna | Cartelle dei video, in sola lettura (separate da `;` su Windows, `:` altrove) |
| `FRANZPLAY_FFPROBE` | `ffprobe` | Programma ffprobe (nome nel PATH o percorso completo) |
| `FRANZPLAY_FFMPEG` | `ffmpeg` | Programma ffmpeg (nome nel PATH o percorso completo) |

## Prima di aprire una pull request

- `make check` è verde.
- Ogni comportamento nuovo ha i suoi test; ogni regola toccata ha il suo test.
- La pull request fa una cosa sola e spiega in parole semplici cosa cambia per chi usa FranzPLAY.
