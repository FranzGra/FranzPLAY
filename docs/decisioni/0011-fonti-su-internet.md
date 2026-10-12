# 0011 · Copertine e informazioni da internet

**Data:** 12 ottobre 2026 · **Stato:** decisa (fatte: YouTube, TMDB)

## Il problema

Molti video non hanno accanto né una copertina né un file con le informazioni. Per quelli scaricati
da YouTube, però, il nome del file contiene il codice del video (`Gita [dQw4w9WgXcQ].mp4`): basta
chiedere a YouTube copertina, titolo e canale.

## Cosa abbiamo deciso

Francesco ha scelto (12/10/2026) tre fonti, da fare **una alla volta**:
1. **YouTube**.
2. **TMDB**, per i film.
3. **ThePornDB**.

Per tutte vale:

- Sono **spente** finché l'amministratore non le accende, in **Amministrazione › Internet**.
  FranzPLAY funziona uguale senza nessuna fonte e senza internet.
- Si manda **solo quello che il nome del file dice del video** (il codice YouTube, o titolo e anno
  del film), mai niente su chi usa FranzPLAY.
- Un lavoro nuovo della coda, **«Informazioni da internet»** (`online`), chiede un video alla
  volta: per ogni video nuovo, e per tutti quando si accende una fonte.
- Quello che arriva da internet sta in **colonne a parte** (`online_title`, `online_author`…). Le
  colonne calcolate `shown_title`, `shown_author`, `shown_description` e `shown_published_on`
  dicono in un posto solo cosa si vede, campo per campo: prima i **file accanto al video**, poi
  **internet**, poi il **nome del file**.
- La copertina scaricata va nella cartella dati (`online/`). Il lavoro della copertina la passa
  da ffmpeg come tutte le altre. L'ordine è questo: l'immagine accanto al video, poi quella di
  internet, poi un fotogramma del video. Passare da ffmpeg vuol dire anche che un file che non è
  davvero un'immagine non diventa mai una copertina.

**YouTube** non chiede chiavi:
- Il titolo e il canale vengono dall'indirizzo pubblico «oEmbed».
- La copertina viene da `i.ytimg.com`: prima la più grande, se manca quella media.

Se YouTube non conosce più il video (tolto o privato), le sue informazioni si dimenticano.

**TMDB** (The Movie Database), per i film:
- Il **nome del file** dice titolo e anno: `Il sorpasso (1962).mkv`, `The.Matrix.1999.1080p.mkv`.
  Si prende l'ultimo anno; un nome con il codice YouTube va a YouTube, non a TMDB.
- Si cerca in italiano e, se non si trova, in inglese. Un risultato si usa **solo se titolo
  (italiano o originale) e anno sono proprio quelli**, a parte maiuscole e punteggiatura. Così
  `Gita al mare 2019.mp4` non diventa mai un film a caso.
- L'autore è il **regista**; l'immagine è quella larga del film, se manca il poster.
- Serve una **chiave gratuita**, che l'amministratore incolla in Amministrazione › Internet. Va bene
  sia la «Chiave API» corta sia il «Token di accesso in lettura» lungo. Prima di salvarla,
  FranzPLAY chiede a TMDB se è buona. La chiave sta nella tabella `settings` e **non esce mai dal
  server**: l'API dice solo se c'è. Non compare neanche negli errori.
- Se TMDB rifiuta la chiave, il lavoro si ferma senza riprovare; salvare una chiave nuova con TMDB
  acceso richiede di nuovo tutti i video.
- Ogni video va alla sua fonte: se quella fonte è spenta, non si chiede niente e si tiene quello
  che si era trovato.
- Nella pagina c'è la frase che TMDB chiede: «Questo prodotto usa l'API di TMDB ma non è approvato
  né certificato da TMDB».

## Perché così

Le risposte di internet si **controllano all'ingresso** (regola 8):
- tipo giusto, cioè JSON o immagine;
- grandezza massima: 64 KB per le informazioni, 4 MB per le immagini;
- testo pulito come quello dei file.

Un problema di rete o un «troppe domande» (429) si **riprova più tardi**, come ogni lavoro.

Spegnere una fonte non cancella quello che ha già trovato: smette solo di chiedere.

## Cosa resta per dopo

- ThePornDB, con la sua chiave gratuita inserita dall'amministratore.
