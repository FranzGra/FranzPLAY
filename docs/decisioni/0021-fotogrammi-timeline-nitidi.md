# 0021 — Fotogrammi della timeline più nitidi: 480×270, non Full HD

Data: 2026-10-13

## Il problema

La miniatura che compare sopra la barra del tempo era sfocata. Ogni fotogramma era fatto a
160×90 pixel e mostrato largo 160 punti: su un Mac (2 pixel veri per punto) o un telefono
(3 pixel per punto) l'immagine veniva ingrandita 2-3 volte, quindi sgranata.

## Cosa abbiamo deciso

- I fotogrammi si fanno a **480×270** (`video.PreviewWidth` e `video.PreviewHeight`).
- Il player li mostra larghi **240 punti** sul computer e **160** sul telefono. 480 pixel sono
  esattamente quelli che servono in entrambi i casi (240×2 e 160×3): nitidi, senza sprechi.
- Ogni video ricorda nel database la misura con cui è stata fatta la sua immagine
  (`preview_width`, `preview_height`), così quelle vecchie continuano a funzionare mentre
  vengono rifatte una alla volta in sottofondo.
- Il nome del file contiene la larghezza (`12-0a1b2c3d-w480.jpg`): il browser tiene queste
  immagini per un anno, e senza un nome nuovo mostrerebbe quella vecchia tagliata male.

## Perché non Full HD

Abbiamo misurato un video di 10 minuti in 1080p, 100 fotogrammi, su un solo processore
(come un Raspberry Pi, che però è circa 3 volte più lento):

| Fotogramma | Peso immagine | Memoria per unirli | Memoria nel browser |
|---|---|---|---|
| 160×90 (prima) | ~180 KB | ~55 MB | 6 MB |
| 320×180 | ~500 KB | ~70 MB | 23 MB |
| **480×270 (scelto)** | **~780 KB** | **~100 MB** | **52 MB** |
| 640×360 | ~1,4 MB | ~140 MB | 92 MB |
| 1920×1080 | ~10 MB | ~860 MB | 830 MB |

(Il video di prova era pieno di "rumore", quindi i pesi veri sono più bassi; i rapporti restano.)

In Full HD l'immagine peserebbe 10 MB da scaricare a ogni video, il programma userebbe quasi
1 GB di memoria per farla (metà di un Raspberry Pi da 2 GB) e un telefono probabilmente non
riuscirebbe nemmeno a mostrarla. E non si vedrebbe meglio: la miniatura è piccola, e 480 pixel
sono già tutti quelli che lo schermo può mostrare in quello spazio.

Il tempo per fare i fotogrammi non cambia quasi (2,4 s contro 2,9 s): il grosso del lavoro è
leggere il video, non rimpicciolire.

## Se un giorno si vuole cambiare

Basta cambiare le due costanti in `internal/video/preview.go` (con numeri pari) e aggiungere
una migrazione che rimette in coda i lavori `preview`, come la 0039. Per fotogrammi molto più
grandi bisognerebbe prima dividere l'immagine in più pezzi, come fa YouTube.
