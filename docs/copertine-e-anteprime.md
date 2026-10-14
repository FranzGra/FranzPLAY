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
└── previews/     i fotogrammi della timeline
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

Metti nella cartella del video un'immagine con **lo stesso nome del video**. Per `mare.mp4`
FranzPLAY cerca, in quest'ordine:

```
mare.jpg   mare.jpeg   mare.png   mare.webp
mare-poster.jpg   mare-poster.png   mare-thumb.jpg   mare-thumb.png
```

È lo stesso modo in cui **yt-dlp** salva le copertine con `--write-thumbnail`, quindi i video
scaricati così hanno già la loro copertina. L'immagine viene **solo letta**: FranzPLAY non la
sposta, non la rinomina e non la cambia.

**Attenzione:** l'immagine viene cercata quando la copertina viene creata, cioè quando il video
arriva o cambia. Se la metti **dopo**, il video tiene la copertina che aveva. Per fargliela
prendere:

- se la copertina era una scelta tua: in **Amministrazione › Video › Copertina** premi
  **Torna a quella automatica**;
- se era automatica: premi **Scegli un momento**, poi **Usa il momento** (uno qualsiasi), poi
  **Torna a quella automatica**. La copertina viene rifatta e trova l'immagine.

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
