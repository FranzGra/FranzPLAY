# 0014 · Caricare video dal browser

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Il problema

Le persone che l'amministratore abilita devono poter mettere i loro video su FranzPLAY dal
browser, anche dal telefono, anche video grandi (qualche GB). Tutto questo su un Raspberry Pi
con 2 GB di memoria e con connessioni di casa che a volte cadono.

## Cosa abbiamo deciso

- Può caricare solo chi ha **"Può caricare video"** acceso, entro il suo **spazio massimo**
  (10 GB di partenza, l'amministratore lo cambia in Amministrazione › Persone).
- Il video arriva **a pezzi** (al massimo 16 MB ciascuno). Ogni pezzo dice da che punto parte.
  Se la connessione cade, il browser chiede «quanto è arrivato?» e riparte da lì, non da capo.
- Il file cresce nella cartella dati, in `incoming/`. Quando arriva l'ultimo pezzo si sposta, in
  un passo solo, in `uploads/<numero della persona>/`. Le cartelle video dell'amministratore non
  si toccano mai (regola 1).
- La cartella `uploads/` il programma la legge **come una cartella video**: così un video
  caricato ha copertina, anteprime, copia per i browser e tutto il resto come gli altri.
- Un caricamento lasciato a metà per **7 giorni** si cancella e libera il suo spazio.
- Un video che c'è già (stessa impronta) viene rifiutato: non serve averlo due volte.

## Perché così

**A pezzi e non tutto insieme.** Un file intero in una sola richiesta, se la connessione cade al
90%, va rimandato tutto. A pezzi si perde al massimo un pezzo. Ogni pezzo va dritto sul disco,
quindi la memoria usata non dipende da quanto è grande il video.

**Niente librerie esterne** (come tus, uno standard per questo): il nostro modo sta in poche
righe, si capisce leggendolo e non pesa sul Raspberry (regola 10).

**Lo spazio si controlla all'inizio**, con la grandezza dichiarata, e conta anche i caricamenti non
finiti. Il controllo e la scrittura avvengono in una transazione sola: due caricamenti partiti nello
stesso momento non possono superare insieme lo spazio massimo.

**Un pezzo vale solo quando è sul disco.** Prima si scrive, poi si chiede al disco di salvare
davvero (`Sync`), solo dopo il database dice «arrivato». Un pezzo interrotto non viene contato e
alla volta dopo si riscrive sopra.

**Lo spostamento finale è «tutto o niente»** (regola 6): il video entra nel catalogo e il file si
sposta nella stessa transazione. Se il database non salva, il file torna in `incoming/`.

**«Solo io».** Chi carica sceglie se il video lo vedono tutti o solo lui, e può cambiare idea dopo.
Un video «solo io» non compare in nessuna lista, ricerca o playlist, nemmeno in quelle di chi l'ha
caricato: si apre solo dalla sua pagina, e solo da chi l'ha caricato. Nel database basta una
colonna, `private`, che entra nella colonna `visible`: così tutte le liste lo nascondono senza
cambiare una riga. Solo le rotte di un video singolo (pagina, streaming, sottotitoli, audio)
fanno un'eccezione per chi l'ha caricato. Mi piace, commenti e «continua a guardare» restano
spenti per questi video: nessun altro li vedrebbe.

## Cosa resta per dopo

- «Solo alcune persone»: fatto, vedi la decisione 0016.
