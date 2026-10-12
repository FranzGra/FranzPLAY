# L'app Android

FranzPLAY ha una piccola app per i telefoni Android. Questa pagina spiega cosa fa, come
installarla e come si costruisce.

## Cosa fa

L'app è una **finestra su FranzPLAY**. Al primo avvio chiede l'indirizzo del tuo server, controlla
che lì risponda davvero FranzPLAY, e poi mostra FranzPLAY come se fosse un'app normale: niente
barre del browser, la sua icona sulla schermata Home.

L'interfaccia non sta dentro l'app: arriva dal server. Per questo **quando aggiorni il server,
anche l'app è già aggiornata**, senza reinstallare niente.

In più rispetto al browser:

- i video a **schermo intero** occupano tutto lo schermo; girando il telefono si guardano in largo;
- si possono **scegliere i file** da caricare (video, foto del profilo);
- il tasto **Condividi** apre il pannello del telefono (WhatsApp, Telegram, email…);
- il tasto **Indietro** del telefono torna alla pagina di prima;
- se il server non risponde compare una schermata chiara con **Riprova** e **Cambia server**;
- tenendo premuta l'icona dell'app c'è la scorciatoia **Cambia server**.

## Installarla sul telefono

1. Scarica il file `FranzPLAY.apk` (vedi sotto «Dove si trova l'APK»).
2. Aprilo dal telefono. La prima volta Android chiede il permesso di installare app scaricate
   («Installa app sconosciute»): concedilo al browser o all'app File che stai usando.
3. Apri FranzPLAY e scrivi l'indirizzo del server, lo stesso che usi nel browser.
   - Basta il numero del server, come `192.168.1.50`: la porta di FranzPLAY (8090) la aggiunge
     l'app da sola.
   - Se hai cambiato porta, scrivila: `192.168.1.50:9000`.
   - Se raggiungi FranzPLAY da internet con un indirizzo `https://…`, scrivilo intero.
4. Se FranzPLAY è a casa, il telefono deve essere collegato alla stessa rete Wi-Fi del server.

**Dal vecchio FranzPLAY:** la nuova app ha un nome interno diverso dalla vecchia, quindi possono
stare tutte e due sul telefono. Quando passi al nuovo FranzPLAY, disinstalla la vecchia.

## Dove si trova l'APK

L'APK lo costruisce GitHub da solo ogni volta che il codice dell'app cambia.

1. Su GitHub apri il repository, poi **Actions** e il workflow **Android**.
2. Apri l'ultima esecuzione con la spunta verde.
3. In fondo, sotto **Artifacts**, scarica **FranzPLAY-android**: è uno zip con dentro
   `FranzPLAY.apk`.

Con il tasto **Run workflow** della stessa pagina puoi farne costruire uno nuovo quando vuoi.
GitHub tiene questi file per 90 giorni.

## La chiave per firmare (da fare una volta)

Android installa solo app «firmate» con una chiave. Un'app si può **aggiornare** solo con un APK
firmato dalla **stessa** chiave; altrimenti bisogna disinstallarla e reinstallarla (e rientrare).

Finché non c'è una chiave tua, GitHub firma ogni APK con una chiave temporanea, sempre diversa.
Funziona, ma ogni aggiornamento chiede di disinstallare. Per evitarlo, crea una chiave una volta
sola e dalla a GitHub come «segreto» (un valore che GitHub custodisce e non mostra a nessuno).
La chiave **non va mai messa nel codice** (regola 9).

1. Sul computer, con Java installato, crea la chiave (scegli tu una password):

   ```sh
   keytool -genkeypair -v -keystore franzplay.jks -alias franzplay -keyalg RSA -keysize 4096 -validity 36500
   ```

2. Trasformala in testo:
   - Linux e Mac: `base64 -w0 franzplay.jks > franzplay.txt` (sul Mac: `base64 -i franzplay.jks -o franzplay.txt`)
   - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("franzplay.jks")) > franzplay.txt`
3. Su GitHub: **Settings › Secrets and variables › Actions › New repository secret**, e crea:

   | Nome | Valore |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | il contenuto di `franzplay.txt` |
   | `ANDROID_KEYSTORE_PASSWORD` | la password scelta |
   | `ANDROID_KEY_ALIAS` | `franzplay` |
   | `ANDROID_KEY_PASSWORD` | la password scelta |

4. Conserva `franzplay.jks` e la password in un posto sicuro (per esempio un gestore di password).
   Se li perdi, il prossimo APK non potrà aggiornare quello installato.

Da quel momento ogni APK di GitHub è firmato con la tua chiave e si installa sopra il precedente.

## Costruirla sul computer (facoltativo)

Serve solo se vuoi provare modifiche all'app. Ti servono **Java 17 o più nuovo** e l'**Android
SDK** (il modo più semplice è installare Android Studio e aprire la cartella `android/`).

```sh
cd android
./gradlew test             # i test
./gradlew assembleDebug    # l'APK di prova in app/build/outputs/apk/debug/
```

Su Windows si usa `gradlew.bat` al posto di `./gradlew`.

## Com'è fatta

```
android/app/src/main/java/io/github/franzgra/franzplay/
  ServerAddress.java   le regole sull'indirizzo (funzioni pure, con i test)
  SetupActivity.java   la schermata «Connetti a FranzPLAY»
  MainActivity.java    la finestra su FranzPLAY: schermo intero, file, Condividi, Indietro
  Settings.java        ricorda l'indirizzo del server
  Insets.java          tiene i contenuti lontani dalle barre del telefono
```

Il perché di queste scelte è in [`decisioni/0016-app-android.md`](decisioni/0016-app-android.md).
