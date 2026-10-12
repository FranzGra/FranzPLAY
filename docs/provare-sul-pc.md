# Provare FranzPLAY sul tuo computer

Guida passo passo per scaricare il progetto, lanciare i test e avviare il programma.
Serve circa un quarto d'ora la prima volta, poi bastano pochi secondi.

## 1. Installa gli strumenti (una volta sola)

Servono due programmi:

- **Git**: scarica il progetto da GitHub e tiene traccia delle modifiche.
- **Go** (versione 1.24 o più nuova): il linguaggio di FranzPLAY. Compila e avvia il programma.

### Windows

1. Scarica e installa **Git** da <https://git-scm.com/download/win> (vanno bene tutte le opzioni proposte).
2. Scarica e installa **Go** da <https://go.dev/dl/> (il file `.msi` per Windows).
3. Apri **PowerShell** (cercalo nel menu Start) e controlla che funzionino:

   ```powershell
   git --version
   go version
   ```

   Se vedi due numeri di versione, è tutto a posto. Se dice "comando non trovato", chiudi e
   riapri PowerShell.

### Mac

Installa Go da <https://go.dev/dl/> (il file `.pkg`). Git c'è già: la prima volta che scrivi `git`
nel Terminale, il Mac ti propone di installare gli strumenti necessari.

### Linux

Installa Git con il gestore dei pacchetti (`sudo apt install git` su Debian/Ubuntu/Raspberry Pi OS)
e Go seguendo <https://go.dev/doc/install> (le versioni nei gestori di pacchetti sono spesso vecchie).

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

## 4. Avvia FranzPLAY

```sh
go run ./cmd/franzplay
```

Vedrai una riga come `msg="FranzPLAY started" ... addr=:8090`. Ora apri il browser su:

**<http://localhost:8090/api/health>**

Deve comparire qualcosa come `{"status":"ok","version":"dev"}`: il server è vivo.

- Su Windows può comparire un avviso del firewall: puoi scegliere "Annulla", per provare sullo
  stesso computer non serve aprire niente.
- Per **fermarlo**, torna nella finestra del terminale e premi **Ctrl+C**. Vedrai
  `FranzPLAY stopped`.
- Il programma crea una cartella `data` accanto al progetto: è la sua cartella dati. Puoi
  cancellarla quando vuoi, per ora è vuota.

### Cambiare porta o cartella dati

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

## 5. Facoltativo: gli stessi controlli di GitHub

Su Mac e Linux, con `make` e [golangci-lint](https://golangci-lint.run/welcome/install/)
installati, `make check` lancia esattamente i controlli che GitHub fa a ogni modifica.
Su Windows non serve: GitHub li fa comunque in automatico su ogni pull request.
