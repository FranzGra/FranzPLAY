# 0022 · Video che si vedono anche su iPhone, iPad e Mac

**Data:** 13 ottobre 2026 · **Stato:** decisa

## Il problema

FranzPLAY deve aprire tutto, come VLC. Su iPhone, iPad e Mac però molti video non
partivano, soprattutto i `.mkv`.

Il motivo: FranzPLAY decideva se un video "va su tutti i browser" guardando Chrome e Firefox.
Safari, il browser di Apple (anche Chrome su iPhone usa Safari dentro), è molto più severo:

- non apre **mai** i `.mkv`, e i `.webm` solo sui sistemi più recenti;
- l'immagine **VP9** e **AV1** la decodifica solo su alcuni dispositivi;
- l'audio **Opus** e **FLAC** dentro un MP4 lo suona solo sui sistemi recenti, il **Vorbis** mai.

Così FranzPLAY copiava un `.mkv` con immagine AV1 in un MP4 con immagine AV1 e audio Opus: andava
su Chrome, non su un iPhone. E un `.webm` lo lasciava com'era, perché Chrome lo apre.

C'era anche un caso che non andava quasi da nessuna parte: l'H.264 a **10 bit** (si trova in
molti anime) o a colori pieni (4:4:4, come certe registrazioni dello schermo). Il nome del formato
è lo stesso, H.264, ma quasi nessun browser lo sa decodificare. FranzPLAY non lo distingueva.

## Cosa abbiamo deciso

Un video **va bene così com'è** solo se lo apre davvero ogni dispositivo:

| | Va bene così | Serve una copia |
|---|---|---|
| Contenitore | `.mp4`, `.m4v`, `.mov` | tutto il resto (`.mkv`, `.webm`, `.avi`, `.ts`…) |
| Immagine | H.264 a 8 bit, 4:2:0 | HEVC, VP9, AV1, H.264 a 10 bit, MPEG-2, WMV… |
| Audio | AAC, MP3, nessuno | AC3, DTS, Opus, FLAC, Vorbis… |

Per tutti gli altri FranzPLAY fa la copia (decisione [0007](0007-copie-per-i-browser.md)),
sempre MP4 con immagine H.264 a 8 bit e audio AAC (o MP3):

- **Immagine già buona** (H.264 a 8 bit, come quasi tutti i `.mkv` di film e serie): si copia
  così com'è, cambia solo la "scatola". Costa quanto leggere il file: **minuti**, anche su un
  Raspberry.
- **Immagine da rifare** (HEVC, VP9, AV1, 10 bit, formati vecchi): ffmpeg la codifica di nuovo.
  Su un Raspberry Pi 4 un film può richiedere **ore**; si fa in sottofondo quando la macchina è
  libera.
- L'audio che non va bene ovunque diventa AAC stereo: costa poco.

Altre cose che la copia ora fa da sola:

- **Video interlacciati** (vecchie registrazioni TV, DVD, alcune videocamere): le righe pari e
  dispari si uniscono (filtro `yadif`), così non si vedono le righe a pettine. Gli altri video
  non vengono toccati.
- **Misure dispari** (per esempio 853×481): H.264 vuole numeri pari, quindi si toglie una riga.
  Prima la copia falliva.
- Altri tipi di file riconosciuti nelle cartelle: `.3g2`, `.asf`, `.divx`, `.dv`, `.f4v`,
  `.mxf`, `.ogm`, `.rm`, `.rmvb`.

### Ogni dispositivo prende la versione migliore che sa aprire

Con la copia pronta, prima il server mandava la copia a tutti. Ma un `.webm` in VP9 a 4K si vede
benissimo su Chrome e su Firefox, mentre la copia è al massimo 1080p: sarebbe stato un peggioramento.

Adesso il server dice al browser che file è (per esempio `video/webm; codecs="vp09.00.40.08, opus"`)
e il browser stesso risponde se lo sa aprire (`canPlayType`). Se risponde «sicuramente» prende il
file originale, a piena qualità; altrimenti prende la copia. Così Chrome guarda l'originale e
l'iPhone la copia, senza che nessuno debba scegliere.

FranzPLAY ora legge anche il **formato dei colori** dell'immagine (per esempio `yuv420p` a 8 bit
o `yuv420p10le` a 10 bit) e lo salva nel database. Dopo l'aggiornamento, ogni video già letto
**ricontrolla da solo** se gli serve una copia.

## Prove

34 file di prova di tipi diversi (MKV con H.264, HEVC, AV1, 10 bit; AVI, WMV, ASF, FLV, F4V, TS,
MPG da DVD interlacciato, DV, MXF, RealMedia, OGV, OGM, WebM VP8 e VP9, MOV ProRes e HEVC
dell'iPhone, misure dispari, più lingue audio con DTS e AC3) passati dal programma vero: dopo i
lavori, **tutti e 34** si guardano da un file MP4 con H.264 a 8 bit e audio AAC o MP3, l'unica
combinazione che Apple apre su ogni dispositivo.

Il Safari vero non gira su Linux, dove girano le prove automatiche: le regole vengono da cosa
Apple dichiara di supportare, e vanno confermate su un iPhone e un Mac veri.

## Cosa costa

- Più video passano da una copia: per esempio i `.webm` presi da YouTube, che prima Chrome apriva
  com'erano. La copia occupa spazio nella cartella dati (circa quanto il video, o meno).
- I video in HEVC (molti film recenti, i video dell'iPhone) costavano già una nuova codifica:
  non cambia niente.

## Chi aspetta passa avanti

Le copie sono l'ultimo lavoro della coda e cedono il passo (decisione 0007): su una libreria
grande, un `.mkv` poteva aspettare giorni. Ma se una persona lo apre adesso sul suo iPhone, lo
vuole adesso.

- Quando il browser dice di non saper aprire il file (prima ancora di provare, se lo sa già, o
  quando il player fallisce), la pagina lo dice al server (`POST /api/videos/{id}/prepare`).
- Il lavoro della copia di quel video diventa **urgente**: passa davanti a tutti gli altri e non
  cede più il passo. Se una copia "normale" di un altro video sta andando, si ferma e lascia
  passare quella urgente. Se la copia era fallita, si riprova da capo.
- Nel player compare cosa succede: «in coda», «la sta preparando adesso (35%)», o «non è
  riuscito». La percentuale viene da ffmpeg, che ogni pochi secondi scrive a che punto è in un
  piccolo file nella cartella dati.
- Quando la copia è pronta, il video **parte da solo**: la pagina lo sente dagli avvisi del
  server e ricarica il player.

Un lavoro si segna urgente solo per un video che quella persona può vedere, e solo se gli serve
davvero una copia.

## Cambiare lingua su Safari

Il cambio di lingua (decisione [0006](0006-piu-lingue-audio.md)) rimonta il video al volo, e Safari
non lo sa guardare. Su Safari ora il player chiede al browser stesso di suonare l'altra traccia,
che è già nel file o nella copia.
