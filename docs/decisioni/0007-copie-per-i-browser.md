# 0007 · Copie per i browser

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Il problema

Alcuni video non si vedono in tutti i browser: per esempio molti `.mkv` e `.avi`, i film in HEVC
o con l'audio AC3. Il file non si può modificare (regola 1).

## Cosa abbiamo deciso

- Dopo aver letto un video, FranzPLAY decide da solo se serve una **copia**: un file MP4 con
  immagine H.264 e audio AAC o MP3, che si vede ovunque, anche su iPhone, iPad e Mac (vedi la
  decisione [0022](0022-video-su-apple.md)). La copia sta
  nella cartella dati, in `converted/`, e prende il nome dal contenuto, come le copertine.
- **Due casi.** Se l'immagine va già bene e cambia solo la "scatola", l'immagine viene copiata:
  pochi minuti anche per un film. Se l'immagine va rifatta, ffmpeg la codifica di nuovo in H.264,
  al massimo a 1080p.
- La copia tiene **tutte le tracce audio**, nello stesso ordine: la scelta della lingua
  (decisione 0006) funziona anche sulla copia. I sottotitoli restano fuori: FranzPLAY li mostra
  dalle sue copie.
- Quando la copia è pronta, il player la usa al posto del file. Se il file cambia, la copia
  vecchia si cancella; se il nuovo file si vede ovunque, non se ne fa un'altra.

## Perché così

**Ultima nella coda, e cede il passo.** Rifare l'immagine di un film su un Raspberry Pi può
richiedere ore. Se in quel tempo la coda fosse ferma, un video nuovo resterebbe senza copertina
fino a sera. Quindi la copia è l'ultimo lavoro della coda e, appena arriva altro lavoro, si
**ferma**: il lavoro nuovo passa, poi la copia riparte da capo. Ricominciare spreca un po' di
tempo, ma è molto più semplice e sicuro che riprendere a metà.

**Metà dei processori.** ffmpeg usa metà dei processori, così il sito resta veloce mentre lavora.

**Un tempo massimo più lungo.** Gli altri lavori si fermano dopo 10 minuti, perché vuol dire che
qualcosa è bloccato. La copia ha fino a 24 ore.

**Tutto o niente** (regola 6): ffmpeg scrive in un file temporaneo, rinominato solo a lavoro finito.
Un lavoro interrotto non lascia mezze copie: all'avvio FranzPLAY cancella quelle avanzate.
