# worker_assets.py
# (Worker "Lento" per Copertine e Anteprime)

import sys
import time
import logging
import os
import mysql.connector
from mysql.connector import errorcode
import subprocess
import json
from pathlib import Path
from datetime import datetime

# --- Impostazioni ---
PATH_TO_MONITOR = os.environ.get('WATCH_DIR', '/percorsoVideo')
DB_HOST = os.environ.get('MYSQL_HOST', 'mysql')
DB_USER = os.environ.get('MYSQL_USER')
DB_PASS = os.environ.get('MYSQL_PASSWORD')
DB_NAME = os.environ.get('MYSQL_DATABASE')
POLL_INTERVAL = 10 
STABILITY_CHECK_TIME = 2 

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

        command = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", full_path
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=True)
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
    
    command = [
        "ffmpeg",
        "-ss", str(start_time_sec), "-i", full_video_path,
        "-vframes", "1", "-q:v", "2", "-y", full_cover_path
    ]
    
    try:
        logging.info(f"Generazione copertina per: {full_cover_path}")
        subprocess.run(command, capture_output=True, text=True, check=True, timeout=30)
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

    command = [
        "ffmpeg",
        "-ss", str(start_time_sec), "-i", full_video_path,
        "-t", str(duration_sec), 
        "-vf", "scale=-2:480", # Risoluzione 480p 
        "-c:v", "libx264",
        "-preset", "fast", 
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", 
        "-an", # Rimuove audio (non specificato, ma ottimizza)
        "-y", full_preview_path
    ]
    
    try:
        logging.info(f"Generazione anteprima per: {full_preview_path}")
        subprocess.run(command, capture_output=True, text=True, check=True, timeout=120)
        return True
    except Exception as e:
        logging.error(f"Fallita generazione anteprima: {e}")
        return False

# --- Funzione Principale (Solo Asset) ---
def process_missing_assets(conn, settings):
    """
    Cerca UN video a cui mancano asset e li genera.
    Restituisce True se un lavoro è stato fatto, altrimenti False.
    """
    job = None
    try:
        with conn.cursor(dictionary=True) as cursor:
            query = """
                SELECT id, percorso_file, id_Categoria, percorso_copertina, percorso_anteprima 
                FROM Video 
                WHERE percorso_copertina IS NULL OR percorso_anteprima IS NULL 
                ORDER BY id ASC LIMIT 1
            """
            cursor.execute(query)
            job = cursor.fetchone()
            
        if not job:
            return False 

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
            except Exception as e_trans:
                logging.error(f"[Assets] Errore DB update: {e_trans}")
                conn.rollback()

        logging.info(f"[Assets] Elaborazione assets per ID {video_id} completata.")
        return True 

    except Exception as e_outer:
        logging.error(f"[Assets] Errore generico esterno: {e_outer}")
        return False

# --- Blocco Principale ---
if __name__ == "__main__":
    logging.info("--- Avvio Server Worker (Assets) ---")
    if not all([DB_HOST, DB_USER, DB_PASS, DB_NAME]):
        logging.critical("Errore: Variabili d'ambiente del database non impostate!")
        sys.exit(1)

    while True:
        conn = None
        work_done = False
        try:
            conn = get_db_connection()
            # Carica le impostazioni (necessarie per ffmpeg)
            settings = fetch_settings(conn)
            
            # Esegue solo il lavoro "lento"
            work_done = process_missing_assets(conn, settings)

        except mysql.connector.Error as err:
            logging.error(f"Errore connessione DB nel loop principale: {err}")
        except KeyboardInterrupt:
            logging.info("Arresto del worker (Assets)...")
            break
        except Exception as e:
            logging.error(f"Errore non gestito nel loop principale: {e}")
        finally:
            if conn and conn.is_connected():
                conn.close()

        if not work_done:
            logging.info(f"Nessun lavoro. In attesa per {POLL_INTERVAL}s...")
            time.sleep(POLL_INTERVAL)
        else:
            time.sleep(1) # Lavora velocemente se c'è coda