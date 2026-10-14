# 0006 · Più lingue audio

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Il problema

Un film può avere dentro più **tracce audio**: per esempio italiano e inglese. I browser però
suonano sempre e solo **la prima**: non c'è un modo affidabile per dirgli «usa l'altra».

## Cosa abbiamo deciso

- Il lavoro «Lingue e sottotitoli» legge, per ogni video, anche le sue tracce audio (lingua, nome,
  formato) e le salva nel database. Il file del video non si tocca (regola 1).
- Quando c'è più di una lingua, nel player compare **Impostazioni → Audio**. La lingua del file
  (quella che il file segna come principale, o la prima) si guarda come sempre.
- Per un'altra lingua, FranzPLAY **rimonta il video al volo**: ffmpeg prende l'immagine **così
  com'è** (la copia, non la converte) e ci mette accanto la traccia scelta, mentre il video si
  guarda. Non si scrive niente su disco.
- La traccia audio si copia se tutti i browser la conoscono (AAC, MP3); se no (per esempio l'AC3
  dei film, o l'Opus dei video presi dal web) si converte in AAC stereo, che costa poco.
- Al massimo **3 video** alla volta si guardano così; oltre, il server risponde «occupato» e il
  player torna alla lingua del file, con un messaggio.
- Il player ricorda la lingua scelta e la usa per i video successivi che ce l'hanno.

## Perché

**Al volo e non copie pronte.** Fare in anticipo una copia del film per ogni lingua vorrebbe dire
raddoppiare o triplicare lo spazio usato, e ore di lavoro sul Raspberry. Rimontare al volo costa
poco perché l'immagine, che è la parte pesante, viene solo copiata.

**Dove parte il video rimontato.** Un video può iniziare solo da un **fotogramma chiave** (un
fotogramma completo; gli altri descrivono solo cosa cambia). Quindi se chiedi il minuto 14, ffmpeg
parte un po' prima, per esempio dal 12. Per sapere esattamente da dove, il server lo chiede a
ffmpeg stesso, facendo lo stesso salto: così il player conta il tempo giusto e va da solo al 14.

**Andare avanti e indietro.** Il video rimontato arriva un pezzo alla volta e non si può saltare
in un punto non ancora arrivato: in quel caso il player chiede al server un nuovo video che parte
da lì. La durata la prende dal catalogo, perché il video rimontato non la conosce.

## Su iPhone, iPad e Mac

Safari non sa guardare il video rimontato al volo: vuole ricevere ogni video **a pezzi**, chiedendo
lui quale pezzo, e un video che nasce mentre si guarda non ha pezzi da dare. In compenso Safari,
unico tra i browser, sa **cambiare da solo** la traccia audio di un file (`audioTracks`).

Così su Safari il player non chiede niente al server: dice al browser quale traccia suonare, sul
file stesso o sulla sua copia (decisione [0022](0022-video-su-apple.md)), che tengono tutte le
tracce nello stesso ordine. Il cambio è immediato e non costa niente al server. Chrome e Firefox
continuano con il video rimontato.
