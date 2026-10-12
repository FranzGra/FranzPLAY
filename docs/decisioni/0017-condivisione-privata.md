# 0017 · Condividere solo con alcune persone

12 ottobre 2026.

## Cosa si è deciso

Un video caricato dal browser e una playlist si possono far vedere a tre gruppi:
**Tutti**, **Solo io**, **Alcune persone**. Con «Alcune persone» chi carica sceglie i nomi da un
elenco di chi usa FranzPLAY.

Le persone scelte trovano il video nella pagina **«Condivisi con te»**. Per tutti gli altri il
video non esiste: non compare nella Home, nella ricerca, nei consigliati, nelle categorie, nei
canali o nelle playlist, e il suo indirizzo risponde «non trovato».

## Perché così

- **Un posto solo decide chi vede cosa.** «Alcune persone» è un video privato più un elenco di
  persone (tabella `video_shares`). Un video privato resta fuori dalla colonna `visible`, quindi
  tutte le liste lo nascondono già senza toccarle. Solo le rotte di un video singolo (pagina,
  streaming, sottotitoli, audio) guardano anche l'elenco delle persone scelte, e solo la lista
  `GET /api/videos?shared=1` mostra i video condivisi con chi chiede.
- **Niente Home per le cose condivise.** Metterle nelle righe della Home vorrebbe dire cambiare
  ogni lista e ogni regola dei consigliati, con il rischio di farle vedere a chi non deve. Una
  pagina a parte è semplice e sicura.
- **Un video per tutti non ha persone scelte.** Quando torna «Tutti», l'elenco si svuota: così,
  se un giorno torna privato, non lo rivede per sbaglio chi era stato scelto mesi prima.
- **Chi viene scelto lo decide chi carica, controllato una volta all'ingresso**
  (`internal/sharing`): al massimo 50 persone, mai sé stessi, solo persone che esistono.
- **Gli aggiornamenti in tempo reale (SSE) non portano dati**, solo «qualcosa è cambiato»
  (decisione 0005): non possono far trapelare niente.

**Le playlist** funzionano allo stesso modo: «Tutti» vuol dire sul mio canale, «Solo io» è la
playlist privata di sempre, «Alcune persone» usa la tabella `playlist_shares`. Una playlist
condivisa mostra solo i video che tutti possono vedere: un video privato non entra mai in una
playlist. «Guarda più tardi» non si condivide.

## Cosa resta per dopo

- Mi piace e commenti sui video condivisi.
