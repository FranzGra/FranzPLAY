# 0009 · Informazioni dai file accanto ai video

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Il problema

Il titolo di un video viene dal nome del file, e spesso il nome è brutto:
`gita in montagna [dQw4w9WgXcQ].mp4`. Chi scarica i video con yt-dlp ha però, accanto a ogni video,
un file `.info.json` con il titolo vero, la descrizione, il canale e il giorno di pubblicazione.

## Cosa abbiamo deciso

- Un lavoro nuovo della coda, **«Informazioni dal file accanto»** (`details`), legge il file
  `<nome del video>.info.json`. Lo fa per ogni video nuovo o cambiato, e una volta per i video che
  c'erano già.
- FranzPLAY tiene solo **titolo** (fino a 200 caratteri), **descrizione** (fino a 5000), **autore**
  (il canale, o chi l'ha caricato) e **giorno**. Il resto del file (formati, commenti…) si ignora.
- Il testo si **pulisce all'ingresso** (regola 8): niente caratteri di controllo, una riga per
  titolo e autore, al massimo una riga vuota di fila nella descrizione; un giorno che non esiste
  viene scartato.
- Il titolo del nome resta salvato. Il database ha una colonna calcolata, `shown_title`, che dice
  in un posto solo quale titolo si vede: quello del file, se c'è, altrimenti quello del nome.
  Liste, ricerca, pagine admin e consigliati usano quella.
- Se il file sparisce, le sue informazioni si dimenticano e torna il titolo del nome.
- Un file che non si capisce (non è JSON, o è più grande di 16 MB) è un errore **permanente**,
  visibile in Amministrazione › Lavori: riprovare leggerebbe lo stesso file.

## Aggiunta: i file `.nfo` (12 ottobre 2026)

Lo stesso lavoro legge anche `<nome del video>.nfo`, il file di **Kodi** e **Jellyfin**.

- Si leggono i file su **un solo video**: `<movie>` (film), `<episodedetails>` (episodio; i
  programmi che salvano canali YouTube mettono qui il canale come «serie») e `<musicvideo>`.
- Titolo da `<title>`; descrizione da `<plot>`, se manca da `<outline>`; autore dal primo che c'è
  fra canale (`<showtitle>`), cantante (`<artist>`), regista (`<director>`) e studio (`<studio>`);
  giorno da `<premiered>`, `<aired>` o `<releasedate>`. Stessa pulizia e stessi limiti di sopra.
- Se ci sono **tutti e due** i file, vince il `.info.json` (è più preciso); il `.nfo` riempie solo
  quello che manca.
- Un `.nfo` con solo un indirizzo web (Kodi lo permette, per cercare da sé su internet) non dice
  niente del video: nessuna informazione, nessun errore. Un `.nfo` rotto, o più grande di 1 MB, è
  un errore permanente come sopra.

## Perché così

**Solo lettura** (regola 1): il file si legge e basta. Funziona **senza internet**. Leggere un
piccolo file è istantaneo: il lavoro va subito dopo la lettura del video, prima delle copertine.

**Un lavoro a sé** invece che dentro la lettura con ffprobe: così si può rileggere il file da solo
(per esempio dopo averlo aggiunto) senza rifare copertine e anteprime.

## Cosa resta per dopo

- Le fonti su internet (decisione E), solo se l'amministratore le accende.
- Accorgersi da solo quando un `.info.json` viene aggiunto dopo il video. Per ora si preme
  «Rifai copertina» in Amministrazione › Video.
