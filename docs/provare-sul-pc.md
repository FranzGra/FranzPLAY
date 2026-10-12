# Provare FranzPLAY sul tuo computer

Guida passo passo per scaricare il progetto, lanciare i test e avviare il programma.
Serve circa un quarto d'ora la prima volta, poi bastano pochi secondi.

## 1. Installa gli strumenti (una volta sola)

Servono quattro programmi:

- **Git**: scarica il progetto da GitHub e tiene traccia delle modifiche.
- **Go** (versione 1.26 o più nuova): il linguaggio di FranzPLAY. Compila e avvia il programma.
- **Node.js** (versione 22): serve solo per preparare l'interfaccia web. Chi installerà
  FranzPLAY a casa non ne avrà bisogno: l'interfaccia sarà già dentro il programma.
- **FFmpeg**: legge durata e risoluzione dei video (con `ffprobe`) e preparerà le copertine.
  Senza, FranzPLAY parte lo stesso ma i video restano senza durata.

### Windows

1. Scarica e installa **Git** da <https://git-scm.com/download/win> (vanno bene tutte le opzioni proposte).
2. Scarica e installa **Go** da <https://go.dev/dl/> (il file `.msi` per Windows).
3. Scarica e installa **Node.js 22 LTS** da <https://nodejs.org/> (il file `.msi`).
4. Installa **FFmpeg** da PowerShell con `winget install Gyan.FFmpeg`.
5. Apri **PowerShell** (cercalo nel menu Start) e controlla che funzionino:

   ```powershell
   git --version
   go version
   node --version
   ffprobe -version
   ```

   Se vedi quattro numeri di versione, è tutto a posto. Se dice "comando non trovato", chiudi e
   riapri PowerShell.

### Mac

Installa Go da <https://go.dev/dl/> (il file `.pkg`) e Node.js 22 da <https://nodejs.org/>.
FFmpeg si installa con [Homebrew](https://brew.sh/): `brew install ffmpeg`. Git c'è già: la prima volta che scrivi `git`
nel Terminale, il Mac ti propone di installare gli strumenti necessari.

### Linux

Installa Git con il gestore dei pacchetti (`sudo apt install git` su Debian/Ubuntu/Raspberry Pi OS)
e Go seguendo <https://go.dev/doc/install> (le versioni nei gestori di pacchetti sono spesso vecchie).
Per Node.js 22 segui <https://nodejs.org/en/download>. FFmpeg: `sudo apt install ffmpeg`.

## 2. Scarica il progetto

Apri PowerShell (Windows) o il Terminale (Mac e Linux), vai nella cartella dove vuoi tenerlo e scrivi:

```sh
git clone https://github.com/FranzGra/FranzPLAY.git
cd FranzPLAY
```

Per provare una pull request **prima** di unirla, passa al suo ramo (il nome è scritto nella
pull request, accanto a "wants to merge ... from"):

```sh
git fetch
git checkout nome-del-ramo
```

Per tornare alla versione principale: `git checkout main`. Per scaricare le novità: `git pull`.

## 3. Lancia i test

```sh
go test ./...
```

La prima volta Go scarica e compila quello che serve, poi per ogni parte del programma deve
comparire `ok`. Se compare `FAIL`, qualcosa non va: copia il messaggio e mandamelo.

## 4. Prepara l'interfaccia

La prima volta, e ogni volta che scarichi novità sull'interfaccia:

```sh
cd web
npm ci
npm run build
cd ..
```

`npm ci` scarica le librerie dell'interfaccia (la prima volta ci mette un minuto),
`npm run build` la prepara e la mette dentro il programma.

## 5. Avvia FranzPLAY

```sh
go run ./cmd/franzplay
```

Vedrai una riga come `msg="FranzPLAY started" ... addr=:8090`. Ora apri il browser su:

**<http://localhost:8090>**

Compare FranzPLAY in tema scuro. Per vederlo come su un telefono, restringi la finestra del
browser: il menu laterale sparisce e compare la barra in basso con Home, Playlist e Profilo.

Per controllare solo il server, apri <http://localhost:8090/api/health>: deve comparire qualcosa
come `{"status":"ok","version":"dev"}`.

- Su Windows può comparire un avviso del firewall: puoi scegliere "Annulla", per provare sullo
  stesso computer non serve aprire niente.
- Per **fermarlo**, torna nella finestra del terminale e premi **Ctrl+C**. Vedrai
  `FranzPLAY stopped`.
- Il programma crea una cartella `data` accanto al progetto: è la sua cartella dati, con dentro
  il database `franzplay.db`. Puoi cancellarla quando vuoi: FranzPLAY la ricrea.

### Indicare la cartella dei tuoi video

FranzPLAY cerca i video nelle cartelle scritte in `FRANZPLAY_LIBRARIES`. Le legge e basta: non
crea, non rinomina e non cancella mai niente lì dentro. Le sottocartelle diventano categorie.

Windows (PowerShell), con più cartelle separate da `;`:

```powershell
$env:FRANZPLAY_LIBRARIES = "D:\Video;E:\Film di famiglia"
go run ./cmd/franzplay
```

Mac e Linux, con più cartelle separate da `:`:

```sh
FRANZPLAY_LIBRARIES="$HOME/Video:/media/disco/Famiglia" go run ./cmd/franzplay
```

All'avvio e poi ogni minuto FranzPLAY controlla le cartelle e scrive nel terminale cosa ha trovato,
per esempio `library scan finished ... added=12`. Subito dopo legge durata e risoluzione di ogni
video nuovo, uno alla volta (`job done kind=probe ...`). I video non si vedono ancora
nell'interfaccia: arriveranno nei prossimi passi.

### Cambiare porta

Se la porta 8090 è occupata, puoi sceglierne un'altra.

Windows (PowerShell):

```powershell
$env:FRANZPLAY_ADDR = ":9000"
go run ./cmd/franzplay
```

Mac e Linux:

```sh
FRANZPLAY_ADDR=:9000 go run ./cmd/franzplay
```

## 6. Facoltativo: gli stessi controlli di GitHub

Su Mac e Linux, con `make` e [golangci-lint](https://golangci-lint.run/welcome/install/)
installati, `make check` lancia esattamente i controlli che GitHub fa a ogni modifica.
Su Windows non serve: GitHub li fa comunque in automatico su ogni pull request.

Per i soli controlli dell'interfaccia, su qualsiasi sistema: `cd web` e poi `npm run check`.
