# 0013 · Sottotitoli automatici e traduzione

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Il problema

Il vecchio FranzPLAY sapeva **scrivere i sottotitoli da solo**: ascoltava l'audio di un video con
Whisper (un programma che trasforma la voce in testo) e poi li **traduceva** in altre lingue con
LibreTranslate (un traduttore che gira in casa, senza internet). Il nuovo lo deve
saper fare ancora: nessuna funzione del vecchio si perde.

Però il vecchio lo faceva con due contenitori Python in più, pesanti: fino a 3 GB di memoria per
Whisper e 2 GB per il traduttore. Il nuovo deve restare un programma solo e girare su un Raspberry
Pi con 2 GB.

## Cosa abbiamo deciso

- **Whisper è un programma a parte, facoltativo**: si usa **whisper.cpp** (`whisper-cli`), la
  versione di Whisper scritta in C++. Non serve Python, usa poca memoria (il modello `small` sta
  sotto 1 GB) e FranzPLAY lo lancia come fa già con ffmpeg. Se il programma non c'è, i sottotitoli
  automatici sono spenti e tutto il resto funziona come prima.
- **I modelli** (i file `ggml-small.bin`, `ggml-medium.bin`… che contengono "l'orecchio" di
  Whisper) stanno nella cartella dati, in `whisper/`. L'amministratore sceglie quale usare per ogni
  video, come nel vecchio (che offriva `small` e `medium`). FranzPLAY li **scarica da solo** dalla
  pagina, come faceva il vecchio, dal sito di whisper.cpp (Hugging Face), e controlla l'impronta
  pubblicata da whisper.cpp prima di usarli: un file diverso viene buttato.
- **La traduzione** chiede a un server **LibreTranslate**, come il vecchio, ma solo se
  l'amministratore ne scrive l'indirizzo (`FRANZPLAY_TRANSLATE_URL`). Senza, si fanno solo i
  sottotitoli nella lingua parlata. Il testo si manda a pezzi di 40 righe: il vecchio aveva
  scoperto che un film intero in una volta sola andava sempre fuori tempo.
- **Lingue**: italiano, inglese, spagnolo, francese, tedesco e portoghese, come nel vecchio. La
  lingua parlata si può dire o lasciare indovinare a Whisper.
- **Solo su richiesta**: come nel vecchio, si parte solo quando l'amministratore lo chiede per un
  video, in **Amministrazione › Sottotitoli**. Niente parte da solo: su un Raspberry Pi trascrivere
  un film può richiedere ore.
- **Un lavoro della coda** (`transcribe`): ffmpeg estrae l'audio, whisper.cpp scrive il testo con
  i tempi, poi si traduce una lingua alla volta. Come le conversioni, **cede il passo**: si ferma se
  arriva un video nuovo e riparte quando la macchina è libera. Ogni lingua finita resta salvata.
- **I sottotitoli creati vanno nella cartella dati** (`autosubtitles/`), mai accanto ai video
  (regola 1). Nel player compaiono come "Italiano (automatici)", insieme a quelli che c'erano già.
- Whisper a volte scrive `[BLANK_AUDIO]` nei silenzi o ripete la stessa frase sulla musica: queste
  righe si tolgono prima di salvare.

## Le alternative scartate

- **Whisper dentro FranzPLAY** (con una libreria in C collegata al programma Go): il programma
  diventerebbe più difficile da costruire per ogni computer, e peserebbe su chi non lo usa.
- **Python come nel vecchio** (faster-whisper): più dipendenze e più memoria.
- **Tradurre con Whisper**: sa tradurre solo verso l'inglese, quindi non basta.

## Come si accende

1. Installare whisper.cpp, così che `whisper-cli` sia nel PATH (o indicarlo in
   `FRANZPLAY_WHISPER`).
2. In Amministrazione › Sottotitoli premere «Scarica» accanto a un modello (`small` va bene su un
   Raspberry Pi), oppure mettere il file in `cartella-dati/whisper/`.
3. Per tradurre: avviare LibreTranslate e scriverne l'indirizzo in `FRANZPLAY_TRANSLATE_URL`
   (e la chiave in `FRANZPLAY_TRANSLATE_KEY`, se il server la chiede).
