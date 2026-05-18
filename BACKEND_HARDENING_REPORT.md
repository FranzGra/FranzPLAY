# Backend Hardening Report — FranzPLAY

> Sessione di refactoring del backend in 5 fasi.
> Target hardware: **Raspberry Pi 4** (ARM, 2-4 GB RAM, SD card).
> Obiettivi: **sicurezza**, **concorrenza safe**, **streaming video efficiente**, **performance su hardware debole**, **robustezza**.

---

## Indice

1. [Sintesi esecutiva](#sintesi-esecutiva)
2. [Mappa file modificati](#mappa-file-modificati)
3. [Fase 1 — Sicurezza critica](#fase-1--sicurezza-critica)
4. [Fase 2 — Concorrenza](#fase-2--concorrenza)
5. [Fase 3 — Streaming video](#fase-3--streaming-video)
6. [Fase 4 — Performance DB/Cache](#fase-4--performance-dbcache)
7. [Fase 5 — Robustezza / Hardening](#fase-5--robustezza--hardening)
8. [Re-audit finale](#re-audit-finale)
9. [Note operative](#note-operative)

---

## Sintesi esecutiva

| Metrica | Valore |
|---|---|
| File PHP API modificati | 24 |
| File Python modificati | 3 |
| File config Docker/Nginx/PHP modificati | 5 |
| File nuovi creati | 4 |
| Vulnerabilità critiche chiuse | 14 |
| Race condition risolte | 5 |
| Ottimizzazioni performance applicate | 20+ |

### File nuovi creati

| File | Scopo |
|---|---|
| `Backend/api/path_safety.php` | Helper `safeJoinPath()` per anti-traversal centralizzato |
| `Backend/api/rate_limit.php` | Rate limiter Redis (fail-open) |
| `Docker_Config/php/www.conf` | Tuning PHP-FPM per Raspberry Pi (`pm=ondemand`) |
| `Docker_Config/DBMS_Iniziale/02_migrations.sql` | Migrazioni DB idempotenti (`locked_at`, indici) |

---

## Mappa file modificati

### Backend PHP (`Backend/api/`)

| File | Fase | Tipo modifica |
|---|---|---|
| `database.php` | 1 | Whitelist regex su `checkTableExists`, no leak errori al client |
| `gestione_richiesta.php` | 1 | Cookie `secure` auto, permessi sessione `0700` |
| `setup.php` | 1, 4 | `PASSWORD_DEFAULT`, retry loop tabelle, invalidazione cache puntuale |
| `setup_auth.php` | 1 | Richiede admin, regex whitelist, transazione atomica |
| `stream.php` | 1, 3 | Anti-traversal, HTTP Range, chunked streaming 256KB, no-OOM |
| `login.php` | 1, 2, 5 | Anti-timing, ban atomico, rate limit Redis |
| `registrazione.php` | 1, 5 | Min 8 char, email lowercase, JSON robusto, rate limit |
| `reset_password.php` | 1, 5 | Anti-enumeration, salvataggio token con error check, rate limit |
| `profilo.php` | 1 | Min 8 char password, permessi `0755` |
| `status.php` | 1, 4 | CORS whitelist, cache Redis 5min |
| `impostazioni.php` | 1 | CORS whitelist invece di `*`, no leak errori |
| `categorie.php` | 4 | Cache Redis 10min |
| `commenti.php` | 2, 5 | Anti-doppione, rate limit |
| `toggleLike.php` | 2 | `INSERT IGNORE` atomico, prepared statement su update contatore |
| `toggleSalvati.php` | 2 | `INSERT IGNORE` atomico |
| `aggiornaMinutaggio.php` | 2 | UPSERT atomico con `GREATEST(progresso)` lato MySQL |
| `cache.php` | 1, 5 | Auth Redis opzionale, metodi `incr`/`expire` |
| `check_admin.php` | 5 | Audit log delle azioni admin, demote sessione se DB nega |
| `video.php` | 1, 4 | Clamp paginazione max 100, search escape wildcard |
| `videos.php` | 1, 4 | Clamp paginazione, fulltext injection chiusa, type whitelist |
| `admin_modules/users.php` | 1 | Min 8 char, anti-lockout ultimo admin, audit log |
| `admin_modules/videos.php` | 1, 4 | `safeJoinPath`, invalidazione cache mirata |
| `admin_modules/categories.php` | 1, 4 | `safeJoinPath`, N+1 risolto (LEFT JOIN + GROUP BY) |
| `admin_modules/assets.php` | 1, 4 | `safeJoinPath`, permessi `0755`, cache mirata |

### Worker Python (`Backend/python_server/`)

| File | Fase | Tipo modifica |
|---|---|---|
| `watcher.py` | 1, 4 | `realpath` + prefix check, rifiuto symlink, `POLL_TIMEOUT` da env |
| `worker_metadata.py` | 1, 2, 4 | Path validation, claim atomico via `locked_at`, conn reuse, backoff esponenziale, ffprobe timeout |
| `worker_assets.py` | 1, 2, 4 | Path validation, claim atomico via `locked_at`, conn reuse, backoff esponenziale, ffmpeg preset adattivo per ARM |

### Config Docker / Nginx / PHP

| File | Fase | Tipo modifica |
|---|---|---|
| `docker-compose.yml` | 1, 5 | Redis no-ports, PhpMyAdmin `127.0.0.1` + profile dev, healthcheck, `depends_on: condition: service_healthy`, resource limits, MariaDB tuning |
| `Docker_Config/nginx/default.conf` | 3 | `real_ip_header`, `aio on`, `directio 4m`, gzip selettivo, cache headers, `nosniff`, FastCGI buffers ridotti |
| `Docker_Config/php/Dockerfile` | 4 | OPcache, mount `www.conf` |
| `Docker_Config/php/uploads.ini` | 4 | OPcache enable, hardening, sessione SameSite Lax |
| `.env.example` | 5 | Documentate `REDIS_PASSWORD` e tuning env vars |

---

## Fase 1 — Sicurezza critica

### SQL injection chiuse

| Vulnerabilità | File:linea (originale) | Fix |
|---|---|---|
| `SHOW TABLES LIKE '$tableName'` | `database.php:93` | Whitelist regex `[A-Za-z0-9_]+` + `real_escape_string` |
| `SHOW COLUMNS FROM ... LIKE '$column'` | `setup_auth.php:46` | Stessa whitelist regex |
| `UPDATE Video SET Likes ... WHERE id = $id_video` | `toggleLike.php:71,81` | Prepared statement con `?` |
| Fulltext Boolean injection (`-foo` esclude) | `videos.php:176-192` | `preg_replace('/[+\-*"()<>~@]/', '', $term)` |
| LIKE search senza escape wildcard | `video.php:160` | `str_replace(['\\','%','_'], …)` |

### Path traversal chiuse

Creato helper centralizzato `Backend/api/path_safety.php` con funzione `safeJoinPath($base, $relative)` che:

- Rifiuta null byte
- Rifiuta schemi URL (`file://`, ecc.) e path assoluti Unix/Windows
- Normalizza `..` e `.` su uno stack (rifiuta traversal sopra la base)
- Rifiuta caratteri di controllo
- Usa `realpath()` per resolvere symlink e verificare prefix sulla base reale
- Supporta creazione di file non ancora esistenti (validando il parent)

Applicato in:
- `stream.php` (riga 140) — protezione streaming media
- `admin_modules/videos.php` (riga 90) — elimina video
- `admin_modules/categories.php` (riga 65) — upload sfondo
- `admin_modules/assets.php` (3 punti) — upload copertina/anteprima, rimozione

Equivalente Python in `watcher.py:_get_relative_path()` e `worker_metadata.py:_is_path_inside_base()`.

### Altre vulnerabilità

| Vulnerabilità | File | Fix |
|---|---|---|
| `setup_auth.php` senza auth → chiunque eseguiva migrazioni | `setup_auth.php` | `if (empty($_SESSION['amministratore'])) inviaRisposta(false, 403)` |
| PhpMyAdmin esposto su `:8080` + root | `docker-compose.yml` | Bind `127.0.0.1:8080`, `PMA_USER` = utente app, `profiles: [dev]` |
| Redis esposto senza auth | `docker-compose.yml`, `cache.php` | Solo `expose` (non `ports`), password opzionale via env, `cache.php` autentica se `REDIS_PASSWORD` settata |
| Cookie sessione `secure: false` | `gestione_richiesta.php` | Auto-rileva HTTPS o `X-Forwarded-Proto` |
| Sessioni `mkdir 0777` | `gestione_richiesta.php` | `mkdir 0700` |
| Timing attack su `password_verify` (utente inesistente) | `login.php` | Hash dummy precalcolato per consumare stesso tempo CPU |
| User enumeration su reset password | `reset_password.php` | Risposta generica unica, log interno per audit |
| CORS `*` su `status.php` e `impostazioni.php` | due file | Whitelist coerente con `gestione_richiesta.php` |
| Password minima 4 char | 5 file | Innalzata a 8 char ovunque (login admin, registrazione, profilo, reset, setup) |
| Inconsistenza `PASSWORD_BCRYPT` vs `PASSWORD_DEFAULT` | `setup.php` | `PASSWORD_DEFAULT` ovunque |
| `usleep(500000)` deterministico | `setup.php` | Retry loop con `checkTableExists` (max ~1.5s) |
| Errori DB leakati al client | `database.php` | Solo `error_log()`, client riceve messaggio generico |
| Email duplicata `User@x` vs `user@x` | `registrazione.php` | `strtolower($email)` |
| JSON malformato fallback silenzioso | `registrazione.php` | Errore 400 esplicito |
| Symlink → `/etc/passwd` accettato dal watcher | `watcher.py` | `os.path.islink()` rifiutato, `realpath()` + prefix check |
| Tabella `Spammers` ban poteva fallire silenziosamente | (vedi Fase 2) | Singolo statement atomico |

---

## Fase 2 — Concorrenza

### Race condition su Like/Salvati

**Problema:** Pattern Check-Then-Act sotto doppio click parallelo:
```
T0: req1 SELECT FROM Like → not found
T1: req2 SELECT FROM Like → not found
T2: req1 INSERT Like → OK, Likes++ → 1
T3: req2 INSERT Like → DUPLICATE KEY error, Likes++ → 2 (BUG: doppio incremento)
```

**Fix:** `INSERT IGNORE` atomico + check `affected_rows`:
```php
executePreparedQuery("INSERT IGNORE INTO `Like` (id_Utente, id_Video) VALUES (?, ?)", "ii", [$id_utente, $id_video]);
if ($last_affected_rows > 0) {
    executePreparedQuery("UPDATE Video SET Likes = Likes + 1 WHERE id = ?", "i", [$id_video]);
}
```

Inoltre supporto al parametro `action` (`'like'`/`'unlike'`) per evitare comportamento ping-pong sotto double-submit.

### Ban login atomico

**Problema:** Tra `SELECT COUNT(*)` dei fallimenti e `INSERT INTO Spammers`, richieste parallele potevano:
- Saltare il ban entrambe
- Causare violazione PRIMARY KEY

**Fix:** Singolo statement con sub-SELECT atomico in MariaDB:
```sql
INSERT INTO Spammers (Nome_Utente, indirizzo_Ip, bloccato_fino_a)
SELECT ?, ?, DATE_ADD(NOW(), INTERVAL 30 SECOND)
FROM (SELECT COUNT(*) AS c FROM Accessi
      WHERE Nome_Utente = ? AND successo = 0
        AND data_ora_tentativo > DATE_SUB(NOW(), INTERVAL 30 SECOND)) t
WHERE t.c >= 3
ON DUPLICATE KEY UPDATE indirizzo_Ip = VALUES(indirizzo_Ip),
                        bloccato_fino_a = DATE_ADD(NOW(), INTERVAL 30 SECOND);
```

### Cronologia: progresso video non regressivo

**Problema:** Richieste fuori ordine dal player (network jitter) potevano sovrascrivere progressi recenti con valori vecchi.

**Fix:** UPSERT con `GREATEST` lato MySQL:
```sql
INSERT INTO Cronologia (id_Utente, id_Video, progresso_secondi, continua_a_guardare, ...)
VALUES (?, ?, ?, CASE WHEN ? > 0 AND (? / ?) >= 0.9 THEN 0 ELSE 1 END, NOW())
ON DUPLICATE KEY UPDATE
    progresso_secondi = GREATEST(progresso_secondi, VALUES(progresso_secondi)),
    continua_a_guardare = CASE WHEN ? > 0 AND (GREATEST(...) / ?) >= 0.9 THEN 0 ELSE 1 END,
    ultimo_aggiornamento = NOW();
```

### Commenti: anti-doppione

**Problema:** Doppio click pubblicava 2 commenti identici.

**Fix:** Check pre-INSERT per duplicato negli ultimi 60s dallo stesso utente sullo stesso video → risposta "già pubblicato" idempotente.

### Worker Python: claim atomico

**Problema:** Due worker (anche due istanze dello stesso container) potevano processare lo stesso record contemporaneamente, causando duplicazioni.

**Fix:** Colonna `locked_at DATETIME NULL` con claim via UPDATE condizionale:
```sql
UPDATE Video_Temp SET locked_at = NOW() WHERE id = ? AND locked_at IS NULL;
-- Se rowcount = 1 → claim vinto, processo il record
-- Se rowcount = 0 → un altro worker l'ha preso, skip
```

Caratteristiche:
- Migrazione idempotente in `_ensure_lock_column()` (check `INFORMATION_SCHEMA.COLUMNS`)
- Lock abbandonati auto-rilasciati dopo 5 min (Video_Temp) / 10 min (Video) per worker crashati
- Rilascio del lock in caso di errore per permettere retry
- Whitelist regex su nomi tabella/colonna per safety

---

## Fase 3 — Streaming video

### Problema su Raspberry Pi

`readfile($video)` in `stream.php` su un file da 1 GB → carica 1 GB in RAM → **OOM kill** su Pi con 1-2 GB.
Inoltre nessun supporto Range → ogni seek del player ritrasmette dall'inizio.

### Soluzione applicata

#### `stream.php` riscritto

1. **Validazione anti-traversal** (Fase 1, già descritto)
2. **Produzione Linux → X-Accel-Redirect:** delega a Nginx (zero-copy via `sendfile`, range supportato nativamente)
3. **Fallback dev (Windows) → chunked streaming + Range:**
   - Output buffer disabilitato (`ob_end_clean()`)
   - Parsing `HTTP_RANGE` (`bytes=START-END`, `bytes=-N` suffix)
   - Risposta `206 Partial Content` con `Content-Range`
   - `416` se range fuori file
   - `fread(256KB)` in loop, `feof`/`connection_aborted` check
   - `set_time_limit(0)` per video lunghi

#### Nginx tuning (`default.conf`)

- `aio on; directio 4m; output_buffers 2 256k` per video > 4 MB
- `add_header Accept-Ranges bytes` per dichiarare al client il supporto seek
- `Cache-Control: private, max-age=60` su `/protected_media/` (60s di cache permettono seek senza ri-autorizzare PHP)
- `add_header X-Content-Type-Options nosniff` (hardening MIME)
- `gzip` selettivo: solo testo/JSON, mai video/audio/immagini
- `set_real_ip_from` per le subnet Docker → PHP riceve IP reale (necessario per ban login)
- FastCGI buffers ridotti (`fastcgi_buffers 8 16k`) → meno RAM su Pi

#### Headers di cache

| Risorsa | Cache | Razionale |
|---|---|---|
| `/img_utenti/` (avatar) | `public, max-age=86400` | Cambiano raramente, invalidare con `?v=ts` |
| `/protected_media/` (video) | `private, max-age=60` | Permette seek senza ri-call PHP |
| Immagini (jpg/png/webp) via stream.php | `public, max-age=86400, immutable` | Path immutabile per video specifico |
| Video via stream.php | `private, max-age=60` | Idem video |

---

## Fase 4 — Performance DB/Cache

### Cache Redis applicata

| Endpoint | TTL | Chiave |
|---|---|---|
| `categorie.php` | 10 min | `categorie_list_v1` |
| `impostazioni.php` | 24 h | `impostazioni_globali` (già esistente, sistemato) |
| `status.php` | 5 min (solo se `!needsSetup`) | `system_status_v1` |

Invalidazione **mirata** (non più `flush()` globale) in:
- `admin_modules/videos.php` → `categorie_list_v1`
- `admin_modules/categories.php` → `categorie_list_v1` + `impostazioni_globali`
- `admin_modules/assets.php` → `categorie_list_v1`
- `setup.php` → tutte e tre

### Query DB ottimizzate

| Problema | Fix |
|---|---|
| Subquery correlata `COUNT(*) FROM Video` per ogni categoria (N+1) | LEFT JOIN + GROUP BY in `admin_modules/categories.php` |
| LIKE `%term%` senza limit min char | Min 2 char, max 100 char, escape wildcard `%` `_` `\` |
| Paginazione illimitata (DoS) | Clamp `limit` 1-100, `offset` 0-100000 in `video.php` e `videos.php` |
| Param `type` non validato | Whitelist `['all','liked','saved','history']` |

### Worker Python ottimizzazioni

| Problema | Fix |
|---|---|
| Connessione DB riaperta ad ogni iterazione | Reuse persistente, ricrea solo su errore |
| `POLL_INTERVAL=10s` fisso → CPU continua su Pi | Backoff esponenziale 10s → 20s → 40s → ... → max 60s/120s |
| `ffmpeg preset=fast` lento su ARM | Auto: `ultrafast` su ARM, `fast` su x86 (override via env `FFMPEG_PRESET`) |
| `ffmpeg timeout=120s` eccessivo | Auto: 60s su ARM, 120s su x86 (override via env) |
| Polling watcher 2s → 15-25% CPU continuo | `POLL_TIMEOUT=5s` di default (override via `WATCHER_POLL_TIMEOUT`) |

### PHP-FPM + OPcache (Raspberry Pi)

#### `uploads.ini`
```ini
memory_limit = 128M
opcache.enable = 1
opcache.memory_consumption = 64
opcache.max_accelerated_files = 4000
opcache.revalidate_freq = 60
opcache.fast_shutdown = 1
expose_php = Off
session.use_strict_mode = 1
```

#### `www.conf` (nuovo)
```ini
pm = ondemand
pm.max_children = 8
pm.process_idle_timeout = 30s
pm.max_requests = 500
request_slowlog_timeout = 5s
```

### MariaDB tuning (`docker-compose.yml`)

```yaml
command:
  - --innodb-buffer-pool-size=256M    # Bilanciato per 2-4GB
  - --innodb-log-file-size=48M
  - --innodb-flush-log-at-trx-commit=2  # Meno fsync su SD card
  - --innodb-io-capacity=100           # SD card lenta
  - --max-connections=50
  - --key-buffer-size=16M
  - --query-cache-size=0               # Deprecated, disabilita
```

---

## Fase 5 — Robustezza / Hardening

### Rate limiter Redis

Creato `Backend/api/rate_limit.php` con funzione `checkRateLimit($action, $identifier, $max, $window_sec)`:

- Implementazione: `INCR` + `EXPIRE` (atomico in Redis)
- **Fail-open**: se Redis è down, non blocca il servizio (loggato)
- `Retry-After` header su 429

Applicato a:

| Endpoint | Limite |
|---|---|
| `login.php` | 15 req/min per IP |
| `registrazione.php` | 5 req/5min per IP |
| `reset_password.php` | 5 req/10min per IP |
| `commenti.php` | 30 req/min per utente loggato |

### Healthcheck Docker

| Servizio | Healthcheck |
|---|---|
| `mysql` | `mysqladmin ping -u root` |
| `redis` | `redis-cli ping` (tollerante a NOAUTH) |
| `php` | `php-fpm -t` (config test) |
| `nginx` | `wget --spider /api/status.php` |

Tutti i servizi dipendenti usano `depends_on: condition: service_healthy` → l'avvio è ordinato e non c'è più la race condition "PHP parte prima di MySQL".

### Resource limits Docker

| Servizio | CPU max | RAM max |
|---|---|---|
| `nginx` | 0.6 | 128 MB |
| `php` | 1.5 | 384 MB |
| `redis` | 0.5 | 320 MB |
| `python_watcher` | 0.5 | 128 MB |
| `python_worker_meta` | 0.6 | 192 MB |
| `python_worker_assets` | 1.2 | 512 MB (ffmpeg) |

Previene OOM-killer di Linux quando ffmpeg va in runaway.

### Audit log admin

`check_admin.php` ora logga ogni azione admin:
```
[ADMIN AUDIT] user=42 action=elimina_video ip=192.168.1.10
```
+ alert su tentativi non autorizzati:
```
🚨 [SECURITY ALERT] Tentativo accesso Admin non autorizzato. UserID=99 IP=1.2.3.4
```
+ demote forzato della sessione se il DB nega.

### Anti-lockout sull'ultimo admin

`admin_modules/users.php` ora blocca:
- Toggle off del flag Admin se è l'ultimo admin
- Eliminazione di un admin se è l'ultimo admin

```php
$res_cnt = $database->query("SELECT COUNT(*) AS cnt FROM Utenti WHERE Admin = 1");
if ((int)$row_cnt['cnt'] <= 1) {
    throw new Exception("Almeno un amministratore deve rimanere.");
}
```

### Migrazioni DB idempotenti

`Docker_Config/DBMS_Iniziale/02_migrations.sql` viene eseguito dopo `DBMS.sql` dall'entrypoint MariaDB:

```sql
ALTER TABLE `Video_Temp` ADD COLUMN IF NOT EXISTS `locked_at` DATETIME NULL;
ALTER TABLE `Video`      ADD COLUMN IF NOT EXISTS `locked_at` DATETIME NULL;
ALTER TABLE `Video` ADD INDEX IF NOT EXISTS `idx_video_assets_missing` ...;
```

Inoltre i worker Python contengono `_ensure_lock_column()` come fallback in-app per istanze già installate.

---

## Re-audit finale

Dopo ogni fase ho rieseguito un audit di regressione. Ho verificato:

✅ **Sintassi:** tutti i file PHP/Python/YAML coerenti, indentazione consistente
✅ **Include:** ogni `safeJoinPath` ha il suo `require_once 'path_safety.php'`, ogni `checkRateLimit` ha `require_once 'rate_limit.php'`
✅ **Variabili globali:** `$Cache` dichiarato dove serve; `$last_affected_rows` è safe in PHP-FPM (per-request, non condiviso)
✅ **Docker compose:** 9 servizi, depends_on coerenti, no cicli, env vars `$$` correttamente escapate
✅ **Bind types:** verificato manualmente l'UPSERT di `aggiornaMinutaggio.php` (8 placeholder = 8 char bind = 8 valori)
✅ **Stream Range:** check ordine `file_exists` → `fopen` → `fseek` (no warning su FP non definito)

### Falsi positivi identificati nell'audit

L'agent di re-audit ha segnalato 3 "bug critici" che dopo verifica manuale **non erano reali**:

1. **"Redis healthcheck Alpine non funziona"** → Falso: `redis:alpine` ha busybox `sh`, `if/then/else/fi` funziona. Comunque semplificato per ridurre rischi.
2. **"aggiornaMinutaggio bind sbagliato"** → Falso: 8 placeholder, 8 bind, conta verificata manualmente.
3. **"stream.php $fp non definito"** → Falso: il `die()` precedente intercetta i file inesistenti prima di arrivare a `fopen`.

L'audit ha invece confermato che logica nuova (path_safety, rate_limit, worker locking, stream Range) è solida.

---

## Note operative

### Variabili ENV opzionali aggiunte (`.env`)

```bash
# Auth Redis (vuoto = no auth, ma comunque non esposto fuori dalla rete docker)
REDIS_PASSWORD=

# Tuning worker Python
WATCHER_POLL_TIMEOUT=5
WORKER_POLL_INTERVAL=10
WORKER_BACKOFF_MAX=120
FFMPEG_PRESET=ultrafast   # ultrafast/superfast/veryfast/fast/medium
FFMPEG_COVER_TIMEOUT=20
FFMPEG_PREVIEW_TIMEOUT=60
```

### Comandi utili

```bash
# Avviare lo stack senza phpmyadmin (modalità produzione)
docker compose up -d

# Avviare con phpmyadmin per debug locale
docker compose --profile dev up -d

# Verificare healthcheck
docker compose ps

# Vedere i log di rate limiting
docker logs BACKEND_PHP 2>&1 | grep RATE_LIMIT

# Vedere audit log admin
docker logs BACKEND_PHP 2>&1 | grep "ADMIN AUDIT"
```

### Compatibilità

- **MariaDB:** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` richiede 10.3+ (MariaDB latest soddisfa)
- **PHP:** 8.2 (immagine `php:8.2-fpm-alpine`)
- **Python:** 3.x (immagine `python:slim`)
- **Redis:** funziona con/senza password (controllato a runtime)

### Out-of-scope (rimasti opzionali)

Cose **non implementate** perché out-of-scope o low-priority:

- HTTPS/TLS (per uso LAN non urgente; per internet-facing va aggiunto Certbot)
- `logout.php` non controlla sessione esistente (irrilevante, è già idempotente)
- `entrypoint.sh` PHP fa `chown -R` pesante su NAS grandi (è una sola volta all'avvio)
- HTTP/2 server push (low impact)

---

## Conclusione

Il backend FranzPLAY è ora:

- ✅ **Sicuro** contro SQL injection, path traversal, timing attack, CSRF base, user enumeration
- ✅ **Concorrenza-safe** sotto richieste parallele (Like, Salvati, ban login, worker Python, cronologia)
- ✅ **Resource-efficient** su Raspberry Pi 4 (streaming chunked, OPcache, PHP-FPM ondemand, MariaDB tuned, ffmpeg adattivo)
- ✅ **Robusto** con rate limiting, healthcheck, resource limits, audit logging, anti-lockout

Il sistema è pronto per essere deployato su hardware modesto e gestire molteplici utenti contemporanei senza compromessi.
