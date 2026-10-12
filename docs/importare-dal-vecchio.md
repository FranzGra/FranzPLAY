# Portare i dati dal vecchio FranzPLAY

Il giorno del passaggio, questa guida porta nel nuovo FranzPLAY quello che le persone hanno
fatto nel vecchio: account, mi piace, commenti, cronologia e il resto. Dopo, il vecchio si può
spegnere.

Il vecchio database **non viene mai toccato**: se ne fa una copia in un file, e il nuovo legge
solo quel file. Se qualcosa va storto, il vecchio è esattamente com'era.

## Cosa viene portato

| Nel vecchio | Nel nuovo |
|---|---|
| Persone (nome, password, amministratore sì o no) | Persone, con la **stessa password** |
| Colore del tema di ogni persona | Colore del tema |
| Righe della Home chiuse | Righe della Home chiuse |
| Ultimo accesso | Ultimo accesso, nell'elenco delle persone |
| Mi piace | Mi piace |
| Commenti | Commenti |
| Salvati | «Guarda più tardi» |
| Cronologia e «Continua a guardare» | Cronologia e «Continua a guardare» |
| Registro degli accessi (ultimi 90 giorni) | Registro degli accessi |
| Nome e colore del sito, se li avevi cambiati | Nome e colore del sito |
| Foto del profilo (se copi anche la loro cartella) | Foto del profilo, ritagliate quadrate |

Il nuovo FranzPLAY **non sa ancora tenere** alcune cose del vecchio: titoli e nomi di categorie
cambiati a mano, copertine scelte a mano, sottotitoli fatti da Whisper. Il
resoconto finale le conta, così sai cosa manca; arriveranno con i prossimi passi.

Qualche dettaglio utile:

- **Le password.** Il vecchio le salvava con un metodo più vecchio (bcrypt). Il nuovo lo
  capisce: ognuno entra con la sua password di sempre, e al primo accesso il nuovo la mette al
  sicuro con il suo metodo, senza che la persona se ne accorga.
- **Chi c'è già.** Se nel nuovo esiste già una persona con lo stesso nome (per esempio tu, che
  hai creato l'amministratore al primo avvio), i suoi dati del vecchio vanno a lei. La sua
  password e il suo ruolo nel nuovo restano com'erano.
- **Nomi che il nuovo non accetta.** Il nuovo vuole nomi da 3 a 32 caratteri, fatti di lettere,
  numeri, spazi, punti, trattini e `_`. Un nome come `Al` diventa `Al_`: il resoconto te lo dice,
  e la persona può cambiarlo dal suo Profilo.
- **«Visto» o no.** Il vecchio leggeva male la durata dei video lunghi e segnava come visti film
  appena iniziati. Il nuovo ricalcola con la durata vera: quei film tornano a metà, dove erano.
  Un video che una persona aveva tolto da «Continua a guardare» resta fuori.
- **Commenti** più lunghi di 2000 caratteri vengono accorciati (con «…» alla fine); quelli vuoti
  restano fuori.

## Come si riconoscono i video

Il vecchio conosceva un video solo dal suo percorso dentro la cartella video, per esempio
`Vacanze/Mare 2019.mp4`. Il nuovo confronta i percorsi **partendo dalla fine**: il video giusto
è quello che ha lo stesso nome del file e, se ce ne sono più di uno, più cartelle uguali.

Quindi il modo più semplice è che il nuovo FranzPLAY usi **la stessa cartella dei video** del
vecchio (in `FRANZPLAY_LIBRARIES`). Va bene anche una cartella sopra o sotto quella.

Se due video hanno lo stesso nome e le stesse cartelle (nessuno può dire quale sia quello
giusto), l'importazione non tira a indovinare: lo scrive nel resoconto e lascia fuori i dati di
quel video.

## I passi

### 1. Prepara il nuovo FranzPLAY

Avvia il nuovo FranzPLAY con la cartella dei video del vecchio, crea l'amministratore e aspetta
che i video compaiano nella Home (vedi [provare-sul-pc.md](provare-sul-pc.md)). Non serve
aspettare copertine e anteprime: basta che i video ci siano.

Se lanci l'importazione prima, si ferma e te lo dice: senza video non saprebbe a cosa attaccare
mi piace e commenti.

### 2. Fai la copia del vecchio database

Sul computer dove gira il vecchio FranzPLAY, apri il terminale **nella cartella del vecchio
FranzPLAY** (quella con `docker-compose.yml`) e scrivi:

```sh
docker compose exec -T mysql sh -c 'mariadb-dump --single-transaction -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > vecchio-franzplay.sql
```

Non serve sapere la password del database: il comando la prende da dentro il container.
`--single-transaction` fa la copia senza fermare il vecchio sito, che intanto continua a
funzionare. Alla fine c'è un file `vecchio-franzplay.sql` (di solito pochi MB).

**In alternativa, con phpMyAdmin** (la pagina sulla porta 8080 del vecchio): scegli il database
a sinistra, poi **Esporta**, metodo **Rapido**, formato **SQL**, e premi **Esporta**. Va bene
uguale.

Porta il file sul computer del nuovo FranzPLAY (chiavetta, cartella condivisa…).

**Le foto del profilo** non sono nel database ma in una cartella del vecchio:
`App_Data/User_Images`, dentro la cartella del vecchio FranzPLAY. Se vuoi portarle, copia anche
quella cartella sul computer del nuovo. Le foto JPEG e PNG arrivano ritagliate quadrate; quelle
WEBP il nuovo non le sa leggere: il resoconto dice di chi sono, e quella persona la può
scegliere di nuovo dal suo Profilo.

### 3. Prova, senza salvare niente

Con le stesse impostazioni con cui avvii il nuovo FranzPLAY (soprattutto `FRANZPLAY_DATA_DIR`,
se l'hai cambiata), scrivi:

```sh
go run ./cmd/franzplay import-old -try vecchio-franzplay.sql
```

Se hai il programma già pronto invece del codice, è lo stesso con `franzplay` al posto di
`go run ./cmd/franzplay` (su Windows `.\franzplay.exe`).

Se hai copiato la cartella delle foto, aggiungi `-photos` con il suo percorso, prima del nome del
file:

```sh
go run ./cmd/franzplay import-old -try -photos User_Images vecchio-franzplay.sql
```

Con `-try` non viene salvato niente: compare solo il resoconto di cosa succederebbe. Comincia con
`PROVA` e dice per esempio quanti video ha ritrovato e quali no, quante persone arrivano, quanti
mi piace e commenti. Se mancano molti video, controlla di aver indicato la cartella giusta.

### 4. Importa davvero

Lo stesso comando, senza `-try` (e con `-photos …` se porti le foto):

```sh
go run ./cmd/franzplay import-old vecchio-franzplay.sql
```

È **tutto o niente**: se qualcosa si rompe a metà, non resta nessun dato a metà. Le foto arrivano
subito dopo, una per una: una foto che non si legge viene solo scritta nel resoconto. Chi ha già
una foto nel nuovo tiene la sua. Il nuovo
FranzPLAY può restare acceso intanto; dopo, ricarica la pagina nel browser.

Si può **rilanciare** quante volte vuoi: quello che c'è già non viene aggiunto due volte. Per
esempio, se ti accorgi di aver dimenticato una cartella di video, aggiungila, aspetta che i video
compaiano e rilancia l'importazione con lo stesso file: arrivano i dati di quei video.

### 5. Controlla e spegni il vecchio

Entra nel nuovo con un paio di account e guarda mi piace, commenti e «Continua a guardare».
Quando sei contento, spegni il vecchio FranzPLAY (`docker compose down` nella sua cartella).
Tieni da parte il file `vecchio-franzplay.sql`: è la copia di tutto il vecchio database.

Attenzione: dentro quel file ci sono anche le email e le impronte delle password. Non mandarlo in
giro e non metterlo su GitHub.
