# worker_metadata.py (AGGIORNATO)
import sys
import time
import logging
import os
import mysql.connector
import subprocess
import json
from pathlib import Path

# --- Impostazioni ---
PATH_TO_MONITOR = os.environ.get('WATCH_DIR', '/percorsoVideo')
DB_HOST = os.environ.get('MYSQL_HOST', 'mysql')
DB_USER = os.environ.get('MYSQL_USER')
DB_PASS = os.environ.get('MYSQL_PASSWORD')
DB_NAME = os.environ.get('MYSQL_DATABASE')
POLL_INTERVAL = 10 
STABILITY_CHECK_TIME = 2 

# Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [Worker-Meta] - %(message)s', handlers=[logging.StreamHandler(sys.stdout)])

def get_db_connection():
    while True:
        try:
            return mysql.connector.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME, autocommit=True)
        except mysql.connector.Error:
            time.sleep(5)

def _is_path_inside_base(full_path):
    """Verifica che il path risolto (post-symlink) stia dentro PATH_TO_MONITOR."""
    try:
        full_real = os.path.realpath(full_path)
        base_real = os.path.realpath(PATH_TO_MONITOR)
        return full_real == base_real or full_real.startswith(base_real + os.sep)
    except OSError:
        return False

def get_video_metadata(full_path):
    global STABILITY_CHECK_TIME
    try:
        # Hardening: nessun accesso a file fuori dalla base, niente symlink che escono.
        if not _is_path_inside_base(full_path):
            logging.warning(f"[SECURITY] Path fuori base ignorato in metadata: {full_path}")
            return None, None, None
        if os.path.islink(full_path):
            logging.warning(f"[SECURITY] Symlink ignorato in metadata: {full_path}")
            return None, None, None

        size1 = os.path.getsize(full_path)
        time.sleep(STABILITY_CHECK_TIME)
        size2 = os.path.getsize(full_path)
        if size1 != size2: return None, None, None

        # ffprobe con timeout per evitare hang su file corrotti.
        # I path provengono da watcher.py che già rifiuta symlink e path fuori base;
        # essendo argomenti passati come lista (no shell) non è possibile command-injection.
        command = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", full_path]
        result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=20)
        metadata = json.loads(result.stdout)
        
        duration_sec = float(metadata['format']['duration'])
        
        # --- LOGICA DURATA MIGLIORATA (MM:SS) ---
        # Se il video dura meno di 1 ora, usiamo MM:SS (es. 59:59)
        # Se dura più di 1 ora, usiamo H:MM (es. 1:30) per stare nei 5 caratteri del DB
        hours = int(duration_sec // 3600)
        minutes = int((duration_sec % 3600) // 60)
        seconds = int(duration_sec % 60)
        
        if hours > 0:
            # Formato H:MM (sacrifichiamo i secondi per video lunghi > 1h)
            durata_str = f"{hours}:{minutes:02d}"
        else:
            # Formato MM:SS (Standard per la maggior parte dei video)
            durata_str = f"{minutes:02d}:{seconds:02d}"
        
        formato_file = Path(full_path).suffix.lstrip('.').lower()
        return duration_sec, durata_str, formato_file

    except subprocess.TimeoutExpired:
        logging.error(f"[!] ffprobe TIMEOUT su {full_path}: file probabilmente corrotto.")
        return None, None, None
    except Exception as e:
        logging.error(f"Errore metadata {full_path}: {e}")
        return None, None, None

def get_or_create_category(cursor, relative_path):
    parent_path_obj = Path(relative_path).parent
    category_name = "Generale" if str(parent_path_obj) == '.' else parent_path_obj.name
    category_path = "/" if str(parent_path_obj) == '.' else f"/{parent_path_obj.as_posix()}"
    
    cursor.execute("SELECT id FROM Categorie WHERE Percorso = %s", (category_path,))
    result = cursor.fetchone()
    
    if result:
        return result['id']
    else:
        cursor.execute("INSERT INTO Categorie (Nome, Percorso) VALUES (%s, %s)", (category_name, category_path))
        return cursor.lastrowid

def process_new_videos_from_temp(conn):
    """
    Claim atomico di un record da Video_Temp tramite UPDATE condizionale.
    Se la colonna `locked_at` non esiste, la creiamo on-the-fly per non
    richiedere migrazioni manuali. Più worker possono coesistere senza
    duplicare il lavoro.
    """
    try:
        # Migrazione idempotente: aggiunge colonna `locked_at` se mancante.
        _ensure_lock_column(conn, 'Video_Temp', 'locked_at')

        # 1) Scarta i lock "abbandonati" (worker crashato): più vecchi di 5 min.
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE Video_Temp SET locked_at = NULL "
                "WHERE locked_at IS NOT NULL AND locked_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)"
            )

        # 2) Claim atomico di UN record candidato.
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT id FROM Video_Temp WHERE locked_at IS NULL ORDER BY id ASC LIMIT 1")
            candidate = cursor.fetchone()
        if not candidate:
            return False

        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE Video_Temp SET locked_at = NOW() WHERE id = %s AND locked_at IS NULL",
                (candidate['id'],)
            )
            claimed = cursor.rowcount > 0
        if not claimed:
            # Un altro worker ha vinto la corsa: lascia che il poll riparta.
            return True

        # 3) Recupera dettagli del job vinto
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT * FROM Video_Temp WHERE id = %s", (candidate['id'],))
            job = cursor.fetchone()
        if not job:
            return True

        relative_path = job['percorso_file']
        full_path = os.path.join(PATH_TO_MONITOR, relative_path)

        if not os.path.exists(full_path):
            with conn.cursor() as cursor:
                cursor.execute("DELETE FROM Video_Temp WHERE id = %s", (job['id'],))
            return True

        _, durata_str, formato = get_video_metadata(full_path)
        if not durata_str:
            # Rilascia il lock per ritentare al prossimo giro.
            with conn.cursor() as cursor:
                cursor.execute("UPDATE Video_Temp SET locked_at = NULL WHERE id = %s", (job['id'],))
            return False

        titolo = Path(relative_path).stem

        try:
            conn.start_transaction()
            with conn.cursor(dictionary=True) as cursor:
                id_cat = get_or_create_category(cursor, relative_path)
                query = ("INSERT INTO Video (percorso_file, Titolo, id_Categoria, Durata, Formato, data_Pubblicazione) "
                         "VALUES (%s, %s, %s, %s, %s, NOW())")
                cursor.execute(query, (relative_path, titolo, id_cat, durata_str, formato))
                cursor.execute("DELETE FROM Video_Temp WHERE id = %s", (job['id'],))
            conn.commit()
            logging.info(f"Video processato: {titolo} ({durata_str})")
        except Exception as e:
            conn.rollback()
            logging.error(f"Errore processo video {relative_path}: {e}")
            # In caso di errore, rilascia il lock per permettere il retry.
            with conn.cursor() as cursor:
                cursor.execute("UPDATE Video_Temp SET locked_at = NULL WHERE id = %s", (job['id'],))
        return True
    except Exception as e:
        logging.error(f"Errore generale in process_new_videos_from_temp: {e}")
        return False


def _ensure_lock_column(conn, table_name, column_name):
    """
    Aggiunge la colonna `locked_at DATETIME NULL` alla tabella indicata, se mancante.
    Idempotente: la verifica usa INFORMATION_SCHEMA per non lanciare errori se esiste.
    """
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s",
                (table_name, column_name)
            )
            exists = cursor.fetchone()[0] > 0
            if not exists:
                # Whitelist su nomi: evitiamo qualsiasi rischio di SQL injection.
                if not (table_name.isalnum() or all(c.isalnum() or c == '_' for c in table_name)):
                    return
                if not (column_name.isalnum() or all(c.isalnum() or c == '_' for c in column_name)):
                    return
                cursor.execute(f"ALTER TABLE `{table_name}` ADD COLUMN `{column_name}` DATETIME NULL")
                logging.info(f"Migrazione: aggiunta colonna {table_name}.{column_name}")
    except Exception as e:
        logging.warning(f"_ensure_lock_column({table_name}.{column_name}) skip: {e}")

if __name__ == "__main__":
    # Connessione DB riutilizzata: meno overhead di handshake TCP/auth ad ogni iterazione.
    # In caso di errore la riapriamo solo allora.
    conn = None
    idle_streak = 0
    BACKOFF_MAX = int(os.environ.get('WORKER_BACKOFF_MAX', '60'))

    while True:
        try:
            if conn is None or not conn.is_connected():
                conn = get_db_connection()

            did_work = process_new_videos_from_temp(conn)

            if did_work:
                idle_streak = 0
                time.sleep(1)
            else:
                # Backoff esponenziale: 10s, 20s, 40s, ... fino a BACKOFF_MAX.
                # Risparmia CPU su Raspberry quando non c'è nulla da fare.
                idle_streak = min(idle_streak + 1, 6)
                sleep_for = min(POLL_INTERVAL * (2 ** (idle_streak - 1)), BACKOFF_MAX)
                time.sleep(sleep_for)
        except mysql.connector.Error as db_err:
            logging.warning(f"[Worker-Meta] DB error: {db_err}. Reconnecting in 5s.")
            try:
                if conn: conn.close()
            except Exception:
                pass
            conn = None
            time.sleep(5)
        except Exception as e:
            logging.error(f"[Worker-Meta] Eccezione generica: {e}")
            time.sleep(5)