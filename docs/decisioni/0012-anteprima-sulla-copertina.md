# 0012 · Anteprima sulla copertina

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Il problema

Nella versione vecchia, tenendo il mouse su un video partiva un pezzetto del video al posto della
copertina. Lo vogliamo anche qui, e anche sul telefono.

## Cosa abbiamo deciso

- Per ogni video FranzPLAY prepara una **anteprima**: 6 secondi **senza audio**, alti 360 pixel,
  in MP4. Pesa poche centinaia di KB.
- L'anteprima è fatta di **3 pezzi da 2 secondi**, presi a un quarto, a metà e a tre quarti del
  video. Così si capisce com'è tutto il video, e si saltano sigle e titoli di coda.
  Un video sotto i 30 secondi dà un pezzo solo; uno sotto i 4 secondi non ne ha.
- È un lavoro della coda (`clip`, «Anteprima sulla copertina»), uno alla volta come gli altri,
  e il file va nella cartella dati (`data/clips/`), **mai** nella cartella dei video.
- **Computer**: il mouse resta sulla copertina per 0,3 secondi e l'anteprima parte; esce e si
  ferma. Passare sopra veloce non fa partire niente.
- **Telefono**: il dito **tiene premuto** sulla copertina per 0,4 secondi e l'anteprima parte, e
  continua anche dopo aver alzato il dito. **Un tocco veloce apre il video**, come sempre.
  Scorrere la pagina non fa partire niente.
- Parte **una sola anteprima alla volta** in tutta la pagina.

## Perché così

- Preparare il file prima, invece di leggere il video vero al volo, è l'unico modo che va bene su
  un Raspberry: un video 4K o un formato che il browser non legge non si possono mostrare in una
  copertina, una piccola MP4 sì, su ogni browser.
- `ffmpeg` salta direttamente ai tre punti (`-ss` prima di `-i`), senza leggere il resto del
  video: anche su un film lungo ci mette pochi secondi.
- Il file si scarica solo quando l'anteprima parte, non quando si apre la pagina.
- Sul telefono il "tieni premuto" lascia al tocco il suo significato di sempre (aprire il video).
