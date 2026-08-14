# worker_covers.py
# ============================================================================
# Worker COPERTINE ONLINE (ricerca su database esterni).
# ============================================================================
# Cerca la copertina di un video su un provider esterno (oggi ThePornDB)
# partendo dal nome file, scarica l'immagine e aggiorna Video.percorso_copertina.
#
# NON sostituisce worker_assets: il frame ffmpeg resta il fallback, sempre
# disponibile e sempre rigenerabile. Spegnendo il master switch il sistema
# torna byte-per-byte a com'era prima di questo modulo.
#
# PERCHE' UN CONTAINER SEPARATO
# Le chiamate di rete (latenza, 429, timeout) non devono occupare
# Video.locked_at, che serializza ffmpeg tra worker_assets e worker_optimizer.
# Questo worker ha un lock PROPRIO su Metadati_Online.locked_at ed e' I/O-bound:
# gli bastano 0.3 CPU / 128 MB.
#
# MODALITA'
#   manuale    (default) -> lavora SOLO i job accodati dall'admin dalla UI
#   automatico           -> fa anche auto-discovery, nei limiti di ambito,
#                           categorie, finestra oraria e quota giornaliera
#
# I job manuali hanno SEMPRE precedenza su quelli automatici, e ignorano la
# finestra oraria: se l'admin clicca, deve succedere adesso.
# ============================================================================

import json
import logging
import os
import sys
import time
from datetime import datetime

import mysql.connector

from asset_paths import get_cover_paths, validate_under_base
from cache_invalidation import invalidate_videos_only
from image_fetch import ImageFetchError, scarica_immagine
from providers import get_provider
from providers.tpdb import ProviderAuthError, ProviderRateLimit

# --- Ambiente ---
PATH_TO_MONITOR = os.environ.get('WATCH_DIR', '/percorsoVideo')
DB_HOST = os.environ.get('MYSQL_HOST', 'mysql')
DB_USER = os.environ.get('MYSQL_USER')
DB_PASS = os.environ.get('MYSQL_PASSWORD')
DB_NAME = os.environ.get('MYSQL_DATABASE')

POLL_INTERVAL = int(os.environ.get('COVERS_POLL_INTERVAL', '20'))
BACKOFF_MAX = int(os.environ.get('COVERS_BACKOFF_MAX', '300'))
STALE_LOCK_MINUTES = int(os.environ.get('COVERS_STALE_LOCK_MINUTES', '15'))
# Quanti video accodare per giro di auto-discovery: piccolo, per non inondare
# la coda e per lasciare spazio ai job manuali.
DISCOVERY_BATCH = int(os.environ.get('COVERS_DISCOVERY_BATCH', '50'))
# Cooldown dopo un 429/503 del provider.
RATE_LIMIT_COOLDOWN = int(os.environ.get('COVERS_RATE_LIMIT_COOLDOWN', '900'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [Worker-Covers] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)]
)

# Stato runtime del worker (non persistito: si azzera al riavvio).
_ultima_chiamata = 0.0        # per la pausa tra richieste
_cooldown_fino_a = 0.0        # impostato dopo un rate limit
_quota_memoria = {}           # fallback se Redis non e' disponibile


# ============================================================================
# DB
# ============================================================================
def get_db_connection():
    while True:
        try:
            return mysql.connector.connect(
                host=DB_HOST, user=DB_USER, password=DB_PASS,
                database=DB_NAME, autocommit=True
            )
        except mysql.connector.Error as err:
            if err.errno == 2003:
                logging.warning("Connessione al DB rifiutata. Riprovo tra 5s...")
                time.sleep(5)
            else:
                logging.error("Errore di connessione DB: %s", err)
                time.sleep(10)


# Valori identici a quelli di 02_migrations.sql: le due strade (DB vergine ->
# init SQL, DB esistente -> questo seed) devono convergere sullo stesso stato.
_SEED_IMPOSTAZIONI = [
    ('copertine_online_abilitato', '0', 'Master switch: se 0 nessuna chiamata di rete viene mai effettuata'),
    ('copertine_online_provider', 'tpdb', 'Provider attivo per la ricerca copertine'),
    ('tpdb_api_token', '', 'Token API ThePornDB. Mai restituito al frontend, solo mascherato'),
    ('copertine_online_modalita', 'manuale', 'manuale = solo job accodati dall admin; automatico = auto-discovery'),
    ('copertine_online_ambito', 'senza_copertina', 'Cosa cercare in automatico: senza_copertina | solo_nuovi | tutti'),
    ('copertine_online_sovrascrivi', '0', 'Se 1 sostituisce anche le copertine gia generate da ffmpeg'),
    ('copertine_online_soglia_auto', '75', 'Score minimo 0-100 per applicare senza conferma dell admin'),
    ('copertine_online_conferma_sempre', '0', 'Se 1 nessun download automatico: ogni match passa da conferma manuale'),
    ('copertine_online_categorie', '[]', 'JSON array di id categoria su cui operare. Vuoto = tutte'),
    ('copertine_online_finestra', '', 'Finestra oraria HH:MM-HH:MM per l auto-discovery. Vuoto = sempre'),
    ('copertine_online_max_giorno', '200', 'Quota massima di chiamate al provider per giorno'),
    ('copertine_online_pausa_richieste', '2', 'Secondi minimi tra due chiamate al provider'),
    ('copertine_online_max_tentativi', '3', 'Tentativi prima di marcare il job come errore definitivo'),
    ('copertine_online_priorita_ffmpeg', '1', 'Se 1 ffmpeg genera subito il frame e l online lo sostituisce dopo'),
    ('copertine_online_attesa_max', '30', 'Minuti oltre i quali ffmpeg procede comunque se l online non risponde'),
    # --- Multi-provider: ordine di priorita' + stato e token per ciascuno ---
    ('copertine_provider_ordine', '["tpdb","tmdb"]', 'Ordine di interrogazione dei database online (JSON)'),
    ('copertine_provider_tpdb_attivo', '1', 'ThePornDB attivo'),
    ('copertine_provider_tpdb_token', '', 'Token API ThePornDB. Mai restituito al frontend'),
    ('copertine_provider_tmdb_attivo', '0', 'The Movie Database attivo'),
    ('copertine_provider_tmdb_token', '', 'Token API The Movie Database. Mai restituito al frontend'),
    ('copertine_provider_youtube_attivo', '0', 'YouTube attivo'),
    ('copertine_provider_youtube_token', '', 'Chiave API YouTube Data v3 (facoltativa). Mai restituita al frontend'),
    ('copertine_youtube_rinnovo_giorni', '25',
     'Giorni dopo i quali una copertina YouTube viene ri-scaricata. Le policy YouTube impongono di aggiornare i dati entro 30 giorni: non superare 29'),
]


def _ensure_schema(conn):
    """
    Migrazioni idempotenti. Servono sui DB pre-esistenti: 02_migrations.sql
    viene eseguito solo su volume MariaDB vergine.
    """
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS `Metadati_Online` (
                    `id`             INT AUTO_INCREMENT PRIMARY KEY,
                    `id_Video`       INT NOT NULL,
                    `provider`       VARCHAR(16) NOT NULL DEFAULT 'tpdb',
                    `stato`          ENUM('in_coda','elaborazione','da_confermare','applicato',
                                          'nessun_match','errore','ignorato') NOT NULL DEFAULT 'in_coda',
                    `origine_job`    ENUM('auto','manuale') NOT NULL DEFAULT 'auto',
                    `query_usata`    VARCHAR(512) NULL,
                    `match_id`       VARCHAR(64)  NULL,
                    `match_titolo`   VARCHAR(512) NULL,
                    `match_sito`     VARCHAR(128) NULL,
                    `match_data`     DATE NULL,
                    `match_score`    TINYINT UNSIGNED NULL,
                    `url_immagine`   VARCHAR(1024) NULL,
                    `candidati_json` TEXT NULL,
                    `errore_msg`     VARCHAR(500) NULL,
                    `tentativi`      INT NOT NULL DEFAULT 0,
                    `locked_at`      DATETIME NULL,
                    `applicato_at`   DATETIME NULL,
                    `creato_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `aggiornato_at`  DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY `uq_meta_video_provider` (`id_Video`, `provider`),
                    KEY `idx_meta_stato` (`stato`, `locked_at`),
                    KEY `idx_meta_video` (`id_Video`),
                    CONSTRAINT `fk_meta_video` FOREIGN KEY (`id_Video`)
                        REFERENCES `Video`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cursor.execute(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Video' "
                "AND COLUMN_NAME = 'copertina_origine'"
            )
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    "ALTER TABLE `Video` ADD COLUMN `copertina_origine` "
                    "ENUM('ffmpeg','online','manuale') NULL"
                )
                cursor.execute(
                    "UPDATE `Video` SET `copertina_origine` = 'ffmpeg' "
                    "WHERE `copertina_origine` IS NULL AND `percorso_copertina` IS NOT NULL "
                    "  AND `percorso_copertina` <> 'mancante'"
                )
                logging.info("Migrazione: aggiunta colonna Video.copertina_origine")

            # Backoff esponenziale sui tentativi falliti. Sui DB gia' esistenti
            # la CREATE TABLE qui sopra non fa nulla, quindi la colonna va
            # aggiunta esplicitamente.
            cursor.execute(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Metadati_Online' "
                "AND COLUMN_NAME = 'prossimo_tentativo_at'"
            )
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    "ALTER TABLE `Metadati_Online` ADD COLUMN `prossimo_tentativo_at` "
                    "DATETIME NULL COMMENT 'Non ritentare prima di questo istante'"
                )
                cursor.execute(
                    "ALTER TABLE `Metadati_Online` ADD INDEX `idx_meta_claim` "
                    "(`stato`, `locked_at`, `prossimo_tentativo_at`)"
                )
                logging.info("Migrazione: aggiunta Metadati_Online.prossimo_tentativo_at")

            # Seed delle impostazioni. Serve sui DB NON vergini, dove
            # 02_migrations.sql non viene mai eseguito: senza questo le chiavi
            # esisterebbero solo dopo il primo salvataggio dall'admin, con la
            # colonna Descrizione vuota e una divergenza silenziosa tra
            # installazioni nuove e aggiornate. INSERT IGNORE = non sovrascrive
            # mai una scelta gia' fatta dall'utente.
            for chiave, valore, descrizione in _SEED_IMPOSTAZIONI:
                cursor.execute(
                    "INSERT IGNORE INTO Impostazioni "
                    "(Chiave_Impostazione, Valore_Impostazione, Descrizione) "
                    "VALUES (%s, %s, %s)",
                    (chiave, valore, descrizione)
                )
    except Exception as e:
        logging.warning("_ensure_schema skip: %s", e)


# ============================================================================
# Impostazioni
# ============================================================================
DEFAULT_SETTINGS = {
    'copertine_online_abilitato': '0',
    'copertine_online_provider': 'tpdb',
    'tpdb_api_token': '',
    'copertine_online_modalita': 'manuale',
    'copertine_online_ambito': 'senza_copertina',
    'copertine_online_sovrascrivi': '0',
    'copertine_online_soglia_auto': '75',
    'copertine_online_conferma_sempre': '0',
    'copertine_online_categorie': '[]',
    'copertine_online_finestra': '',
    'copertine_online_max_giorno': '200',
    'copertine_online_pausa_richieste': '2',
    'copertine_online_max_tentativi': '3',
    'copertine_online_priorita_ffmpeg': '1',
    'copertine_online_attesa_max': '30',
}


def fetch_settings(conn):
    """Legge le sole chiavi del modulo, con default se mancanti."""
    settings = dict(DEFAULT_SETTINGS)
    try:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT Chiave_Impostazione AS k, Valore_Impostazione AS v "
                "FROM Impostazioni WHERE Chiave_Impostazione LIKE 'copertine_online_%' "
                "   OR Chiave_Impostazione LIKE 'copertine_provider_%' "
                "   OR Chiave_Impostazione = 'tpdb_api_token'"
            )
            for row in cursor.fetchall():
                if row['v'] is not None:
                    settings[row['k']] = row['v']
    except Exception as e:
        logging.warning("Lettura impostazioni fallita, uso i default: %s", e)
    return settings


def _intero(settings, chiave, fallback):
    try:
        return int(str(settings.get(chiave, fallback)).strip())
    except (ValueError, TypeError):
        return fallback


def _flag(settings, chiave, fallback='0'):
    return str(settings.get(chiave, fallback)).strip() == '1'


def provider_attivi(settings):
    """
    Elenco ordinato dei provider da interrogare: [(id, token), ...].

    Ordine di priorita' da `copertine_provider_ordine` (JSON). Un provider e'
    incluso solo se attivo e, quando il token e' obbligatorio, se il token c'e':
    interrogare TMDB senza chiave produrrebbe solo errori 401 a ripetizione.

    Retrocompatibilita': se non esiste alcuna configurazione per-provider (
    installazioni precedenti al multi-provider) si ricade sul vecchio schema a
    provider singolo, cosi' un aggiornamento non spegne il modulo.
    """
    from providers import PROVIDER_META, provider_disponibili

    grezzo = (settings.get('copertine_provider_ordine') or '').strip()
    try:
        ordine = json.loads(grezzo) if grezzo else []
        if not isinstance(ordine, list):
            ordine = []
    except ValueError:
        ordine = []
    if not ordine:
        ordine = provider_disponibili()

    configurato = any(k.startswith('copertine_provider_') and k.endswith('_attivo')
                      for k in settings)

    attivi = []
    for pid in ordine:
        meta = PROVIDER_META.get(pid)
        if meta is None:
            continue
        token = (settings.get('copertine_provider_%s_token' % pid) or '').strip()
        # Ripiego sulla vecchia chiave a provider singolo: su un'installazione
        # aggiornata a caldo le nuove chiavi nascono vuote e il token
        # configurato in precedenza andrebbe altrimenti perso.
        if not token and pid == 'tpdb':
            token = (settings.get('tpdb_api_token') or '').strip()

        if configurato:
            if str(settings.get('copertine_provider_%s_attivo' % pid, '0')).strip() != '1':
                continue
        else:
            # Schema legacy: solo il provider singolo, col vecchio nome chiave.
            if pid != (settings.get('copertine_online_provider') or 'tpdb').strip():
                continue
            token = token or (settings.get('tpdb_api_token') or '').strip()

        if meta.get('token_obbligatorio') and not token:
            logging.info("[Covers] Provider '%s' saltato: manca il token obbligatorio.", pid)
            continue
        attivi.append((pid, token))

    return attivi


def _categorie_ammesse(settings):
    """Lista di id categoria su cui operare. Vuota = nessun filtro."""
    grezzo = (settings.get('copertine_online_categorie') or '').strip()
    if not grezzo or grezzo == '[]':
        return []
    try:
        valori = json.loads(grezzo)
        return [int(v) for v in valori]
    except (ValueError, TypeError):
        logging.warning("copertine_online_categorie non e' un JSON valido: %r", grezzo)
        return []


def dentro_finestra(settings, adesso=None):
    """
    True se siamo dentro la finestra oraria configurata (HH:MM-HH:MM).
    Vuota = sempre. Gestisce anche le finestre che scavalcano la mezzanotte
    (es. 22:00-06:00).
    """
    finestra = (settings.get('copertine_online_finestra') or '').strip()
    if not finestra or '-' not in finestra:
        return True
    inizio_txt, fine_txt = finestra.split('-', 1)
    try:
        h1, m1 = [int(x) for x in inizio_txt.strip().split(':')]
        h2, m2 = [int(x) for x in fine_txt.strip().split(':')]
    except (ValueError, IndexError):
        logging.warning("Finestra oraria non valida (%r): la ignoro", finestra)
        return True
    ora = adesso or datetime.now()
    minuti_ora = ora.hour * 60 + ora.minute
    inizio = h1 * 60 + m1
    fine = h2 * 60 + m2
    if inizio == fine:
        return True
    if inizio < fine:
        return inizio <= minuti_ora < fine
    return minuti_ora >= inizio or minuti_ora < fine   # scavalca la mezzanotte


# ============================================================================
# Quota giornaliera (Redis, con fallback in memoria)
# ============================================================================
def _chiave_quota():
    return 'covers_quota_' + datetime.now().strftime('%Y%m%d')


def _quota_usata():
    chiave = _chiave_quota()
    try:
        from cache_invalidation import _connect
        r = _connect()
        if r is not None:
            try:
                valore = r.get(chiave)
                return int(valore) if valore else 0
            finally:
                try:
                    r.close()
                except Exception:
                    pass
    except Exception:
        pass
    return _quota_memoria.get(chiave, 0)


def _quota_incrementa():
    chiave = _chiave_quota()
    try:
        from cache_invalidation import _connect
        r = _connect()
        if r is not None:
            try:
                nuovo = r.incr(chiave)
                r.expire(chiave, 172800)   # 48h: sopravvive al cambio giorno
                return int(nuovo)
            finally:
                try:
                    r.close()
                except Exception:
                    pass
    except Exception:
        pass
    _quota_memoria[chiave] = _quota_memoria.get(chiave, 0) + 1
    return _quota_memoria[chiave]


class QuotaEsaurita(Exception):
    """
    La quota giornaliera si e' esaurita a meta' job.

    Non e' un errore: il job torna in coda intatto (nessun tentativo consumato)
    e riparte quando la quota si azzera. Serve un'eccezione perche' il punto in
    cui ce ne accorgiamo e' dentro la callback `on_call`, in profondita' nel
    provider, e da li' l'unico modo di fermarsi e' risalire.
    """
    pass


def quota_esaurita(settings):
    massimo = _intero(settings, 'copertine_online_max_giorno', 200)
    if massimo <= 0:
        return False        # 0 = nessun limite
    return _quota_usata() >= massimo


# ============================================================================
# Auto-discovery
# ============================================================================
def rinnova_copertine_scadute(conn, settings):
    """
    ============================================================================
    CONFORMITA' ALLE POLICY YOUTUBE — non rimuovere senza leggere.
    ============================================================================
    Le YouTube API Services Developer Policies consentono di conservare i dati
    ottenuti dall'API al massimo 30 giorni, dopo i quali vanno "cancellati o
    aggiornati". NON vietano la conservazione: vietano di congelare il dato.

    Questa funzione e' il meccanismo che rende lecita la conservazione locale:
    ri-scarica le copertine YouTube piu' vecchie di
    `copertine_youtube_rinnovo_giorni` (default 25, con margine sui 30), cosi'
    l'immagine sul disco resta allineata a quella pubblicata da YouTube.

    Se il video non esiste piu' (404) la riga passa a 'errore' con un messaggio
    esplicito: il file locale NON viene cancellato d'ufficio, perche' e' un
    asset dell'utente, ma l'admin lo vede in coda e decide. E' una scelta
    consapevole, documentata anche in AGENT_GUIDE.
    ============================================================================
    Ritorna il numero di copertine rinnovate.
    """
    giorni = _intero(settings, 'copertine_youtube_rinnovo_giorni', 25)
    if giorni <= 0:
        return 0

    try:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT m.id, m.id_Video, m.url_immagine, v.percorso_file, "
                "       v.percorso_copertina, v.copertina_origine, c.Nome AS nome_categoria "
                "FROM Metadati_Online m "
                "JOIN Video v ON v.id = m.id_Video "
                "LEFT JOIN Categorie c ON c.id = v.id_Categoria "
                "WHERE m.provider = 'youtube' AND m.stato = 'applicato' "
                "  AND m.url_immagine IS NOT NULL "
                "  AND m.applicato_at < DATE_SUB(NOW(), INTERVAL %s DAY) "
                "LIMIT 5",
                (giorni,)
            )
            scadute = cursor.fetchall()
    except Exception as e:
        logging.warning("[Covers][Rinnovo] Query fallita: %s", e)
        return 0

    rinnovate = 0
    for riga in scadute:
        # Se nel frattempo la copertina e' stata sostituita a mano, non la
        # tocchiamo: l'obbligo di aggiornamento riguarda il dato YouTube, che
        # in quel caso non e' piu' in uso.
        if riga.get('copertina_origine') == 'manuale':
            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE Metadati_Online SET stato = 'ignorato', "
                    "errore_msg = 'sostituita da un upload manuale' WHERE id = %s",
                    (riga['id'],)
                )
            continue

        destinazione, _ = get_cover_paths(riga['percorso_file'], riga.get('nome_categoria'))
        base = os.path.splitext(destinazione)[0]
        try:
            _, estensione, byte_scritti = scarica_immagine(riga['url_immagine'], base)
        except ImageFetchError as e:
            logging.warning("[Covers][Rinnovo] Video %s non piu' disponibile: %s",
                            riga['id_Video'], e)
            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE Metadati_Online SET stato = 'errore', errore_msg = %s "
                    "WHERE id = %s",
                    (("rinnovo fallito: %s" % e)[:500], riga['id'])
                )
            continue

        _, db_path = get_cover_paths(riga['percorso_file'], riga.get('nome_categoria'),
                                     ext=estensione)
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE Video SET percorso_copertina = %s, copertina_origine = 'online' "
                "WHERE id = %s", (db_path, riga['id_Video'])
            )
            cursor.execute(
                "UPDATE Metadati_Online SET applicato_at = NOW(), errore_msg = NULL "
                "WHERE id = %s", (riga['id'],)
            )
        rinnovate += 1
        logging.info("[Covers][Rinnovo] Copertina YouTube del video %s aggiornata "
                     "(%d byte).", riga['id_Video'], byte_scritti)

    if rinnovate:
        invalidate_videos_only(reason='rinnovo copertine YouTube')
    return rinnovate


def auto_discovery(conn, settings):
    """
    Accoda automaticamente i video che rientrano nei criteri configurati.
    Ritorna il numero di righe inserite.

    Non tocca MAI i video che hanno gia' una riga in stato conclusivo
    (applicato / nessun_match / ignorato): sarebbe un ciclo infinito di
    richieste allo stesso provider per contenuti che non ci sono.
    """
    ambito = (settings.get('copertine_online_ambito') or 'senza_copertina').strip()
    categorie = _categorie_ammesse(settings)
    provider = (settings.get('copertine_online_provider') or 'tpdb').strip()

    condizioni = []
    parametri = []

    if ambito == 'senza_copertina':
        condizioni.append("(v.percorso_copertina IS NULL OR v.percorso_copertina = 'mancante')")
    elif ambito == 'solo_nuovi':
        # "Nuovi" = mai passati dal modulo. La riga Metadati_Online e' il segno
        # di passaggio, quindi il NOT EXISTS piu' sotto basta da solo.
        pass
    # ambito == 'tutti' -> nessuna condizione aggiuntiva

    # Non toccare le copertine caricate a mano dall'admin: mai, in nessun ambito.
    condizioni.append("(v.copertina_origine IS NULL OR v.copertina_origine <> 'manuale')")

    if categorie:
        segnaposti = ','.join(['%s'] * len(categorie))
        condizioni.append("v.id_Categoria IN (%s)" % segnaposti)
        parametri.extend(categorie)

    condizioni.append(
        "NOT EXISTS (SELECT 1 FROM Metadati_Online m "
        "            WHERE m.id_Video = v.id AND m.provider = %s)"
    )
    parametri.append(provider)

    sql = (
        "INSERT IGNORE INTO Metadati_Online (id_Video, provider, stato, origine_job) "
        "SELECT v.id, %s, 'in_coda', 'auto' FROM Video v WHERE " +
        " AND ".join(condizioni) +
        " ORDER BY v.id DESC LIMIT %s"
    )
    parametri_finali = [provider] + parametri + [DISCOVERY_BATCH]

    try:
        with conn.cursor() as cursor:
            cursor.execute(sql, parametri_finali)
            inserite = cursor.rowcount
        if inserite > 0:
            logging.info("[Discovery] Accodati %d video (ambito=%s, categorie=%s)",
                         inserite, ambito, categorie or 'tutte')
        return inserite
    except Exception as e:
        logging.error("[Discovery] Errore durante l'accodamento: %s", e)
        return 0


# ============================================================================
# Elaborazione di un job
# ============================================================================
def _rilascia(conn, id_meta, stato, errore=None, ritenta_tra_sec=None):
    """
    Rilascia il lock del job impostandone lo stato finale.

    `ritenta_tra_sec` popola prossimo_tentativo_at: il job resta 'in_coda' ma
    claim_job non lo ripeschera' prima di quell'istante. Senza, il worker
    riprendeva lo stesso job dopo 1 secondo bruciando tutti i tentativi su un
    errore transitorio.
    """
    try:
        with conn.cursor() as cursor:
            if ritenta_tra_sec is None:
                cursor.execute(
                    "UPDATE Metadati_Online SET stato = %s, errore_msg = %s, "
                    "  locked_at = NULL, prossimo_tentativo_at = NULL WHERE id = %s",
                    (stato, (errore or None), id_meta)
                )
            else:
                cursor.execute(
                    "UPDATE Metadati_Online SET stato = %s, errore_msg = %s, locked_at = NULL, "
                    "  prossimo_tentativo_at = DATE_ADD(NOW(), INTERVAL %s SECOND) "
                    "WHERE id = %s",
                    (stato, (errore or None), int(ritenta_tra_sec), id_meta)
                )
    except Exception as e:
        logging.error("Impossibile aggiornare il job %s: %s", id_meta, e)


def _rimuovi_copertina_precedente(conn, video, nuovo_db_path):
    """
    Se la copertina precedente aveva un'altra estensione (es. .jpg di ffmpeg
    contro .png scaricato), il vecchio file resterebbe su disco e il watcher
    lo cancellerebbe solo dopo un'ora come orfano. Lo togliamo subito noi.
    """
    vecchio = video.get('percorso_copertina')
    if not vecchio or vecchio == 'mancante' or vecchio == nuovo_db_path:
        return
    percorso = os.path.join(PATH_TO_MONITOR, vecchio)
    if not validate_under_base(percorso):
        return
    try:
        if os.path.isfile(percorso):
            os.unlink(percorso)
            logging.info("[Covers] Rimossa copertina precedente: %s", vecchio)
    except OSError as e:
        logging.warning("[Covers] Non ho potuto rimuovere %s: %s", vecchio, e)


def elabora_job(conn, settings, job, providers):
    """
    Esegue un job gia' claimato. Ritorna True se ha fatto lavoro utile.
    Ogni uscita DEVE rilasciare il lock.
    """
    global _ultima_chiamata, _cooldown_fino_a

    id_meta = job['id']
    id_video = job['id_Video']

    # --- Dati del video ---
    with conn.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT v.id, v.percorso_file, v.Titolo, v.Durata, v.percorso_copertina, "
            "       v.copertina_origine, v.id_Categoria, c.Nome AS nome_categoria "
            "FROM Video v LEFT JOIN Categorie c ON v.id_Categoria = c.id "
            "WHERE v.id = %s",
            (id_video,)
        )
        video = cursor.fetchone()

    if not video:
        _rilascia(conn, id_meta, 'errore', 'video non piu presente nel database')
        return True

    # --- Guardia: non sovrascrivere MAI un upload manuale dell'admin ---
    if video.get('copertina_origine') == 'manuale':
        logging.info("[Covers] ID %s ha una copertina caricata a mano: salto.", id_video)
        _rilascia(conn, id_meta, 'ignorato', 'copertina caricata manualmente dall\'admin')
        return True

    # --- Guardia: copertina ffmpeg presente e sovrascrittura disattivata ---
    ha_copertina = (video.get('percorso_copertina')
                    and video['percorso_copertina'] != 'mancante')
    sovrascrivi = _flag(settings, 'copertine_online_sovrascrivi')
    solo_proposta = ha_copertina and not sovrascrivi

    # --- Durata in secondi, per lo scoring (Video.Durata e' "HH:MM") ---
    durata_sec = None
    durata_txt = video.get('Durata') or ''
    if ':' in str(durata_txt):
        try:
            ore, minuti = str(durata_txt).split(':')[:2]
            durata_sec = int(ore) * 3600 + int(minuti) * 60
        except (ValueError, TypeError):
            durata_sec = None

    # --- Throttle: pausa minima tra due chiamate al provider ---
    pausa = _intero(settings, 'copertine_online_pausa_richieste', 2)

    manuale = (job.get('origine_job') == 'manuale')

    def prima_di_chiamare():
        """
        Invocata PRIMA di ogni singola richiesta a un provider.

        La quota va verificata qui, non solo a inizio ciclo: un job puo'
        bruciare fino a 5 chiamate PER PROVIDER (i tentativi di build_query),
        quindi controllandola solo all'ingresso si sforava sistematicamente il
        tetto giornaliero. I job manuali restano esenti: se l'admin clicca,
        deve succedere.
        """
        global _ultima_chiamata
        if not manuale and quota_esaurita(settings):
            raise QuotaEsaurita(
                'quota giornaliera di %d chiamate raggiunta'
                % _intero(settings, 'copertine_online_max_giorno', 200)
            )
        trascorso = time.time() - _ultima_chiamata
        if trascorso < pausa:
            time.sleep(pausa - trascorso)
        _ultima_chiamata = time.time()
        _quota_incrementa()

    # --- Ricerca su TUTTI i provider attivi, in ordine di priorita' ---
    # Ci si ferma al primo che produce un match sopra soglia: gli altri
    # servono solo se il precedente non sa nulla di questo contenuto (tipico
    # di una libreria mista, dove TPDB e TMDB coprono cataloghi disgiunti).
    soglia = _intero(settings, 'copertine_online_soglia_auto', 75)
    query = None
    candidati = []
    errori_provider = []

    for pid, token in providers:
        provider = get_provider(pid, token=token)
        try:
            q, trovati = provider.cerca_candidati(
                video['percorso_file'],
                titolo_db=video.get('Titolo'),
                durata_sec=durata_sec,
                on_call=prima_di_chiamare,
            )
        except ProviderRateLimit as e:
            _cooldown_fino_a = time.time() + RATE_LIMIT_COOLDOWN
            logging.warning("[Covers] Rate limit di '%s': pausa di %ds. (%s)",
                            pid, RATE_LIMIT_COOLDOWN, e)
            _rilascia(conn, id_meta, 'in_coda', None)   # non consuma tentativi
            return False
        except QuotaEsaurita as e:
            # DEVE stare PRIMA di `except Exception`, altrimenti il ciclo
            # passerebbe al provider successivo continuando a chiamare la rete
            # a quota esaurita. Non e' colpa del video: niente tentativi
            # consumati, niente backoff, riparte quando la quota si azzera.
            logging.info("[Covers] ID %s rimandato: %s", id_video, e)
            _rilascia(conn, id_meta, 'in_coda', None)
            return False
        except ProviderAuthError as e:
            # Un token sbagliato riguarda QUEL provider: proviamo gli altri.
            logging.error("[Covers] Autenticazione fallita su '%s': %s", pid, e)
            errori_provider.append("%s: %s" % (pid, e))
            continue
        except Exception as e:
            logging.warning("[Covers] Ricerca fallita su '%s': %s", pid, e)
            errori_provider.append("%s: %s" % (pid, e))
            continue

        if query is None:
            query = q
        for c in trovati:
            c['provider'] = pid
        candidati.extend(trovati)

        if trovati and max(c['score'] for c in trovati) >= soglia:
            break   # match convincente: inutile interrogare gli altri

    candidati.sort(key=lambda c: c.get('score', 0), reverse=True)

    if query is None:
        # Nessun provider ha risposto: e' un errore tecnico, non "nessun match".
        messaggio = "; ".join(errori_provider) or "nessun provider disponibile"
        return _gestisci_errore(conn, settings, job, messaggio)

    if not candidati:
        logging.info("[Covers] Nessun risultato per ID %s (query=%r)", id_video, query['nome'])
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE Metadati_Online SET stato = 'nessun_match', query_usata = %s, "
                "  candidati_json = NULL, errore_msg = NULL, locked_at = NULL WHERE id = %s",
                (query['nome'][:512], id_meta)
            )
        return True

    migliore = candidati[0]
    soglia = _intero(settings, 'copertine_online_soglia_auto', 75)
    conferma_sempre = _flag(settings, 'copertine_online_conferma_sempre')

    # Top-5 candidati serializzati: permettono all'admin di scegliere dalla UI
    # senza rifare la chiamata al provider.
    candidati_json = json.dumps([{
        'id': c['id'], 'title': c['title'], 'site': c['site'], 'date': c['date'],
        'duration': c['duration'], 'image_url': c['image_url'], 'score': c['score'],
        'performers': c.get('performers', [])[:6],
    } for c in candidati[:5]], ensure_ascii=False)

    def _salva_proposta(motivo):
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE Metadati_Online SET stato = 'da_confermare', query_usata = %s, "
                "  match_id = %s, match_titolo = %s, match_sito = %s, match_data = %s, "
                "  match_score = %s, url_immagine = %s, candidati_json = %s, "
                "  errore_msg = %s, locked_at = NULL WHERE id = %s",
                (query['nome'][:512], migliore['id'], migliore['title'][:512],
                 migliore['site'][:128], (migliore['date'] or None), migliore['score'],
                 migliore['image_url'][:1024], candidati_json, motivo, id_meta)
            )
        logging.info("[Covers] ID %s -> proposta in attesa di conferma (score=%d, %s)",
                     id_video, migliore['score'], motivo)

    if conferma_sempre:
        _salva_proposta('modalita "chiedi sempre conferma" attiva')
        return True
    if migliore['score'] < soglia:
        _salva_proposta('confidenza %d%% sotto la soglia di %d%%' % (migliore['score'], soglia))
        return True
    if solo_proposta:
        _salva_proposta('copertina gia presente e sovrascrittura disattivata')
        return True

    # --- Applicazione: download + DB ---
    return applica_candidato(conn, id_meta, video, migliore, query.get('nome', ''),
                             candidati_json, settings)


def applica_candidato(conn, id_meta, video, candidato, query_txt, candidati_json, settings):
    """
    Scarica l'immagine del candidato e la registra come copertina del video.
    Usata sia dal flusso automatico sia dalla conferma manuale dell'admin.
    """
    destinazione_jpg, _ = get_cover_paths(video['percorso_file'], video.get('nome_categoria'))
    # get_cover_paths ci da' il path con estensione; image_fetch aggiunge la sua
    # in base ai magic bytes, quindi passiamo la base senza suffisso.
    base_senza_ext = os.path.splitext(destinazione_jpg)[0]

    if not validate_under_base(os.path.dirname(base_senza_ext) or PATH_TO_MONITOR):
        _rilascia(conn, id_meta, 'errore', 'percorso di destinazione non valido')
        return True

    try:
        path_scritto, estensione, byte_scritti = scarica_immagine(
            candidato['image_url'], base_senza_ext)
    except ImageFetchError as e:
        logging.error("[Covers] Download fallito per ID %s: %s", video['id'], e)
        job = {'id': id_meta, 'id_Video': video['id']}
        return _gestisci_errore(conn, settings, job, str(e))

    _, db_path = get_cover_paths(video['percorso_file'], video.get('nome_categoria'),
                                 ext=estensione)
    _rimuovi_copertina_precedente(conn, video, db_path)

    try:
        conn.start_transaction()
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE Video SET percorso_copertina = %s, copertina_origine = 'online' "
                "WHERE id = %s",
                (db_path, video['id'])
            )
            cursor.execute(
                "UPDATE Metadati_Online SET stato = 'applicato', query_usata = %s, "
                "  match_id = %s, match_titolo = %s, match_sito = %s, match_data = %s, "
                "  match_score = %s, url_immagine = %s, candidati_json = %s, "
                "  errore_msg = NULL, tentativi = 0, applicato_at = NOW(), locked_at = NULL "
                "WHERE id = %s",
                ((query_txt or '')[:512], candidato['id'], (candidato['title'] or '')[:512],
                 (candidato['site'] or '')[:128], (candidato['date'] or None),
                 candidato.get('score'), (candidato['image_url'] or '')[:1024],
                 candidati_json, id_meta)
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        logging.error("[Covers] Aggiornamento DB fallito per ID %s: %s", video['id'], e)
        # Il file e' su disco ma il DB non lo conosce: lo rimuoviamo, altrimenti
        # watcher.cleanup_orphaned_assets lo cancellerebbe comunque fra un'ora.
        try:
            if os.path.isfile(path_scritto):
                os.unlink(path_scritto)
        except OSError:
            pass
        job = {'id': id_meta, 'id_Video': video['id']}
        return _gestisci_errore(conn, settings, job, 'aggiornamento database fallito')

    invalidate_videos_only(reason='copertina online video id=%s' % video['id'])
    logging.info("[Covers] ID %s -> copertina applicata: %s (%s, %d byte, score=%s)",
                 video['id'], candidato['title'][:50], estensione, byte_scritti,
                 candidato.get('score'))
    return True


# Backoff esponenziale tra i tentativi falliti: 60s, 120s, 240s... con tetto
# a 1h. Un errore transitorio (rete, 5xx del provider) non deve piu' consumare
# l'intero budget di tentativi in pochi secondi.
RETRY_BASE_SECONDS = int(os.environ.get('COVERS_RETRY_BASE', '60'))
RETRY_MAX_SECONDS = int(os.environ.get('COVERS_RETRY_MAX', '3600'))


def _attesa_backoff(tentativi):
    """Secondi da attendere prima del prossimo tentativo. Cresce esponenzialmente."""
    esponente = min(max(0, int(tentativi) - 1), 16)
    return min(RETRY_BASE_SECONDS * (2 ** esponente), RETRY_MAX_SECONDS)


def _gestisci_errore(conn, settings, job, messaggio):
    """
    Incrementa i tentativi. Sotto la soglia rimette in coda con un backoff
    esponenziale REALE (prossimo_tentativo_at), raggiunta la soglia marca
    'errore' definitivo: l'admin lo vede in UI e puo' riaccodarlo a mano.
    """
    massimo = _intero(settings, 'copertine_online_max_tentativi', 3)
    try:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                "UPDATE Metadati_Online SET tentativi = tentativi + 1 WHERE id = %s",
                (job['id'],)
            )
            cursor.execute("SELECT tentativi FROM Metadati_Online WHERE id = %s", (job['id'],))
            riga = cursor.fetchone()
            tentativi = riga['tentativi'] if riga else massimo
    except Exception:
        tentativi = massimo

    if tentativi >= massimo:
        _rilascia(conn, job['id'], 'errore', messaggio[:500])
        logging.error("[Covers] ID %s: %d tentativi falliti, marco errore.",
                      job['id_Video'], tentativi)
    else:
        attesa = _attesa_backoff(tentativi)
        _rilascia(conn, job['id'], 'in_coda', messaggio[:500], ritenta_tra_sec=attesa)
        logging.warning("[Covers] ID %s: tentativo %d/%d fallito, riprovo tra %ds.",
                        job['id_Video'], tentativi, massimo, attesa)
    return True


# ============================================================================
# Claim
# ============================================================================
def claim_job(conn):
    """
    Prende UN job in coda con claim atomico.
    I job manuali passano davanti a quelli automatici.
    """
    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE Metadati_Online SET locked_at = NULL, stato = 'in_coda' "
            "WHERE locked_at IS NOT NULL AND locked_at < DATE_SUB(NOW(), INTERVAL %s MINUTE)",
            (STALE_LOCK_MINUTES,)
        )

    with conn.cursor(dictionary=True) as cursor:
        cursor.execute(
            # origine_job serve a elabora_job per esentare i manuali dalla quota.
            "SELECT id, id_Video, origine_job FROM Metadati_Online "
            "WHERE stato = 'in_coda' AND locked_at IS NULL "
            # Backoff: un job appena fallito non e' ripescabile finche' non e'
            # maturo. Senza, veniva ripreso dopo 1 secondo.
            "  AND (prossimo_tentativo_at IS NULL OR prossimo_tentativo_at <= NOW()) "
            "ORDER BY (origine_job = 'manuale') DESC, id ASC LIMIT 1"
        )
        candidato = cursor.fetchone()
    if not candidato:
        return None

    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE Metadati_Online SET locked_at = NOW(), stato = 'elaborazione' "
            "WHERE id = %s AND locked_at IS NULL",
            (candidato['id'],)
        )
        if cursor.rowcount == 0:
            return None       # preso da un altro processo
    return candidato


def ci_sono_job_manuali(conn):
    """I job manuali ignorano finestra oraria e modalita': l'admin ha priorita'."""
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) FROM Metadati_Online "
                "WHERE stato = 'in_coda' AND origine_job = 'manuale' "
                # Stesso criterio di claim_job: un manuale in backoff non e'
                # "in attesa", altrimenti terrebbe aperto il bypass della quota
                # girando a vuoto.
                "  AND (prossimo_tentativo_at IS NULL OR prossimo_tentativo_at <= NOW())"
            )
            return cursor.fetchone()[0] > 0
    except Exception:
        return False


# ============================================================================
# Loop principale
# ============================================================================
def main():
    logging.info("--- Avvio Worker Copertine Online ---")
    if not all([DB_HOST, DB_USER, DB_PASS, DB_NAME]):
        logging.critical("Variabili d'ambiente del database non impostate!")
        sys.exit(1)

    conn = None
    idle_streak = 0
    schema_pronto = False

    while True:
        lavoro_fatto = False
        try:
            if conn is None or not conn.is_connected():
                conn = get_db_connection()
                schema_pronto = False
            if not schema_pronto:
                _ensure_schema(conn)
                schema_pronto = True

            settings = fetch_settings(conn)

            # --- Master switch: a modulo spento NESSUNA chiamata di rete ---
            if not _flag(settings, 'copertine_online_abilitato'):
                time.sleep(60)
                continue

            # --- Cooldown dopo rate limit ---
            if time.time() < _cooldown_fino_a:
                restante = int(_cooldown_fino_a - time.time())
                logging.info("In cooldown per rate limit, altri %ds.", restante)
                time.sleep(min(restante, 60))
                continue

            # Rinnovo delle copertine YouTube in scadenza. Va PRIMA di tutto:
            # e' un obbligo di conformita', non una funzionalita' opzionale,
            # e non deve restare indietro perche' la coda e' piena.
            if rinnova_copertine_scadute(conn, settings):
                lavoro_fatto = True

            manuali_in_attesa = ci_sono_job_manuali(conn)

            # --- Quota giornaliera ---
            if quota_esaurita(settings) and not manuali_in_attesa:
                logging.info("Quota giornaliera esaurita (%d chiamate). Attendo.",
                             _quota_usata())
                time.sleep(300)
                continue

            # --- Auto-discovery (solo automatico, dentro finestra, senza quota esaurita) ---
            modalita = (settings.get('copertine_online_modalita') or 'manuale').strip()
            if (modalita == 'automatico' and dentro_finestra(settings)
                    and not quota_esaurita(settings)):
                auto_discovery(conn, settings)

            # --- Un job per giro ---
            job = claim_job(conn)
            if job:
                attivi = provider_attivi(settings)
                if not attivi:
                    logging.warning(
                        "Nessun provider attivo o configurato: il job resta in coda."
                    )
                    _rilascia(conn, job['id'], 'in_coda', 'nessun provider attivo')
                    time.sleep(60)
                    continue
                lavoro_fatto = elabora_job(conn, settings, job, attivi)

        except mysql.connector.Error as err:
            logging.error("Errore DB nel loop principale: %s", err)
            try:
                if conn:
                    conn.close()
            except Exception:
                pass
            conn = None
        except KeyboardInterrupt:
            logging.info("Arresto del worker (Copertine)...")
            try:
                if conn:
                    conn.close()
            except Exception:
                pass
            break
        except Exception as e:
            logging.error("Errore non gestito nel loop principale: %s", e)

        if lavoro_fatto:
            idle_streak = 0
            time.sleep(1)
        else:
            idle_streak = min(idle_streak + 1, 6)
            attesa = min(POLL_INTERVAL * (2 ** (idle_streak - 1)), BACKOFF_MAX)
            time.sleep(attesa)


if __name__ == "__main__":
    main()
