# 0025 · Una cartella dei contenuti, portabile

1 novembre 2026.

## Cosa si è deciso

Accanto alla cartella dati nasce una seconda cartella, quella dei **contenuti**: tutto quello che
FranzPLAY fa o riceve e che non è il database in uso. A regime è fatta così:

```text
contenuti/
  video/
    Nome del video [a1b2c3d4]/
      video.json
      copertina.jpg
      anteprima.mp4
      timeline.jpg
      sottotitoli/
  categorie/
  modelli/
  caricati/
  utenti/
  database/
```

- **Il database in uso resta nella cartella dati** (`/data`), con il suo lucchetto. Non si sposta:
  SQLite vuole un disco vero e veloce, i contenuti possono stare su un disco grande e lento.
- **La cartella dei video resta in sola lettura** (regola 1): nessun file accanto ai video.
- **Il lavoro va a fasi.** Questa è la prima e non sposta niente: aggiunge l'impostazione
  `FRANZPLAY_CONTENT_DIR` e fa passare ogni percorso da un solo punto, il tipo `content.Root`. Oggi
  le cartelle dentro la radice hanno ancora i nomi di sempre (`covers`, `previews`, `whisper`…). La
  struttura qui sopra arriva con le fasi dopo, che spostano davvero i file.
- **Se l'impostazione manca, i contenuti stanno nella cartella dati**, come sempre: chi aggiorna
  non vede nessuna differenza. Una cartella contenuti dentro una cartella dei video, o che ne
  contiene una, viene rifiutata all'avvio, come per la cartella dati.

## Perché così

- **L'identità di un video è la sua impronta, non il percorso** (vedi
  [0002](0002-riconoscere-i-video.md)). Il nome della cartella serve alla persona, che apre il disco
  e capisce cosa c'è; il codice tra parentesi quadre serve alla macchina, che ritrova il video anche
  se il nome cambia.
- **Portabile vuol dire che si copia e funziona.** Dentro `video.json` c'è quello che serve a
  rimettere insieme un video su un'altra installazione, senza il database.
- **Un solo punto per i percorsi.** Erano sparsi in decine di `filepath.Join(dataDir, ...)`: cambiare
  struttura voleva dire cercarli tutti e sperare. Ora chi crea un `Coverer` riceve un `content.Root`
  e non una stringa: passare per sbaglio la cartella dati è un errore di compilazione.
- **Docker senza rompere niente.** `compose.yaml` monta sempre qualcosa su `/contenuti`, e di suo non
  può rendere facoltativo un volume. Senza `FRANZPLAY_CONTENT_FOLDER` ci rimonta la cartella dati e
  lascia vuoto `FRANZPLAY_CONTENT_DIR`: FranzPLAY non guarda `/contenuti` e usa `/data`. Il prezzo è
  un montaggio in più che non serve, in cambio di nessun volume vuoto creato a chi non ne ha bisogno.

## Seconda fase: la cartella di ogni video

I file nuovi di un video finiscono in `video/<Nome> [<codice>]/`, con nomi fissi: `video.json`,
`copertina.jpg`, `timeline.jpg`, `anteprima.mp4`, `anteprima-hd.mp4`, `convertito.mp4`,
`immagine-online.img`, `copertina-scelta.*`, `anteprima-scelta.*` e `sottotitoli/`. I file già fatti
restano dove sono: non si sposta niente.

- **Vecchio e nuovo convivono, senza migrazione.** Il valore nel database dice dove sta il file: senza
  `/` è un file vecchio nella sua cartella piatta (`12-a1b2c3d4.jpg`), con `/` è `<codice>/<file>`, con
  l'eventuale `?v=<versione>`. Il database non contiene mai il nome della cartella, che può cambiare.
- **L'indirizzo non contiene il nome del file.** `/api/covers/<codice>.jpg`, `/api/previews/<codice>.jpg`,
  `/api/clips/<codice>.mp4`, `/api/clips-hd/<codice>.mp4`: il file lo decide la rotta. Quando un file
  cambia, cambia il `?v=` e la cache del browser non serve quello vecchio.
- **Il codice sono gli ultimi 8 caratteri dell'impronta.** La cartella si riconosce dal codice e si
  conferma con l'impronta intera in `video.json`. Se due impronte diverse danno lo stesso codice, la
  seconda usa un codice più lungo (12, 16… fino all'impronta intera). Una cartella senza `video.json`
  leggibile non viene mai adottata.
- **Rinomina e spostamento.** Se il nome del file cambia, cambia il nome della cartella; se la
  rinomina fallisce si scrive nel log e si riprova alla scansione dopo. Se il file cambia solo
  sottocartella, si aggiorna solo `video.json`.
- **File sostituito: cartella nuova.** La riga tiene il valore vecchio finché il suo lavoro non rifà il
  file, così il video non resta mai senza copertina. La cartella vecchia si tiene per 30 giorni
  (vedi la terza fase).
- **I lavori in corso stanno in `in-corso/`**, svuotata all'avvio: i temporanei non finiscono mai in
  una cartella che una persona può copiare.
- **Per i sottotitoli automatici prima il file, poi la riga.** Riga e file si scrivono nella stessa
  transazione, e la riga esiste solo dopo che il file è al suo posto: se il file non si scrive, la riga
  non resta. Un lavoro annullato o arrivato tardi non tocca il file in uso. Una riga il cui file manca
  non conta come fatta: il lavoro riparte.

## Terza fase: riuso alla scansione e pulizia prudente

Un video di 48 minuti trascritto in 4 ore non si rifà mai per sbaglio: la cartella vale più del
database. Se il database sparisce, o la cartella arriva da un'altra installazione, il lavoro è salvo.

- **Il riuso avviene quando un video è nuovo per il database.** Se in `video/` c'è una cartella con il
  suo codice e in `video.json` la sua impronta intera, FranzPLAY rimette nel database quello che trova:
  copertina, timeline, anteprime, convertito, immagine online, scelte dell'amministratore, titolo e
  categoria forzati, sottotitoli con lingua, modello e origine. Conta il codice, non il nome: dopo
  l'adozione il nome si allinea con la rinomina di sempre. La cartella può aspettare il suo video anche
  per giorni.
- **Ogni file si controlla prima di crederci.** Deve esistere, non essere vuoto ed essere davvero dentro
  quella cartella: i nomi di `video.json` hanno una lista fissa e si aprono con `os.Root`, quindi un
  `../` non esce mai. Quello che manca lo rifanno i lavori di sempre.
- **`video.json` dice anche quali lavori sono finiti** (`done`). I lavori finiti si segnano come fatti
  senza partire; un sottotitolo automatico riusato non torna in coda. L'unico che riparte sempre è
  `details`: legge solo il file accanto al video, costa niente e non tocca la cartella. Se le
  informazioni del video non sono in `video.json`, si riparte dalla lettura del file.
- **`video.json` rotto, o scritto da una versione più nuova: non si adotta**, non si sovrascrive, non si
  cancella. Il log lo dice e il video si tratta come nuovo. Scrive altrove, con il codice più lungo che
  già serve per le collisioni. **Il video nasce nascosto** (`hidden_at`): quella cartella poteva dire che
  era nascosto o privato, e nessuno può più saperlo. Lo mostra l'amministratore, e «Contenuti senza video»
  segna la cartella e dice perché. Anche una cartella con il codice giusto ma di un altro video rotto
  nasconde: meglio un video da mostrare a mano che uno privato aperto a tutti.
- **Una cartella si cancella solo per un fatto visto dal database.** Una cartella sconosciuta non si
  tocca mai, nemmeno con il database pieno. I fatti sono due: il video dimenticato dopo 30 giorni, che
  lascia la riga in `retired_folders` (migrazione 0054), e il file sostituito, che ce la lascia con
  scadenza a 30 giorni, cioè lo stesso tempo che abbiamo per un file sparito. Chi sostituisce un video
  e si pente ha un mese. La cancellazione chiesta dall'amministratore non c'è ancora.
- **Database vuoto: nessuna pulizia.** Prima della prima scansione non si sa niente, quindi non si
  cancella niente. I file piatti trovati con il database vuoto si tengono e non si riusano, perché i
  loro nomi dipendono da id vecchi: il log dice quanti e dove, e `content.hold_flat_files` li protegge
  anche ai riavvii dopo, finché l'amministratore non deciderà. Con il database pieno le pulizie dei file
  piatti restano come prima. `in-corso/` resta temporanea e si svuota all'avvio.
- **«Contenuti senza video» nel Riepilogo.** Mostra cartella, titolo e dimensione, fino a 200 voci. Sola
  lettura: niente pulsante, perché quelle cartelle possono valere ore di lavoro. Si ricalcola al massimo
  una volta al minuto, perché il Riepilogo si aggiorna ogni 2,5 secondi.
- **Fuori da questa fase.** Una riga già esistente a cui manca un valore che la cartella ha non viene
  riempita, e lo stesso vale per il file sostituito: il riuso è solo per i video nuovi. Non tornano le
  proposte online e le richieste di sottotitoli.

## Quarta fase: privacy, copie del database e trasferimento

Prima una cartella copiata riportava in chiaro i video nascosti o privati. Ora la perdita del database
non apre niente, e un FranzPLAY già in uso può portare i suoi file nella struttura nuova.

- **`video.json` tiene anche `access` e `added_at`:** `hidden_at`, video privato, chi lo ha caricato,
  data di aggiunta. All'adozione tornano. Un `video.json` senza questi dati (mai riscritto dopo
  l'aggiornamento) lascia il video visibile come prima: per questo al primo avvio si riscrivono tutti,
  una volta sola (`content.access_saved`). Proposte online e richieste di sottotitoli restano fuori.
- **Condivisioni e link non stanno in `video.json`:** contengono segreti e persone. Perderli può solo
  ridurre chi vede. Un video privato il cui proprietario non esiste più nel database resta chiuso a
  tutti, mai aperto, finché un amministratore non decide (vedi la quinta fase).
- **Dati generali: si scrive nel nuovo, si legge dal nuovo e poi dal vecchio, si cancella da entrambi.**
  Vale per `modelli/whisper/`, `modelli/translator/`, `categorie/` e `utenti/`. Così nessun file vecchio
  va spostato per forza. I video caricati nuovi vanno in `caricati/video/`; `uploads/` si legge ancora
  finché il trasferimento non ha spostato tutto (`content.uploads_moved`). Un video caricato non viene
  mai cancellato da una pulizia.
- **`categorie/categorie.json`** tiene i nomi e le scelte delle categorie: le immagini da sole non
  bastano a ricostruirle.
- **Copia del database ogni notte alle 4 locali**, e dopo il primo avvio del giorno se manca. `VACUUM
  INTO` su un temporaneo e poi rinomina: una copia a metà non ha mai il nome giusto. Si tengono le ultime
  7 `franzplay_GG-MM-AAAA.db` e si cancellano solo i file con questo nome. Permessi 0600: dentro ci sono
  hash delle password, sessioni e chiavi API.
- **Ripristino all'avvio solo se il database manca.** Vince la copia più recente che passa
  `integrity_check`, e il log dice quale. Una copia di una versione più nuova ferma l'avvio con un errore
  chiaro, senza scendere a una più vecchia: sarebbe un salto indietro silenzioso. `database/` vuota vuol
  dire ripartire da zero. Dopo il ripristino, una volta sola, `video.json` vince sulla riga per gli
  stessi dati, perché è più recente (`content.after_restore`); i `retired_folders` della copia si
  dimenticano, perché quei video possono essere tornati.
- **`franzplay migrate-content` è un comando, non un pulsante.** Scegliere il momento e controllare il
  risultato tocca a chi amministra. Parte a servizio fermo: prende lo stesso lock del server. Senza
  opzioni apre il database in sola lettura e non cambia niente.
- **`--apply` copia, controlla, e aggiorna il database tutto insieme.** Prima guarda lo spazio in sola
  lettura: se non basta, rifiuta senza aver toccato nemmeno il database. Poi fa una copia del database
  (`franzplay_prima-del-trasferimento_GG-MM-AAAA.db`, fuori da rotazione e ripristino), copia ogni file
  con sha256 confrontato, e infine una sola transazione cambia righe, `video.json` e `moved_files`
  (migrazione 0055). Fermato a metà, ricomincia: i file già giusti non si ricopiano e il database non è
  mai a metà.
- **`--remove-old` cancella solo quello che `moved_files` nomina**, dopo aver ricontrollato le due
  copie e che il database non lo usi. Un file cambiato o con la copia sparita resta. I modelli hanno
  `new_sha256` diverso perché i loro `config.yml` nominano la cartella.
- **`content.hold_flat_files` si scioglie da solo.** Il comando non cancella i file mai copiati: nessun
  video li nomina, e non sappiamo di chi sono. Dice dove sono. Il blocco cade quando non ne resta
  nessuno, all'avvio o alla fine di `--remove-old`.

Limiti rimasti: in `caricati/video/` un conflitto di nome con un file diverso lascia il video nella
libreria vecchia, e `uploads/` resta letta.

## Quinta fase: i difetti trovati dalla revisione

Ogni punto ha un test che falliva prima della correzione.

- **Un lavoro arrivato tardi non tocca il file in uso.** Copertina, timeline, anteprime, copia
  convertita e immagine online si scrivono solo se il video ha ancora l'impronta con cui il lavoro è
  partito, nella stessa transazione che aggiorna la riga (`IfSame`). Altrimenti il lavoro finisce senza
  scrivere e senza cancellare niente. Per i sottotitoli non serviva: si copiano solo i file che mancano.
- **Una copia vuota non vince su una piena.** Un database vuoto non si copia se ce n'è già una con dati
  (video o persone); la rotazione tiene sempre l'ultima copia con dati; il ripristino prova prima le
  copie con dati e usa una vuota solo se non c'è altro.
- **Il ripristino lascia un segno accanto al database** (`.restored-from-copy`, con l'ora della copia),
  scritto prima di dare il nome al database. Se il programma si ferma prima di
  `content.after_restore`, all'avvio dopo il lavoro si rifà. Il segno sparisce quando il database lo ha
  scritto.
- **Chi vede un video: vince il più chiuso, salvo prova.** Dopo un ripristino `video.json` vince sulla
  riga solo se il suo `savedAt` è dopo l'ora della copia. Senza questa prova vince il più chiuso dei
  due: nascosto se lo dice uno dei due, privato se lo dice uno dei due. Un `video.json` che non si è
  potuto scrivere è più vecchio del database, e non deve aprire niente. Se non si scrive dopo un cambio di
  chi vede, al prossimo avvio si riscrivono tutti.
- **Contenuti illeggibili o non montati: errore chiaro, niente rifatto.** Se la cartella dei contenuti
  o `video/` non si leggono, FranzPLAY non parte. Se la cartella dei contenuti è separata, vuota, e il
  database ha video o persone, è quasi sempre un disco non montato: FranzPLAY non parte e dice cosa fare
  (montare il disco; per ripartire da zero, creare una cartella `video` vuota; per portarci i file,
  `migrate-content --apply`). Un'installazione nuova parte come sempre. Anche la scansione non aggiunge
  niente se non riesce a leggere i contenuti: non saprebbe quali video sono nascosti.
- **Cartelle dei video che mancano: solo un avviso.** Se il database nomina file in cartelle
  `<codice>/…` che `video/` non ha, all'avvio il log lo dice (quante, qualche codice, quale cartella
  dei contenuti è in uso) e FranzPLAY parte lo stesso. Il caso tipico: dopo `migrate-content --apply`
  si toglie `FRANZPLAY_CONTENT_FOLDER` e si torna a `/data`: non è una cartella separata né vuota, e il
  controllo qui sopra non la ferma. L'avviso non ferma, non cancella e non rifà niente: una cartella
  può mancare anche per un motivo giusto, e il resto del sito funziona.
- **Il proprietario torna solo se è lo stesso account.** `video.json` tiene il nome e l'ora in cui
  l'account è nato (`uploadedBySince`). Un account nuovo con lo stesso nome, magari su un'altra
  installazione, è un'altra persona: il video resta privato e senza proprietario. Nella pagina del video
  l'amministratore gli dà un proprietario, o lo apre a tutti (con conferma; link e condivisioni vecchie
  cadono). Il titolo del video caricato torna comunque.
- **`moved_files` nomina i file nuovi con il codice, non con il nome della cartella**, così
  `--remove-old` li ritrova anche dopo una rinomina.
- **Una scelta spostata in un'altra cartella lascia il posto vecchio solo dopo la riga.** Prima si copia,
  poi si aggiorna la riga (solo se nomina ancora il file vecchio), e solo allora si cancella il vecchio.
  Uno stop in mezzo lascia due copie, mai nessuna.
- **`categorie/categorie.json` si legge come `video.json`.** Nomi vuoti, colori non validi, librerie
  che non sono tra quelle configurate e percorsi fuori dalla libreria si scartano. Un file che non si
  capisce non si sovrascrive. Dopo un ripristino le scelte del file vincono sulla copia solo se il suo
  `savedAt` è dopo l'ora della copia. Le immagini delle categorie che nessuno nomina, dopo un ripristino
  o con il file illeggibile, non si cancellano (`content.hold_category_files`): restano finché non le
  nomina di nuovo qualcuno, o le cancella l'amministratore a mano.
- **I modelli whisper restano in un posto solo.** Finché ci sono modelli solo nella cartella vecchia
  `whisper/`, la pagina Sottotitoli mostra quella e i modelli nuovi vanno lì. Dopo il trasferimento vale
  `modelli/whisper/`.
- **La copia del database si apre in sola lettura con un indirizzo `file:` corretto** anche per percorsi
  relativi e di Windows.
