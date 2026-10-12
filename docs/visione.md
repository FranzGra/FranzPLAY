# FranzPLAY: la visione

> Il documento completo su cosa stiamo costruendo, per chi e con quali regole.
> Le istruzioni di lavoro brevi sono in [`CLAUDE.md`](../CLAUDE.md). Le parti segnate con ❓ sono
> decisioni ancora aperte (elenco nella sezione 13).

---

## 1. Cos'è FranzPLAY, in una frase

**Uno YouTube personale, gratuito e open source, che chiunque può installare a casa propria su un
computer piccolo e vecchio.**

Ogni contenuto è **un video**: non un film, non un episodio di una serie. Un video ha un titolo,
una copertina, un canale o una categoria, i like, i commenti, e si può salvare in una playlist o
riprendere da dove lo si era lasciato. Esattamente come su YouTube.

### Perché esiste (e perché non è Jellyfin)

- **Jellyfin** è pensato per film e serie TV: cataloga per stagioni, attori, anni, e per
  funzionare bene vuole che i file siano nominati in un certo modo. Per una raccolta di video
  "normali" (corsi, video scaricati, riprese di famiglia, tutorial) è lento da usare e pesante.
- **YouTube** è comodo, ma un creator che ci mette i suoi video non possiede né la piattaforma
  né la sua community.
- **FranzPLAY** sta in mezzo: la semplicità di YouTube, sul tuo computer, con i tuoi file.

### I due scopi del progetto

1. **Il prodotto**: lo YouTube personale descritto sopra.
2. **Imparare**: Francesco usa il progetto per imparare Go e il modo moderno di scrivere software,
   costruendolo insieme all'IA. Quindi il codice deve essere **chiaro e spiegabile**, non solo
   funzionante (vedi sezione 10).

---

## 2. Per chi è

✅ **Deciso (12/10/2026)**: FranzPLAY si scrive per **una persona normale** che si fa il suo
"YouTube di casa".

- **Cosa vuole**: buttare i suoi video in una cartella e guardarli subito, da TV, telefono o PC.
- **Con chi**: lui stesso, e i familiari o gli amici con cui vuole condividere i video.
- **Esempi**: una raccolta di video scaricati, corsi comprati, video delle vacanze, riprese di famiglia.

Il creator che si fa il suo sito per la community è **solo un esempio** di come si può usare
FranzPLAY, non un pubblico per cui aggiungiamo funzioni apposta.

---|---|---|
| **Persona a casa** | Buttare video in una cartella e guardarli subito, da TV, telefono o PC, con la sua famiglia | Una raccolta di video scaricati, corsi comprati, video di vacanze |
| **Creator** | Un suo "canale" sul suo sito, dove la community guarda, commenta e mette like ai suoi video e videocorsi | Un insegnante che pubblica un corso su `video.suosito.it` |

❓ **Decisione aperta A**: quale dei due serviamo per primo (vedi sezione 13).

---

## 3. Dove deve girare

FranzPLAY deve funzionare bene **su macchine piccole e vecchie**. È uno dei motivi per cui esiste.

- **Macchina di riferimento minima**: Raspberry Pi 4 con 2 GB di RAM. Se gira bene lì, gira bene ovunque.
- **Altre macchine tipiche**: ZimaBlade / ZimaOS, un vecchio portatile, un NAS, un mini PC.
- **Sistemi**: Linux prima di tutto (anche ARM, cioè i processori del Raspberry). Windows e macOS
  devono funzionare, ma non sono la priorità.

### Obiettivi misurabili

Questi numeri sono il nostro "metro". Se una modifica li peggiora, va ripensata.

| Cosa | Obiettivo |
|---|---|
| Memoria (RAM) a riposo, con 10.000 video | sotto i **100 MB** (puntiamo a 50) |
| Un video nuovo compare nel sito | entro **pochi secondi** da quando il file è completo |
| La copertina di un video nuovo è pronta | entro **qualche secondo** dalla comparsa |
| Avvio del programma | sotto i **2 secondi** |
| Installazione | **un solo file** da scaricare (o un solo container Docker) |
| Il sito si apre su un telefono | veloce anche con una connessione lenta |

Per confronto: la versione vecchia usa circa 1–1,3 GB a riposo con zero video, Jellyfin 200–400 MB.

---

## 4. Cosa FranzPLAY NON è (e non deve diventare)

Dire no è importante quanto dire sì: ogni funzione in più è peso in più sul Raspberry.

- **Non è un media center** per film e serie (niente stagioni, episodi, cast, anni di uscita).
- **Non converte i video "al volo"** mentre li guardi: un Raspberry non ce la fa. Se un video non
  si vede nel browser, si prepara prima una copia compatibile, con calma (vedi sezione 6).
- **Non è tanti programmi** che si parlano: è **uno solo**.
- **Non modifica mai i tuoi file** (regola n.1, sezione 9).
- **Non dipende da servizi esterni**: internet serve solo per funzioni facoltative (copertine
  online). Senza internet, tutto il resto funziona.

---

## 5. Le funzioni, con le priorità

Si costruisce **una tappa alla volta**. Ogni tappa finisce con qualcosa che si può usare davvero.

### Tappa 1 · "Guardo i miei video" (il minimo indispensabile)

- Scegliere una o più **cartelle video** (le "librerie"). Le sottocartelle diventano **categorie**.
- Il programma **trova da solo** i video nuovi, spostati o rinominati.
- **Copertina** automatica per ogni video (un fotogramma, oppure l'immagine che c'è già accanto al file).
- **Home in stile YouTube**: griglia di video, ultimi arrivati, categorie, ricerca per titolo.
- **Pagina del video** con il player, titolo, durata, descrizione.
- **Streaming** dei video che il browser sa già leggere, con salto avanti e indietro.
- **Utenti** con login e due ruoli: **amministratore** (creato al primo avvio) e **utente normale** (sezione 5 bis).
- **Continua a guardare**: il video riprende dal punto giusto, anche cambiando dispositivo.

### Tappa 2 · "È il mio YouTube"

- **Like** (e "non mi piace", ❓ se lo vogliamo).
- **Commenti**, con risposte.
- **Più playlist per utente**, create da lui, più la playlist speciale "Guarda più tardi".
- **Cronologia** di cosa ho visto.
- **Anteprime al passaggio del mouse** (le immagini che scorrono sulla barra del player).
- **Aggiornamenti in tempo reale**: un video nuovo compare senza ricaricare la pagina; l'admin
  vede l'avanzamento dei lavori (copertine, anteprime).
- **Pannello admin**: librerie, utenti, video, copertine, commenti, lavori in coda e falliti (con tasto "riprova").
- **Profilo / canale** di ogni utente: la sua pagina, con i suoi video e le sue playlist pubbliche.
- **Sottotitoli** già presenti (file `.srt`/`.vtt` accanto al video o dentro il file).
- **Più lingue audio**, se il file le contiene.

### Tappa 3 · "Lo condivido"

- **Raccomandazioni**: "video simili" e "potrebbe piacerti", calcolati sul tuo computer, con regole
  semplici e spiegabili (stessa categoria, stesso canale, cosa guardano gli altri utenti). Niente
  intelligenza artificiale pesante.
- **Copertine e informazioni da fonti esterne** (sezione 7).
- **Copie compatibili**: per i video che il browser non legge, il programma ne prepara una copia
  nella sua area, uno alla volta, quando la macchina è libera.
- **Condividere con amici e familiari**: inviti per creare un account, e video o playlist
  visibili solo a chi scegli tu.
- **Caricare video dal browser**: ogni utente abilitato carica i suoi video nel suo canale, da una
  pagina simile a quella di YouTube, e riceve like e commenti (sezione 5 bis).
- **Importare i dati dalla versione vecchia** (utenti, like, cronologia, commenti).

### Più avanti, se serve

- Sottotitoli automatici con Whisper (solo su macchine potenti, come modulo da accendere).
- App per TV e telefoni (all'inizio basta il sito installabile dal browser).
- Accesso da fuori casa in modo sicuro (consiglio: Tailscale, così il sito non è esposto su internet).
- Più lingue per l'interfaccia (italiano e inglese all'inizio).

---

## 5 bis. Utenti, ruoli e canali: una piccola community

FranzPLAY non è solo "i miei video": è una **piccola community privata** tra familiari e amici.

### Due ruoli

| Ruolo | Cosa può fare |
|---|---|
| **Amministratore** | Chi installa e mantiene FranzPLAY. Ha le pagine admin: librerie, video, copertine, commenti, utenti, lavori in coda, impostazioni. Può modificare o nascondere qualsiasi cosa. |
| **Utente** | Guarda i video, mette like, commenta, crea le sue playlist. Ha un suo **profilo / canale**. Se abilitato, **carica i suoi video** e riceve like e commenti. |

### Ogni utente ha il suo canale

- Una pagina profilo come su YouTube: foto, nome, i suoi video caricati, le sue playlist pubbliche.
- I video delle **librerie** (le cartelle dell'admin) appartengono al canale che l'admin sceglie
  per ogni libreria (di solito il suo).

### Dove finiscono i video caricati

- Nella **cartella dati di FranzPLAY**, in una parte riservata ai caricamenti, divisa per utente.
  Le cartelle video dell'admin restano **intatte e in sola lettura** (regola 1 e decisione G).
- I video caricati fanno parte dei dati da salvare: sono inclusi nel backup e nel trasloco.

### Le regole per non appesantire il Raspberry

- **Spazio massimo per utente**, deciso dall'admin.
- **Niente conversioni obbligatorie**: se il video è già nei formati che il browser legge (come
  quelli dei telefoni), si pubblica subito. Altrimenti si prepara una copia compatibile in coda,
  **un lavoro pesante alla volta**, e il video compare quando è pronto.
- Caricamento "a pezzi", che riprende da dove si era fermato se la connessione cade.

### Chi vede cosa

- ✅ **Deciso (12/10/2026)**: possono caricare video **solo gli utenti che l'admin abilita**, ognuno
  con il suo spazio massimo. Gli altri guardano, commentano e creano playlist.
- Ogni video caricato ha una **visibilità**: tutti gli utenti di questo FranzPLAY, solo alcune
  persone scelte, oppure privato.
- L'utente può modificare o cancellare i **suoi** video; l'admin può nascondere o togliere qualsiasi
  video o commento.

---

## 6. La velocità: come la otteniamo

Sono i tre punti dove la versione vecchia era lenta.

### Trovare i video nuovi

- Il programma si fa **avvisare dal sistema operativo** quando cambia qualcosa nella cartella
  (su Linux si chiama *inotify*), invece di ricontrollare tutto ogni tanto.
- Per i dischi di rete, che a volte non avvisano, c'è anche un **controllo periodico** leggero di riserva.
- Un video **compare subito** come "in arrivo", e diventa guardabile appena il file è completo
  (cioè quando smette di crescere). Così si vede subito che è stato trovato, senza rischiare di
  leggere un file copiato a metà.

### Copertine

- Prima si cerca un'immagine **già presente** accanto al video (es. `video.jpg`, o quella che
  scarica yt-dlp): istantanea.
- Altrimenti si estrae **un solo fotogramma** con ffmpeg, saltando direttamente al punto giusto
  del file senza leggerlo tutto: pochi istanti anche sul Raspberry.
- Le copertine hanno **la precedenza** su tutti gli altri lavori.

### Anteprime

- Le anteprime (le immagini sulla barra del player) costano di più: si fanno **dopo**, con calma,
  a priorità bassa.
- **Un lavoro pesante alla volta**, deciso dal programma in base alla macchina.

---

## 6 bis. I tuoi dati sopravvivono a un trasloco o a una reinstallazione

Obiettivo: se cambi server, reinstalli il sistema o rifai il container Docker, **non perdi niente**
(utenti, like, commenti, playlist, cronologia) e il programma **non rifà da capo** copertine e
anteprime già pronte.

Come lo otteniamo, **senza scrivere nelle tue cartelle video**:

- **Una sola "cartella dati" di FranzPLAY**, scelta all'installazione, che contiene tutto: il
  database SQLite, le copertine, le anteprime, le copie compatibili, i backup. Il programma, invece,
  si può buttare e reinstallare quando vuoi.
- **Consiglio: metterla sullo stesso disco dei video**, ma *accanto* alla cartella video, non dentro
  (es. `/disco/video/` e `/disco/franzplay-dati/`). Così, se si rompe o si reinstalla il sistema
  operativo, i dati sono al sicuro insieme ai video. Con Docker, la cartella dati è "collegata" dal
  disco, mai chiusa dentro il container.
- **Traslocare = copiare quella cartella.** Nuovo server, si indica la cartella dati e si riparte
  identici. Il lavoro già fatto (copertine, anteprime) è lì e non si ricalcola.
- **Backup automatico** del database ogni notte, dentro la cartella dati, tenendo gli ultimi giorni.
- **I video si riconoscono dal contenuto** (regola 2): anche se sul nuovo server le cartelle hanno
  un percorso diverso, il programma ritrova ogni video e lo ricollega a like, commenti e copertine.
- **Esportazione leggibile**: dall'admin si può scaricare un file unico (JSON) con utenti, playlist,
  like, commenti e cronologia. Serve come copia di sicurezza "per sempre", leggibile anche senza FranzPLAY.

**Leggere** file accanto ai video va benissimo (copertine già presenti, `.nfo`, `.info.json` di
yt-dlp, sottotitoli): li usiamo per lavorare meno. **Scriverli** no, per la regola 1.

✅ **Deciso (12/10/2026)**: tutto ciò che il programma genera vive solo nella cartella dati. Nessun file scritto accanto ai video, nemmeno come opzione.

---

## 7. Fonti esterne per copertine e informazioni (facoltative)

Tutto deve funzionare **anche senza internet**. Le fonti esterne si accendono a scelta.

Ordine proposto, dalla più semplice:

1. **File accanto al video** (gratis, offline): immagine di copertina, file `.nfo`, e soprattutto il
   file `.info.json` che crea **yt-dlp** quando scarichi da YouTube. Contiene titolo, descrizione,
   canale, data, tag: tutto quello che serve, senza chiedere niente a nessuno.
2. **YouTube**: per i video scaricati da YouTube, recuperare copertina e informazioni dal codice del
   video (quello nel nome del file).
3. **TMDB** (The Movie Database): per chi ha anche qualche film. Serve una chiave gratuita.
4. Altre da decidere insieme più avanti.

Ogni fonte è un **"fornitore"** intercambiabile: aggiungerne una nuova non deve toccare il resto del
programma. ❓ Quali fonti e in che ordine lo decidiamo quando arriviamo alla tappa 3.

✅ **Fatto (12/10/2026)**: la fonte 1, il file `.info.json` di yt-dlp accanto al video (titolo,
descrizione, autore, giorno), e i file `.nfo` di Kodi e Jellyfin. Decisione in
`docs/decisioni/0009-informazioni-dai-file.md`.

---

## 8. Com'è fatto, in grande

```
  Browser (React + TypeScript)
        │  chiede i dati (API)        ▲ riceve gli avvisi "è cambiato qualcosa" (SSE)
        ▼                             │
  ┌──────────────────────────────────────────────┐
  │  FranzPLAY: UN SOLO programma in Go          │
  │                                              │
  │  catalogo · riproduzione · utenti · social   │
  │  elaborazione (coda dei lavori) · fonti      │
  └──────────────────────────────────────────────┘
        │ legge soltanto             │ scrive solo qui
        ▼                            ▼
  Le tue cartelle video        Area dati del programma
  (SOLA LETTURA)               database SQLite, copertine,
                               anteprime, copie compatibili
                                     │
                               ffmpeg (lanciato dal programma)
```

- **Un solo programma in Go**, diviso dentro in **moduli** (i "quartieri"): catalogo, riproduzione,
  utenti, social (like, commenti, playlist), elaborazione, fonti esterne.
- **Database SQLite**: un solo file, nessun programma separato da installare.
- **Interfaccia React + TypeScript**, preparata una volta e **inclusa dentro il programma Go**:
  si installa un file solo e c'è tutto.
- **Tempo reale con SSE**: il server manda un piccolo avviso ("il video 42 è cambiato") e il
  browser ricarica solo quella parte. Niente WebSocket.
- **ffmpeg / ffprobe** per leggere le informazioni dei video e fare copertine e anteprime.
- **Distribuzione**: un file eseguibile per Linux (anche ARM), Windows, macOS, più un'immagine
  Docker (comoda su ZimaOS e sui NAS).

---

## 9. Le regole che non si discutono

Vengono dall'audit della versione vecchia: ognuna esiste perché lì è successo un danno vero.
**Ogni regola deve avere almeno un test automatico che la prova.**

1. **Le cartelle video sono in sola lettura.** Il programma non rinomina, non converte sul posto,
   non cancella e non crea niente lì dentro. Tutto ciò che produce va nella sua area dati.
2. **Un video si riconosce dal contenuto, non dal percorso.** Dimensione più "impronta" di un pezzo
   del file: se lo sposti o lo rinomini, like, commenti e cronologia restano.
3. **Prima di cancellare, dubitare.** Se una cartella sembra vuota, forse il disco non è montato:
   non si cancella niente. Un video mancante viene solo **segnato come mancante**, e sparisce
   davvero dopo giorni. Mai cancellare tanti video in un colpo solo.
4. **Un solo padrone.** Un solo programma possiede il database e la coda dei lavori. Lo schema del
   database si definisce **in un posto solo**, con aggiornamenti numerati (migrazioni).
5. **Un lavoro pesante alla volta.** È il programma a decidere quando lanciare ffmpeg, in base alla macchina.
6. **Scritture "tutto o niente".** Ogni file si scrive prima in un file temporaneo e si rinomina
   solo a lavoro finito: niente file a metà.
7. **Gli errori non si nascondono.** Ogni errore arriva a chi deve saperlo. Ogni lavoro fallito è
   visibile nell'admin con un tasto "riprova". Mai rispondere "salvato!" se non è vero.
8. **Dati con tipi chiari.** La durata è un numero di secondi. Gli stati sono un elenco chiuso di
   valori. Ciò che arriva da fuori (browser, file, ffprobe, siti esterni) si controlla **una volta,
   all'ingresso**.
9. **Sicuro dall'installazione.** Segreti generati al primo avvio, mai scritti nel codice. Una sola
   porta aperta. Primo accesso protetto da un codice monouso. Sessioni che si possono revocare.
10. **Leggero per scelta.** Prima di aggiungere una libreria o una funzione, chiedersi quanto pesa
    sul Raspberry. Pochissime dipendenze, tutte con la versione fissata.

---

## 10. Come scriviamo il codice

### Organizzazione

- **Cartelle per funzionalità**, non per tipo di file: `catalogo/`, `commenti/`, `playlist/`…
  Ognuna contiene tutto quello che le serve, test compresi.
- **Nucleo puro e guscio**: le decisioni importanti ("questo video è nuovo?", "posso cancellare?",
  "l'ha visto tutto?") sono funzioni che non toccano disco, database o orologio. Si provano con un
  test in un millisecondo. Il guscio legge e scrive, e chiede al nucleo cosa fare.
- **Interfacce piccole** al posto dell'ereditarietà: un "fornitore di copertine" è qualunque cosa
  sappia rispondere a "trovami la copertina di questo video".
- **L'API si descrive una volta sola** (OpenAPI) e da lì si generano i tipi per l'interfaccia React:
  se il server cambia un campo, l'interfaccia se ne accorge subito.

### Abitudini

- **Formattazione automatica** (`gofmt`, Prettier) e **controlli automatici** (lint, tipi stretti).
- **Test dal primo giorno**: tanti test piccoli sul nucleo, pochi test "da browser".
- **Controlli a ogni modifica** su GitHub (CI): se un test fallisce, la modifica non entra.
- **Modifiche piccole**: una pull request = una cosa sola, facile da rileggere.
- **Messaggi di commit standard**: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`.
- **Decisioni scritte**: ogni scelta importante ha una paginetta che dice cosa si è deciso e perché
  (cartella `docs/decisioni/`).
- **Log ordinati**: ogni riga di log è un dato strutturato, leggibile anche da un programma.
- **Configurazione fuori dal codice**: percorsi e opzioni in un file o in variabili d'ambiente.

### Lingua

✅ **Deciso (12/10/2026)**: il codice e i commenti nel codice sono in **inglese**. La documentazione
per Francesco e le conversazioni restano in **italiano semplice**.

---

## 11. Come lavoriamo insieme (Francesco + IA)

Questo è anche un percorso di studio. Per questo:

- **L'IA spiega prima di scrivere**: cosa sta per fare e perché, in parole semplici, con pochi
  termini tecnici. Ogni termine nuovo viene spiegato la prima volta che compare.
- **Passi piccoli**: una funzione alla volta, ognuna con i suoi test. Niente modifiche giganti.
- **Francesco scrive dei pezzi da solo**: per ogni tappa, l'IA propone un piccolo esercizio su un
  pezzo vero del progetto (es. "scrivi la funzione che decide se un video è stato visto tutto"),
  poi lo rivede insieme a lui.
- **I test controllano l'IA**: se l'IA sbaglia, un test lo deve scoprire. Il codice che nessuno
  capisce non entra.
- **Prima la versione semplice**: si sceglie sempre la soluzione più semplice che funziona;
  si complica solo quando serve davvero.

---

## 12. Rapporto con la versione vecchia

- ✅ **Deciso (12/10/2026)**: la versione vecchia è in uso ma **non si corregge**. Resta com'è finché
  la nuova non è pronta, poi viene **sostituita direttamente** e dismessa.
- Il nuovo FranzPLAY è un **progetto nuovo, scritto da zero**, in un **repository GitHub nuovo**
  (deciso il 12/10/2026). Il repository vecchio resta a parte, com'è.
- Poiché legge le cartelle in sola lettura, si può provare **sugli stessi video** mentre il vecchio
  continua a funzionare.
- **Al cambio**, uno strumento di importazione porta nel nuovo utenti, like, commenti, cronologia e
  "continua a guardare" dal database vecchio, così nessuno perde niente. I video si ricollegano dal
  contenuto, non dal percorso.
- Dal vecchio si tengono le **idee** (home stile YouTube, "butta dentro e guarda") e alcune
  **ricette** (i comandi ffmpeg, le ricerche delle copertine), non il codice.
- ✅ **Interfaccia (decisa il 12/10/2026)**: rifatta da zero in **React + TypeScript**. Simile alla
  vecchia ma migliore, pensando molto bene all'esperienza d'uso.

### Come deve essere l'interfaccia

- **Stile moderno e minimale, "alla Apple"**: tanto spazio vuoto, pochi colori, caratteri puliti,
  animazioni leggere e mai invadenti.
- **Intuitiva**: chi la apre per la prima volta capisce cosa fare senza spiegazioni.
- **Efficace**: le azioni frequenti (guardare, riprendere, salvare in playlist) sono a un tocco.
- **Tema scuro come interfaccia principale** (deciso il 12/10/2026); il tema chiaro è secondario.
- **Funziona bene ovunque**: telefono, tablet, PC e TV.
- **Niente iscrizioni ai canali**: gli utenti sono pochi. Restano cronologia, categorie, il mio
  canale e le mie playlist.
- **Sul telefono, solo tre tasti in basso**: Home, Playlist, Profilo. Il tasto "Carica un video"
  sta nella pagina del profilo, non nella barra.
- Proposta grafica: https://claude.ai/artifact/TRM8naidqDGSB8qjMGjUyT
- **Veloce anche su telefoni economici** e connessioni lente.
- Prima di scrivere il codice di una pagina, si disegna com'è fatta e la si approva insieme.

---

## 13. Decisioni aperte

| | Domanda | Consiglio |
|---|---|---|
| ✅ A | Per chi è | **Deciso**: la persona a casa che condivide con familiari e amici. Il creator è solo un esempio d'uso. |
| ✅ B | Interfaccia | **Deciso**: rifatta da zero in React + TypeScript, stile minimale alla Apple, simile alla vecchia ma migliore. |
| ✅ C | Lingua | **Deciso**: inglese nel codice, italiano nei documenti. |
| ✅ D | Licenza | **Deciso**: doppia licenza. **AGPL-3.0** per tutti (codice pubblico; chi lo modifica o lo offre online deve pubblicare le modifiche) più una **licenza commerciale** che può concedere solo Francesco. Chi contribuisce firma un accordo (CLA) che lascia a Francesco i diritti per poter dare la licenza commerciale. Il nome FranzPLAY si potrà proteggere come marchio. |
| E | Fonti esterne per copertine e informazioni | Da decidere alla tappa 3. Proposta in sezione 7. |
| ✅ F | "Non mi piace" accanto al like | **Deciso**: solo il like. Tra familiari e amici il "non mi piace" serve poco e può offendere. |
| ✅ H | Chi carica video | **Deciso**: solo gli utenti abilitati dall'admin, con uno spazio massimo. Sezione 5 bis. |
| ✅ G | Dove tenere i dati | **Deciso**: una cartella dati unica accanto ai video (non dentro), con backup notturno ed esportazione JSON. Niente file scritti nelle cartelle video. Sezione 6 bis. |

---

## 14. Il primo passo: le fondamenta

Obiettivo: **un programma vuoto che si compila, si avvia e ha i controlli automatici attivi.**
Niente funzioni ancora, ma la "casa" è pronta e ordinata.

1. Questo documento entra nel progetto come `CLAUDE.md`, insieme alla licenza (AGPL-3.0 più la nota
   sulla licenza commerciale) e a un README breve.
2. Lo scheletro del programma Go: si avvia, legge la configurazione, risponde "sono vivo" a un
   indirizzo, e si spegne in modo pulito.
3. I controlli automatici su GitHub: formattazione, lint e test a ogni modifica.
4. Il primo test vero, sulla prima funzione pura: il tipo **Durata in secondi**.
5. **Esercizio per Francesco**: il tour ufficiale di Go (go.dev/tour), poi un piccolo programma che
   elenca i video di una cartella con nome, dimensione e data. Lo rivediamo insieme.

**Fatto quando**: chiunque scarica il progetto, lo avvia con un comando e i controlli su GitHub sono verdi.

---

## Piccolo glossario

- **Go**: il linguaggio del server. Crea un solo file eseguibile, leggero e veloce.
- **SQLite**: un database che è un semplice file, senza un programma separato.
- **React / TypeScript**: con cosa si costruisce l'interfaccia nel browser. TypeScript è JavaScript
  con i "tipi", che trovano gli errori prima di aprire il sito.
- **API**: l'elenco delle "domande" che il browser può fare al server.
- **SSE**: un canale in cui il server avvisa il browser quando cambia qualcosa.
- **ffmpeg / ffprobe**: i programmi che leggono e lavorano i video.
- **Migrazione**: un file numerato che cambia il database in modo ordinato e ripetibile.
- **CI**: i controlli automatici che partono a ogni modifica del codice.
- **Test**: un piccolo programma che controlla che un pezzo di codice faccia quello che deve.
- **Nucleo puro**: la parte del codice che prende decisioni senza toccare disco o database.
