# 0016 · L'app Android

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Il problema

Il vecchio FranzPLAY aveva un'app Android, e nessuna funzione del vecchio si perde. Il vecchio la
faceva con Capacitor: tutto il sito era copiato dentro l'app, e al primo avvio l'app chiedeva
l'indirizzo del server. Così ogni modifica all'interfaccia voleva un'app nuova, e il sito doveva
saper parlare con un server «lontano» (cookie e indirizzi diversi).

## Cosa abbiamo deciso

- **Una finestra sul server.** L'app mostra l'interfaccia che il server già serve (una WebView,
  cioè il motore del browser dentro un'app). L'interfaccia resta **una sola**, in `web/`.
  Aggiornare il server aggiorna anche l'app. Cookie e indirizzi funzionano come nel browser.
- **Prima chiede l'indirizzo e lo controlla.** Come il vecchio. Si accetta anche solo
  `192.168.1.50`: l'app aggiunge `http://` e la porta 8090. Prima di salvarlo chiama
  `GET /api/health`: se non risponde FranzPLAY, lo dice invece di mostrare una pagina bianca.
- **Java e solo Android, nessuna libreria** (regola 10): niente Capacitor, niente AndroidX,
  niente Kotlin. L'APK resta piccolissimo e le parti da capire sono poche.
- **Quello che il browser darebbe e la WebView no, lo aggiunge l'app:** schermo intero dei video,
  scelta dei file, pannello Condividi (la WebView non ha `navigator.share`: l'app lo aggiunge alla
  pagina e lo passa ad Android), tasto Indietro, schermata quando il server non risponde.
- **Solo il server dentro l'app.** I link ad altri siti si aprono nel browser del telefono. Il
  pannello Condividi accetta solo indirizzi del server.
- **http permesso.** A casa FranzPLAY si raggiunge quasi sempre con `http://192.168.…`, quindi
  l'app lo permette (anche `https` funziona).
- **Anche il sito è installabile** (manifest e icone in `web/public/`): su un iPhone o con un
  indirizzo `https` si può aggiungere alla schermata Home anche senza app.
- **La CI costruisce l'APK** (workflow `Android`). La chiave per firmare sta nei segreti di
  GitHub, mai nel codice (regola 9). Senza chiave, l'APK è firmato con una chiave temporanea.
- **Android 8.0 o più nuovo** (`minSdk 26`): copre quasi tutti i telefoni in uso e permette
  l'icona disegnata come vettore, senza immagini per ogni misura.

## Cosa abbiamo scartato

- **Capacitor, come il vecchio:** due copie dell'interfaccia da tenere allineate, più dipendenze,
  e una app nuova per ogni modifica.
- **Solo il sito installabile (PWA):** Android lo installa come app vera solo con `https`, che a
  casa di solito non c'è.
- **Un'app scritta da zero (Kotlin, Jetpack Compose):** tutto da rifare due volte, contro la
  regola dell'unica interfaccia.
