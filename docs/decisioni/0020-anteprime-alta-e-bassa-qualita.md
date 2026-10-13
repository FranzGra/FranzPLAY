# 0020 · Anteprime in alta e bassa qualità

**Data:** 13 ottobre 2026 · **Stato:** decisa

## Il problema

L'anteprima che parte sulla copertina ([0012](0012-anteprima-sulla-copertina.md)) era solo a
360 pixel: leggera, ma un po' sfocata sugli schermi nitidi di oggi. Francesco vuole anteprime di
qualità quando la connessione è buona (a casa), e leggere quando non lo è.

## Cosa abbiamo deciso

- Ogni anteprima esiste in **due versioni**, con lo stesso nome in due cartelle della cartella dati:
  - **leggera**, alta 360 pixel, in `data/clips/` (come prima);
  - **nitida**, alta **720 pixel** (mai ingrandita: un video più piccolo resta com'è), in
    `data/clips-hd/`.
- Un solo passaggio di `ffmpeg` fa tutte e due: il video si legge una volta sola.
- Il **browser sceglie** ogni volta che un'anteprima parte: quella nitida se la connessione è
  buona, quella leggera se è lenta (3G o meno, meno di 5 megabit al secondo) o se la persona ha
  chiesto di risparmiare dati. Lo sa da quello che dice il browser (Chrome, Edge, Android); Safari
  e Firefox non lo dicono, e allora si usa quella nitida, che pesa comunque poco.
- Le anteprime già fatte si **rifanno da sole** dopo l'aggiornamento, in sottofondo, una alla volta.

## Perché 720 e non 1080

- Una copertina, anche su un computer grande, è larga circa 400 punti: con uno schermo nitido
  sono circa 800 pixel veri. Un'anteprima a 720 (larga 1280) li copre già tutti; a 1080 non si
  vedrebbe nessuna differenza.
- In una prova, la versione a 1080 pesava circa **4 volte** quella a 720: più disco sul Raspberry,
  più attesa sul telefono, per niente di visibile.
- Se un giorno le copertine diventassero più grandi, basta cambiare un numero
  (`video.ClipHDHeight`).
