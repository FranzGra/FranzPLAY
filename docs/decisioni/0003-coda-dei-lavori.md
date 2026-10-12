# 0003 · La coda dei lavori pesanti

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Cosa abbiamo deciso

- I lavori pesanti (leggere un video con `ffprobe`, e presto fare le copertine con `ffmpeg`)
  stanno in una **coda dentro il database**, la tabella `jobs`.
- C'è **un solo lavoratore**: fa un lavoro alla volta (regola 5).
- Quando la scansione trova un video nuovo o cambiato, mette in coda la sua lettura e
  "sveglia" il lavoratore.

## Perché

**Un lavoro alla volta.** Su un Raspberry Pi due ffmpeg insieme rendono lento tutto, anche chi
sta guardando un video. Per ora il numero è fisso a uno; più avanti FranzPLAY potrà decidere in
base alla macchina.

**La coda nel database** sopravvive ai riavvii: se FranzPLAY si spegne a metà di un lavoro, alla
partenza successiva quel lavoro ricomincia. Nella pagina Amministrazione › Lavori si vedono i
lavori in coda e quelli falliti, con il tasto "Riprova", e la pagina segue la coda in tempo reale.

**Quando un lavoro fallisce:**
- ritenta dopo 5 minuti, poi dopo 10;
- al terzo errore si ferma e resta segnato come fallito, con il messaggio dell'errore;
- se l'errore non si può risolvere riprovando (per esempio un file `.mp4` che contiene solo
  audio) si ferma subito.

**Se il file cambia mentre lo si legge**, il risultato vecchio non viene salvato e il lavoro
riparte sul file nuovo.

## Cosa si legge di ogni video

Durata (in secondi), larghezza e altezza **come si vedono sullo schermo** (un video girato col
telefono in verticale risulta verticale), formato del video e dell'audio, tipo di file. Serviranno
per mostrare la durata sulle copertine e per decidere se il browser può riprodurre il video così
com'è.

## Le copertine

- Dopo la lettura con ffprobe, ogni video riceve una copertina JPEG larga 640 pixel (mai
  ingrandita), salvata in `data/covers/`.
- Se accanto al video c'è un'immagine con lo stesso nome (`mare.jpg`, `mare.png`, `mare.webp`,
  `mare-poster.jpg`, `mare-thumb.jpg`…) si usa quella: è il modo in cui yt-dlp salva le copertine.
  FranzPLAY la legge e basta, la copia ridotta finisce nella cartella dati.
- Altrimenti si prende un fotogramma a un decimo del video, al massimo al primo minuto, per
  evitare gli inizi neri e i titoli.
- Il nome del file della copertina cambia quando cambia il contenuto del video, così il browser
  non mostra mai la copertina vecchia.
- La copertina si scrive in un file temporaneo e si rinomina solo a lavoro finito (regola 6).
- All'avvio FranzPLAY cancella le copertine che nessun video usa più (video dimenticati).

## Le anteprime della barra del player

- Dopo la copertina, ogni video lungo almeno 4 secondi riceve le **anteprime**: piccoli
  fotogrammi (160×90) presi ogni 2 secondi, o più distanti nei video lunghi, mai più di 100.
  Stanno tutti in **un'unica immagine** a griglia (10 per riga) in `data/previews/`: il browser
  la scarica una volta sola e mostra il pezzo giusto mentre il mouse scorre sulla barra.
- Per essere veloci anche su un Raspberry Pi, ffmpeg legge solo i **fotogrammi chiave** del video
  invece di guardarlo tutto: l'anteprima è un po' meno precisa, ma pronta in pochi secondi.
  Se un video ha un solo fotogramma chiave (capita nelle clip corte), si leggono tutti.
- Prima si scrivono i fotogrammi uno per uno in una cartella temporanea, così si sa quanti sono
  davvero; poi si uniscono. Solo l'immagine finita esce dalla cartella temporanea (regola 6).
- L'ordine dei lavori: prima le letture con ffprobe, poi le copertine (servono a ogni pagina),
  poi le anteprime, per ultimi i sottotitoli dentro il file.

## I sottotitoli dentro il file

- Molti `.mkv` (e alcuni `.mp4`) hanno i sottotitoli **dentro** il file. Il browser non li vede,
  quindi un lavoro «lingue e sottotitoli» (`tracks`) li copia come file WebVTT nella cartella dati,
  in `subtitles/`. Il video si legge e basta (regola 1).
- Prima ffprobe dice quali sottotitoli ci sono; poi **un solo** ffmpeg li copia tutti insieme, così il
  file si legge una volta sola. Per un film su un Raspberry Pi può volerci un po': i sottotitoli sono
  sparsi lungo tutto il video e ffmpeg deve attraversarlo tutto. Per questo è l'ultimo lavoro della coda.
- Si tengono solo i sottotitoli di testo (SRT, ASS, WebVTT, quelli degli `.mp4`). Quelli fatti di
  immagini (DVD, Blu-ray) il browser non li sa mostrare: per ora si saltano.
- Le copie si scrivono in una cartella temporanea e si spostano solo quando sono tutte pronte
  (regola 6). Il nome cambia quando cambia il contenuto del video, e all'avvio si cancellano le copie
  che nessun video usa più.
- Nel player compaiono dopo i sottotitoli messi accanto al video, che qualcuno ha messo lì apposta.
