# worker_subtitles.py
# ============================================================================
# Worker SOTTOTITOLI (on-demand, mai automatico).
# ============================================================================
# Genera sottotitoli SOLO per i video accodati esplicitamente dall'admin nella
# pagina Admin > Sottotitoli (righe `Sottotitoli.stato = 'in_coda'`). Nessuna
# scansione automatica della libreria: il worker resta in idle finche' non trova
# un job in coda.
#
# Pipeline:
#   1. ffmpeg estrae l'audio (16kHz mono) dal video.
#   2. faster-whisper (CTranslate2, CPU INT8) trascrive -> segmenti + timestamp.
#   3. Si scrive il VTT della trascrizione nella lingua originale.
#   4. Per ogni lingua di traduzione richiesta, LibreTranslate (container separato,
#      via HTTP) traduce i segmenti -> VTT tradotto.
#
# Concorrenza: claim atomico via `Sottotitoli.locked_at` (stesso pattern degli
# altri worker). Un job per volta (serializzato), coerente coi vincoli hardware.
# ============================================================================

import sys
import os
import time
import json
import logging
import tempfile
import subprocess
import platform
from pathlib import Path

import mysql.connector
import requests

import subtitles_common as subs_common
from cache_invalidation import invalidate_videos_and_categories

# --- Impostazioni ambiente ---
PATH_TO_MONITOR = os.environ.get('WATCH_DIR', '/percorsoVideo')
DB_HOST = os.environ.get('MYSQL_HOST', 'mysql')
DB_USER = os.environ.get('MYSQL_USER')
DB_PASS = os.environ.get('MYSQL_PASSWORD')
DB_NAME = os.environ.get('MYSQL_DATABASE')

POLL_INTERVAL = int(os.environ.get('SUBTITLES_POLL_INTERVAL', '15'))
BACKOFF_MAX = int(os.environ.get('SUBTITLES_BACKOFF_MAX', '120'))
STALE_LOCK_MINUTES = int(os.environ.get('SUBTITLES_STALE_LOCK_MINUTES', '30'))

# faster-whisper
WHISPER_MODEL_DIR = os.environ.get('WHISPER_MODEL_DIR', '/models')
WHISPER_COMPUTE_TYPE = os.environ.get('WHISPER_COMPUTE_TYPE', 'int8')
WHISPER_DEFAULT_MODEL = os.environ.get('WHISPER_DEFAULT_MODEL', 'small')
WHISPER_BEAM_SIZE = int(os.environ.get('WHISPER_BEAM_SIZE', '5'))

# Modelli selezionabili per-job dall'admin (whitelist, coerente col backend PHP).
ALLOWED_MODELS = {'small', 'medium'}

# --- Discovery sottotitoli manuali ---
# Estensioni e default lingua vivono in subtitles_common (condivise col watcher).
SUB_EXTENSIONS = subs_common.SUB_EXTENSIONS
MANUAL_DEFAULT_LANG = subs_common.MANUAL_DEFAULT_LANG
# Ogni quanto ri-scansionare il disco per nuovi sottotitoli manuali (secondi).
# Ora e' solo una RETE DI SICUREZZA: il rilevamento in tempo reale e' fatto dal
# watcher (watcher.py) all'istante in cui il file compare nella cartella. Per
# questo l'intervallo e' alto (default 15 min), cosi' il worker dedica il tempo
# alle trascrizioni invece che a scansionare il disco.
DISCOVERY_INTERVAL = int(os.environ.get('SUBTITLES_DISCOVERY_INTERVAL', '900'))

# LibreTranslate (container separato per la traduzione multilingua)
LIBRETRANSLATE_URL = os.environ.get('LIBRETRANSLATE_URL', 'http://libretranslate:5000').rstrip('/')
LIBRETRANSLATE_API_KEY = os.environ.get('LIBRETRANSLATE_API_KEY') or None
# Timeout PER BATCH (non piu' per l'intero video): con i batch ogni richiesta
# resta piccola, quindi 120s sono abbondanti. Alzato a 300 come margine.
LIBRETRANSLATE_TIMEOUT = int(os.environ.get('LIBRETRANSLATE_TIMEOUT', '300'))
# Segmenti per richiesta. LibreTranslate (argos) traduce su CPU un testo alla
# volta: mandare 1000 segmenti in un colpo solo sforava i 120s -> timeout e
# traduzione persa per intero. Spezzando in batch ogni richiesta finisce in
# pochi secondi e la traduzione regge qualsiasi durata.
LIBRETRANSLATE_BATCH_SIZE = max(1, int(os.environ.get('LIBRETRANSLATE_BATCH_SIZE', '40')))
# Tentativi per batch su errore transitorio (timeout/connessione).
LIBRETRANSLATE_RETRIES = max(0, int(os.environ.get('LIBRETRANSLATE_RETRIES', '2')))

FFMPEG_AUDIO_TIMEOUT = int(os.environ.get('SUBTITLES_FFMPEG_TIMEOUT', '600'))

# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [Worker-Subs] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)]
)

# Cache del modello Whisper: caricarlo costa secondi e RAM, lo teniamo vivo tra i
# job e lo ricarichiamo solo se l'admin cambia il modello in Impostazioni.
_whisper_model = None
_whisper_model_name = None


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
                logging.error(f"Errore di connessione DB: {err}")
                time.sleep(10)


def _ensure_subtitles_table(conn):
    """
    Crea la tabella Sottotitoli se mancante (idempotente). Serve sui DB
    pre-esistenti dove 02_migrations.sql non viene rieseguito (l'init gira
    solo su volume vergine).
    """
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS `Sottotitoli` (
                    `id` INT AUTO_INCREMENT PRIMARY KEY,
                    `id_Video` INT NOT NULL,
                    `lingua` VARCHAR(8) NOT NULL,
                    `lingua_origine` VARCHAR(8) NULL,
                    `tipo` ENUM('trascrizione','traduzione') NOT NULL DEFAULT 'trascrizione',
                    `percorso_file` VARCHAR(512) NULL,
                    `stato` ENUM('in_coda','elaborazione','completato','errore') NOT NULL DEFAULT 'in_coda',
                    `modello_richiesto` VARCHAR(32) NULL,
                    `modello_usato` VARCHAR(32) NULL,
                    `errore_msg` VARCHAR(500) NULL,
                    `locked_at` DATETIME NULL,
                    `generato_at` DATETIME NULL,
                    `creato_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY `uq_sottotitoli_video_lingua` (`id_Video`, `lingua`),
                    KEY `idx_sottotitoli_stato` (`stato`, `locked_at`),
                    KEY `idx_sottotitoli_video` (`id_Video`),
                    CONSTRAINT `fk_sottotitoli_video` FOREIGN KEY (`id_Video`)
                        REFERENCES `Video`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            # Colonna aggiunta in un secondo momento: ALTER idempotente per i DB
            # gia' esistenti (l'init SQL non rigira su volume non vergine).
            cursor.execute("""
                ALTER TABLE `Sottotitoli`
                ADD COLUMN IF NOT EXISTS `modello_richiesto` VARCHAR(32) NULL AFTER `stato`
            """)
    except Exception as e:
        logging.warning(f"_ensure_subtitles_table skip: {e}")


def fetch_whisper_model_name(conn):
    """Legge il modello Whisper configurato in Impostazioni (default 'small')."""
    try:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT Valore_Impostazione AS v FROM Impostazioni "
                "WHERE Chiave_Impostazione = 'whisper_modello' LIMIT 1"
            )
            row = cursor.fetchone()
            if row and row['v']:
                return row['v'].strip()
    except Exception as e:
        logging.warning(f"Lettura whisper_modello fallita: {e}. Uso default.")
    return WHISPER_DEFAULT_MODEL


# ============================================================================
# Path & VTT helpers
# ============================================================================
def _validate_under_base(full_path):
    """Rifiuta path fuori da WATCH_DIR e symlink (anti traversal)."""
    try:
        full_real = os.path.realpath(full_path)
        base_real = os.path.realpath(PATH_TO_MONITOR)
        if not (full_real == base_real or full_real.startswith(base_real + os.sep)):
            logging.warning(f"[SECURITY] Path fuori base: {full_path}")
            return False
        if os.path.islink(full_path):
            logging.warning(f"[SECURITY] Symlink ignorato: {full_path}")
            return False
        return True
    except OSError:
        return False


def _get_subtitle_paths(relative_path, category_name, lang):
    """
    Costruisce il path del VTT per una lingua, accanto agli altri asset del video.
    Coerente con worker_assets._get_asset_paths: il suffisso cartella e' il nome
    della CARTELLA SU DISCO (gia' sanificata dal watcher), non il Categorie.Nome.

    Ritorna (full_vtt_path, db_vtt_path).
    """
    p = Path(relative_path)
    parent_dir = p.parent
    video_stem = p.stem
    folder_suffix = parent_dir.name if parent_dir.name else (category_name or "Generale")

    db_vtt_path = (parent_dir / f"sottotitoli_{folder_suffix}" / f"{video_stem}.{lang}.vtt").as_posix()
    full_vtt_path = os.path.join(PATH_TO_MONITOR, db_vtt_path)
    return full_vtt_path, db_vtt_path


def _format_timestamp(seconds):
    """Secondi (float) -> 'HH:MM:SS.mmm' per WebVTT."""
    if seconds < 0:
        seconds = 0
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def write_vtt(segments, full_vtt_path):
    """
    Scrive i segmenti in formato WebVTT. `segments` = lista di dict
    {'start': float, 'end': float, 'text': str}.
    """
    # Crea la cartella sottotitoli con permessi ampi: su alcuni mount (es. drvfs su
    # Windows, o share di rete) le nuove dir nascono di proprieta' di un uid diverso
    # da quello del worker; senza il bit di scrittura per il gruppo/altri il worker
    # non potrebbe scrivere il .vtt. Best-effort: se non siamo owner, chmod fallisce
    # silenziosamente (su Linux nativo la dir e' gia' nostra e scrivibile).
    parent = Path(full_vtt_path).parent
    os.makedirs(parent, mode=0o777, exist_ok=True)
    try:
        os.chmod(parent, 0o777)
    except OSError:
        pass
    lines = ["WEBVTT", ""]
    for seg in segments:
        text = (seg['text'] or '').strip()
        if not text:
            continue
        lines.append(f"{_format_timestamp(seg['start'])} --> {_format_timestamp(seg['end'])}")
        lines.append(text)
        lines.append("")
    with open(full_vtt_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(lines))


# ============================================================================
# Audio extraction + trascrizione + traduzione
# ============================================================================
def extract_audio(full_video_path, wav_path):
    """Estrae l'audio in WAV 16kHz mono (formato ottimale per Whisper)."""
    command = [
        "ffmpeg", "-y", "-i", full_video_path,
        "-vn", "-ac", "1", "-ar", "16000",
        "-f", "wav", wav_path
    ]
    subprocess.run(command, capture_output=True, text=True, check=True, timeout=FFMPEG_AUDIO_TIMEOUT)


def get_whisper_model(model_name):
    """Carica (o riusa dalla cache) il modello faster-whisper."""
    global _whisper_model, _whisper_model_name
    if _whisper_model is not None and _whisper_model_name == model_name:
        return _whisper_model
    from faster_whisper import WhisperModel
    logging.info(f"Caricamento modello Whisper '{model_name}' (compute={WHISPER_COMPUTE_TYPE})...")
    _whisper_model = WhisperModel(
        model_name, device="cpu",
        compute_type=WHISPER_COMPUTE_TYPE,
        download_root=WHISPER_MODEL_DIR
    )
    _whisper_model_name = model_name
    logging.info(f"Modello '{model_name}' pronto.")
    return _whisper_model


def transcribe(wav_path, model_name, source_lang):
    """
    Trascrive l'audio. Se source_lang e' 'auto' (o vuoto) lascia rilevare a Whisper.
    Ritorna (segments, detected_lang) dove segments e' lista di dict start/end/text.
    """
    model = get_whisper_model(model_name)
    language = None if (not source_lang or source_lang == 'auto') else source_lang
    segments_gen, info = model.transcribe(
        wav_path,
        language=language,
        beam_size=WHISPER_BEAM_SIZE,
        vad_filter=True,   # filtra il silenzio: meno allucinazioni nei vuoti
    )
    segments = [{'start': s.start, 'end': s.end, 'text': s.text} for s in segments_gen]
    detected = getattr(info, 'language', None) or source_lang or 'und'
    return segments, detected


def _translate_batch(texts, source_lang, target_lang):
    """
    Traduce una lista di testi in UNA richiesta a LibreTranslate, con retry sui
    fallimenti transitori (timeout/connessione). Ritorna la lista tradotta,
    stessa lunghezza di `texts`.
    """
    payload = {
        'q': texts,
        'source': source_lang,
        'target': target_lang,
        'format': 'text',
    }
    if LIBRETRANSLATE_API_KEY:
        payload['api_key'] = LIBRETRANSLATE_API_KEY

    last_err = None
    for attempt in range(LIBRETRANSLATE_RETRIES + 1):
        try:
            resp = requests.post(
                f"{LIBRETRANSLATE_URL}/translate",
                json=payload, timeout=LIBRETRANSLATE_TIMEOUT
            )
            resp.raise_for_status()
            data = resp.json()
            translated = data.get('translatedText')
            # LibreTranslate ritorna una lista se q e' una lista; stringa se q e' stringa.
            if isinstance(translated, str):
                translated = [translated]
            if not isinstance(translated, list) or len(translated) != len(texts):
                raise RuntimeError(
                    f"Risposta LibreTranslate inattesa "
                    f"(len {len(translated) if isinstance(translated, list) else 'n/a'} vs {len(texts)})"
                )
            return translated
        except (requests.RequestException, RuntimeError) as e:
            last_err = e
            if attempt < LIBRETRANSLATE_RETRIES:
                wait = 2 * (attempt + 1)
                logging.warning(f"[Subs] Batch traduzione fallito (tentativo {attempt + 1}): {e}. Riprovo tra {wait}s.")
                time.sleep(wait)
    raise last_err


def translate_segments(segments, source_lang, target_lang):
    """
    Traduce il testo dei segmenti via LibreTranslate, preservando i timestamp.
    Lavora a BATCH (LIBRETRANSLATE_BATCH_SIZE segmenti per richiesta): ogni
    chiamata resta piccola e rapida, evitando il timeout che colpiva la vecchia
    richiesta monolitica con centinaia/migliaia di segmenti.
    """
    out = []
    total = len(segments)
    for start in range(0, total, LIBRETRANSLATE_BATCH_SIZE):
        batch = segments[start:start + LIBRETRANSLATE_BATCH_SIZE]
        texts = [(seg['text'] or '').strip() for seg in batch]
        translated = _translate_batch(texts, source_lang, target_lang)
        for seg, txt in zip(batch, translated):
            out.append({'start': seg['start'], 'end': seg['end'], 'text': txt})
    return out


# ============================================================================
# Aggiornamenti DB per le singole righe
# ============================================================================
def _mark_row(conn, row_id, stato, percorso_file=None, lingua=None, errore=None, modello=None):
    sets = ["stato = %s", "locked_at = NULL"]
    params = [stato]
    if percorso_file is not None:
        sets.append("percorso_file = %s"); params.append(percorso_file)
    if lingua is not None:
        sets.append("lingua = %s"); params.append(lingua)
    if modello is not None:
        sets.append("modello_usato = %s"); params.append(modello)
    if errore is not None:
        sets.append("errore_msg = %s"); params.append(errore[:500])
    else:
        sets.append("errore_msg = NULL")
    if stato == 'completato':
        sets.append("generato_at = NOW()")
    params.append(row_id)
    with conn.cursor() as cursor:
        cursor.execute(f"UPDATE Sottotitoli SET {', '.join(sets)} WHERE id = %s", params)


def _fail_video_rows(conn, video_id, message):
    """Marca come errore tutte le righe in elaborazione di un video (file mancante, ecc.)."""
    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE Sottotitoli SET stato = 'errore', errore_msg = %s, locked_at = NULL "
            "WHERE id_Video = %s AND stato = 'elaborazione'",
            (message[:500], video_id)
        )


# ============================================================================
# Loop principale di processing
# ============================================================================
def process_jobs(conn, model_name):
    """
    Processa i sottotitoli di UN video accodato. Ritorna True se ha fatto lavoro.
    """
    _ensure_subtitles_table(conn)

    # 1. Rilascia lock abbandonati: le righe rimaste 'elaborazione' da troppo
    #    tempo (worker crashato) tornano in coda.
    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE Sottotitoli SET stato = 'in_coda', locked_at = NULL "
            "WHERE stato = 'elaborazione' AND locked_at IS NOT NULL "
            "AND locked_at < DATE_SUB(NOW(), INTERVAL %s MINUTE)",
            (STALE_LOCK_MINUTES,)
        )

    # 2. Trova il video con il job piu' vecchio in coda.
    with conn.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT id_Video FROM Sottotitoli "
            "WHERE stato = 'in_coda' AND locked_at IS NULL "
            "ORDER BY creato_at ASC, id ASC LIMIT 1"
        )
        candidate = cursor.fetchone()
    if not candidate:
        return False
    video_id = candidate['id_Video']

    # 3. Claim atomico di tutte le righe in coda di quel video.
    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE Sottotitoli SET stato = 'elaborazione', locked_at = NOW() "
            "WHERE id_Video = %s AND stato = 'in_coda' AND locked_at IS NULL",
            (video_id,)
        )
        if cursor.rowcount == 0:
            return True  # un altro ciclo l'ha gia' preso

    # 4. Carica i dati del video.
    with conn.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT v.percorso_file, v.id_Categoria, c.Nome AS cat_nome "
            "FROM Video v LEFT JOIN Categorie c ON v.id_Categoria = c.id "
            "WHERE v.id = %s", (video_id,)
        )
        vinfo = cursor.fetchone()

    if not vinfo:
        _fail_video_rows(conn, video_id, "Video inesistente nel DB.")
        return True

    relative_path = vinfo['percorso_file']
    category_name = vinfo['cat_nome'] or "Generale"
    full_video_path = os.path.join(PATH_TO_MONITOR, relative_path)

    if not os.path.exists(full_video_path) or not _validate_under_base(full_video_path):
        _fail_video_rows(conn, video_id, "File video non trovato o path non valido.")
        return True

    # 5. Carica le righe in elaborazione di questo video.
    with conn.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT id, lingua, lingua_origine, tipo, modello_richiesto FROM Sottotitoli "
            "WHERE id_Video = %s AND stato = 'elaborazione'", (video_id,)
        )
        rows = cursor.fetchall()
    if not rows:
        return True

    # Lingua sorgente scelta dall'admin (coerente tra le righe del batch).
    source_lang = next((r['lingua_origine'] for r in rows if r['lingua_origine']), 'auto')

    # Modello scelto dall'admin per QUESTO video (modello_richiesto). Se le righe
    # non lo specificano, si usa il default globale passato dal loop principale.
    requested = next((r['modello_richiesto'] for r in rows if r.get('modello_richiesto')), None)
    if requested in ALLOWED_MODELS:
        model_name = requested
    elif requested:
        logging.warning(f"[Subs] Modello richiesto '{requested}' non ammesso (id={video_id}): uso '{model_name}'.")

    logging.info(f"[Subs] Video id={video_id} ('{relative_path}'): {len(rows)} lingua/e, "
                 f"sorgente='{source_lang}', modello='{model_name}'.")

    wav_path = None
    try:
        # 6. Estrazione audio + trascrizione (una sola volta per video).
        fd, wav_path = tempfile.mkstemp(suffix='.wav')
        os.close(fd)
        logging.info(f"[Subs] Estrazione audio per id={video_id}...")
        extract_audio(full_video_path, wav_path)

        logging.info(f"[Subs] Trascrizione id={video_id} in corso...")
        segments, detected_lang = transcribe(wav_path, model_name, source_lang)
        actual_source = detected_lang if (not source_lang or source_lang == 'auto') else source_lang
        logging.info(f"[Subs] Trascrizione completata: {len(segments)} segmenti, lingua='{actual_source}'.")

        # 7. Scrivi prima la trascrizione (serve come sorgente per le traduzioni).
        full_src_vtt, db_src_vtt = _get_subtitle_paths(relative_path, category_name, actual_source)
        write_vtt(segments, full_src_vtt)

        # Individua la riga 'trascrizione' del batch e finalizzala (gestendo il caso
        # 'auto' che va riscritto col codice rilevato, con dedup anti-UNIQUE).
        trans_row = next((r for r in rows if r['tipo'] == 'trascrizione'), None)
        if trans_row:
            _finalize_transcription_row(conn, video_id, trans_row, actual_source, db_src_vtt, model_name)
        else:
            # Nessuna riga trascrizione esplicita: assicuriamo comunque la sorgente
            # su disco (gia' fatto) per le traduzioni; niente DB update.
            pass

        # 8. Traduzioni: ogni riga 'traduzione' con target != sorgente.
        for r in rows:
            if r['tipo'] != 'traduzione':
                continue
            target = r['lingua']
            try:
                if target == actual_source:
                    # La "traduzione" coincide con la lingua parlata: riusa la trascrizione.
                    _mark_row(conn, r['id'], 'completato',
                              percorso_file=db_src_vtt, modello=model_name)
                    continue
                if not segments:
                    # Nessun parlato rilevato (es. trailer musicale): niente da tradurre.
                    # Scriviamo un VTT vuoto nella lingua target ed evitiamo la chiamata
                    # a LibreTranslate, che rifiuta un array 'q' vuoto con 400 Bad Request.
                    full_t_vtt, db_t_vtt = _get_subtitle_paths(relative_path, category_name, target)
                    write_vtt([], full_t_vtt)
                    _mark_row(conn, r['id'], 'completato',
                              percorso_file=db_t_vtt, modello=model_name)
                    logging.info(f"[Subs] Nessun segmento da tradurre per {target} (id={video_id}): VTT vuoto.")
                    continue
                logging.info(f"[Subs] Traduzione {actual_source} -> {target} (id={video_id})...")
                tr_segments = translate_segments(segments, actual_source, target)
                full_t_vtt, db_t_vtt = _get_subtitle_paths(relative_path, category_name, target)
                write_vtt(tr_segments, full_t_vtt)
                _mark_row(conn, r['id'], 'completato',
                          percorso_file=db_t_vtt, modello=model_name)
                logging.info(f"[Subs] Traduzione {target} completata (id={video_id}).")
            except Exception as e_tr:
                logging.error(f"[Subs] Traduzione {target} fallita (id={video_id}): {e_tr}")
                _mark_row(conn, r['id'], 'errore', errore=str(e_tr))

        logging.info(f"[Subs] Job video id={video_id} completato.")
        return True

    except subprocess.CalledProcessError as e:
        msg = f"ffmpeg fallito: {e.stderr[:200] if e.stderr else e}"
        logging.error(f"[Subs] {msg} (id={video_id})")
        _fail_video_rows(conn, video_id, msg)
        return True
    except Exception as e:
        logging.error(f"[Subs] Errore generazione id={video_id}: {e}")
        _fail_video_rows(conn, video_id, str(e))
        return True
    finally:
        if wav_path and os.path.exists(wav_path):
            try:
                os.remove(wav_path)
            except OSError:
                pass


def _finalize_transcription_row(conn, video_id, trans_row, actual_source, db_src_vtt, model_name):
    """
    Completa la riga di trascrizione. Gestisce il caso 'auto': la riga ha
    `lingua` = 'auto' (placeholder) e va riscritta col codice rilevato. Se esiste
    gia' un'altra riga con quella `lingua` (es. l'admin aveva chiesto anche la
    traduzione nella lingua poi rivelatasi quella parlata), evita il conflitto
    UNIQUE(id_Video, lingua): assegna la trascrizione a quella riga e rimuove
    il placeholder 'auto'.
    """
    if trans_row['lingua'] == actual_source:
        _mark_row(conn, trans_row['id'], 'completato',
                  percorso_file=db_src_vtt, modello=model_name)
        return

    # lingua diversa (tipicamente 'auto'): cerca collisione.
    with conn.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT id FROM Sottotitoli WHERE id_Video = %s AND lingua = %s AND id != %s LIMIT 1",
            (video_id, actual_source, trans_row['id'])
        )
        clash = cursor.fetchone()

    if clash:
        # Riusa la riga esistente come portatrice della trascrizione, elimina il placeholder.
        _mark_row(conn, clash['id'], 'completato',
                  percorso_file=db_src_vtt, modello=model_name)
        with conn.cursor() as cursor:
            cursor.execute("DELETE FROM Sottotitoli WHERE id = %s", (trans_row['id'],))
    else:
        _mark_row(conn, trans_row['id'], 'completato',
                  percorso_file=db_src_vtt, lingua=actual_source, modello=model_name)


# ============================================================================
# Discovery sottotitoli manuali (file .vtt/.srt messi a mano nel filesystem)
# ============================================================================
def discover_manual_subtitles(conn):
    """
    Scansiona /percorsoVideo e importa i sottotitoli messi a mano dall'utente:
    file .vtt o .srt accanto al video oppure nella cartella sottotitoli_<categoria>,
    con nome <stem_video>[.<lingua>].(vtt|srt). Per ogni lingua non ancora presente
    crea una riga Sottotitoli 'completato'. I .srt vengono convertiti in .vtt.
    """
    # 1. Indice dei video per cartella: parent_rel -> [(stem, id)]
    by_parent = {}
    langs_by_id = {}
    try:
        with conn.cursor(dictionary=True) as cur:
            cur.execute("SELECT id, percorso_file FROM Video")
            vids = cur.fetchall()
    except Exception as e:
        logging.warning(f"[Discovery] lettura Video fallita: {e}")
        return
    if not vids:
        return
    for r in vids:
        p = Path(r['percorso_file'])
        parent = p.parent.as_posix()
        parent = '' if parent == '.' else parent
        by_parent.setdefault(parent, []).append((p.stem, r['id']))
        langs_by_id[r['id']] = set()

    # 2. Lingue gia' COMPLETATE: solo queste sono intoccabili. Le lingue con
    #    riga 'in_coda'/'elaborazione'/'errore' NON bloccano l'import: un file
    #    manuale per una lingua il cui job automatico e' fallito (o in attesa)
    #    deve poter vincere e sbloccare la situazione.
    with conn.cursor(dictionary=True) as cur:
        cur.execute("SELECT id_Video, lingua FROM Sottotitoli WHERE stato = 'completato'")
        for r in cur.fetchall():
            if r['id_Video'] in langs_by_id:
                langs_by_id[r['id_Video']].add((r['lingua'] or '').lower())

    imported = 0
    for root, dirs, files in os.walk(PATH_TO_MONITOR):
        base = os.path.basename(root)
        # Un .vtt puo' stare nella cartella del video o in sottotitoli_<x>: in
        # entrambi i casi il video di riferimento sta nella cartella "padre".
        video_dir = os.path.dirname(root) if base.startswith('sottotitoli_') else root
        rel_parent = os.path.relpath(video_dir, PATH_TO_MONITOR).replace('\\', '/')
        rel_parent = '' if rel_parent == '.' else rel_parent
        candidates = by_parent.get(rel_parent)
        if not candidates:
            continue

        for f in files:
            low = f.lower()
            if not low.endswith(SUB_EXTENSIONS):
                continue
            name = f[:-4]

            # Match col video il cui stem combacia (preferisci lo stem piu' lungo).
            matched = None
            for stem, vid in candidates:
                if name == stem or name.startswith(stem + '.'):
                    if matched is None or len(stem) > len(matched[0]):
                        matched = (stem, vid)
            if not matched:
                continue
            stem, vid = matched

            lang = subs_common.lang_from_name(name, stem)
            if lang in langs_by_id.get(vid, set()):
                continue  # lingua gia' presente: non sovrascrivere

            full_src = os.path.join(root, f)
            if not _validate_under_base(full_src):
                continue

            # Determina il .vtt finale (convertendo l'eventuale .srt) tramite il
            # modulo condiviso, cosi' la logica e' identica a quella del watcher.
            db_rel = subs_common._materialize_vtt(full_src, PATH_TO_MONITOR, logging)
            if db_rel is None:
                continue

            try:
                # override=True: il file manuale vince e sblocca eventuali righe
                # 'errore'/'in_coda'. Le lingue gia' 'completato' sono escluse a
                # monte (langs_by_id), quindi niente re-import a vuoto delle righe ok.
                subs_common.register_subtitle_row(conn, vid, lang, db_rel, override=True)
                langs_by_id.setdefault(vid, set()).add(lang)
                imported += 1
                logging.info(f"[Discovery] Sottotitolo manuale importato: video={vid} lingua={lang} file={db_rel}")
            except Exception as e:
                logging.warning(f"[Discovery] insert fallita (video={vid}, lingua={lang}): {e}")

    if imported:
        logging.info(f"[Discovery] {imported} sottotitolo/i manuale/i importato/i.")
        # Aggiorna la UI: nuove lingue disponibili nel player.
        invalidate_videos_and_categories(reason=f"discovery {imported} sottotitoli manuali")


# ============================================================================
# Entrypoint
# ============================================================================
if __name__ == "__main__":
    # umask 0: le cartelle/file creati ereditano i permessi richiesti (0o777/0o666)
    # senza che la umask di default (022) tolga la scrittura a gruppo/altri. Serve
    # perche' i .vtt finiscono in dir che su alcuni mount appartengono ad altro uid.
    os.umask(0)
    logging.info("--- Avvio Worker Sottotitoli (faster-whisper) ---")
    if not all([DB_HOST, DB_USER, DB_PASS, DB_NAME]):
        logging.critical("Variabili d'ambiente del database non impostate!")
        sys.exit(1)

    logging.info(f"Architettura: {platform.machine()} | LibreTranslate: {LIBRETRANSLATE_URL}")

    conn = None
    idle_streak = 0
    last_discovery = 0.0
    while True:
        work_done = False
        try:
            if conn is None or not conn.is_connected():
                conn = get_db_connection()

            # Discovery periodica dei sottotitoli messi a mano nel filesystem.
            now = time.time()
            if now - last_discovery >= DISCOVERY_INTERVAL:
                try:
                    discover_manual_subtitles(conn)
                except Exception as e:
                    logging.warning(f"[Discovery] errore scansione: {e}")
                last_discovery = now

            model_name = fetch_whisper_model_name(conn)
            work_done = process_jobs(conn, model_name)
        except mysql.connector.Error as err:
            logging.error(f"Errore DB nel loop: {err}")
            try:
                if conn: conn.close()
            except Exception:
                pass
            conn = None
        except KeyboardInterrupt:
            logging.info("Arresto worker sottotitoli...")
            break
        except Exception as e:
            logging.error(f"Errore non gestito nel loop: {e}")

        if work_done:
            idle_streak = 0
            time.sleep(1)
        else:
            idle_streak = min(idle_streak + 1, 6)
            sleep_for = min(POLL_INTERVAL * (2 ** (idle_streak - 1)), BACKOFF_MAX)
            time.sleep(sleep_for)
