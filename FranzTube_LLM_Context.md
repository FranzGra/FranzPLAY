# 🧠 FranzTube - LLM Technical Context & PRD
> **FILE CRITICO**: Questo documento contiene l'intera conoscenza tecnica necessaria per comprendere, manutenere ed espandere FranzTube. Forniscilo a qualsiasi LLM come contesto primario.

---

## 1. Executive Summary
**FranzTube** è una piattaforma di video streaming self-hosted (clone YouTube/Netflix) ottimizzata per hardware embedded (**Raspberry Pi 4**).
*   **Core Value**: "Drop & Watch". L'utente carica un file video via FTP/SMB e il sistema automatizza tutto (ingestione, metadata, locandine, streaming).
*   **Stack**: Docker Compose, React 19 (Vite), PHP 8.2 (Nativo), MySQL, Python 3.9 (Automation).
*   **Vincoli**: Risorse limitate (CPU/RAM RPi4) -> Architettura ottimizzata per caching, zero-copy streaming e concorrenza controllata.

---

## 2. Architettura & Infrastruttura (Docker)
Il sistema è un'orchestrazione di 7 container definita in `docker-compose.yml`.

| Servizio | Immagine | Ruolo & Responsabilità Tecniche |
| :--- | :--- | :--- |
| **frontend** | `node:18-alpine` | Server Dev Vite. Entrypoint dinamico (`entrypoint.sh`) che installa dipendenze al boot. Hot-reload attivo. |
| **web_server** | `nginx:alpine` | Gateway/Reverse Proxy. Gestisce SSL, routing `/` vs `/api/`. **Streaming Delegate** via `X-Accel-Redirect`. |
| **php** | `php:8.2-fpm` | Backend API Stateless. Logica business. Sessioni persistenti su disco (Condivise col container Nginx/PHP). |
| **mysql** | `mariadb` | DB Relazionale. Schema rigido. Dati persistenti su volume Docker. |
| **redis** | `redis:alpine` | Cache Layer. Cache query SQL pesanti + Session Handler PHP. |
| **automation** | `python:3.9` | 3 Processi Background distinti (`Watcher`, `Meta`, `Assets`). |

### Volumi & Filesystem
*   `/Frontend`: Codice React (RW per sviluppo live).
*   `/Backend`: Codice PHP/Python.
*   `/percorsoVideo` (ENV `WATCH_DIR`): Storage Video. **Single Source of Truth** per il contenuto.

---

## 3. Frontend (React 19 + Vite 7)
*   **Path**: `/Frontend/React`
*   **Styling**: **Tailwind CSS v4** (Zero-runtime). Temi dinamici via variabili CSS (`--primary-color`) iniettate da `AuthContext`.
*   **Router**: `react-router-dom` v6. Pagine: `/`, `/watch/:id`, `/categories`, `/admin/*`.
*   **Player**: Wrapper custom su `plyr`. Implementa **Smart Resume** (start = `saved_time - 3s`).
*   **Icons**: `lucide-react`.

### Design Patterns
*   **Context API**: Gestione stato globale auth e preferenze utente.
*   **Optimistic UI**: Feedback immediato su azioni utente (es. Like/Salva).
*   **Lazy Loading**: I componenti pesanti vengono caricati solo al bisogno.

---

## 4. Backend (PHP 8.2 Nativo)
*   **Path**: `/Backend/api`
*   **Filosofia**: Procedurale, Zero-Framework per minimizzare overhead CPU.
*   **API Pattern**: REST-ish (JSON Body in/out). `gestione_richiesta.php` gestisce CORS e bootstrap.

### Security
*   **Auth**: Sessioni PHP native. Password `bcrypt` ($2y$, cost 10).
*   **Anti-Spam**: Protezione **Username-based** (non IP). 3 errori/30s -> Ban temporaneo (Tabella `Spammers`).
*   **Streaming Protetto**:
    1.  Client chiede `stream.php?id=123`.
    2.  PHP valida sessione.
    3.  PHP emette header `X-Accel-Redirect: /protected_media/video.mp4`.
    4.  Nginx serve i byte (Zero-Copy sendfile). PHP muore subito (risparmio RAM).

---

## 5. Database Schema (MySQL)
5 Tabelle principali. Integrità referenziale enforced.

1.  **`Video`**: Registro centrale. `percorso_file` (relativo), `Titolo`, `id_Categoria`, Path Asset (`copertina`, `anteprima`).
2.  **`Utenti`**: Credenziali, `Admin` (bool), `colore_Tema` (HEX).
3.  **`Categorie`**: Mapping 1:1 con le cartelle fisiche.
4.  **`Cronologia`**: Join `Utente <-> Video`. Payload: `progresso_secondi` (resume point).
5.  **`Impostazioni`**: Config key-value (es. durata anteprime, path scan).

---

## 6. Automazione & Ingestione (Python)
3 Demoni indipendenti in `/Backend/python_server`.

### A. Watcher (`watcher.py`)
Monitora il filesystem (PollingObserver).
*   **New File**: `INSERT INTO Video_Temp`.
*   **Rename Cartella (Smart Sync)**:
    *   Rileva rinomina directory (Categoria).
    *   **Filesystem**: Rinomina folder asset `copertine_OLD` -> `copertine_NEW` e `cover_OLD.jpg` -> `cover_NEW.jpg`.
    *   **DB**: Update `Categorie` e path referenziati in `Video`. Nessun link rotto.

### B. Worker Metadata (`worker_metadata.py`)
*   Promuove da `Video_Temp` a `Video`.
*   Estrae durata/codec via `ffprobe`.

### C. Worker Assets (`worker_assets.py`)
*   Cicla su `Video` con asset `NULL`.
*   **Copertina**: Estrae JPG al minuto 3 (o 50%).
*   **Anteprima**: Genera anteprima animata 10s (480p, no audio) per hover card.

---

## 7. Performance & RPi4 Optimizations
Configurazioni specifiche per hardware low-power.

1.  **Concurrency**:
    *   Max 5-10 utenti concorrenti (limite I/O SD Card).
    *   Worker Python serializzati (1 file alla volta per tipo) per non saturare CPU.
2.  **Caching Strategy (Redis)**:
    *   Query SQL frequenti (es. Lista Home Page) cachate per 5m.
    *   Sessioni PHP in RAM (Redis) per evitare scritture SD.
3.  **Frontend Build**:
    *   Pre-bundling aggressivo con Vite per ridurre request count.
4.  **Nginx Tuning**:
    *   `sendfile on`, `tcp_nopush on`.
    *   Buffering ottimizzato per streaming video (slice range requests).

---

## 8. Flussi Utente Critici

### Playback Flow
1.  **Navigazione**: `/watch/123`.
2.  **API**: `video.php` ritorna dettagli + `progresso_secondi` (es. 120s).
3.  **Smart Resume**: Player start @ 117s.
4.  **Loop**: Ogni 10s client chiama `aggiornaMinutaggio.php`.

### Admin Dashboard
*   Accessibile solo se `Utenti.Admin = 1`.
*   Gestione CRUD Video/Utenti.
*   Upload manuale copertine/sfondi categorie.
*   Monitoraggio spazio disco e stato servizi.

### Formato Risposte in Output del LLM
Dovrai sempre rispondere in italiano nella chat testuale.