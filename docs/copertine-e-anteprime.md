# Copertine e anteprime

Per ogni video FranzPLAY prepara tre cose da guardare:

| Cosa | Dove si vede | Com'è fatta |
|---|---|---|
| **Copertina** | la foto ferma del video, in ogni pagina | un'immagine JPEG larga **640** pixel |
| **Anteprima** | i secondi che partono tenendo il mouse sulla copertina; sul telefono parte da sola la scheda che resta al centro dello schermo quando smetti di scorrere | un video MP4 di **6 secondi**, senza audio, in due versioni: **360p** e **720p** |
| **Fotogrammi della timeline** | la miniatura sopra la barra del tempo, mentre ci passi sopra col mouse | una sola immagine JPEG a griglia, con fino a **100** fotogrammi da **480×270** |

Le crea da solo, in sottofondo, uno alla volta, appena trova un video nuovo o cambiato. Puoi
seguire il lavoro in **Amministrazione › Lavori**.

## Dove finiscono

**Mai nella cartella dei video**: FranzPLAY non scrive niente lì dentro. Tutto va nella
**cartella dati** (`FRANZPLAY_DATA_DIR`):

- sul PC, avviato con `make run`: la cartella `data/` del progetto;
- con Docker: `/data` dentro il contenitore, cioè la cartella `./data` accanto a `compose.yaml`
  (o quella che hai scritto in `FRANZPLAY_DATA_FOLDER` nel file `.env`).

```
data/
├── covers/       le copertine
├── own-covers/   le immagini che hai caricato tu come copertina
├── clips/        le anteprime leggere (360p)
├── clips-hd/     le stesse anteprime, nitide (720p)
├── own-clips/    i video che hai caricato tu come anteprima
├── previews/     i fotogrammi della timeline
└── category-pictures/  le copie leggere delle immagini delle categorie
```

Il nome di ogni file cambia quando cambia il video, così il browser non mostra mai quello vecchio.
I file che nessun video usa più vengono tolti da soli al successivo avvio.

## La copertina

FranzPLAY sceglie la copertina in quest'ordine; vince la prima che trova:

1. **quella che scegli tu** in **Amministrazione › Video**, sul video, pulsante **Copertina**:
   **Carica un'immagine** (JPG, PNG o WebP fino a 10 MB, tagliata in 16:9 come le altre),
   **Scegli un momento** del video, oppure **Cerca su internet**;
2. **un'immagine accanto al video**, con lo stesso nome (vedi sotto);
3. un'immagine trovata **su internet** (YouTube, TMDB, ThePornDB), solo se l'hai accesa in
   **Amministrazione › Internet**;
4. un **fotogramma del video**, preso a un decimo della durata (al massimo al primo minuto), per
   saltare schermate nere e titoli iniziali.

Qualunque sia la fonte, la copertina viene rifatta come JPEG largo al massimo 640 pixel (mai
ingrandita): leggera da scaricare e nitida sul telefono e nella griglia del computer.

### Usare un'immagine tua accanto al video

Metti nella cartella del video un'immagine con **lo stesso nome del video**: FranzPLAY usa quella
come copertina e **non prende nessun fotogramma** dal video. Per `mare.mp4` cerca, in
quest'ordine:

```
mare.jpg          mare.jpeg          mare.png          mare.webp
mare-poster.jpg   mare-poster.jpeg   mare-poster.png   mare-poster.webp
mare-thumb.jpg    mare-thumb.jpeg    mare-thumb.png    mare-thumb.webp
mare-cover.jpg    mare-cover.jpeg    mare-cover.png    mare-cover.webp
```

- **Maiuscole e minuscole non contano**: va bene anche `MARE.JPG`.
- Sono gli stessi nomi che usano **Jellyfin** e **Kodi**, e il modo in cui **yt-dlp** salva le
  copertine con `--write-thumbnail`: i video scaricati così hanno già la loro copertina.
- L'immagine viene **solo letta**: FranzPLAY non la sposta, non la rinomina e non la cambia. Ne fa
  una copia leggera (JPEG largo 640 pixel, tagliato in 16:9 al centro come tutte le copertine)
  nella cartella dati.
- **Puoi metterla quando vuoi**, anche dopo che il video è già su FranzPLAY: al controllo successivo
  delle cartelle (entro un minuto, oppure subito con **Amministrazione › Cartelle ›
  Controlla adesso**) la copertina cambia da sola. Lo stesso se **sostituisci** l'immagine con un'altra
  o la **togli**: senza immagine si torna al fotogramma del video.
- Se in **Amministrazione › Video › Copertina** hai scelto tu una copertina, vince sempre la tua
  scelta. Per tornare all'immagine nella cartella premi **Torna a quella automatica**.

## L'immagine delle categorie

Ogni sottocartella della cartella video è una **categoria** (i video in `Viaggi/` sono nella
categoria Viaggi). Se dentro quella cartella metti un'immagine con uno di questi nomi, diventa
l'immagine della categoria al posto della card colorata con la cartellina:

| Forma | Nomi (in ordine: vince il primo) |
|---|---|
| **verticale** (poster) | `poster` · `cover` · `folder` · `categoria` · `category` · `copertina` |
| **orizzontale** | `landscape` · `backdrop` · `fanart` · `thumb` · `sfondo` · `background` |

Con estensione `.jpg`, `.jpeg`, `.png` o `.webp`; maiuscole e minuscole non contano. Sono i nomi
di **Jellyfin** e **Kodi**, quindi una cartella preparata per loro funziona già.

```
Viaggi/
├── poster.jpg      verticale: il "libro" nella card e accanto al nome
├── fanart.jpg      orizzontale: lo sfondo della card e della pagina
├── Sardegna.mp4
└── Roma.mp4
```

- **Conta la forma vera dell'immagine**, non il nome: un `poster.jpg` più largo che alto viene
  usato come immagine orizzontale. Il nome serve solo a scegliere quando ce ne sono più di una.
- Va messa **direttamente** nella cartella della categoria (non in una sottocartella).
- Puoi metterle **entrambe**, solo una, o nessuna:
  - **orizzontale**: riempie la card nella pagina **Categorie** e fa da sfondo alla fascia in cima
    alla pagina della categoria;
  - **solo verticale**: la card resta del suo colore e il poster sta nell'angolo, un po' inclinato
    (si raddrizza passandoci sopra col mouse); nella pagina della categoria il poster sta accanto
    al nome, e lo stesso poster sfocato fa da sfondo;
  - **nessuna**: tutto resta com'era, con la card colorata e la cartellina.
- Se in **Amministrazione › Categorie** hai caricato tu un'immagine, vince la tua al posto di
  quella orizzontale.
- Come per le copertine, l'immagine viene **solo letta**: FranzPLAY ne fa una copia leggera (lato
  più lungo al massimo 1280 pixel) nella cartella dati. Se la aggiungi, la cambi o la togli, la
  pagina si aggiorna da sola entro un minuto.

## L'anteprima sulla copertina

- È fatta di **3 pezzi da 2 secondi**, presi a un quarto, a metà e a tre quarti del video, così
  si capisce com'è tutto il video e si saltano sigle e titoli di coda. Un video sotto i 30 secondi
  dà un pezzo solo; uno sotto i 4 secondi non ha anteprima.
- Esiste in **due versioni**, fatte insieme con un solo passaggio di FFmpeg:
  - **leggera**, 360p: poche centinaia di KB;
  - **nitida**, 720p (o meno, se il video è più piccolo: non viene mai ingrandita).
- **Il browser sceglie quale scaricare** ogni volta che un'anteprima parte: quella nitida se la
  connessione è buona (come il Wi-Fi di casa), quella leggera se è lenta (3G o meno di 5 megabit
  al secondo) o se il telefono è in "risparmio dati". Chrome, Edge e Android lo sanno; Safari e
  Firefox no, e allora prendono quella nitida, che pesa comunque poco.
- Si scarica **solo quando parte**, non quando apri la pagina.

In **Amministrazione › Video**, pulsante **Anteprima**, puoi:

- **Carica un video**: un MP4 o WebM tuo (fino a 100 MB); FranzPLAY ne usa i primi 15 secondi,
  senza audio, e ne fa le due versioni come per le altre;
- **Rifalla dal video**: torna all'anteprima fatta da FranzPLAY;
- **Nessuna anteprima**: su quel video non parte niente.

Perché 720p e non 1080p: [decisione 0020](decisioni/0020-anteprime-alta-e-bassa-qualita.md).

## I fotogrammi della timeline

- FranzPLAY prende un fotogramma ogni pochi secondi: il più spesso possibile (al massimo uno ogni
  2 secondi), ma **non più di 100** in tutto. In un video di 10 minuti, uno ogni 6 secondi.
- Ogni fotogramma è rimpicciolito a **480×270**, con le bande nere se il video ha un'altra forma.
  Il player lo mostra largo 240 punti sul computer e 160 sul telefono: gli schermi del Mac hanno
  2 pixel veri per punto e quelli dei telefoni 3, quindi 480 pixel bastano a vederlo nitido su
  entrambi. L'immagine intera pesa circa mezzo mega. Perché non in Full HD:
  [decisione 0021](decisioni/0021-fotogrammi-timeline-nitidi.md).
- Le anteprime fatte dalle versioni vecchie (160×90) continuano a funzionare e vengono rifatte
  da sole, una alla volta, in sottofondo.
- Tutti insieme stanno in **una sola immagine** a griglia (10 per riga), che il player scarica una
  volta sola quando apri il video. Così passare sulla barra è immediato.
- Per andare veloce anche su un Raspberry, usa i fotogrammi "chiave" del video: sono un po' meno
  precisi al secondo, ma si fanno in pochi secondi anche su un film lungo.
