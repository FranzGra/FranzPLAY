# 0018 · Pagina del video come YouTube, modalità Teatro e di chi è il video

13 ottobre 2026.

## Cosa si è deciso

- **Player grande, a sinistra.** Nella pagina di un video il player prende tutto lo spazio
  accanto al menu, con i video «Da guardare dopo» in una colonna a destra, come su YouTube.
  Diventa grande quanto lo schermo permette lasciando visibile il titolo sotto.
- **Modalità Teatro.** Un tasto nel player (e la lettera **T**) allarga il player a tutta la
  larghezza sotto la barra in alto, su fondo nero; il menu laterale si fa da parte. Non è lo
  schermo intero. La scelta resta salvata nel browser per i video seguenti. Sul telefono non
  serve: il player prende già tutta la larghezza, quindi il tasto non c'è.
- **Di chi è il video.** Sotto il titolo c'è la persona a cui appartiene il video, con la sua
  foto (o l'iniziale) e un collegamento al suo canale. È chi lo ha caricato; per un video trovato
  in una cartella è **l'amministratore principale**: il primo amministratore creato, cioè chi ha
  installato FranzPLAY. Anche il video di una persona che non c'è più passa a lui.

## Perché così

- **Si calcola, non si salva.** Il proprietario di un video da cartella non è scritto nel
  database: si chiede al momento chi è il primo amministratore. Niente migrazione, e se un giorno
  si importa o si cambia qualcosa, la risposta resta giusta.
- **Solo per la pagina di un video.** Le liste (Home, ricerca…) non lo portano: lì non si vede, e
  così restano leggere.
- **Il canale dell'amministratore non cambia.** Mostra ancora solo i video caricati da lui dal
  browser, non tutta la libreria: altrimenti il suo canale diventerebbe una copia della Home.
- **La pagina chiede spazio alla cornice** (`usePageWidth` in `web/src/app/pageWidth.tsx`):
  «normale», «largo» o «tutto». Così le altre pagine restano come sono.
