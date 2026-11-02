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

Su **Windows**, in PowerShell, i comandi sono un po' diversi (`curl.exe` con `.exe`, e `copy`
al posto di `cp`):

```powershell
mkdir franzplay; cd franzplay
curl.exe -fsSLO https://raw.githubusercontent.com/FranzGra/FranzPLAY/main/compose.yaml
curl.exe -fsSLO https://raw.githubusercontent.com/FranzGra/FranzPLAY/main/.env.example
copy .env.example .env
```

Se hai già scaricato tutto il progetto con `git clone`, sono già nella sua cartella principale:
basta `cp .env.example .env` (su Windows `copy .env.example .env`).

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
| `FRANZPLAY_DATA_FOLDER` | `./data` | La cartella dati: database, copertine, anteprime, video caricati. Deve stare fuori da quella dei video. **Su Windows e Mac scrivi `franzplay-data`**: la tiene Docker, perché il database su una cartella di Windows o del Mac sarebbe lento e a rischio |
| `FRANZPLAY_CONTENT_FOLDER` | spenta | La cartella dei contenuti, vedi [più sotto](#la-cartella-dei-contenuti) |
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

**Il primo accesso.** Compare la pagina **Benvenuto in FranzPLAY**: scrivi il tuo nome e una
password e sei l'amministratore. Non serve nessun codice. Fallo subito dopo l'installazione:
finché l'amministratore non esiste, il primo che apre il sito lo diventa. Da qui in poi tutto è
come spiegato in [provare-sul-pc.md](provare-sul-pc.md#il-primo-accesso).

> **Se il sito è già raggiungibile da internet** prima che tu crei l'amministratore, accendi il
> codice di installazione: in `.env` scrivi `FRANZPLAY_SETUP_CODE=true`. FranzPLAY allora chiede
> anche un codice che trovi con `docker compose logs franzplay | grep setup_code`.

## Tutti i giorni

| Per… | Scrivi |
|---|---|
| vedere se è acceso e sta bene | `docker compose ps` (deve dire `healthy`) |
| guardare cosa fa | `docker compose logs -f franzplay` (Ctrl+C per uscire) |
| fermarlo | `docker compose down` (i tuoi dati restano) |
| riaccenderlo | `docker compose up -d` |
| **aggiornarlo** | `docker compose pull` e poi `docker compose up -d` |
| dopo aver cambiato `.env` | `docker compose up -d` |

**Copia di sicurezza.** Il database si copia da solo ogni notte ([qui sotto](#se-il-database-si-perde)).
Per una copia di tutto: fermalo (`docker compose down`), copia la cartella dei dati dove vuoi e
riaccendilo. Per spostare FranzPLAY su un
altro computer: stessa cosa, e sul nuovo scrivi in `.env` dove hai messo la cartella.

Se usi `franzplay-data` (Windows e Mac), la cartella la tiene Docker: la vedi in Docker Desktop,
sezione **Volumes**, e da lì la puoi esportare.

## La cartella dei contenuti

Di solito non serve. Copertine, anteprime, sottotitoli, modelli e video caricati stanno nella
cartella dati. Per tenerli su un altro disco, in `.env` scrivi:

```sh
FRANZPLAY_CONTENT_FOLDER=/media/disco/FranzPLAY-contenuti
```

Il database resta nella cartella dati. FranzPLAY non parte se la cartella dei contenuti sta dentro
una cartella dei video, o la contiene.

Su un FranzPLAY già in uso i file già fatti non si spostano da soli: portali col comando qui sotto.
Il perché è in [0025](decisioni/0025-cartella-contenuti.md).

### Cosa c'è dentro

| Cartella | Cosa contiene |
| --- | --- |
| `video/<nome> [codice]/` | tutto quello che è di un video, e il suo `video.json` |
| `categorie/` | immagini, copie e `categorie.json` con le scelte |
| `modelli/whisper/`, `modelli/translator/` | i modelli scaricati |
| `utenti/` | le foto dei profili |
| `caricati/video/`, `caricati/in-arrivo/` | i video caricati dal sito |
| `database/` | le copie di sicurezza del database |

> **Attenzione: la cartella dei contenuti è riservata.** Contiene le copie del database (hash delle
> password, sessioni, chiavi API), i video caricati, anche quelli privati, e le foto dei profili.
> Non metterla in una condivisione e non darla a chi non deve vedere tutto.

Se la cartella dei contenuti è su un altro disco e quel disco non è montato, FranzPLAY **non parte** e
lo dice nel log, invece di rifare tutto in una cartella vuota. Monta il disco e riavvia. Se vuoi
davvero ripartire da zero con i contenuti, crea dentro una cartella vuota `video`; se vuoi portarci i
file vecchi, usa `migrate-content --apply` (qui sotto). Anche una cartella che non si legge (permessi)
ferma l'avvio.

Se invece FranzPLAY parte ma nel log trovi l'avviso **«the database knows folders of videos the
content folder does not have»**, sta usando una cartella dei contenuti diversa da quella che il
database conosce: di solito `FRANZPLAY_CONTENT_FOLDER` tolto da `.env` dopo il trasferimento, o il disco
non montato. Controlla `.env` e il disco, poi riavvia. Finché non lo fai quei video restano senza
copertine, anteprime e sottotitoli, ma niente viene cancellato.

### Se il database si perde

**Il database si ricostruisce da solo.** Ogni notte alle 4, e al primo avvio del giorno se manca,
FranzPLAY scrive `database/franzplay_GG-MM-AAAA.db` e tiene le ultime 7. All'avvio, se
`franzplay.db` non c'è, riparte dalla copia più recente sana e scrive nel log quale ha usato.
I video arrivati dopo la copia tornano dal loro `video.json`.

**Quello che è successo dopo l'ultima copia si perde.** Le copie si fanno alle 4 di notte e al primo
avvio del giorno: progressi di visione, «mi piace», commenti, utenti nuovi, playlist e condivisioni
fatti dopo quell'ora non tornano. Tornano invece i lavori sui video (copertine, anteprime,
sottotitoli), che stanno nelle loro cartelle.

Una copia vuota (un FranzPLAY appena nato) non prende mai il posto di una con dati, e la copia con
dati più recente non esce dalla rotazione.

| Caso | Cosa succede |
| --- | --- |
| Nessuna copia | Riparte da zero: copertine e scelte tornano da `video.json`, ma utenti e progressi no |
| Copia rovinata | Passa a quella del giorno prima |
| Copia di una versione più nuova del programma | Si ferma con un errore chiaro: aggiorna FranzPLAY, o togli quella copia |
| Vuoi ripartire da zero davvero | Svuota `database/` e cancella `franzplay.db` |

> **Attenzione:** in quelle copie ci sono hash delle password, sessioni e chiavi API. Sono leggibili
> solo dall'utente di FranzPLAY (0600): non mettere la cartella in una condivisione.

Le copie stanno nella cartella dei contenuti: tieni i contenuti su un altro disco e un disco rotto
non si porta via tutto.

Da `video.json` tornano anche video nascosti, video privati, chi li ha caricati e la data di
arrivo. Le condivisioni con singole persone e i link dei video privati stanno solo nel database:
senza copia si perdono, e il video resta chiuso. Se copia e `video.json` non sono d'accordo su chi
vede un video, vince `video.json` solo se è stato scritto dopo la copia; altrimenti vince il più
chiuso dei due.

Un video privato torna al suo proprietario solo se è lo stesso account (stesso nome e stessa data di
creazione). Un account rifatto con lo stesso nome è un'altra persona: il video resta **chiuso a
tutti**. Lo decidi tu da **Amministrazione › Video**, nella pagina del video, scheda **Chi lo vede**:
scegli il nuovo proprietario, oppure **Aprilo a tutti**.

Categorie: dopo un ripristino le scelte di `categorie/categorie.json` (nomi, colori, immagini)
vincono sulla copia solo se il file è stato scritto dopo la copia. Le immagini di categoria che
nessuno nomina più non si cancellano: restano in `categorie/` finché non le usi di nuovo o le
cancelli a mano. Lo stesso se `categorie.json` è rovinato: FranzPLAY non lo sovrascrive.

Se il `video.json` di una cartella è rovinato, o scritto da una versione più nuova, FranzPLAY non si
fida: non tocca la cartella, rifà il lavoro e **il video arriva nascosto**, perché poteva esserlo. Lo
rimostri tu da **Amministrazione › Video**. La cartella resta nel **Riepilogo**, scheda **Contenuti
senza video**, con il motivo.

### Portare i file di un FranzPLAY già in uso

Il comando `migrate-content` copia i file vecchi nelle cartelle nuove. **Non cancella niente** finché
non glielo chiedi. Si può fermare e rilanciare: riprende da dove era.

**1. Prepara e ferma FranzPLAY.** In `.env` scrivi `FRANZPLAY_CONTENT_FOLDER`, come qui sopra. Scarica
la versione nuova, perché il comando c'è solo lì, e ferma: il comando rifiuta se FranzPLAY è acceso.

```sh
docker compose pull
docker compose stop franzplay
```

**2. Guarda cosa farebbe.** Senza opzioni non cambia nulla: dice quanti file, quanto pesano e se c'è
spazio.

```sh
docker compose run --rm franzplay franzplay migrate-content
```

**3. Copia.** Prima fa una copia del database, `database/franzplay_prima-del-trasferimento_GG-MM-AAAA.db`.
Poi copia ogni file e ne controlla dimensione e sha256. Il database cambia solo alla fine, tutto
insieme.

```sh
docker compose run --rm franzplay franzplay migrate-content --apply
```

**4. Riaccendi e controlla** che video, copertine, categorie e foto si vedano.

```sh
docker compose up -d
```

**5. Quando sei sicuro, libera il disco.** Ferma di nuovo e cancella i vecchi. Ricontrolla copia per
copia: un file cambiato, o con la copia sparita, resta dov'è e te lo dice.

```sh
docker compose stop franzplay
docker compose run --rm franzplay franzplay migrate-content --remove-old
docker compose up -d
```

Finché i vecchi ci sono, le pulizie automatiche non li toccano. Da `--remove-old` in poi restano solo
i file mai copiati, quelli che nessun video nomina: il comando dice dove sono. Non servono, e
cancellarli tocca a te. Quando sono spariti, al primo avvio le pulizie ripartono da sole. Lo stesso
vale per la riga «File vecchi tenuti» della scheda **Contenuti senza video**.

I modelli e le foto non ancora portati continuano a funzionare: FranzPLAY cerca prima nella cartella
nuova, poi in quella vecchia. Anche i video caricati restano leggibili da `uploads/` finché non lanci
`--apply`.

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

Nell'immagine amd64 ci sono due versioni di Whisper: quella completa, per i processori con AVX2, e
quella di base, più lenta, per i processori piccoli (Celeron, Atom) che hanno almeno SSE4.2.
FranzPLAY sceglie da solo quando parte; la pagina dei sottotitoli dice quale usa. Se il processore
non ha nemmeno SSE4.2, la stessa pagina lo spiega e i sottotitoli automatici restano spenti.

Anche il **traduttore** è già dentro l'immagine: non c'è niente da impostare e non serve un altro
container. Quando chiedi una traduzione, il modello di quelle due lingue si scarica da solo nella
cartella dati, circa 36 MB per direzione. Lavora su un solo core e vuole circa 200 MB di memoria,
solo mentre traduce. Conosce inglese, italiano, spagnolo, francese e tedesco; tra due lingue
diverse dall'inglese passa dall'inglese.

Se preferisci **LibreTranslate**, un altro traduttore che gira a casa tua, in `.env` togli il `#` a
queste due righe:

```sh
COMPOSE_PROFILES=traduzioni
FRANZPLAY_TRANSLATE_URL=http://libretranslate:5000
```

e `docker compose up -d`. La prima volta LibreTranslate scarica le lingue scelte in
`LIBRETRANSLATE_LANGUAGES` (italiano e inglese, se non scrivi altro) e ci mette qualche minuto.
Attenzione: vuole 1-2 GB di memoria, troppa per un Raspberry Pi da 2 GB. Se hai già un
LibreTranslate su un altro computer, scrivi solo il suo indirizzo in `FRANZPLAY_TRANSLATE_URL`.

## Senza internet

Internet serve **solo per scaricare l'immagine** (la prima volta e per gli aggiornamenti). Dopo,
FranzPLAY parte e funziona anche con il cavo staccato: l'interfaccia, i caratteri e le icone sono
dentro l'immagine, e copertine, anteprime, copie per i browser e sottotitoli li fa FFmpeg sul tuo
computer. Nessun pezzo viene scaricato all'avvio. Ogni volta che si prepara una versione nuova,
un controllo automatico la avvia senza nessuna rete e verifica che parta e prepari le copertine.

Usano internet solo queste cose, e solo se le accendi tu:

- **Copertine e titoli da internet** (YouTube, TMDB, ThePornDB): sono spenti finché non li accendi in
  **Amministrazione › Internet**.
- **Il modello di Whisper**, la prima volta che premi «Scarica» in **Amministrazione ›
  Sottotitoli**. Senza internet FranzPLAY lo dice con un messaggio chiaro. Puoi anche portarlo tu:
  scarica il file su un altro computer, per esempio
  [ggml-small.bin](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin), e
  mettilo nella cartella `modelli/whisper` dentro la cartella dati. Se la cartella dati è
  `franzplay-data` (Windows e Mac), copialo così (il riavvio alla fine rende il file di FranzPLAY):

  ```sh
  docker compose exec franzplay mkdir -p /data/modelli/whisper
  docker compose cp ggml-small.bin franzplay:/data/modelli/whisper/ggml-small.bin
  docker compose restart
  ```

- **I modelli per tradurre**: si scaricano la prima volta che servono, quindi senza internet si
  traduce solo tra le lingue già scaricate.

- **LibreTranslate**, se lo accendi: la prima volta scarica le lingue. Poi a ogni avvio cerca
  aggiornamenti; senza internet lo scrive nel suo log e parte lo stesso con le lingue che ha.

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
- **Windows**: nei percorsi usa le barre `/`, per esempio `C:/Users/Nome/Videos`.
- **Nessuno riesce più a entrare** («troppi tentativi sbagliati»), neanche l'amministratore:
  qualcuno ha sbagliato apposta molte volte. Togli tutti i blocchi con
  `docker compose exec franzplay franzplay unblock` (senza Docker: `franzplay unblock`), poi
  riprova. Se FranzPLAY sta dietro un proxy (Caddy, Nginx…), scrivi il suo indirizzo in
  `FRANZPLAY_TRUSTED_PROXIES` nel file `.env`.
- **Sistema a 32 bit** (vecchi Raspberry Pi): l'immagine non c'è. Usa il programma da solo,
  come spiegato in [provare-sul-pc.md](provare-sul-pc.md).

## Com'è fatta l'immagine

Per chi è curioso, i file sono:

- `Dockerfile`: la ricetta dell'immagine, in quattro passi. L'interfaccia e il programma Go si
  preparano sul computer che costruisce (anche per il Raspberry Pi, quindi in fretta); Whisper si
  compila per il sistema di arrivo; alla fine restano solo Alpine Linux (un sistema minuscolo),
  FFmpeg e i due programmi.
- `docker/entrypoint.sh`: all'avvio dà la cartella dati e quella dei contenuti, se c'è, al tuo
  utente (`PUID`/`PGID`) e fa partire
  FranzPLAY con quell'utente, mai come amministratore del sistema (root).
- `compose.yaml`: monta i video in sola lettura, tiene i log piccoli, chiede a Docker di
  controllare ogni 30 secondi che FranzPLAY risponda (lo vedi con `docker compose ps`) e lo riaccende se si ferma.
- `.github/workflows/docker.yml`: a ogni modifica GitHub costruisce l'immagine per computer
  normali e per ARM, la prova con `docker/smoke-test.sh` e, quando la modifica entra in `main`,
  la pubblica su `ghcr.io/franzgra/franzplay`.

FranzPLAY acceso e fermo, con la libreria vuota, usa circa 25 MB di memoria.
