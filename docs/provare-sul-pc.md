# Provare FranzPLAY sul tuo computer

Guida passo passo per scaricare il progetto, lanciare i test e avviare il programma.
Serve circa un quarto d'ora la prima volta, poi bastano pochi secondi.

## 1. Installa gli strumenti (una volta sola)

Servono quattro programmi:

- **Git**: scarica il progetto da GitHub e tiene traccia delle modifiche.
- **Go** (versione 1.26 o più nuova): il linguaggio di FranzPLAY. Compila e avvia il programma.
- **Node.js** (versione 22): serve solo per preparare l'interfaccia web. Chi installerà
  FranzPLAY a casa non ne avrà bisogno: l'interfaccia sarà già dentro il programma.
- **FFmpeg**: legge durata e risoluzione dei video (con `ffprobe`) e prepara le copertine.
  Senza, FranzPLAY parte lo stesso ma i video restano senza durata e senza copertina.

### Windows

1. Scarica e installa **Git** da <https://git-scm.com/download/win> (vanno bene tutte le opzioni proposte).
2. Scarica e installa **Go** da <https://go.dev/dl/> (il file `.msi` per Windows).
3. Scarica e installa **Node.js 22 LTS** da <https://nodejs.org/> (il file `.msi`).
4. Installa **FFmpeg** da PowerShell con `winget install Gyan.FFmpeg`.
5. Apri **PowerShell** (cercalo nel menu Start) e controlla che funzionino:

   ```powershell
   git --version
   go version
   node --version
   ffprobe -version
   ```

   Se vedi quattro numeri di versione, è tutto a posto. Se dice "comando non trovato", chiudi e
   riapri PowerShell.

### Mac

Installa Go da <https://go.dev/dl/> (il file `.pkg`) e Node.js 22 da <https://nodejs.org/>.
FFmpeg si installa con [Homebrew](https://brew.sh/): `brew install ffmpeg`. Git c'è già: la prima volta che scrivi `git`
nel Terminale, il Mac ti propone di installare gli strumenti necessari.

### Linux

Installa Git con il gestore dei pacchetti (`sudo apt install git` su Debian/Ubuntu/Raspberry Pi OS)
e Go seguendo <https://go.dev/doc/install> (le versioni nei gestori di pacchetti sono spesso vecchie).
Per Node.js 22 segui <https://nodejs.org/en/download>. FFmpeg: `sudo apt install ffmpeg`.

## 2. Scarica il progetto

Apri PowerShell (Windows) o il Terminale (Mac e Linux), vai nella cartella dove vuoi tenerlo e scrivi:

```sh
git clone https://github.com/FranzGra/FranzPLAY.git
cd FranzPLAY
```

Per provare una pull request **prima** di unirla, passa al suo ramo (il nome è scritto nella
pull request, accanto a "wants to merge ... from"):

```sh
git fetch
git checkout nome-del-ramo
```

Per tornare alla versione principale: `git checkout main`. Per scaricare le novità: `git pull`.

## 3. Lancia i test

```sh
go test ./...
```

La prima volta Go scarica e compila quello che serve, poi per ogni parte del programma deve
comparire `ok`. Se compare `FAIL`, qualcosa non va: copia il messaggio e mandamelo.

## 4. Prepara l'interfaccia

La prima volta, e ogni volta che scarichi novità sull'interfaccia:

```sh
cd web
npm ci
npm run build
cd ..
```

`npm ci` scarica le librerie dell'interfaccia (la prima volta ci mette un minuto),
`npm run build` la prepara e la mette dentro il programma.

## 5. Avvia FranzPLAY

```sh
go run ./cmd/franzplay
```

Vedrai una riga come `msg="FranzPLAY started" ... addr=:8090`. Ora apri il browser su:

**<http://localhost:8090>**

Compare FranzPLAY in tema scuro. Per vederlo come su un telefono, restringi la finestra del
browser: il menu laterale sparisce e compare la barra in basso con Home, Playlist e Profilo.

Per controllare solo il server, apri <http://localhost:8090/api/health>: deve comparire qualcosa
come `{"status":"ok","version":"dev"}`.

- Su Windows può comparire un avviso del firewall: puoi scegliere "Annulla", per provare sullo
  stesso computer non serve aprire niente.
- Per **fermarlo**, torna nella finestra del terminale e premi **Ctrl+C**. Vedrai
  `FranzPLAY stopped`.
- Il programma crea una cartella `data` accanto al progetto: è la sua cartella dati, con dentro
  il database `franzplay.db`. Puoi cancellarla quando vuoi: FranzPLAY la ricrea.

### Indicare la cartella dei tuoi video

FranzPLAY cerca i video nelle cartelle scritte in `FRANZPLAY_LIBRARIES`. Le legge e basta: non
crea, non rinomina e non cancella mai niente lì dentro. Le sottocartelle diventano categorie.

Windows (PowerShell), con più cartelle separate da `;`:

```powershell
$env:FRANZPLAY_LIBRARIES = "D:\Video;E:\Film di famiglia"
go run ./cmd/franzplay
```

Windows con il **Prompt dei comandi** (la finestra nera che mostra `C:\...>` invece di `PS C:\...>`):
qui si usa `set`, senza virgolette e senza spazi intorno all'`=`.

```bat
set FRANZPLAY_LIBRARIES=D:\Video;E:\Film di famiglia
go run ./cmd/franzplay
```

L'impostazione vale finché resta aperta quella finestra: in una finestra nuova va riscritta.

Mac e Linux, con più cartelle separate da `:`:

```sh
FRANZPLAY_LIBRARIES="$HOME/Video:/media/disco/Famiglia" go run ./cmd/franzplay
```

All'avvio e poi ogni minuto FranzPLAY controlla le cartelle e scrive nel terminale cosa ha trovato,
per esempio `library scan finished ... added=12`. Subito dopo legge durata e risoluzione di ogni
video nuovo e ne prepara la copertina, un lavoro alla volta (`job done kind=probe ...`,
`job done kind=cover ...`). Le copertine finiscono in `data/covers`.

**Senza ricaricare la pagina.** Se aggiungi un video nella cartella mentre FranzPLAY è aperto nel
browser, entro il controllo successivo (al massimo un minuto) compare da solo nella Home, e poco
dopo arriva anche la sua copertina. Il server avvisa il browser quando la libreria cambia, e la
pagina chiede di nuovo l'elenco.

**Copertina tua.** Se accanto a un video c'è un'immagine con lo stesso nome (per esempio
`mare.jpg` accanto a `mare.mp4`, oppure `mare-poster.jpg`), FranzPLAY usa quella. Altrimenti prende
un fotogramma a un decimo del video (al massimo al primo minuto), così evita gli inizi neri.

### Il primo accesso

Al primo avvio FranzPLAY non ha ancora utenti. Nel terminale compare una riga come questa:

```
level=WARN msg="FranzPLAY has no administrator yet: ..." setup_code=RFY6-9YPX-QF7X
```

Quel **codice di installazione** serve a creare l'amministratore, cioè te: solo chi vede il
terminale può farlo. Da quel momento tutto FranzPLAY chiede nome e password.

Apri <http://localhost:8090>: compare la pagina **Benvenuto in FranzPLAY**. Scrivi il codice,
il tuo nome e una password (almeno 8 caratteri) e premi **Crea e entra**. Le volte successive
basta nome e password. Per uscire: pagina **Profilo**, tasto **Esci**. Sempre dal Profilo, con
**Cambia password** scegli una password nuova: sugli altri dispositivi dovrai entrare di nuovo.

**Aggiungere persone.** Solo tu, come amministratore, vedi la voce **Amministrazione** nel menu (sul
telefono è nella pagina Profilo). Nella sezione **Persone** aggiungi familiari e amici con un nome e
una password, decidi chi può caricare video e chi è amministratore, dai una password nuova a chi
l'ha dimenticata o togli una persona. Deve restare sempre almeno un amministratore.

Nella sezione **Video** trovi tutti i video, anche quelli nascosti e quelli il cui file non si
trova più, con il nome del file. **Nascondi** fa sparire un video per tutti (resta con i suoi mi
piace e commenti, e con **Mostra** torna com'era); **Rifai copertina** rilegge il video e ne prepara
di nuovo copertina e anteprime.

Nella sezione **Commenti** trovi tutti i commenti, dai più nuovi, con il video sotto cui sono
scritti: puoi eliminare quelli che non vanno bene (con le loro risposte).

Nella sezione **Cartelle** vedi le cartelle dei video, quanti video ha ognuna e com'è andato
l'ultimo controllo. Se una cartella non si legge, o è vuota ma prima aveva dei video (disco
staccato?), te lo dice in rosso. Con **Controlla adesso** non aspetti il minuto.

Nella sezione **Lavori** vedi cosa FranzPLAY sta facendo da solo (leggere i video, copertine,
anteprime): quello in corso, quanti aspettano, quanti sono fatti e quali sono falliti, con il
messaggio d'errore. Con **Riprova** (o **Riprova tutti**) li rimetti in coda. La pagina si aggiorna
da sola mentre i lavori vanno avanti. Se manca ffmpeg o ffprobe, te lo dice in rosso.

Nella **Home** compaiono i video più recenti, con le categorie in alto per filtrarli. Clicca su un
video per guardarlo con il player di FranzPLAY:

- **barra del tempo** grande: cliccala o trascinala per spostarti;
- **±10 secondi** con i tasti accanto a Play, con le frecce o J e L della tastiera, oppure con un
  doppio tocco ai lati del video sul telefono;
- altri tasti: **spazio** o K per pausa, **F** schermo intero, **M** muto, **C** sottotitoli;
- l'**ingranaggio** apre le impostazioni: velocità, lingua dell'audio (se il video ne ha più di
  una), sottotitoli e il loro stile (dimensione, colore, sfondo, posizione).

**Continua a guardare.** FranzPLAY ricorda dove hai fermato ogni video, per ogni persona. Quando lo
riapri riparte da lì, e nella Home compare la riga **Continua a guardare** con una barra che mostra
quanto ne hai visto. I primi secondi non contano (hai solo aperto il video); gli ultimi secondi,
spesso i titoli di coda, valgono come «finito» e il video esce dalla riga.

**Cronologia.** Nel menu (o dalla pagina Profilo sul telefono) trovi tutti i video che hai guardato,
divisi per giorno. Con la **X** togli un video (la prossima volta riparte dall'inizio); con
**Cancella cronologia** la svuoti tutta. Ognuno vede solo la sua.

**Anteprime.** Passando il mouse (o il dito) sulla barra del player compare una piccola immagine
del punto del video. FranzPLAY le prepara da solo con ffmpeg, dopo la copertina, e le salva nella
cartella dati (`previews/`): per i video appena aggiunti arrivano dopo qualche secondo.

**Mi piace e commenti.** Sotto ogni video c'è il pollice **Mi piace** con quante persone lo
apprezzano, e più in basso i **commenti**: scrivi nel riquadro e premi **Commenta** (o Ctrl+Invio).
Con **Rispondi** si risponde a un commento, e la risposta finisce sotto di lui. Ognuno può
eliminare i propri commenti; l'amministratore può eliminare tutti, per tenere pulito.

**Playlist.** Sotto ogni video il tasto **Salva** apre le tue playlist: spunta **Guarda più tardi**
o una tua playlist, oppure creane una nuova al volo. Nella pagina **Playlist** le trovi tutte; dentro
una playlist puoi togliere un video con la **X**, rinominarla o eliminarla (i video restano nella
libreria). «Guarda più tardi» c'è sempre e non si elimina. Le playlist sono tue e nessun altro le
vede, finché non premi **Sul mio canale**.

**Il canale.** Ognuno ha un canale: dal menu a sinistra **Il mio canale**, oppure dalla pagina
Profilo. Mostra il tuo nome, da quando sei su FranzPLAY e le playlist che hai messo sul canale.
Gli altri possono aprirle e guardarle, ma non cambiarle. Per vedere il canale di qualcuno basta
premere il suo nome sotto un commento. Premi di nuovo **Sul mio canale** e la playlist torna solo
tua. «Guarda più tardi» resta sempre privata.

**Sottotitoli.** FranzPLAY usa i file `.srt` e `.vtt` che stanno accanto al video con lo stesso
nome, per esempio `mare.srt`, oppure `mare.it.srt` e `mare.en.srt` se ci sono più lingue. Non li
modifica: li legge e li converte al volo. Usa anche i sottotitoli **dentro** il video, come quelli
di molti file `.mkv`: ne fa una copia nella cartella dati, in `subtitles/`, e compaiono nel menu
dei sottotitoli del player insieme agli altri. Per un film lungo la copia può richiedere un po' di
tempo, perché ffmpeg deve leggere tutto il file: la vedi in Amministrazione › Lavori come
«Lingue e sottotitoli». I sottotitoli fatti di immagini (quelli dei DVD e dei Blu-ray) il browser
non li sa mostrare, quindi per ora vengono saltati.

**Più lingue audio.** Se un video ha dentro più lingue (capita con molti film `.mkv`), nel player
compare **ingranaggio › Audio**. Scegli un'altra lingua e il video continua dallo stesso punto con
l'audio nuovo: FranzPLAY lo rimonta al volo con ffmpeg, senza toccare il file. Il player si ricorda
la lingua per i video successivi. Se il computer sta già facendo questo lavoro per 3 video, il
player resta sulla lingua del file e te lo dice. Per creare un video di prova con due lingue:

```sh
ffmpeg -f lavfi -i testsrc2=duration=60 -f lavfi -i sine=frequency=440:duration=60 -f lavfi -i sine=frequency=880:duration=60 -map 0 -map 1 -map 2 -c:v libvpx-vp9 -c:a libopus -metadata:s:a:0 language=ita -metadata:s:a:1 language=eng "due lingue.mkv"
```

**Copie per i browser.** Alcuni video (molti `.mkv` e `.avi`, o i film in HEVC) non si vedono in
tutti i browser. FranzPLAY se ne accorge da solo e ne prepara una **copia** in formato MP4 nella
cartella dati, in `converted/`: il file originale non viene toccato. Quando la copia è pronta, il
player usa quella, senza che tu debba fare niente. La vedi in Amministrazione › Lavori come
«Copia per i browser».

- Se basta cambiare la "scatola" del video (per esempio un `.mkv` con immagine H.264), ci vuole
  poco: l'immagine viene solo copiata.
- Se va rifatta l'immagine (HEVC, vecchi `.avi`), su un Raspberry Pi può volerci anche più della
  durata del film. Per questo FranzPLAY lo fa per ultimo, con metà dei processori, e **si ferma**
  appena arriva un video nuovo: prima prepara la sua copertina, poi riprende la copia da capo.

Finché la copia non è pronta, un video così può restare nero o mostrare «Questo video non si riesce
a riprodurre»: riprova più tardi.

**Informazioni dal file accanto al video.** Se scarichi i video con
[yt-dlp](https://github.com/yt-dlp/yt-dlp) e l'opzione `--write-info-json`, accanto a ogni video
c'è un file `.info.json` con lo stesso nome (per esempio `gita [abc123].mp4` e
`gita [abc123].info.json`). FranzPLAY lo legge, senza modificarlo, e usa il **titolo vero** al posto
di quello ricavato dal nome del file; nella pagina del video mostra anche **chi l'ha pubblicato**,
il **giorno** e la **descrizione**. Lo vedi in Amministrazione › Lavori come «Informazioni dal file
accanto». Se aggiungi o cambi il file `.info.json` dopo, premi **Rifai copertina** sul video in
Amministrazione › Video: oltre alla copertina rilegge tutto.

**Video consigliati.** Accanto al player, in **Da guardare dopo**, FranzPLAY propone i video più
simili a quello che stai guardando, e sotto ognuno dice perché: «Visto da chi ha visto questo»
(qualcun altro ha guardato tutti e due), «Anche questo in Vacanze» (stessa categoria) o «Titolo
simile» (parole in comune nel titolo). I video che hai già finito vanno in fondo. Nella Home, dopo
che hai guardato o messo «Mi piace» a qualcosa, compare la riga **Potrebbe piacerti**: video delle
categorie che guardi di più e video guardati dagli altri, che tu non hai ancora aperto. Tutto si
calcola sul tuo computer, con poche regole semplici: nessun dato esce di casa.

### Cambiare porta

Se la porta 8090 è occupata, puoi sceglierne un'altra.

Windows (PowerShell):

```powershell
$env:FRANZPLAY_ADDR = ":9000"
go run ./cmd/franzplay
```

Windows (Prompt dei comandi):

```bat
set FRANZPLAY_ADDR=:9000
go run ./cmd/franzplay
```

Mac e Linux:

```sh
FRANZPLAY_ADDR=:9000 go run ./cmd/franzplay
```

## 6. Facoltativo: gli stessi controlli di GitHub

Su Mac e Linux, con `make` e [golangci-lint](https://golangci-lint.run/welcome/install/)
installati, `make check` lancia esattamente i controlli che GitHub fa a ogni modifica.
Su Windows non serve: GitHub li fa comunque in automatico su ogni pull request.

Per i soli controlli dell'interfaccia, su qualsiasi sistema: `cd web` e poi `npm run check`.
