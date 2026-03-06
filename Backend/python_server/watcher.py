# watcher.py

import sys
import time
import logging
import os
import mysql.connector
from mysql.connector import errorcode
# Usiamo il PollingObserver che è più affidabile su Docker per Mac
from watchdog.observers.polling import PollingObserver as Observer
from watchdog.events import FileSystemEventHandler
from pathlib import Path

# --- Impostazioni (Invariate) ---
VIDEO_EXTENSIONS = (
    '.mp4', '.mkv', '.avi', '.mov', 
    '.wmv', '.flv', '.webm'
)
COVER_NAMES = {'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp'}
PATH_TO_MONITOR = os.environ.get('WATCH_DIR', '/percorsoVideo')
DB_HOST = os.environ.get('MYSQL_HOST', 'mysql')
DB_USER = os.environ.get('MYSQL_USER')
DB_PASS = os.environ.get('MYSQL_PASSWORD')
DB_NAME = os.environ.get('MYSQL_DATABASE')
POLL_TIMEOUT = 2 # Scansione ogni 2 secondi

# --- Configurazione Logging (Invariata) ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [Watcher] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)]
)

# --- Connessione DB (Invariata) ---
def get_db_connection():
    while True:
        try:
            conn = mysql.connector.connect(
                host=DB_HOST,
                user=DB_USER,
                password=DB_PASS,
                database=DB_NAME
            )
            return conn
        except mysql.connector.Error as err:
            if err.errno == errorcode.ER_ACCESS_DENIED_ERROR:
                logging.error("[!] Errore di accesso al DB: username o password errati.")
                time.sleep(60)
            elif err.errno == errorcode.ER_BAD_DB_ERROR:
                logging.error(f"[!] Il database '{DB_NAME}' non esiste.")
                time.sleep(60)
            elif 'Connection refused' in str(err) or err.errno == 2003:
                logging.warning("[!] Connessione al DB rifiutata. Il servizio 'mysql' è pronto? Riprovo tra 5s...")
                time.sleep(5)
            else:
                logging.error(f"[!] Errore di connessione non gestito: {err}")
                time.sleep(10)

# --- Classe Helper (Invariata) ---
class FakeEvent:
    def __init__(self, path, is_dir=False):
        self.src_path = path
        self.is_directory = is_dir

# --- Gestore Eventi (MODIFICATO) ---
class VideoHandler(FileSystemEventHandler):

    # --- Funzioni Helper (Invariate) ---
    def _get_relative_path(self, absolute_path):
        try:
            relative_path = os.path.relpath(absolute_path, PATH_TO_MONITOR)
            return relative_path.replace(os.sep, '/')
        except ValueError:
            logging.error(f"[!] Errore: il file {absolute_path} è fuori dalla directory monitorata {PATH_TO_MONITOR}")
            return None

    def _is_video_file(self, file_path):
        if os.path.basename(file_path).startswith('.'):
            return False
        if os.path.isdir(file_path):
            return False
        return file_path.lower().endswith(VIDEO_EXTENSIONS)

    def _is_cover_file(self, file_path):
        """
        Controlla se il file è una copertina di categoria (es. cover.jpg)
        """
        if os.path.isdir(file_path):
            return False
        return os.path.basename(file_path).lower() in COVER_NAMES

    def _is_path_excluded(self, absolute_path):
        """
        Controlla se il percorso è IN una cartella asset (anteprime/copertine).
        """
        try:
            relative_path_str = self._get_relative_path(absolute_path)
            if not relative_path_str:
                return True 

            parts = Path(relative_path_str).parts
            for part in parts:
                if part.startswith('anteprime_') or part.startswith('copertine_'):
                    return True
            return False
        except Exception:
            return True

    def _calculate_asset_paths(self, relative_path, category_name):
        """
        Calcola i percorsi asset (filesystem e DB) basandosi sulla logica del Worker.
        (Logica invariata)
        """
        p = Path(relative_path)
        parent_dir = p.parent
        video_stem = p.stem 

        db_cover_path = (parent_dir / f"copertine_{category_name}" / f"{video_stem}.jpg").as_posix()
        db_preview_path = (parent_dir / f"anteprime_{category_name}" / f"{video_stem}.mp4").as_posix()

        full_cover_path = os.path.join(PATH_TO_MONITOR, db_cover_path)
        full_preview_path = os.path.join(PATH_TO_MONITOR, db_preview_path)
        
        return full_cover_path, db_cover_path, full_preview_path, db_preview_path

    def _ensure_category_exists(self, cursor, category_db_path):
        """
        Assicura che la categoria esista nel DB. Se non c'è, la crea.
        Restituisce l'ID della categoria (anche se non lo usiamo direttamente).
        """
        cursor.execute("SELECT id FROM Categorie WHERE Percorso = %s", (category_db_path,))
        result = cursor.fetchone()
        if result:
            return result[0]
        else:
            # Estrae il nome dal path (es: "/Forza Horizon 5" -> "Forza Horizon 5")
            # Se è "/" -> "Generale"
            if category_db_path == '/' or category_db_path == '':
                category_name = "Generale"
            else:
                category_name = os.path.basename(category_db_path)
            
            logging.info(f"Categoria '{category_name}' non trovata. Creazione automatica...")
            cursor.execute("INSERT INTO Categorie (Nome, Percorso) VALUES (%s, %s)", (category_name, category_db_path))
            return cursor.lastrowid

    # --- GESTORI EVENTI ---

    def on_created(self, event):
        """
        (Logica invariata)
        """
        if self._is_path_excluded(event.src_path):
            logging.debug(f"[+ IGNORATA] CREAZIONE: Ignorato evento in percorso escluso: {event.src_path}")
            return
        
        if event.is_directory:
            logging.info(f"[+] CREAZIONE (CARTELLA): Rilevata {event.src_path}.")
            return
        
        # --- BLOCCO GESTIONE COPERTINE CATEGORIA ---
        if self._is_cover_file(event.src_path):
            relative_path = self._get_relative_path(event.src_path)
            if relative_path:
                logging.info(f"[+] CREAZIONE (Cover Categoria): Rilevato {relative_path}. Aggiorno DB.")
                # Il file è tipo "NomeCategoria/cover.jpg".
                # Il DB si aspetta "/NomeCategoria/cover.jpg"
                db_path = f"/{relative_path.replace(os.sep, '/')}"
                
                # Ricaviamo il path della categoria (la cartella padre)
                # Se relative_path è "Cat/cover.jpg", parent è "Cat".
                # Nel DB il percorso categoria è "/Cat"
                parent_dir = os.path.dirname(relative_path)
                category_db_path = f"/{parent_dir.replace(os.sep, '/')}"
                
                try:
                    conn = get_db_connection()
                    cursor = conn.cursor()
                    
                    # --- FIX: Assicuriamo che la categoria esista ---
                    self._ensure_category_exists(cursor, category_db_path)
                    
                    # Aggiorna la categoria che corrisponde alla cartella padre
                    query = "UPDATE Categorie SET Immagine_Sfondo = %s WHERE Percorso = %s"
                    cursor.execute(query, (db_path, category_db_path))
                    conn.commit()
                    if cursor.rowcount > 0:
                        logging.info(f"Categoria '{category_db_path}' aggiornata con nuova cover: {db_path}")
                    else:
                        logging.warning(f"UPDATE fallito stranamente per '{category_db_path}' (Cover: {db_path}).")
                except mysql.connector.Error as err:
                    logging.error(f"Errore DB (Creazione Cover): {err}")
                finally:
                    if cursor: cursor.close()
                    if conn and conn.is_connected(): conn.close()
            return
        # --- FINE BLOCCO COPERTINE ---

        if not self._is_video_file(event.src_path):
            return
        relative_path = self._get_relative_path(event.src_path)
        if not relative_path:
            return
        logging.info(f"[+] CREAZIONE (FILE): Nuovo file video rilevato: {relative_path}")
        conn = None
        cursor = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            query_check = "SELECT 1 FROM Video WHERE percorso_file = %s LIMIT 1"
            cursor.execute(query_check, (relative_path,))
            result = cursor.fetchone()
            if result:
                logging.info(f"[=] Video '{relative_path}' già presente in tabella 'Video'. Ignoro.")
            else:
                logging.info(f"Video '{relative_path}' non trovato in 'Video'. Aggiungo a 'Video_Temp'.")
                query_insert = "INSERT IGNORE INTO Video_Temp (percorso_file) VALUES (%s)"
                cursor.execute(query_insert, (relative_path,))
                conn.commit()
                if cursor.rowcount > 0:
                    logging.info(f"Video '{relative_path}' aggiunto con successo a 'Video_Temp'.")
                else:
                    logging.info(f"Video '{relative_path}' era già presente in 'Video_Temp'.")
        except mysql.connector.Error as err:
            logging.error(f"Errore DB (Creazione) per {relative_path}: {err}")
        finally:
            if cursor: cursor.close()
            if conn and conn.is_connected(): conn.close()

    def on_deleted(self, event):
        """
        (Logica invariata)
        """
        relative_path = self._get_relative_path(event.src_path)
        if not relative_path:
            return
        
        conn = None
        cursor = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True) 

            if self._is_path_excluded(event.src_path):
                # Questo è un ASSET (copertina o anteprima)
                logging.info(f"ELIMINAZIONE (Asset): Rilevato: {relative_path}. Imposto NULL nel DB.")
                
                query_cover = "UPDATE Video SET percorso_copertina = NULL WHERE percorso_copertina = %s"
                cursor.execute(query_cover, (relative_path,))
                
                query_preview = "UPDATE Video SET percorso_anteprima = NULL WHERE percorso_anteprima = %s"
                cursor.execute(query_preview, (relative_path,))
                
                conn.commit()
                if cursor.rowcount > 0:
                    logging.info(f"Asset '{relative_path}' impostato a NULL. Verrà rigenerato.")

            elif event.is_directory:
                # Questo blocco viene raggiunto solo se la directory NON è una cartella asset
                # (grazie al check _is_path_excluded precedente).
                # Assumiamo quindi che sia una Categoria.
                logging.info(f"ELIMINAZIONE (Directory Categoria): Rilevata {relative_path}. Tento rimozione da DB.")
                
                # Formattiamo il percorso come nel DB (con / iniziale, come in on_moved)
                db_path = f"/{relative_path.replace(os.sep, '/')}"
                
                query_cat = "DELETE FROM Categorie WHERE Percorso = %s"
                cursor.execute(query_cat, (db_path,))
                conn.commit()
                
                if cursor.rowcount > 0:
                    logging.info(f"Categoria con percorso '{db_path}' eliminata con successo dal DB.")
                else:
                    logging.warning(f"Nessuna categoria trovata nel DB con percorso '{db_path}'. (Potrebbe essere una cartella 'normale' non ancora processata o già rimossa).")

            # --- BLOCCO ELIMINAZIONE COPERTINA CATEGORIA ---
            elif self._is_cover_file(event.src_path):
                logging.info(f"ELIMINAZIONE (Cover Categoria): Rilevato {relative_path}. Rimuovo da DB.")
                # Se elimino "Cat/cover.jpg", devo settare a NULL la categoria "Cat" SE aveva quella cover.
                db_path = f"/{relative_path.replace(os.sep, '/')}"
                
                query_reset = "UPDATE Categorie SET Immagine_Sfondo = NULL WHERE Immagine_Sfondo = %s"
                cursor.execute(query_reset, (db_path,))
                conn.commit()
                if cursor.rowcount > 0:
                    logging.info(f"Categoria aggiornata (rimossa cover {db_path}).")
            # --- FINE BLOCCO ELIMINAZIONE COPERTINA ---

            else:
                # Questo è un VIDEO PRINCIPALE
                logging.info(f"ELIMINAZIONE (File Video): Rilevato: {relative_path}")
                
                query_find = "SELECT percorso_copertina, percorso_anteprima FROM Video WHERE percorso_file = %s"
                cursor.execute(query_find, (relative_path,))
                asset_result = cursor.fetchone()

                # Elimina da DB
                query_temp = "DELETE FROM Video_Temp WHERE percorso_file = %s"
                cursor.execute(query_temp, (relative_path,))
                query_main = "DELETE FROM Video WHERE percorso_file = %s"
                cursor.execute(query_main, (relative_path,))
                conn.commit()
                
                if cursor.rowcount > 0:
                    logging.info(f"File {relative_path} rimosso con successo da 'Video' e/o 'Video_Temp'.")

                if asset_result:
                    old_db_cover_path = asset_result['percorso_copertina']
                    old_db_preview_path = asset_result['percorso_anteprima']
                    
                    if old_db_cover_path and old_db_cover_path != 'mancante':
                        full_cover = os.path.join(PATH_TO_MONITOR, old_db_cover_path)
                        try:
                            os.remove(full_cover)
                            logging.info(f"File copertina eliminato: {full_cover}")
                        except FileNotFoundError:
                            logging.warning(f"File copertina {full_cover} non trovato, impossibile eliminare.")
                        except Exception as e:
                            logging.error(f"Errore eliminazione copertina {full_cover}: {e}")
                    
                    if old_db_preview_path and old_db_preview_path != 'mancante':
                        full_preview = os.path.join(PATH_TO_MONITOR, old_db_preview_path)
                        try:
                            os.remove(full_preview)
                            logging.info(f"File anteprima eliminato: {full_preview}")
                        except FileNotFoundError:
                            logging.warning(f"File anteprima {full_preview} non trovato, impossibile eliminare.")
                        except Exception as e:
                            logging.error(f"Errore eliminazione anteprima {full_preview}: {e}")

        except mysql.connector.Error as err:
            logging.error(f"Errore DB (Eliminazione) per {relative_path}: {err}")
        finally:
            if cursor: cursor.close()
            if conn and conn.is_connected(): conn.close()

    # --- on_moved (MODIFICATO) ---
    def on_moved(self, event):
        """
        Gestisce lo spostamento/rinomina di file, asset E directory (Categorie).
        """
        old_rel_path = self._get_relative_path(event.src_path)
        new_rel_path = self._get_relative_path(event.dest_path)
        if not old_rel_path or not new_rel_path:
            return

        is_src_asset = self._is_path_excluded(event.src_path)
        is_dest_asset = self._is_path_excluded(event.dest_path)

        # --- MODIFICA: Gestione Spostamento Directory (Categoria) ---
        if event.is_directory:
            if is_src_asset or is_dest_asset: 
                logging.debug(f"SPOSTAMENTO (Directory Asset): {old_rel_path} -> {new_rel_path}. Ignorato.")
                return
            
            logging.info(f"SPOSTAMENTO (Directory): {old_rel_path} -> {new_rel_path}. Aggiorno Categoria e rinomino cartelle/file asset.")

            # 1. Calcola nomi vecchi e nuovi
            old_category_name = Path(old_rel_path).name
            new_category_name = Path(new_rel_path).name
            new_full_path_dir = event.dest_path # Percorso *completo* della cartella rinominata

            # 2. Rinomina cartella Copertine
            old_cover_dir_name = f"copertine_{old_category_name}"
            new_cover_dir_name = f"copertine_{new_category_name}"
            current_cover_dir_path = os.path.join(new_full_path_dir, old_cover_dir_name)
            target_cover_dir_path = os.path.join(new_full_path_dir, new_cover_dir_name)

            if os.path.exists(current_cover_dir_path):
                try:
                    os.rename(current_cover_dir_path, target_cover_dir_path)
                    logging.info(f"RINOMINATA cartella Copertine: {old_cover_dir_name} -> {new_cover_dir_name}")
                except Exception as e:
                    logging.error(f"Fallita rinomina cartella Copertine {current_cover_dir_path}: {e}")
            
            # 3. Rinomina cartella Anteprime
            old_preview_dir_name = f"anteprime_{old_category_name}"
            new_preview_dir_name = f"anteprime_{new_category_name}"
            current_preview_dir_path = os.path.join(new_full_path_dir, old_preview_dir_name)
            target_preview_dir_path = os.path.join(new_full_path_dir, new_preview_dir_name)

            if os.path.exists(current_preview_dir_path):
                try:
                    os.rename(current_preview_dir_path, target_preview_dir_path)
                    logging.info(f"RINOMINATA cartella Anteprime: {old_preview_dir_name} -> {new_preview_dir_name}")
                except Exception as e:
                    logging.error(f"Fallita rinomina cartella Anteprime {current_preview_dir_path}: {e}")

            # --- NUOVA LOGICA: Rinomina Sfondo Categoria ---
            # Cerchiamo il file cover_VecchioNome.* DENTRO la cartella (già rinominata)
            old_cover_prefix = f'cover_{old_category_name.lower()}.'
            found_old_cover = None
            try:
                for f in os.listdir(new_full_path_dir):
                    if f.lower().startswith(old_cover_prefix):
                        found_old_cover = f
                        break
            except Exception as e:
                 logging.error(f"Errore scansione sfondo in {new_full_path_dir}: {e}")

            if found_old_cover:
                try:
                    _, ext = os.path.splitext(found_old_cover)
                    new_cover_file_name = f"cover_{new_category_name}{ext}"
                    old_file_full_path = os.path.join(new_full_path_dir, found_old_cover)
                    new_file_full_path = os.path.join(new_full_path_dir, new_cover_file_name)
                    
                    os.rename(old_file_full_path, new_file_full_path)
                    logging.info(f"RINOMINATO Sfondo: {found_old_cover} -> {new_cover_file_name}")
                except Exception as e:
                    logging.error(f"Fallita rinomina sfondo {found_old_cover}: {e}")
            # --- FINE NUOVA LOGICA ---

            # 4. Aggiorna DB (Tabella Categorie)
            old_db_path = f"/{old_rel_path.replace(os.sep, '/')}"
            new_db_path = f"/{new_rel_path.replace(os.sep, '/')}"

            conn = None
            cursor = None
            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                query = "UPDATE Categorie SET Nome = %s, Percorso = %s WHERE Percorso = %s"
                cursor.execute(query, (new_category_name, new_db_path, old_db_path))
                conn.commit()

                if cursor.rowcount > 0:
                    logging.info(f"CATEGORIA Aggiornata: Nome='{new_category_name}', Percorso='{new_db_path}'")
                else:
                    logging.info(f"Nessuna categoria trovata con percorso '{old_db_path}'.")
            except mysql.connector.Error as err:
                logging.error(f"Errore DB (Spostamento Directory Categoria): {err}")
            finally:
                if cursor: cursor.close()
                if conn and conn.is_connected(): conn.close()
            
            return # Evento directory gestito.
        # --- FINE MODIFICA ---

        # --- GESTIONE SPOSTAMENTO FILE (Logica invariata) ---
        conn = None
        cursor = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True) 

            if is_src_asset:
                logging.info(f"SPOSTAMENTO (Asset): Rilevato: {old_rel_path}. Imposto NULL.")
                query_cover = "UPDATE Video SET percorso_copertina = NULL WHERE percorso_copertina = %s"
                cursor.execute(query_cover, (old_rel_path,))
                query_preview = "UPDATE Video SET percorso_anteprima = NULL WHERE percorso_anteprima = %s"
                cursor.execute(query_preview, (old_rel_path,))
                conn.commit()
                if cursor.rowcount > 0:
                    logging.info(f"Asset '{old_rel_path}' impostato a NULL. Verrà rigenerato.")
            
            elif is_dest_asset:
                logging.info(f"SPOSTAMENTO (In Asset): {old_rel_path} spostato in cartella asset. Rimuovo.")
                self.on_deleted(FakeEvent(event.src_path, is_dir=False))
            
            else:
                is_src_video = self._is_video_file(event.src_path)
                is_dest_video = self._is_video_file(event.dest_path)

                if is_src_video and is_dest_video:
                    logging.info(f"SPOSTAMENTO (Video->Video): {old_rel_path} -> {new_rel_path}")
                    
                    query_find = "SELECT percorso_copertina, percorso_anteprima FROM Video WHERE percorso_file = %s"
                    cursor.execute(query_find, (old_rel_path,))
                    asset_result = cursor.fetchone()
                    
                    new_db_cover = None
                    new_db_preview = None

                    if asset_result:
                        old_db_cover_path = asset_result['percorso_copertina']
                        old_db_preview_path = asset_result['percorso_anteprima']
                        
                        new_parent_path_obj = Path(new_rel_path).parent
                        if str(new_parent_path_obj) == '.': 
                            new_category_name = "Generale"
                        else: 
                            new_category_name = new_parent_path_obj.name
                        
                        (new_full_cover, new_db_cover_calc, 
                         new_full_preview, new_db_preview_calc) = self._calculate_asset_paths(new_rel_path, new_category_name)
                        
                        if old_db_cover_path and old_db_cover_path != 'mancante':
                            old_full_cover = os.path.join(PATH_TO_MONITOR, old_db_cover_path)
                            if os.path.exists(old_full_cover):
                                try:
                                    os.makedirs(Path(new_full_cover).parent, exist_ok=True)
                                    # Mantiene l'estensione originale della cover personalizzata
                                    _, cover_ext = os.path.splitext(old_full_cover)
                                    new_full_cover_with_ext = str(Path(new_full_cover).with_suffix(cover_ext))
                                    new_db_cover_calc_with_ext = str(Path(new_db_cover_calc).with_suffix(cover_ext)).replace(os.sep, '/')
                                    
                                    os.rename(old_full_cover, new_full_cover_with_ext)
                                    logging.info(f"RINOMINATA Copertina: {old_db_cover_path} -> {new_db_cover_calc_with_ext}")
                                    new_db_cover = new_db_cover_calc_with_ext
                                except Exception as e:
                                    if os.path.exists(new_full_cover_with_ext):
                                        logging.info(f"File copertina {new_full_cover_with_ext} già presente. Assumo spostato da rinomina categoria.")
                                        new_db_cover = new_db_cover_calc_with_ext 
                                    else:
                                        logging.error(f"Fallita rinomina copertina {old_full_cover} -> {new_full_cover_with_ext}: {e}")
                            else:
                                logging.warning(f"Copertina {old_db_cover_path} in DB ma non su disco. Sarà rigenerata.")
                        
                        if old_db_preview_path and old_db_preview_path != 'mancante':
                            old_full_preview = os.path.join(PATH_TO_MONITOR, old_db_preview_path)
                            if os.path.exists(old_full_preview):
                                try:
                                    os.makedirs(Path(new_full_preview).parent, exist_ok=True)
                                    # Mantiene l'estensione originale dell'anteprima
                                    _, preview_ext = os.path.splitext(old_full_preview)
                                    new_full_preview_with_ext = str(Path(new_full_preview).with_suffix(preview_ext))
                                    new_db_preview_calc_with_ext = str(Path(new_db_preview_calc).with_suffix(preview_ext)).replace(os.sep, '/')
                                    
                                    os.rename(old_full_preview, new_full_preview_with_ext)
                                    logging.info(f"RINOMINATA Anteprima: {old_db_preview_path} -> {new_db_preview_calc_with_ext}")
                                    new_db_preview = new_db_preview_calc_with_ext
                                except Exception as e:
                                    if os.path.exists(new_full_preview_with_ext):
                                        logging.info(f"File anteprima {new_full_preview_with_ext} già presente. Assumo spostato da rinomina categoria.")
                                        new_db_preview = new_db_preview_calc_with_ext
                                    else:
                                        logging.error(f"Fallita rinomina anteprima {old_full_preview} -> {new_full_preview_with_ext}: {e}")
                            else:
                                logging.warning(f"Anteprima {old_db_preview_path} in DB ma non su disco. Sarà rigenerata.")

                        query_main = """
                            UPDATE Video 
                            SET percorso_file = %s, percorso_copertina = %s, percorso_anteprima = %s 
                            WHERE percorso_file = %s
                        """
                        cursor.execute(query_main, (new_rel_path, new_db_cover, new_db_preview, old_rel_path))

                    query_temp = "UPDATE Video_Temp SET percorso_file = %s WHERE percorso_file = %s"
                    cursor.execute(query_temp, (new_rel_path, old_rel_path))

                    conn.commit()
                    logging.info(f"Aggiornato DB per spostamento: {old_rel_path} -> {new_rel_path}")

                elif is_src_video and not is_dest_video:
                    logging.info(f"RINOMINA (Video->NonVideo): Trattato come eliminazione: {event.src_path}")
                    self.on_deleted(event) 
                
                elif not is_src_video and is_dest_video:
                    logging.info(f"RINOMINA (NonVideo->Video): Trattato come creazione: {event.dest_path}")
                    self.on_created(FakeEvent(event.dest_path, is_dir=False))
        
        except mysql.connector.Error as err:
            logging.error(f"Errore DB (Spostamento File): {err}")
        finally:
            if cursor: cursor.close()
            if conn and conn.is_connected(): conn.close()

# --- Funzione Scansione (Invariata) ---
def perform_scan(handler):
    logging.info(f"--- [Scan Iniziale] Avvio scansione di {PATH_TO_MONITOR} ---")
    scan_count = 0
    try:
        for root, dirs, files in os.walk(PATH_TO_MONITOR, topdown=True):
            
            dirs[:] = [
                d for d in dirs 
                if not d.startswith('.') and 
                   not d.startswith('anteprime_') and 
                   not d.startswith('copertine_')
            ]
            
            for file in files:
                absolute_path = os.path.join(root, file)
                if handler._is_video_file(absolute_path):
                    logging.debug(f"[Scan Iniziale] Trovato video: {file}. Elaborazione...")
                    fake_event = FakeEvent(absolute_path, is_dir=False)
                    handler.on_created(fake_event)
                    scan_count += 1
                elif handler._is_cover_file(absolute_path):
                    logging.debug(f"[Scan Iniziale] Trovata cover categoria: {file}. Elaborazione...")
                    fake_event = FakeEvent(absolute_path, is_dir=False)
                    handler.on_created(fake_event) # Riutilizziamo la logica di creazione
                    
        logging.info(f"--- [Scan Iniziale] Scansione completata. Elaborati {scan_count} file video. ---")
    
    except Exception as e:
        logging.error(f"Errore critico during la scansione (polling): {e}")

# --- Blocco Principale (Invariato) ---
if __name__ == "__main__":
    if not all([DB_HOST, DB_USER, DB_PASS, DB_NAME]):
        logging.critical("Errore: Variabili d'ambiente del database non impostate.")
        sys.exit(1)

    logging.info(f"--- Avvio Server Watcher ---")
    logging.info(f"Directory monitorata: {PATH_TO_MONITOR}")
    logging.info(f"Modalità: Polling (Scansione ogni {POLL_TIMEOUT} secondi)")

    logging.info("Test connessione iniziale al database...")
    initial_conn = get_db_connection()
    if initial_conn:
        initial_conn.close()
        logging.info("Test connessione DB riuscito.")
    else:
        logging.critical("Impossibile stabilire la connessione iniziale al DB. Uscita.")
        sys.exit(1)

    event_handler = VideoHandler()
    perform_scan(event_handler)
    observer = Observer(timeout=POLL_TIMEOUT) 
    observer.schedule(event_handler, PATH_TO_MONITOR, recursive=True)
    observer.start()
    logging.info(f"--- Server Watcher avviato. In attesa di modifiche (Polling ogni {POLL_TIMEOUT}s) ---")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logging.info("Richiesta di interruzione ricevuta. Arresto...")
        observer.stop()
    
    observer.join()
    logging.info("--- Server Watcher arrestato. ---")