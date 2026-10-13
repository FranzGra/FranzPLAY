# FranzPLAY con Docker

Il modo più semplice per installare FranzPLAY a casa: su un Raspberry Pi, su ZimaOS, su un
vecchio portatile o sul tuo computer. Non servono Go, Node.js né FFmpeg: c'è già tutto dentro.

**Docker** è un programma che fa girare altri programmi dentro una "scatola" chiusa, il
**contenitore**, con tutto quello che serve già dentro. L'**immagine** è il modello da cui nasce
la scatola: quella di FranzPLAY contiene il programma, l'interfaccia, FFmpeg e Whisper (per i
sottotitoli automatici), ed è pronta sia per i computer normali sia per Raspberry Pi e ZimaBlade.

## 1. Installa Docker (una volta sola)

- **ZimaOS**: c'è già.
- **Raspberry Pi** e **Linux**: `curl -fsSL https://get.docker.com | sh`, poi
  `sudo usermod -aG docker $USER` ed esci e rientra (così non serve scrivere `sudo` ogni volta).
- **Windows** e **Mac**: installa [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  e avvialo.

Controlla che funzioni: `docker compose version` deve scrivere un numero di versione.

Sul Raspberry Pi serve il sistema a **64 bit** (Raspberry Pi OS 64-bit, quello consigliato).

## 2. Prendi i due file di FranzPLAY

Servono solo due file: `compose.yaml` (com'è fatto FranzPLAY) e `.env.example` (le tue scelte).
Crea una cartella, per esempio `franzplay`, e scaricali lì dentro:

```sh
mkdir franzplay && cd franzplay
curl -fsSLO https://raw.githubusercontent.com/FranzGra/FranzPLAY/main/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/FranzGra/FranzPLAY/main/.env.example
cp .env.example .env
```

Se hai già scaricato tutto il progetto con `git clone`, sono già nella sua cartella principale:
basta `cp .env.example .env`.

## 3. Scrivi le tue scelte nel file `.env`

Apri `.env` con un editor di testo (`nano .env` sul Raspberry Pi). Ogni riga è spiegata. Di
solito basta cambiare **una riga**, la cartella dei tuoi video:

```sh
FRANZPLAY_VIDEO_FOLDER=/media/disco/Video
```

Le altre hanno già un valore che va bene:

| Impostazione | Di solito | Cosa fa |
|---|---|---|
| `FRANZPLAY_VIDEO_FOLDER` | da scrivere | La cartella dei tuoi video. FranzPLAY la vede in **sola lettura**: non può toccarla |
| `FRANZPLAY_DATA_FOLDER` | `./data` | La cartella dati: database, copertine, anteprime, video caricati. Deve stare fuori da quella dei video |
| `FRANZPLAY_PORT` | `8090` | La porta del sito |
| `PUID` e `PGID` | `1000` | Il tuo utente: i file della cartella dati saranno tuoi. Li vedi con il comando `id` |
| `TZ` | `Europe/Rome` | Il fuso orario |
| `FRANZPLAY_IMAGE_TAG` | `latest` | La versione di FranzPLAY |
| `COMPOSE_PROFILES`, `FRANZPLAY_TRANSLATE_URL`… | spente | La traduzione dei sottotitoli, vedi più sotto |

## 4. Avvia FranzPLAY

```sh
docker compose up -d
```

La prima volta Docker scarica l'immagine (circa 60 MB) e la avvia; `-d` vuol dire "in sottofondo":
il terminale torna libero e FranzPLAY resta acceso, anche dopo un riavvio del computer.

Apri il browser su **http://indirizzo-del-computer:8090**: sullo stesso computer è
<http://localhost:8090>, da un telefono in casa è l'indirizzo del Raspberry Pi, per esempio
`http://192.168.1.20:8090`.

**Il primo accesso.** FranzPLAY chiede un **codice di installazione**, per essere sicuro che sei
tu. Lo trovi così:

```sh
docker compose logs franzplay | grep setup_code
```

Scrivi il codice, il tuo nome e una password: sei l'amministratore. Da qui in poi tutto è come
spiegato in [provare-sul-pc.md](provare-sul-pc.md#il-primo-accesso).

## Tutti i giorni

| Per… | Scrivi |
|---|---|
| vedere se è acceso e sta bene | `docker compose ps` (deve dire `healthy`) |
| guardare cosa fa | `docker compose logs -f franzplay` (Ctrl+C per uscire) |
| fermarlo | `docker compose down` (i tuoi dati restano) |
| riaccenderlo | `docker compose up -d` |
| **aggiornarlo** | `docker compose pull` e poi `docker compose up -d` |
| dopo aver cambiato `.env` | `docker compose up -d` |

**Copia di sicurezza.** Tutto quello che FranzPLAY sa sta nella cartella dati. Fermalo
(`docker compose down`), copia la cartella dove vuoi e riaccendilo. Per spostare FranzPLAY su un
altro computer: stessa cosa, e sul nuovo scrivi in `.env` dove hai messo la cartella.

## Più cartelle di video

In `compose.yaml`, sotto `volumes:`, togli il `#` alla riga della seconda cartella e scrivi il suo
percorso a sinistra dei due punti:

```yaml
      - /media/altro-disco/Film:/videos2:ro
```

Poi, sempre in `compose.yaml`, aggiungi la nuova cartella a `FRANZPLAY_LIBRARIES`:

```yaml
      FRANZPLAY_LIBRARIES: /videos:/videos2
```

E infine `docker compose up -d`. Il `:ro` alla fine è importante: vuol dire sola lettura.

## Sottotitoli automatici e traduzioni

**Whisper**, che scrive i sottotitoli ascoltando i video, è già dentro l'immagine. In
**Amministrazione › Sottotitoli** scegli e scarica un modello (finisce nella cartella dati) e
FranzPLAY è pronto.

Per **tradurre** i sottotitoli serve **LibreTranslate**, un traduttore che gira a casa tua. In
`.env` togli il `#` a queste due righe:

```sh
COMPOSE_PROFILES=traduzioni
FRANZPLAY_TRANSLATE_URL=http://libretranslate:5000
```

e `docker compose up -d`. La prima volta LibreTranslate scarica le lingue scelte in
`LIBRETRANSLATE_LANGUAGES` (italiano e inglese, se non scrivi altro) e ci mette qualche minuto.
Attenzione: vuole 1-2 GB di memoria, troppa per un Raspberry Pi da 2 GB. Se hai già un
LibreTranslate su un altro computer, scrivi solo il suo indirizzo in `FRANZPLAY_TRANSLATE_URL`.

## Portare i dati dal vecchio FranzPLAY

La guida è [importare-dal-vecchio.md](importare-dal-vecchio.md). Con Docker cambia solo il modo di
lanciare l'importazione: metti la copia del vecchio database, per esempio `vecchio.sql`, nella
cartella dati, poi:

```sh
docker compose stop
docker compose run --rm franzplay franzplay import-old -try /data/vecchio.sql   # prova, non salva niente
docker compose run --rm franzplay franzplay import-old /data/vecchio.sql        # importa davvero
docker compose up -d
```

## Costruire l'immagine da solo

Se l'immagine pronta non si riesce a scaricare, `docker compose up -d` la costruisce da sola dal
progetto (serve averlo scaricato con `git clone`). Per costruirla apposta, per esempio per provare
una modifica:

```sh
docker compose build
docker compose up -d
```

Su un computer normale ci vogliono pochi minuti; su un Raspberry Pi di più, perché Whisper va
compilato. Per la prova completa che fa anche GitHub (avvia FranzPLAY con un video vero, lo
guarda e controlla che la cartella dei video resti intatta):

```sh
docker build -t ghcr.io/franzgra/franzplay:smoke .
docker/smoke-test.sh smoke
```

## Se qualcosa non va

- **«scrivi in .env la cartella dei tuoi video»**: manca `FRANZPLAY_VIDEO_FOLDER` nel file `.env`,
  o il file non si chiama proprio `.env`.
- **La porta è occupata** (`port is already allocated`): cambia `FRANZPLAY_PORT`, per esempio
  `9000`, e apri `http://indirizzo:9000`.
- **I video non compaiono**: in Amministrazione › Cartelle FranzPLAY dice se non riesce a leggere
  la cartella. Controlla il percorso in `.env` e che il tuo utente possa leggere i file.
- **Windows**: nei percorsi usa le barre `/`, per esempio `C:/Users/Francesco/Videos`.
- **Sistema a 32 bit** (vecchi Raspberry Pi): l'immagine non c'è. Usa il programma da solo,
  come spiegato in [provare-sul-pc.md](provare-sul-pc.md).

## Com'è fatta l'immagine

Per chi è curioso, i file sono:

- `Dockerfile`: la ricetta dell'immagine, in quattro passi. L'interfaccia e il programma Go si
  preparano sul computer che costruisce (anche per il Raspberry Pi, quindi in fretta); Whisper si
  compila per il sistema di arrivo; alla fine restano solo Alpine Linux (un sistema minuscolo),
  FFmpeg e i due programmi.
- `docker/entrypoint.sh`: all'avvio dà la cartella dati al tuo utente (`PUID`/`PGID`) e fa partire
  FranzPLAY con quell'utente, mai come amministratore del sistema (root).
- `compose.yaml`: monta i video in sola lettura, tiene i log piccoli, chiede a Docker di
  controllare ogni 30 secondi che FranzPLAY risponda (lo vedi con `docker compose ps`) e lo riaccende se si ferma.
- `.github/workflows/docker.yml`: a ogni modifica GitHub costruisce l'immagine per computer
  normali e per ARM, la prova con `docker/smoke-test.sh` e, quando la modifica entra in `main`,
  la pubblica su `ghcr.io/franzgra/franzplay`.

FranzPLAY acceso e fermo, con la libreria vuota, usa circa 25 MB di memoria.
