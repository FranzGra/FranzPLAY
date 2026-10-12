# 0008 · Video consigliati

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Il problema

Finito un video, cosa guardo? E nella Home, cosa c'è che potrebbe piacermi? YouTube usa sistemi
enormi che imparano da miliardi di persone. FranzPLAY gira su un Raspberry Pi, per una famiglia: ci
vuole qualcosa di piccolo, veloce e che si capisca.

## Cosa abbiamo deciso

Due liste, ognuna con poche regole a **punti**. Ogni video consigliato dice **perché** è lì.

**Da guardare dopo** (accanto al player), per il video che stai guardando:

| Regola | Punti |
|---|---|
| Un'altra persona ha guardato sia questo video sia quello | 2 per persona, fino a 3 persone |
| Stessa categoria | 3 |
| Una parola in comune nel titolo (di almeno 4 lettere, non parole come «della» o «video») | 1 per parola, fino a 3 |

I video che hai già finito vanno in fondo. Se nessun video prende punti, la lista mostra i più
recenti, così non è mai vuota.

**Potrebbe piacerti** (nella Home), per te:

| Regola | Punti |
|---|---|
| Una categoria che ti piace: 2 per ogni «Mi piace» e 1 per ogni video guardato in quella categoria | 2 per ogni punto, fino a 5 |
| Altre persone hanno guardato o messo «Mi piace» al video | 2 per persona, fino a 3 persone |

Qui ci sono solo video che non hai mai aperto e che prendono almeno un punto. Se non hai ancora
guardato niente, la riga non compare.

La ragione mostrata è la regola che ha dato più punti. A parità di punti viene prima il video più
recente.

## Perché così

**Si capisce.** Con «Anche questo in Vacanze» o «Visto da chi ha visto questo» sai subito perché
un video ti viene proposto. Non serve fidarsi di una scatola nera.

**È leggero.** Per ogni richiesta il programma legge solo id, titolo e categoria dei video (anche
diecimila video sono pochi kilobyte) più la cronologia e i «Mi piace», e fa qualche somma. Niente
intelligenza artificiale, niente calcoli di notte, niente tabelle in più nel database.

**Resta a casa.** Le regole usano solo quello che c'è già nel tuo FranzPLAY.

**I tetti** («fino a 3 persone») impediscono a una sola regola di schiacciare le altre.

## Cosa resta per dopo

- Quando ci saranno i video caricati dagli utenti, si aggiungerà la regola «stesso canale».
- Se un giorno le liste diventassero lente con moltissimi video, si potranno salvare i risultati
  invece di calcolarli a ogni richiesta.
