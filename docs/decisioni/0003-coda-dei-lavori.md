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
partenza successiva quel lavoro ricomincia. Nel pannello admin (tappa 2) si vedranno i lavori in
coda e quelli falliti, con il tasto "riprova".

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
