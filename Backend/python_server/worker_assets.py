# worker_assets.py
# (Worker "Lento" per Copertine e Anteprime)

import sys
import time
import logging
import os
import platform
import mysql.connector
from mysql.connector import errorcode
import subprocess
import json
from pathlib import Path
from datetime import datetime

from cache_invalidation import invalidate_videos_only

# --- Impostazioni ---
PATH_TO_MONITOR = os.environ.get('WATCH_DIR', '/percorsoVideo')
DB_HOST = os.environ.get('MYSQL_HOST', 'mysql')
DB_USER = os.environ.get('MYSQL_USER')
DB_PASS = os.environ.get('MYSQL_PASSWORD')
DB_NAME = os.environ.get('MYSQL_DATABASE')
POLL_INTERVAL = int(os.environ.get('WORKER_POLL_INTERVAL', '10'))
STABILITY_CHECK_TIME = 2

# Adatta i preset ffmpeg all'architettura: su ARM (Raspberry) usiamo 'ultrafast'
# per non saturare la CPU; su x86 più potente teniamo 'fast' per qualità migliore.
_IS_ARM = platform.machine().lower().startswith(('arm', 'aarch'))
FFMPEG_PRESET = os.environ.get('FFMPEG_PRESET', 'ultrafast' if _IS_ARM else 'fast')
FFMPEG_PREVIEW_TIMEOUT = int(os.environ.get('FFMPEG_PREVIEW_TIMEOUT', '60' if _IS_ARM else '120'))
FFMPEG_COVER_TIMEOUT = int(os.environ.get('FFMPEG_COVER_TIMEOUT', '20' if _IS_ARM else '30'))

# --- Configurazione Logging ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [Worker-Asset] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)]
)

# --- Connessione DB ---
def get_db_connection():
    while True:
        try:
            conn = mysql.connector.connect(
                host=DB_HOST,
                user=DB_USER,
                password=DB_PASS,
                database=DB_NAME,
                autocommit=True
            )
            return conn
        except mysql.connector.Error as err:
            if err.errno == 2003: 
                logging.warning("Connessione al DB rifiutata. Riprovo tra 5s...")
                time.sleep(5)
            else:
                logging.error(f"Errore di connessione DB: {err}")
                time.sleep(10)

# --- Funzioni di Supporto ---

def fetch_settings(conn):
    """
    Carica le impostazioni (minutaggi, durate) dal DB.
    """
    settings = {}
    try:
        if not conn or not conn.is_connected():
            conn = get_db_connection()
            
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT Chiave_Impostazione, Valore_Impostazione FROM Impostazioni")
            results = cursor.fetchall()
            for row in results:
                settings[row['Chiave_Impostazione']] = row['Valore_Impostazione']
            logging.info("Impostazioni caricate dal database.")
            
            settings['default_Minutaggio_Copertina'] = float(settings.get('default_Minutaggio_Copertina', 1))
            settings['default_Minutaggio_Anteprima'] = float(settings.get('default_Minutaggio_Anteprima', 2))
            settings['durata_Anteprima'] = int(settings.get('durata_Anteprima', 10))
            return settings
    except Exception as e:
        logging.error(f"Impossibile caricare le impostazioni dal DB: {e}. Uso valori di default.")
        return {
            'default_Minutaggio_Copertina': 1.0,
            'default_Minutaggio_Anteprima': 2.0,
            'durata_Anteprima': 10
        }

def get_video_metadata(full_path):
    """
    Estrae solo la durata in secondi (serve per i controlli).
    """
    global STABILITY_CHECK_TIME
    try:
        size1 = os.path.getsize(full_path)
        time.sleep(STABILITY_CHECK_TIME)
        size2 = os.path.getsize(full_path)

        if size1 != size2:
            return None 

        # Hardening: rifiuta path fuori base e symlink.
        try:
            full_real = os.path.realpath(full_path)
            base_real = os.path.realpath(PATH_TO_MONITOR)
            if not (full_real == base_real or full_real.startswith(base_real + os.sep)):
                logging.warning(f"[SECURITY] Path fuori base in worker_assets: {full_path}")
                return None
            if os.path.islink(full_path):
                logging.warning(f"[SECURITY] Symlink ignorato in worker_assets: {full_path}")
                return None
        except OSError:
            return None

        command = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", full_path
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=20)
        metadata = json.loads(result.stdout)
        
        duration_sec = float(metadata['format']['duration'])
        return duration_sec

    except Exception:
        return None

def _get_asset_paths(relative_path, category_name):
    """
    Costruisce i percorsi per copertina e anteprima.
    """
    p = Path(relative_path)
    parent_dir = p.parent
    video_stem = p.stem 

    # Usa la logica del PROMPT (es. Anteprime_Categoria 1)
    # ma rinominata per coerenza (es. anteprime_NomeCategoria)
    db_cover_path = (parent_dir / f"copertine_{category_name}" / f"{video_stem}.jpg").as_posix()
    db_preview_path = (parent_dir / f"anteprime_{category_name}" / f"{video_stem}.mp4").as_posix()

    full_cover_path = os.path.join(PATH_TO_MONITOR, db_cover_path)
    full_preview_path = os.path.join(PATH_TO_MONITOR, db_preview_path)
    
    return full_cover_path, db_cover_path, full_preview_path, db_preview_path

def get_low_priority_prefix():
    prefix = []
    if sys.platform != 'win32':
        import shutil
        if shutil.which('nice'):
            prefix.extend(['nice', '-n', '19'])
        if shutil.which('ionice'):
            prefix.extend(['ionice', '-c', '3'])
    return prefix

def generate_cover(full_video_path, full_cover_path, start_min, video_duration_sec):
    """
    Genera copertina (ffmpeg).
    """
    start_time_sec = start_min * 60
    
    # Controllo durata (come da specifiche) 
    if start_time_sec > video_duration_sec:
        logging.warning(f"Minutaggio copertina ({start_min}m) supera durata video. Uso metà video.")
        start_time_sec = video_duration_sec / 2
        
    os.makedirs(Path(full_cover_path).parent, exist_ok=True)
    
    # NB: usiamo path già validati a monte (process_missing_assets). ffmpeg non
    # supporta "--" come terminatore opzioni, ma essendo argomenti passati come
    # lista (no shell), un nome file che inizia con "-" non causa injection,
    # al massimo viene interpretato come flag; previeniamo a monte rifiutando
    # file con prefisso "-" nella validazione del path.
    command = get_low_priority_prefix() + [
        "ffmpeg",
        "-ss", str(start_time_sec), "-i", full_video_path,
        "-vframes", "1", "-q:v", "2", "-y", full_cover_path
    ]
    
    try:
        logging.info(f"Generazione copertina per: {full_cover_path}")
        subprocess.run(command, capture_output=True, text=True, check=True, timeout=FFMPEG_COVER_TIMEOUT)
        return True
    except Exception as e:
        logging.error(f"Fallita generazione copertina: {e}")
        return False

def generate_preview(full_video_path, full_preview_path, start_min, duration_sec, video_duration_sec):
    """
    Genera anteprima (ffmpeg) in 480p .
    """
    start_time_sec = start_min * 60
    
    # Controllo durata (come da specifiche) 
    if start_time_sec > video_duration_sec:
        logging.warning(f"Minutaggio anteprima ({start_min}m) supera durata video. Uso metà video.")
        start_time_sec = video_duration_sec / 2
        
    os.makedirs(Path(full_preview_path).parent, exist_ok=True)

    command = get_low_priority_prefix() + [
        "ffmpeg",
        "-ss", str(start_time_sec), "-i", full_video_path,
        "-t", str(duration_sec), 
        "-vf", "scale=-2:480", # Risoluzione 480p 
        "-c:v", "libx264",
        "-preset", FFMPEG_PRESET,
        "-threads", "1", # Limita a 1 thread su RPi4 per preservare risorse
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", 
        "-an", # Rimuove audio (non specificato, ma ottimizza)
        "-y", full_preview_path
    ]
    
    try:
        logging.info(f"Generazione anteprima per: {full_preview_path}")
        subprocess.run(command, capture_output=True, text=True, check=True, timeout=FFMPEG_PREVIEW_TIMEOUT)
        return True
    except Exception as e:
        logging.error(f"Fallita generazione anteprima: {e}")
        return False

# --- Migrazione idempotente: aggiunge colonna locked_at se mancante ---
def _ensure_lock_column(conn, table_name='Video', column_name='locked_at'):
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s",
                (table_name, column_name)
            )
            exists = cursor.fetchone()[0] > 0
            if not exists:
                if not all(c.isalnum() or c == '_' for c in table_name): return
                if not all(c.isalnum() or c == '_' for c in column_name): return
                cursor.execute(f"ALTER TABLE `{table_name}` ADD COLUMN `{column_name}` DATETIME NULL")
                logging.info(f"Migrazione: aggiunta colonna {table_name}.{column_name}")
    except Exception as e:
        logging.warning(f"_ensure_lock_column({table_name}.{column_name}) skip: {e}")


# --- Funzione Principale (Solo Asset) ---
def process_missing_assets(conn, settings):
    """
    Cerca UN video a cui mancano asset e li genera.
    Restituisce True se un lavoro è stato fatto, altrimenti False.

    Claim atomico: usa Video.locked_at per evitare che due worker paralleli
    elaborino lo stesso video contemporaneamente.
    """
    job = None
    try:
        _ensure_lock_column(conn, 'Video', 'locked_at')

        # Rilascia lock abbandonati (più vecchi di 10 minuti).
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE Video SET locked_at = NULL "
                "WHERE locked_at IS NOT NULL AND locked_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)"
            )

        # Trova un candidato.
        with conn.cursor(dictionary=True) as cursor:
            query = """
                SELECT id FROM Video
                WHERE (percorso_copertina IS NULL OR percorso_anteprima IS NULL)
                  AND locked_at IS NULL
                ORDER BY id ASC LIMIT 1
            """
            cursor.execute(query)
            candidate = cursor.fetchone()
        if not candidate:
            return False

        # Claim atomico.
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE Video SET locked_at = NOW() WHERE id = %s AND locked_at IS NULL",
                (candidate['id'],)
            )
            if cursor.rowcount == 0:
                # Un altro worker l'ha preso prima di noi.
                return True

        # Carica il record completo dopo il claim.
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT id, percorso_file, id_Categoria, percorso_copertina, percorso_anteprima "
                "FROM Video WHERE id = %s",
                (candidate['id'],)
            )
            job = cursor.fetchone()
        if not job:
            return True

        video_id = job['id']
        relative_path = job['percorso_file']
        full_video_path = os.path.join(PATH_TO_MONITOR, relative_path)
        
        logging.info(f"[Assets] Inizio generazione per: {relative_path} (ID: {video_id})")

        if not os.path.exists(full_video_path):
            logging.warning(f"[Assets] File {relative_path} non trovato. Imposto assets a 'mancante'.")
            with conn.cursor() as cursor:
                query_update = """
                    UPDATE Video SET 
                    percorso_copertina = IFNULL(percorso_copertina, 'mancante'),
                    percorso_anteprima = IFNULL(percorso_anteprima, 'mancante')
                    WHERE id = %s
                """
                cursor.execute(query_update, (video_id,))
            return True

        duration_sec = get_video_metadata(full_video_path)
        if duration_sec is None:
            logging.warning(f"[Assets] Impossibile leggere metadata per {relative_path}. Riprovo dopo {POLL_INTERVAL}s.")
            return False 

        category_name = "Generale"
        if job['id_Categoria']:
             with conn.cursor(dictionary=True) as cursor:
                 cursor.execute("SELECT Nome FROM Categorie WHERE id = %s", (job['id_Categoria'],))
                 cat_result = cursor.fetchone()
                 if cat_result:
                     category_name = cat_result['Nome']
        
        full_cover, db_cover, full_preview, db_preview = _get_asset_paths(relative_path, category_name)

        updates_to_run = []
        
        if job['percorso_copertina'] is None:
            success = False
            # --- NUOVO CONTROLLO ---
            if os.path.exists(full_cover):
                logging.info(f"[Assets] Copertina {db_cover} GIÀ ESISTENTE. Aggiorno DB.")
                success = True
            # --- FINE CONTROLLO ---
            else:
                logging.info(f"[Assets] Copertina {db_cover} non trovata. Avvio generazione...")
                success = generate_cover(full_video_path, full_cover, 
                                         settings['default_Minutaggio_Copertina'], duration_sec)
            
            if success:
                updates_to_run.append(
                    ("UPDATE Video SET percorso_copertina = %s WHERE id = %s", (db_cover, video_id))
                )
                logging.info(f"[Assets] Copertina per ID {video_id} impostata nel DB.")
            else:
                 logging.error(f"[Assets] Fallita generazione/rilevamento copertina per ID {video_id}. Riprovo al prossimo ciclo.")
                 # Non impostiamo 'mancante' così può riprovare se è stato un errore temporaneo

        if job['percorso_anteprima'] is None:
            success = False
            # --- NUOVO CONTROLLO ---
            if os.path.exists(full_preview):
                logging.info(f"[Assets] Anteprima {db_preview} GIÀ ESISTENTE. Aggiorno DB.")
                success = True
            # --- FINE CONTROLLO ---
            else:
                logging.info(f"[Assets] Anteprima {db_preview} non trovata. Avvio generazione...")
                success = generate_preview(full_video_path, full_preview,
                                           settings['default_Minutaggio_Anteprima'], 
                                           settings['durata_Anteprima'], duration_sec)
            
            if success:
                updates_to_run.append(
                    ("UPDATE Video SET percorso_anteprima = %s WHERE id = %s", (db_preview, video_id))
                )
                logging.info(f"[Assets] Anteprima per ID {video_id} impostata nel DB.")
            else:
                 logging.error(f"[Assets] Fallita generazione/rilevamento anteprima per ID {video_id}. Riprovo al prossimo ciclo.")
                 
        if updates_to_run:
            try:
                conn.start_transaction()
                with conn.cursor() as cursor:
                    for query, params in updates_to_run:
                        cursor.execute(query, params)
                conn.commit()
                logging.info(f"[Assets] DB aggiornato per ID {video_id}.")
                # Copertine/anteprime appena pronte: aggiorna cache feed pubblico
                # così le thumbnail compaiono subito in Home/Categorie senza
                # aspettare il TTL di 5 min.
                invalidate_videos_only(reason=f"asset video id={video_id}")
            except Exception as e_trans:
                logging.error(f"[Assets] Errore DB update: {e_trans}")
                conn.rollback()

        # Rilascia sempre il lock (sia che l'asset sia stato generato o meno).
        try:
            with conn.cursor() as cursor:
                cursor.execute("UPDATE Video SET locked_at = NULL WHERE id = %s", (video_id,))
        except Exception:
            pass

        logging.info(f"[Assets] Elaborazione assets per ID {video_id} completata.")
        return True

    except Exception as e_outer:
        logging.error(f"[Assets] Errore generico esterno: {e_outer}")
        # Best-effort: rilascia il lock se possibile.
        try:
            if job and job.get('id'):
                with conn.cursor() as cursor:
                    cursor.execute("UPDATE Video SET locked_at = NULL WHERE id = %s", (job['id'],))
        except Exception:
            pass
        return False

# --- Blocco Principale ---
if __name__ == "__main__":
    logging.info("--- Avvio Server Worker (Assets) ---")
    if not all([DB_HOST, DB_USER, DB_PASS, DB_NAME]):
        logging.critical("Errore: Variabili d'ambiente del database non impostate!")
        sys.exit(1)

    # Riusiamo la connessione DB tra iterazioni: handshake costa ~20-100ms su Pi.
    conn = None
    idle_streak = 0
    BACKOFF_MAX = int(os.environ.get('WORKER_BACKOFF_MAX', '120'))

    while True:
        work_done = False
        try:
            if conn is None or not conn.is_connected():
                conn = get_db_connection()
            settings = fetch_settings(conn)
            work_done = process_missing_assets(conn, settings)

        except mysql.connector.Error as err:
            logging.error(f"Errore DB nel loop principale: {err}")
            try:
                if conn: conn.close()
            except Exception:
                pass
            conn = None
        except KeyboardInterrupt:
            logging.info("Arresto del worker (Assets)...")
            try:
                if conn: conn.close()
            except Exception:
                pass
            break
        except Exception as e:
            logging.error(f"Errore non gestito nel loop principale: {e}")

        if work_done:
            idle_streak = 0
            time.sleep(1)
        else:
            # Backoff esponenziale per ridurre wakeup inutili su Raspberry.
            idle_streak = min(idle_streak + 1, 6)
            sleep_for = min(POLL_INTERVAL * (2 ** (idle_streak - 1)), BACKOFF_MAX)
            logging.info(f"Nessun lavoro. Attendo {sleep_for}s.")
            time.sleep(sleep_for)