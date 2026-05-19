# worker_optimizer.py
# ----------------------------------------------------------------------------
# Worker "Lento" — Ottimizzazione cross-device dei video tramite REMUX puro
# (fMP4 faststart). Niente transcodifica video, mai. Audio ricodificato solo
# se non compatibile con iOS (Opus/Vorbis/FLAC/DTS → AAC).
#
# OBIETTIVO:
#   Ogni video nella libreria diventa un .mp4 fMP4 faststart, cioè:
#   - container MP4 (iOS-friendly, demuxer disponibile ovunque)
#   - moov atom all'inizio del file (faststart) → play parte istantaneo
#   - frammentato internamente (frag_keyframe + empty_moov + default_base_moof)
#     → permette Range-streaming chunked stile YouTube senza scaricare prima
#     l'intero indice del file.
#
# PROCEDURA per ogni video con `ottimizzato IS NULL`:
#   1. ffprobe → estrai codec_video, codec_audio, container
#   2. Branching:
#      - codec_video ∈ {h264, hevc} AND codec_audio ∈ {aac, ac3, eac3}
#           → ffmpeg -c:v copy -c:a copy   (remux puro, secondi)
#      - codec_video ∈ {h264, hevc} AND codec_audio ∉ {...}
#           → ffmpeg -c:v copy -c:a aac -b:a 192k   (re-encode SOLO audio)
#      - container già MP4 fMP4 faststart valido AND codec ok
#           → marca ottimizzato=1 senza toccare il file
#      - codec_video ∉ {h264, hevc}  (VP9, AV1, MPEG-4 ASP, ecc.)
#           → ottimizzato = 0 (impossibile senza transcodifica video)
#             il file resta servito così com'è; iOS mostrerà avviso.
#   3. Se è stato prodotto un nuovo .mp4:
#      - aggiorno DB: percorso_file = nuovo .mp4, ottimizzato=1, codec_*, ottimizzato_at=NOW()
#      - rinomino l'originale in <stem>.bak.<ts><ext> (NON cancellato)
#      - segno cleanup_path / cleanup_at = NOW() + 24h
#   4. Cleanup pass (ad ogni iterazione, prima del lavoro nuovo):
#      - cerca cleanup_at < NOW(), cancella il file fisico, azzera le colonne.
#
# SICUREZZA:
#   - Validazione path tramite realpath() + prefix di PATH_TO_MONITOR.
#   - Niente shell, ffmpeg/ffprobe via lista args.
#   - Lock atomico via Video.locked_at (riusato da worker_assets).
#   - Disk-space check pre-remux: serve almeno 1.2x della size del sorgente.
#
# PERFORMANCE su Raspberry Pi 4:
#   - Remux -c copy: I/O-bound, CPU ~5-15%. Anche 4GB in ~2-3 min.
#   - Re-encode audio: ~10-20% CPU per ~30s su un video da 1h.
# ----------------------------------------------------------------------------

import sys
import os
import time
import json
import logging
import platform
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

import mysql.connector

from cache_invalidation import invalidate_videos_only

# --- Impostazioni ---
PATH_TO_MONITOR = os.environ.get('WATCH_DIR', '/percorsoVideo')
DB_HOST = os.environ.get('MYSQL_HOST', 'mysql')
DB_USER = os.environ.get('MYSQL_USER')
DB_PASS = os.environ.get('MYSQL_PASSWORD')
DB_NAME = os.environ.get('MYSQL_DATABASE')

POLL_INTERVAL = int(os.environ.get('OPTIMIZER_POLL_INTERVAL', '30'))
BACKOFF_MAX = int(os.environ.get('OPTIMIZER_BACKOFF_MAX', '300'))
CLEANUP_GRACE_HOURS = int(os.environ.get('OPTIMIZER_CLEANUP_HOURS', '24'))
STABILITY_CHECK_TIME = 2
FFPROBE_TIMEOUT = 30
# Remux può essere lungo su 4K HEVC da 8GB su SD card. 30min è un cap di sicurezza.
FFMPEG_REMUX_TIMEOUT = int(os.environ.get('OPTIMIZER_REMUX_TIMEOUT', '1800'))
FFMPEG_AUDIO_TIMEOUT = int(os.environ.get('OPTIMIZER_AUDIO_TIMEOUT', '600'))

_IS_ARM = platform.machine().lower().startswith(('arm', 'aarch'))

# Codec video compatibili nativamente con iOS Safari + Chrome + Firefox + Edge.
COMPATIBLE_VIDEO_CODECS = {'h264', 'hevc', 'h265'}
# Codec audio supportati da iOS (AAC universale, AC-3/E-AC-3 dal iOS 9).
COMPATIBLE_AUDIO_CODECS = {'aac', 'ac3', 'eac3'}

# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [Worker-Optimizer] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)],
)


# --- DB ---
def get_db_connection():
    while True:
        try:
            return mysql.connector.connect(
                host=DB_HOST, user=DB_USER, password=DB_PASS,
                database=DB_NAME, autocommit=True,
            )
        except mysql.connector.Error as err:
            logging.warning(f"DB connection retry: {err}")
            time.sleep(5)


# --- Path safety ---
def _is_path_inside_base(full_path):
    try:
        full_real = os.path.realpath(full_path)
        base_real = os.path.realpath(PATH_TO_MONITOR)
        return full_real == base_real or full_real.startswith(base_real + os.sep)
    except OSError:
        return False


# --- ffprobe wrapper ---
def probe_codecs(full_path):
    """
    Ritorna (codec_video, codec_audio, container_name, duration_sec) o None.
    codec_video / codec_audio in lowercase; None se la traccia manca.
    """
    if not _is_path_inside_base(full_path) or os.path.islink(full_path):
        logging.warning(f"[SECURITY] Path rifiutato: {full_path}")
        return None

    try:
        size1 = os.path.getsize(full_path)
        time.sleep(STABILITY_CHECK_TIME)
        size2 = os.path.getsize(full_path)
        if size1 != size2:
            return None

        cmd = [
            'ffprobe', '-v', 'quiet', '-print_format', 'json',
            '-show_format', '-show_streams', full_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True,
                                check=True, timeout=FFPROBE_TIMEOUT)
        data = json.loads(result.stdout)

        v_codec, a_codec, height = None, None, None
        for s in data.get('streams', []):
            if s.get('codec_type') == 'video' and v_codec is None:
                v_codec = (s.get('codec_name') or '').lower()
                height = s.get('height')
            elif s.get('codec_type') == 'audio' and a_codec is None:
                a_codec = (s.get('codec_name') or '').lower()

        fmt = data.get('format', {})
        container = (fmt.get('format_name') or '').lower()
        duration = float(fmt.get('duration', 0)) if fmt.get('duration') else 0
        return v_codec, a_codec, container, duration, height

    except subprocess.TimeoutExpired:
        logging.error(f"ffprobe TIMEOUT su {full_path}")
        return None
    except Exception as e:
        logging.error(f"ffprobe errore su {full_path}: {e}")
        return None


# --- Disk space check ---
def has_enough_space(source_path, factor=1.2):
    """Verifica che la partizione abbia almeno `factor` volte la size del sorgente."""
    try:
        src_size = os.path.getsize(source_path)
        stat = shutil.disk_usage(os.path.dirname(source_path))
        return stat.free > src_size * factor
    except OSError:
        return False


# --- Remux core ---
def remux_to_fmp4(source_path, dest_path, copy_audio=True, v_codec=None):
    """
    Lancia ffmpeg per produrre un fMP4 faststart.
    copy_audio=False → re-encode audio in AAC 192k (per Opus/Vorbis/FLAC/DTS).
    v_codec → codec video (per scegliere il codec_tag corretto).
    Ritorna True/False.

    Note movflags:
      +faststart                  → moov all'inizio (richiede secondo pass interno)
      +frag_keyframe              → frammenta ad ogni keyframe (Range chunked)
      +empty_moov                 → moov vuoto iniziale (compatibile MSE)
      +default_base_moof          → offset relativi (più robusto per HTTP Range)

    CODEC TAGS (cruciale per Safari iOS):
      HEVC → 'hvc1' (Apple flavor) anziché 'hev1' (default standard MPEG).
             Senza questo, iPhone Safari rifiuta SILENZIOSAMENTE i video HEVC
             (player nero, nessun messaggio errore).
      H.264 → 'avc1' (default già corretto, ma esplicito per chiarezza).
    """
    audio_args = ['-c:a', 'copy'] if copy_audio else ['-c:a', 'aac', '-b:a', '192k']

    # Imposta il codec tag corretto in base al codec video.
    video_tag_args = []
    if v_codec in ('hevc', 'h265'):
        video_tag_args = ['-tag:v', 'hvc1']
    elif v_codec == 'h264':
        video_tag_args = ['-tag:v', 'avc1']

    cmd = [
        'ffmpeg', '-v', 'error', '-y',
        '-i', source_path,
        '-c:v', 'copy',
        *video_tag_args,
        *audio_args,
        '-movflags', '+faststart',
        # Mantiene tutti gli stream video/audio principali; scarta dati extra
        # tipici degli MKV (capitoli, allegati, sottotitoli non-mov_text) che
        # MP4 non supporta o gestisce diversamente.
        '-map', '0:v:0', '-map', '0:a:0?',
        # Sottotitoli soft: copia solo se già mov_text (subrip→mov_text richiede transcode).
        '-f', 'mp4',
        dest_path,
    ]
    timeout = FFMPEG_REMUX_TIMEOUT if copy_audio else FFMPEG_AUDIO_TIMEOUT
    try:
        logging.info(f"ffmpeg {'remux' if copy_audio else 'audio re-encode'} → {dest_path}")
        result = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=timeout)
        if result.returncode != 0:
            logging.error(f"ffmpeg ha fallito (rc={result.returncode}): {result.stderr[:500]}")
            return False
        return True
    except subprocess.TimeoutExpired:
        logging.error(f"ffmpeg TIMEOUT su {source_path}")
        return False
    except Exception as e:
        logging.error(f"ffmpeg eccezione su {source_path}: {e}")
        return False


# --- Migrazione idempotente ---
def _ensure_column(conn, table_name, column_name, column_type):
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s",
                (table_name, column_name),
            )
            if cursor.fetchone()[0] > 0:
                return
            if not all(c.isalnum() or c == '_' for c in table_name):
                return
            if not all(c.isalnum() or c == '_' for c in column_name):
                return
            cursor.execute(f"ALTER TABLE `{table_name}` ADD COLUMN `{column_name}` {column_type}")
            logging.info(f"Migrazione: aggiunta colonna {table_name}.{column_name}")
    except Exception as e:
        logging.warning(f"_ensure_column({table_name}.{column_name}) skip: {e}")


def _ensure_schema(conn):
    _ensure_column(conn, 'Video', 'locked_at',      'DATETIME NULL')
    _ensure_column(conn, 'Video', 'ottimizzato',    'TINYINT NULL')
    _ensure_column(conn, 'Video', 'ottimizzato_at', 'DATETIME NULL')
    _ensure_column(conn, 'Video', 'codec_video',    'VARCHAR(32) NULL')
    _ensure_column(conn, 'Video', 'codec_audio',    'VARCHAR(32) NULL')
    _ensure_column(conn, 'Video', 'altezza_video',  'INT NULL')
    _ensure_column(conn, 'Video', 'cleanup_path',   'VARCHAR(500) NULL')
    _ensure_column(conn, 'Video', 'cleanup_at',     'DATETIME NULL')


# --- Cleanup pass ---
def cleanup_expired_originals(conn):
    """
    Cancella i file originali rinominati la cui finestra di grazia è scaduta.
    Idempotente: se il file non esiste già, azzera comunque le colonne.
    """
    try:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT id, cleanup_path FROM Video "
                "WHERE cleanup_at IS NOT NULL AND cleanup_at < NOW() "
                "LIMIT 20"
            )
            rows = cursor.fetchall()

        for r in rows:
            rel = r['cleanup_path']
            if not rel:
                continue
            full = os.path.join(PATH_TO_MONITOR, rel)
            # Difesa in profondità: non cancelliamo nulla che non sia dentro la base.
            if not _is_path_inside_base(full):
                logging.warning(f"[CLEANUP][SECURITY] Path fuori base, skip: {rel}")
            else:
                try:
                    if os.path.isfile(full):
                        os.remove(full)
                        logging.info(f"[CLEANUP] Originale rimosso: {rel}")
                except OSError as e:
                    logging.warning(f"[CLEANUP] Rimozione fallita {rel}: {e}")

            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE Video SET cleanup_path = NULL, cleanup_at = NULL WHERE id = %s",
                    (r['id'],),
                )
    except Exception as e:
        logging.error(f"[CLEANUP] errore generale: {e}")


# --- Job principale: ottimizza UN video ---
def claim_next_candidate(conn):
    """Claim atomico via Video.locked_at, ritorna il record completo o None."""
    # Libera lock abbandonati (>30 min: remux può durare a lungo su Pi).
    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE Video SET locked_at = NULL "
            "WHERE locked_at IS NOT NULL AND locked_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)"
        )

    # Candidato: video mai analizzato, asset già pronti (per non rallentare la
    # generazione anteprime/copertine del worker_assets).
    with conn.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT id FROM Video "
            "WHERE ottimizzato IS NULL AND locked_at IS NULL "
            "  AND percorso_copertina IS NOT NULL AND percorso_anteprima IS NOT NULL "
            "ORDER BY id ASC LIMIT 1"
        )
        candidate = cursor.fetchone()
    if not candidate:
        return None

    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE Video SET locked_at = NOW() WHERE id = %s AND locked_at IS NULL",
            (candidate['id'],),
        )
        if cursor.rowcount == 0:
            return None  # Race persa con un altro worker, riprova al giro dopo.

    with conn.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT id, percorso_file FROM Video WHERE id = %s",
            (candidate['id'],),
        )
        return cursor.fetchone()


def release_lock(conn, video_id):
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE Video SET locked_at = NULL WHERE id = %s",
                (video_id,),
            )
    except Exception:
        pass


def mark_incompatible(conn, video_id, v_codec, a_codec, height):
    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE Video SET ottimizzato = 0, ottimizzato_at = NOW(), "
            "codec_video = %s, codec_audio = %s, altezza_video = %s, locked_at = NULL "
            "WHERE id = %s",
            (v_codec, a_codec, height, video_id),
        )


def mark_already_good(conn, video_id, v_codec, a_codec, height):
    """File già in formato compatibile ma non necessariamente fMP4: marca solo metadata."""
    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE Video SET ottimizzato = 1, ottimizzato_at = NOW(), "
            "codec_video = %s, codec_audio = %s, altezza_video = %s, locked_at = NULL "
            "WHERE id = %s",
            (v_codec, a_codec, height, video_id),
        )


def commit_remux(conn, video_id, new_rel_path, original_rel_path, v_codec, a_codec, height):
    """
    Commit atomico post-remux:
      - percorso_file = nuovo .mp4
      - ottimizzato = 1, codec_*, altezza_video, ottimizzato_at = NOW()
      - cleanup_path = file originale rinominato
      - cleanup_at   = NOW() + 24h
    """
    grace_hours = CLEANUP_GRACE_HOURS
    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE Video SET "
            "  percorso_file = %s, "
            "  ottimizzato = 1, "
            "  ottimizzato_at = NOW(), "
            "  codec_video = %s, "
            "  codec_audio = %s, "
            "  altezza_video = %s, "
            "  cleanup_path = %s, "
            "  cleanup_at = DATE_ADD(NOW(), INTERVAL %s HOUR), "
            "  locked_at = NULL "
            "WHERE id = %s",
            (new_rel_path, v_codec, a_codec, height, original_rel_path, grace_hours, video_id),
        )


def process_one_video(conn):
    """Ritorna True se un lavoro è stato fatto (anche fallito), False se la coda è vuota."""
    job = claim_next_candidate(conn)
    if not job:
        return False

    video_id = job['id']
    rel = job['percorso_file']
    full = os.path.join(PATH_TO_MONITOR, rel)

    if not os.path.isfile(full):
        logging.warning(f"[ID {video_id}] File mancante: {rel}. Marco ottimizzato=0.")
        mark_incompatible(conn, video_id, None, None, None)
        return True

    probe = probe_codecs(full)
    if probe is None:
        logging.warning(f"[ID {video_id}] ffprobe fallito. Rilascio lock per retry.")
        release_lock(conn, video_id)
        return True

    v_codec, a_codec, container, _duration, height = probe
    logging.info(f"[ID {video_id}] codec_video={v_codec} codec_audio={a_codec} container={container} height={height}")

    # Caso 1: codec video incompatibile → impossibile senza transcodifica.
    if v_codec not in COMPATIBLE_VIDEO_CODECS:
        logging.info(f"[ID {video_id}] Codec video {v_codec} non compatibile. Marco ottimizzato=0.")
        mark_incompatible(conn, video_id, v_codec, a_codec, height)
        return True

    # Caso 2: già MP4 con codec ok → consideralo ottimizzato senza toccarlo.
    # Heuristica: il container ffprobe riporta "mov,mp4,m4a,..." per MP4.
    is_mp4_container = 'mp4' in container or container.startswith('mov,')
    needs_audio_reencode = a_codec not in COMPATIBLE_AUDIO_CODECS if a_codec else False

    if is_mp4_container and not needs_audio_reencode:
        # Già MP4 + codec ok. Non rifrazioniamo (sarebbe costoso e inutile su Pi
        # per file potenzialmente già faststart). Marchiamo come ottimizzato.
        logging.info(f"[ID {video_id}] Già MP4 con codec compatibili: marco ottimizzato=1.")
        mark_already_good(conn, video_id, v_codec, a_codec, height)
        return True

    # Caso 3: serve remux (container != mp4, oppure audio non compatibile).
    if not has_enough_space(full, factor=1.2):
        logging.warning(f"[ID {video_id}] Spazio disco insufficiente per remux. Rilascio lock.")
        release_lock(conn, video_id)
        return True

    src_path = Path(rel)
    new_rel = (src_path.parent / f"{src_path.stem}.mp4").as_posix()
    new_full = os.path.join(PATH_TO_MONITOR, new_rel)

    # Se il nuovo file esiste già (rerun parziale): rimuovilo.
    if os.path.exists(new_full) and new_full != full:
        try:
            os.remove(new_full)
        except OSError:
            pass

    # Se per caso il container era già .mp4 ma serve audio re-encode, il nome
    # del nuovo file colliderebbe con l'originale: usiamo un nome intermedio.
    if os.path.abspath(new_full) == os.path.abspath(full):
        new_rel = (src_path.parent / f"{src_path.stem}.opt.mp4").as_posix()
        new_full = os.path.join(PATH_TO_MONITOR, new_rel)

    success = remux_to_fmp4(full, new_full, copy_audio=not needs_audio_reencode, v_codec=v_codec)
    if not success:
        # Cleanup output parziale.
        try:
            if os.path.exists(new_full):
                os.remove(new_full)
        except OSError:
            pass
        logging.error(f"[ID {video_id}] Remux fallito. Marco ottimizzato=0 (fallback).")
        mark_incompatible(conn, video_id, v_codec, a_codec, height)
        return True

    # Rinomina l'originale per il cleanup ritardato (failsafe 24h).
    ts = int(time.time())
    backup_rel = (src_path.parent / f"{src_path.stem}.bak.{ts}{src_path.suffix}").as_posix()
    backup_full = os.path.join(PATH_TO_MONITOR, backup_rel)

    try:
        os.rename(full, backup_full)
    except OSError as e:
        # Rinomina fallita: rollback del file remuxato.
        logging.error(f"[ID {video_id}] Impossibile rinominare originale: {e}. Rollback.")
        try:
            os.remove(new_full)
        except OSError:
            pass
        release_lock(conn, video_id)
        return True

    # Nuovi codec (post-remux audio re-encode l'audio diventa aac).
    final_a_codec = 'aac' if needs_audio_reencode else a_codec
    commit_remux(conn, video_id, new_rel, backup_rel, v_codec, final_a_codec, height)
    invalidate_videos_only(reason=f"remux video id={video_id}")
    logging.info(f"[ID {video_id}] ✅ Ottimizzato. Originale → {backup_rel} (cleanup in {CLEANUP_GRACE_HOURS}h)")
    return True


# --- Main loop ---
if __name__ == '__main__':
    logging.info("--- Avvio Worker Optimizer (remux fMP4 faststart) ---")
    if not all([DB_HOST, DB_USER, DB_PASS, DB_NAME]):
        logging.critical("Variabili d'ambiente DB mancanti.")
        sys.exit(1)

    conn = None
    idle_streak = 0

    while True:
        try:
            if conn is None or not conn.is_connected():
                conn = get_db_connection()
                _ensure_schema(conn)

            # Step 1: cleanup pass (poco costoso, fa partire eventuali cancellazioni scadute).
            cleanup_expired_originals(conn)

            # Step 2: lavoro principale.
            did_work = process_one_video(conn)

            if did_work:
                idle_streak = 0
                time.sleep(2)
            else:
                idle_streak = min(idle_streak + 1, 6)
                sleep_for = min(POLL_INTERVAL * (2 ** (idle_streak - 1)), BACKOFF_MAX)
                logging.info(f"Nessun lavoro. Attendo {sleep_for}s.")
                time.sleep(sleep_for)

        except mysql.connector.Error as db_err:
            logging.warning(f"DB error: {db_err}. Reconnect in 5s.")
            try:
                if conn:
                    conn.close()
            except Exception:
                pass
            conn = None
            time.sleep(5)
        except KeyboardInterrupt:
            logging.info("Arresto worker optimizer.")
            try:
                if conn:
                    conn.close()
            except Exception:
                pass
            break
        except Exception as e:
            logging.error(f"Eccezione non gestita: {e}")
            time.sleep(5)
