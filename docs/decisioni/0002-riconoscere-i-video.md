# 0002 · Come FranzPLAY trova e riconosce i video

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Cosa abbiamo deciso

- Le cartelle dei video si indicano con `FRANZPLAY_LIBRARIES`. FranzPLAY le **legge e basta**.
- Ogni video ha un'**impronta**: un codice calcolato dal suo contenuto. È l'impronta che dice
  "questo è il video X", non il nome del file né la cartella in cui si trova.
- All'avvio, e poi **ogni minuto**, FranzPLAY confronta le cartelle con il catalogo nel database.
- Un video che non si trova più viene **segnato come mancante**. Se torna, riprende tutto
  (like, commenti, cronologia). Viene dimenticato davvero solo dopo **30 giorni**.

## Perché

**L'impronta.** Nella versione vecchia un video spostato o rinominato diventava un video nuovo e
perdeva tutto. Con l'impronta, FranzPLAY riconosce lo stesso video ovunque si trovi.
Leggere un video intero richiederebbe minuti su un Raspberry, quindi l'impronta usa la
dimensione esatta e tre pezzetti del file (inizio, metà, fine): al massimo 192 KB per video.

**Il controllo ogni minuto è leggero.** Per i file già conosciuti FranzPLAY guarda solo nome,
dimensione e data: non apre nessun video. L'impronta si calcola solo per i file nuovi o cambiati.

**Sola lettura garantita dal codice.** Le cartelle si leggono attraverso `fs.FS`, un tipo di Go che
permette solo di leggere: anche volendo, da lì non si può scrivere. Un test controlla che dopo
ogni scansione la cartella sia identica a prima.

**Prima di cancellare, dubitare** (regola 3). Nessun video viene segnato come mancante quando:
- la cartella non si legge tutta (permessi, un errore del disco);
- la cartella è vuota ma prima aveva dei video: quasi certamente il disco non è collegato.

## Casi particolari

- **Due copie identiche** dello stesso video: si mostra una volta sola, l'altra si ignora.
- **File sostituito** con una versione nuova nello stesso posto (per esempio ricodificato):
  resta lo stesso video, con la sua storia.
- **Cartelle ignorate**: quelle nascoste (che iniziano con `.`) e quelle dei NAS o di Windows
  (`@eaDir`, `#recycle`, `$RECYCLE.BIN`…). Anche i collegamenti (symlink) si ignorano.
- **Categorie**: la prima sottocartella. `Viaggi/2025/mare.mp4` è nella categoria "Viaggi".
- Non si possono indicare cartelle una dentro l'altra, né la cartella dati dentro una cartella
  dei video: FranzPLAY si rifiuta di partire e spiega perché.
