# 0019 · FranzPLAY si installa con Docker

13 ottobre 2026.

## Cosa si è deciso

- **Docker è il modo di installare FranzPLAY.** Un'immagine con tutto dentro (programma,
  interfaccia, FFmpeg, whisper.cpp), un `compose.yaml` e un `.env.example` con ogni impostazione
  spiegata. Il programma da solo resta, per chi sviluppa e per i sistemi a 32 bit.
- **Un'immagine pronta, per amd64 e arm64**, pubblicata su `ghcr.io/franzgra/franzplay` a ogni
  modifica che entra in `main` (e con il numero di versione per i tag `v1.2.3`). Se non si riesce
  a scaricarla, `docker compose` la costruisce dal progetto.
- **Alpine Linux** come base, con l'FFmpeg di Alpine.
- **Whisper sempre dentro.** Il programma pesa pochi MB e non fa niente finché l'amministratore
  non scarica un modello: così i sottotitoli automatici funzionano senza costruire niente.
- **LibreTranslate accanto, spento.** Si accende con `COMPOSE_PROFILES=traduzioni`.
- **Mai root.** Il contenitore parte, dà la cartella dati all'utente `PUID`/`PGID` e fa girare
  FranzPLAY con quell'utente. Disco del contenitore in sola lettura, permessi ridotti al minimo.
- **I video montati in sola lettura** (`:ro`): la regola 1 la fa rispettare anche il sistema.

## Perché così

- **Veloce da costruire anche per il Raspberry Pi.** Interfaccia e programma Go si preparano sul
  computer che costruisce, per qualsiasi sistema di arrivo (Go lo sa fare da solo, SQLite è in
  Go). Su GitHub l'immagine ARM si costruisce su una macchina ARM vera, quindi niente emulazione
  lenta, e la prova completa (`docker/smoke-test.sh`) gira su tutte e due.
- **Alpine e non Debian**: la stessa FFmpeg su Debian porta con sé tre volte tanto. Un'FFmpeg
  "statica" già pronta era più grande ancora (circa 400 MB) e di terzi.
- **`PUID`/`PGID`** sono i nomi che usano quasi tutte le immagini per casa (anche le app di
  ZimaOS): chi installa li conosce già. Senza, una cartella dati creata da Docker sarebbe di root
  e FranzPLAY non potrebbe scriverci.
- **Porta e cartelle fisse dentro l'immagine** (`:8090`, `/data`, `/videos`): chi installa sceglie
  solo cosa c'è fuori (`FRANZPLAY_PORT`, `FRANZPLAY_VIDEO_FOLDER`…), e il controllo di salute di
  Docker sa sempre dove chiedere.
- **Niente sistemi a 32 bit nell'immagine**: le macchine ARM di GitHub non li fanno girare, e i
  Raspberry Pi 4 e ZimaOS sono a 64 bit.
