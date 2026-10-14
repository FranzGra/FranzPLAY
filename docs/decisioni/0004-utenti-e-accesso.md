# 0004 · Utenti e accesso

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Cosa abbiamo deciso

- Per vedere qualsiasi cosa in FranzPLAY bisogna **entrare con nome e password**. Senza accesso
  si vede solo la pagina di accesso.
- Ci sono due ruoli: **amministratore** (gestisce gli utenti) e **utente** (guarda, e più avanti
  mette "mi piace" e commenta). Chi può caricare video lo decide l'amministratore, utente per utente.
- Gli utenti li crea **l'amministratore**: niente registrazione libera, perché FranzPLAY si
  condivide con famiglia e amici per invito.

## Il primo avvio

Al primo avvio non esiste nessun utente. FranzPLAY scrive nel terminale un **codice di
installazione**, per esempio `setup_code=RFY6-9YPX-QF7X`, e chiede quel codice per creare
l'amministratore.

**Perché un codice?** Senza, il primo che apre la pagina diventerebbe amministratore: se FranzPLAY
è raggiungibile da altri in casa (o da internet), potrebbe non essere chi l'ha installato. Il
codice lo vede solo chi può leggere il terminale. Una volta creato l'amministratore il codice non
serve più e non viene più mostrato.

**Aggiornamento del 13 ottobre 2026: il codice ora è spento di serie.** Non si vuole dover
cercare un codice nel terminale: chi installa apre il sito e crea subito l'amministratore. Il
rischio resta quello detto sopra, ma è piccolo: la pagina esiste solo nei pochi minuti tra
l'installazione e la creazione dell'amministratore, di solito su una rete di casa, e dopo non si
riapre mai (il database rifiuta un "primo utente" se ne esiste già uno, anche con due richieste
nello stesso istante). Nel log FranzPLAY scrive che aspetta il suo amministratore. Chi mette il
sito su internet prima di crearlo accende il codice con `FRANZPLAY_SETUP_CODE=true`.

## Le password

- Non si salvano mai. Si salva un'**impronta** fatta con **Argon2id**: un calcolo lento e che usa
  molta memoria, facile per controllare una password ma costosissimo per chi, rubato il database,
  volesse provare milioni di password. Usiamo le impostazioni minime consigliate da OWASP
  (un'organizzazione che si occupa di sicurezza del web).
- Da 8 a 128 caratteri.
- Dopo **5 password sbagliate** per lo stesso nome bisogna aspettare un minuto.
- A un nome che non esiste FranzPLAY risponde nello stesso modo e nello stesso tempo che a una
  password sbagliata: così non si scopre quali nomi esistono.
- Al massimo **due controlli di password insieme**: ognuno usa 19 MB, e un Raspberry da 2 GB non
  deve riempirsi per una raffica di tentativi.

## Le sessioni

Una volta entrati, il browser riceve un **cookie** (un piccolo biglietto che rimanda a ogni
richiesta) con un codice casuale. Nel database si salva solo l'impronta del codice.

- Dura **30 giorni dall'ultimo uso**: chi usa FranzPLAY almeno una volta al mese non deve mai
  rientrare.
- Il cookie non è leggibile dagli script della pagina e non viene mandato da altri siti.
- Se si cambia la password, tutti gli altri browser vengono fatti uscire.
- Se l'amministratore cancella un utente, anche le sue sessioni spariscono.
- Le richieste che cambiano qualcosa e arrivano da un altro sito vengono rifiutate.

## Cosa non si può fare

- Cancellare l'**ultimo amministratore**: nessuno potrebbe più gestire FranzPLAY.
