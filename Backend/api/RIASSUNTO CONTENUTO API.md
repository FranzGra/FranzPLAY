# 📘 FranzTube - Documentazione Tecnica API Backend

> **Versione:** 2.0 (Revisione Sicurezza & Performance)
> **Stack:** PHP 8.x, MySQL 8.x, Nginx (Reverse Proxy)
> **Formato Scambio:** JSON
> **Autenticazione:** Sessioni PHP (Cookie)

---

## 1. Architettura Generale
Il backend è strutturato come una collezione di script PHP "micro-servizi" stateless che rispondono a chiamate REST/AJAX. L'architettura è nativa, ottimizzata per Raspberry Pi (basso overhead) e container Docker.

### 🛠️ Standard di Sviluppo
* **Bootstrap:** Ogni endpoint include `gestione_richiesta.php` (CORS/Helpers) e `database.php` (Connessione).
* **Input Handling:** Supporto ibrido per `php://input` (JSON raw da React) e `$_POST` (Fallback/FormData).
* **Output:** JSON standardizzato tramite funzione helper `inviaRisposta()` definita in `gestione_richiesta.php`.
* **Sicurezza:** Prepared Statements (MySQLi) obbligatori. Casting rigoroso dei tipi (`(int)`).
* **Error Handling:** Blocchi `try-catch` globali. Log su `error_log` (visibile da `docker logs`), risposta JSON pulita al client.

### 📡 Formato Risposta Standard
```json
{
  "successo": true,
  "messaggio": "Operazione completata",
  "dati": { ... } // Opzionale
}
```

---

## 2. Mappa dei File e Funzionalità

### 🧱 Core & Utilities
| File | Descrizione Tecnica |
| :--- | :--- |
| `gestione_richiesta.php` | **Middleware Globale**. Gestisce header CORS, avvia la sessione, definisce `inviaRisposta()`. Deve essere il primo include. |
| `database.php` | **DB Connector**. Inizializza `mysqli` con charset `utf8mb4` e timeout ridotti (per hardware low-spec). Gestisce variabili ENV Docker. |
| `check_admin.php` | **Middleware Sicurezza**. Verifica doppia (Sessione + Query DB) per endpoint amministrativi. Blocca esecuzione se non admin. |
| `setup_auth.php` | **Migration Tool**. Aggiunge colonne `Email` e `ResetToken` al DB se mancanti. Idempotente (può essere eseguito più volte). |

### 🔐 Autenticazione & Utenti
| File | Descrizione Tecnica |
| :--- | :--- |
| `login.php` | Autenticazione con hash `password_verify`. Implementa **Anti-Spam** basato su *Username* (non IP) per compatibilità VPN/Proxy (Tabella `Spammers`). |
| `logout.php` | Distrugge sessione server-side e invalida cookie client-side. |
| `registrazione.php` | Crea nuovi utenti. Hashing `PASSWORD_DEFAULT`. Controllo duplicati Username/Email. |
| `reset_password.php` | **Flow a 2 step**: 1) Generazione Token (simulazione invio email in log). 2) Reset password e invalidazione token. |
| `profilo.php` | Gestione account: cambio avatar (validazione MIME reale), cambio tema (HEX), cambio password e username. |

### 🎬 Video & Streaming
| File | Descrizione Tecnica |
| :--- | :--- |
| `video.php` | **Main Query Engine**. Gestisce Home, Filtri Categoria, Ricerca e Dettaglio Player. Usa Subqueries per ottimizzare il recupero di stati (Like/Salvati) in una singola chiamata. |
| `stream.php` | **Secure Streaming**. Non legge il file direttamente. Verifica auth, sanitizza il path (anti-traversal) e delega lo streaming a Nginx tramite header `X-Accel-Redirect`. |
| `categorie.php` | Restituisce lista semplice delle categorie (Cartelle mappate). |

### ❤️ Interazioni Utente
| File | Descrizione Tecnica |
| :--- | :--- |
| `aggiornaMinutaggio.php` | **Logica UPSERT**. Salva progresso video (`Cronologia`). Se record esiste aggiorna timestamp, altrimenti inserisce. Forza `continua_a_guardare=1`. |
| `toggleLike.php` | **Transazionale**. Aggiunge/Rimuove record in tabella `Like` E aggiorna contatore denormalizzato su `Video` in una transazione atomica. |
| `toggleSalvati.php` | Aggiunge/Rimuove da `Salvati`. Restituisce azione `saved`/`unsaved` per UI immediata. |
| `rimuoviDaCronologia.php` | **Soft Delete**. Imposta `continua_a_guardare = 0` nella tabella Cronologia. Non cancella i dati statistici ma nasconde dalla Home. |
| `commenti.php` | CRUD Commenti. `SELECT` con JOIN utente. `DELETE` consentita a Owner o Admin (logica unificata in query condizionale). |

### 🛠️ Amministrazione (`admin.php`)
Unico entry-point per tutte le operazioni di gestione:
* `lista_video` / `dettagli_video`: CRUD video.
* `upload_copertina` / `upload_sfondo_categoria`: Upload immagini con validazione MIME `finfo`.
* `elimina_video`: Cancella record DB e file fisici dal filesystem.
* `stato_server`: Statistiche spazio disco e configurazione PHP `ini_get`.

---

## 3. Gestione Errori e Sicurezza

1.  **SQL Injection:**
    * Tassativo l'uso di `prepare()` e `bind_param()` per qualsiasi variabile utente.
    * Nessuna concatenazione di stringhe nelle query SQL.

2.  **Path Traversal (File System):**
    * In `stream.php` e nelle funzioni di upload, i percorsi vengono puliti rimuovendo `..`, `//` e null bytes.
    * L'accesso ai file video avviene solo tramite redirect interno di Nginx (`/protected_media/`).

3.  **Cross-Origin (CORS):**
    * Gestito centralmente in `gestione_richiesta.php`. Abilitato per `localhost` in sviluppo, da configurare per dominio reale in produzione.

4.  **Database Failures:**
    * Se il DB non è raggiungibile, `database.php` intercetta l'errore e restituisce un JSON 500, prevenendo la stampa di stack trace HTML.

---

## 4. Schema Database (Riferimento Rapido)

* **Video:** `id`, `Titolo`, `Likes` (cache counter), `percorso_file`, `percorso_copertina`, `id_Categoria`.
* **Utenti:** `id`, `Nome_Utente`, `Password` (hash), `Admin` (bool), `colore_Tema`, `Email`, `ResetToken`.
* **Cronologia:** `id_Utente`, `id_Video`, `progresso_secondi`, `continua_a_guardare` (bool), `ultimo_aggiornamento`.
* **Like / Salvati:** Tabelle di relazione (`id_Utente`, `id_Video`).
* **Spammers:** `Nome_Utente`, `bloccato_fino_a` (Logica anti-bruteforce per username).
* **Commenti:** `id`, `id_Utente`, `id_Video`, `testo_commento`.