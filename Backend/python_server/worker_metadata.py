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

def get_video_metadata(full_path):
    global STABILITY_CHECK_TIME
    try:
        size1 = os.path.getsize(full_path)
        time.sleep(STABILITY_CHECK_TIME)
        size2 = os.path.getsize(full_path)
        if size1 != size2: return None, None, None 

        command = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", full_path]
        result = subprocess.run(command, capture_output=True, text=True, check=True)
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
    try:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT * FROM Video_Temp ORDER BY id ASC LIMIT 1")
            job = cursor.fetchone()
            
        if not job: return False 
            
        relative_path = job['percorso_file']
        full_path = os.path.join(PATH_TO_MONITOR, relative_path)
        
        if not os.path.exists(full_path):
            with conn.cursor() as cursor: cursor.execute("DELETE FROM Video_Temp WHERE id = %s", (job['id'],))
            return True

        _, durata_str, formato = get_video_metadata(full_path)
        if not durata_str: return False 

        titolo = Path(relative_path).stem
        
        try:
            conn.start_transaction() 
            with conn.cursor(dictionary=True) as cursor:
                id_cat = get_or_create_category(cursor, relative_path)
                query = "INSERT INTO Video (percorso_file, Titolo, id_Categoria, Durata, Formato, data_Pubblicazione) VALUES (%s, %s, %s, %s, %s, NOW())"
                cursor.execute(query, (relative_path, titolo, id_cat, durata_str, formato))
                cursor.execute("DELETE FROM Video_Temp WHERE id = %s", (job['id'],))
            conn.commit() 
            logging.info(f"Video processato: {titolo} ({durata_str})")
        except Exception:
            conn.rollback() 
        return True 
    except Exception:
        return False

if __name__ == "__main__":
    while True:
        try:
            conn = get_db_connection()
            if not process_new_videos_from_temp(conn):
                time.sleep(POLL_INTERVAL)
            else:
                time.sleep(1)
        except Exception:
            time.sleep(5)