# 0015 · Importare i dati dal vecchio FranzPLAY

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Il problema

Il vecchio FranzPLAY (PHP e MariaDB) è usato davvero. Il giorno del passaggio le persone devono
ritrovare nel nuovo tutto quello che avevano: account, mi piace, commenti, cronologia, salvati.
Il vecchio non va mai modificato, e l'importazione deve poter girare più volte senza fare danni.

## Cosa abbiamo deciso

- **Si legge una copia, non il database.** L'amministratore salva il vecchio database in un file
  `.sql` (con `mariadb-dump` o da phpMyAdmin) e lancia `franzplay import-old file.sql`. Il nuovo
  non si collega mai al vecchio MariaDB: non può cambiarlo nemmeno per sbaglio, e non serve una
  libreria per parlare con MariaDB (regola 10). Il file si legge un pezzo alla volta, quindi anche
  una copia grande non riempie la memoria del Raspberry.
- **Un comando dello stesso programma**, non un programma a parte: usa le stesse migrazioni e le
  stesse regole (regola 4). Con `-try` mostra il resoconto senza salvare niente.
- **Tutto o niente** (regola 6): una sola transazione. **Rilanciabile**: ogni riga si aggiunge
  solo se non c'è già (persone per nome, mi piace e salvati per persona e video, commenti per
  video, persona, testo e ora). Nella cronologia vince la posizione più recente.
- **Le password restano.** Il nuovo capisce gli hash bcrypt del vecchio e li sostituisce con
  Argon2id al primo accesso riuscito.
- **I video si riconoscono dal percorso**, confrontato dalla fine (nome del file, poi cartelle). Il
  vecchio non aveva un'impronta del contenuto, quindi il percorso è l'unico legame. Se due video
  vanno bene allo stesso modo, non si tira a indovinare: si scrive nel resoconto.
- **Il «visto» si ricalcola** con la durata vera del nuovo: il vecchio leggeva male le durate
  (audit, punto D2).
- **Ore italiane.** Il vecchio salvava le date con l'orologio di `Europe/Rome` (lo dice il suo
  `docker-compose.yml`); le colonne TIMESTAMP che `mariadb-dump` scrive in UTC si leggono in UTC.
  La tabella dei fusi orari è dentro il programma (`time/tzdata`, circa 450 KB), così funziona
  anche dove il sistema non ce l'ha.
- **Niente si perde in silenzio.** Ciò che il nuovo non sa ancora tenere (titoli e categorie
  cambiati a mano, copertine scelte a mano, foto del profilo, sottotitoli di Whisper) e le righe
  che non si leggono sono contati nel resoconto.

## Cosa resta per dopo

- Le foto del profilo: vivono nella cartella `App_Data/User_Images` del vecchio, non nel
  database. Serve un passo in più che le legga da lì.
- Titoli e categorie cambiati a mano e copertine scelte a mano, quando il nuovo saprà tenerli.
