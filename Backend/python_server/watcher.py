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
import re
import unicodedata

from cache_invalidation import invalidate_videos_and_categories
import subtitles_common as subs_common

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
POLL_TIMEOUT = int(os.environ.get('WATCHER_POLL_TIMEOUT', '5'))  # Scansione ogni 5s di default (era 2s, troppo aggressivo per ARM)
POLL_BACKOFF_MAX = int(os.environ.get('WATCHER_POLL_BACKOFF_MAX', '30'))  # Ceiling backoff esponenziale

# --- Helper per la Sanificazione dei Nomi dei File ---
def sanitize_component_string(name):
    # 1. Rimpiazza caratteri accentati ed europei con i rispettivi equivalenti ASCII
    name = unicodedata.normalize('NFKD', name)
    name = "".join([c for c in name if not unicodedata.combining(c)])
    
    # Mappa manuale per casi speciali come l'apostrofo e le virgolette
    name = name.replace("'", "_")
    name = name.replace('"', "_")
    
    # 2. Sostituisci tutti i caratteri non conformi con underscore
    # Sono consentiti solo a-z, A-Z, 0-9, dot (.) e dash (-)
    name = re.sub(r'[^a-zA-Z0-9\.\-]', '_', name)
    
    # 3. Normalizza gli underscore multipli e rimuovi quelli ai bordi
    name = re.sub(r'_{2,}', '_', name)
    name = re.sub(r'_\.', '.', name)
    name = name.strip('_')
    name = name.strip('-')
    
    return name

def sanitize_name(name, is_file=True):
    if is_file:
        path_obj = Path(name)
        stem = path_obj.stem
        ext = path_obj.suffix
        clean_stem = sanitize_component_string(stem)
        clean_ext = sanitize_component_string(ext.lstrip('.')).lower()
        if not clean_stem:
            clean_stem = f"video_{int(time.time())}"
        return f"{clean_stem}.{clean_ext}" if clean_ext else clean_stem
    else:
        clean_name = sanitize_component_string(name)
        if not clean_name:
            clean_name = f"cartella_{int(time.time())}"
        return clean_name

def is_conforming(name, is_file=True):
    if not name:
        return False
    # Controlla se contiene solo a-zA-Z0-9, dot (.), dash (-), underscore (_)
    if re.search(r'[^a-zA-Z0-9\.\-_]', name):
        return False
    # Evita underscore multipli o strani pattern di inizio/fine
    if '__' in name or '..' in name or '--' in name:
        return False
    if name.startswith('_') or name.endswith('_') or name.startswith('-') or name.endswith('-'):
        return False
    if is_file:
        ext = Path(name).suffix
        if ext and ext != ext.lower():
            return False
    return True

def get_unique_path(target_path):
    if not os.path.exists(target_path):
        return target_path
    
    path_obj = Path(target_path)
    parent = path_obj.parent
    stem = path_obj.stem
    ext = path_obj.suffix
    
    counter = 1
    while True:
        new_name = f"{stem}_{counter}{ext}"
        new_path = parent / new_name
        if not new_path.exists():
            return str(new_path)
        counter += 1

def _is_size_stable(file_path, wait_seconds=2):
    """
    Verifica che la size del file non cambi per `wait_seconds` secondi.
    Serve a non rinominare/processare file ancora in scrittura (es. sync OneDrive
    che scarica gradualmente): rinominarli mentre vengono scritti porta a file
    corrotti o a duplicati con suffisso _1 quando il sync li ricrea.
    """
    try:
        size1 = os.path.getsize(file_path)
        if size1 == 0:
            return False
        time.sleep(wait_seconds)
        size2 = os.path.getsize(file_path)
        return size1 == size2
    except OSError:
        return False


def sanitize_path(absolute_path):
    """
    Rinomina il file o la directory se contiene caratteri non conformi.
    Restituisce il nuovo path assoluto (o quello originale se già conforme o se c'è un errore).
    """
    try:
        abs_real = os.path.realpath(absolute_path)
        base_real = os.path.realpath(PATH_TO_MONITOR)
        if not (abs_real == base_real or abs_real.startswith(base_real + os.sep)):
            return absolute_path
        if os.path.islink(absolute_path):
            return absolute_path

        if abs_real == base_real:
            return absolute_path

        parent_dir = os.path.dirname(absolute_path)
        basename = os.path.basename(absolute_path)

        if basename.startswith('.'):
            return absolute_path
        if basename.startswith('anteprime_') or basename.startswith('copertine_') or basename.startswith('sottotitoli_'):
            return absolute_path

        is_dir = os.path.isdir(absolute_path)

        if is_conforming(basename, is_file=not is_dir):
            return absolute_path

        clean_basename = sanitize_name(basename, is_file=not is_dir)
        dest_path = os.path.join(parent_dir, clean_basename)

        # Per i FILE: prima di toccarli, attendi che la size sia stabile.
        # Rinominare un file ancora in scrittura (es. OneDrive sync in corso)
        # produce file troncati/corrotti e duplicati _1 quando il sync ricrea
        # l'originale per ritentare.
        if not is_dir and os.path.exists(absolute_path):
            if not _is_size_stable(absolute_path, wait_seconds=2):
                logging.info(
                    f"[SANITY] File '{absolute_path}' ancora in scrittura "
                    f"(size non stabile). Rimando la rinomina al prossimo evento."
                )
                return absolute_path

        # Se la destinazione "pulita" esiste GIÀ con la stessa size del source,
        # siamo davanti a un duplicato di sync (OneDrive/Dropbox ricreano spesso
        # il file originale dopo che noi l'avevamo rinominato). Cancelliamo il
        # source invece di generare "<name>_1.ext" che resterebbe orfano e
        # spesso corrotto.
        if not is_dir and os.path.exists(dest_path):
            try:
                src_size = os.path.getsize(absolute_path)
                dst_size = os.path.getsize(dest_path)
                if src_size == dst_size and src_size > 0:
                    logging.warning(
                        f"[SANITY] Duplicato sync rilevato: '{absolute_path}' "
                        f"({src_size}B) identico a '{dest_path}'. Rimuovo il source."
                    )
                    try:
                        os.remove(absolute_path)
                    except OSError as e:
                        logging.error(f"[SANITY] Rimozione duplicato fallita: {e}")
                    return dest_path
            except OSError:
                pass

        dest_path = get_unique_path(dest_path)

        logging.info(f"[SANITY] Rinomina di sicurezza: '{absolute_path}' -> '{dest_path}'")
        os.rename(absolute_path, dest_path)
        return dest_path
    except Exception as e:
        logging.error(f"[SANITY] Errore durante la rinomina di '{absolute_path}': {e}")
        return absolute_path

def pre_scan_sanitize(base_path):
    logging.info(f"--- [Pre-Scan] Avvio bonifica nomi file in {base_path} ---")
    renamed_count = 0
    try:
        for root, dirs, files in os.walk(base_path, topdown=False):
            # Filtra dirs in-place per escludere cartelle nascoste e speciali
            dirs[:] = [
                d for d in dirs
                if not d.startswith('.') and
                   not d.startswith('anteprime_') and
                   not d.startswith('copertine_') and
                   not d.startswith('sottotitoli_')
            ]

            # Rinomina prima i file
            for file in files:
                if file.startswith('.'):
                    continue
                file_path = os.path.join(root, file)
                new_path = sanitize_path(file_path)
                if new_path != file_path:
                    renamed_count += 1
            
            # Rinomina poi le directory
            for d in dirs:
                if d.startswith('.'):
                    continue
                dir_path = os.path.join(root, d)
                new_path = sanitize_path(dir_path)
                if new_path != dir_path:
                    renamed_count += 1
                    
        logging.info(f"--- [Pre-Scan] Bonifica completata. Rinominate {renamed_count} risorse. ---")
    except Exception as e:
        logging.error(f"[Pre-Scan] Errore critico durante la bonifica nomi: {e}")

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

    # --- Funzioni Helper ---
    def _get_relative_path(self, absolute_path):
        """
        Calcola il path relativo a PATH_TO_MONITOR e, in caso di symlink che
        puntano fuori dalla directory monitorata, ritorna None per impedire
        path traversal o accesso a file di sistema (es. /etc/passwd via symlink).
        """
        try:
            abs_real = os.path.realpath(absolute_path)
            base_real = os.path.realpath(PATH_TO_MONITOR)
            if not (abs_real == base_real or abs_real.startswith(base_real + os.sep)):
                logging.warning(f"[SECURITY] Path fuori dalla base monitorata, ignorato: {absolute_path}")
                return None
            relative_path = os.path.relpath(absolute_path, PATH_TO_MONITOR)
            # Sanifica: rifiuta path con caratteri di controllo o '..' residui
            if '..' in relative_path.split(os.sep) or any(ord(c) < 32 for c in relative_path):
                logging.warning(f"[SECURITY] Path con componenti sospette: {relative_path}")
                return None
            return relative_path.replace(os.sep, '/')
        except (ValueError, OSError) as e:
            logging.error(f"[!] Errore calcolo path relativo per {absolute_path}: {e}")
            return None

    def _is_video_file(self, file_path):
        basename = os.path.basename(file_path)
        # File nascosti (dotfile)
        if basename.startswith('.'):
            return False
        # Directory
        if os.path.isdir(file_path):
            return False
        # Symlink: potrebbero puntare a file non-video o fuori dalla base.
        if os.path.islink(file_path):
            logging.warning(f"[SECURITY] Symlink ignorato: {file_path}")
            return False
        # Backup o file temporanei creati da worker_optimizer durante il remux
        # Non sono veri video, non vanno indicizzati.
        if '.bak.' in basename or '.tmp.' in basename:
            return False
        return file_path.lower().endswith(VIDEO_EXTENSIONS)

    def _is_cover_file(self, file_path):
        """
        Controlla se il file è una copertina di categoria (es. cover.jpg)
        """
        if os.path.isdir(file_path):
            return False
        return os.path.basename(file_path).lower() in COVER_NAMES

    def _is_subtitle_file(self, file_path):
        """
        File sottotitolo manuale (.vtt/.srt) messo a mano nelle cartelle.
        Gestito a parte PRIMA dell'esclusione perche' spesso vive dentro
        sottotitoli_<categoria> (che _is_path_excluded scarterebbe).
        """
        basename = os.path.basename(file_path)
        if basename.startswith('.'):
            return False
        if os.path.isdir(file_path) or os.path.islink(file_path):
            return False
        return file_path.lower().endswith(subs_common.SUB_EXTENSIONS)

    def _handle_subtitle_upsert(self, absolute_path):
        """
        Importa/aggiorna in tempo reale un sottotitolo manuale comparso o
        modificato su disco: trova il video, ricava la lingua, converte
        l'eventuale .srt, scrive la riga Sottotitoli e invalida la cache.
        """
        conn = None
        try:
            conn = get_db_connection()
            result = subs_common.import_subtitle_file(
                conn, absolute_path, PATH_TO_MONITOR, log=logging, override=True
            )
            conn.commit()
        except Exception as e:
            logging.error(f"[Subs] Import sottotitolo manuale fallito per {absolute_path}: {e}")
            result = None
        finally:
            if conn and conn.is_connected():
                conn.close()

        if result:
            vid, lang, db_rel = result
            logging.info(f"[Subs] Sottotitolo manuale '{lang}' importato in tempo reale: video={vid} file={db_rel}")
            invalidate_videos_and_categories(reason=f"sottotitolo manuale {db_rel}")

    def _handle_subtitle_delete(self, absolute_path):
        """Rimuove la riga Sottotitoli quando il file .vtt/.srt viene eliminato/spostato."""
        relative_path = self._get_relative_path(absolute_path)
        if not relative_path:
            return
        conn = None
        removed = False
        try:
            conn = get_db_connection()
            removed = subs_common.remove_subtitle_row(conn, relative_path)
            conn.commit()
        except Exception as e:
            logging.error(f"[Subs] Rimozione riga sottotitolo fallita per {relative_path}: {e}")
        finally:
            if conn and conn.is_connected():
                conn.close()
        if removed:
            logging.info(f"[Subs] Sottotitolo manuale rimosso dal DB: {relative_path}")
            invalidate_videos_and_categories(reason=f"sottotitolo rimosso {relative_path}")

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
                if part.startswith('anteprime_') or part.startswith('copertine_') or part.startswith('sottotitoli_'):
                    return True
            return False
        except Exception:
            return True

    def _calculate_asset_paths(self, relative_path, category_name):
        """
        Calcola i percorsi asset (filesystem e DB) basandosi sulla logica del Worker.
        Vedi worker_assets._get_asset_paths per il razionale: usiamo il nome
        della CARTELLA SU DISCO (sanificato dal watcher) come suffisso, non il
        Categorie.Nome con spazi, altrimenti PHP e Python creerebbero due
        cartelle distinte (con/senza spazi).
        """
        p = Path(relative_path)
        parent_dir = p.parent
        video_stem = p.stem
        folder_suffix = parent_dir.name if parent_dir.name else (category_name or "Generale")

        db_cover_path = (parent_dir / f"copertine_{folder_suffix}" / f"{video_stem}.jpg").as_posix()
        db_preview_path = (parent_dir / f"anteprime_{folder_suffix}" / f"{video_stem}.mp4").as_posix()

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
            # Estrae il nome dal path (es: "/Forza_Horizon_5" -> "Forza Horizon 5")
            # Se è "/" -> "Generale"
            # I path su disco usano underscore al posto degli spazi (sanitize),
            # ma il Nome mostrato in UI/Admin deve avere gli spazi.
            if category_db_path == '/' or category_db_path == '':
                category_name = "Generale"
            else:
                category_name = os.path.basename(category_db_path).replace('_', ' ')

            logging.info(f"Categoria '{category_name}' non trovata. Creazione automatica...")
            cursor.execute("INSERT INTO Categorie (Nome, Percorso) VALUES (%s, %s)", (category_name, category_db_path))
            return cursor.lastrowid

    # --- GESTORI EVENTI ---

    def on_created(self, event):
        # Sottotitoli manuali: gestiti PRIMA dell'esclusione (vivono spesso in
        # sottotitoli_<categoria>). Rilevamento in tempo reale = aggiornamento DB
        # immediato, senza attendere la scansione bulk del worker.
        if not event.is_directory and self._is_subtitle_file(event.src_path):
            sanitized = sanitize_path(event.src_path)
            if sanitized != event.src_path:
                return  # rinominato: il nuovo nome rigenera l'evento
            self._handle_subtitle_upsert(sanitized)
            return

        if self._is_path_excluded(event.src_path):
            logging.debug(f"[+ IGNORATA] CREAZIONE: Ignorato evento in percorso escluso: {event.src_path}")
            return

        # Bonifica immediata del nome se non conforme
        sanitized_path = sanitize_path(event.src_path)
        if sanitized_path != event.src_path:
            # Rinomina eseguita, watchdog rileverà il nuovo nome.
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
                        invalidate_videos_and_categories(reason=f"cover categoria {category_db_path}")
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
        logging.debug(f"[+] CREAZIONE (FILE): Nuovo file video rilevato: {relative_path}")
        conn = None
        cursor = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            query_check = "SELECT 1 FROM Video WHERE percorso_file = %s LIMIT 1"
            cursor.execute(query_check, (relative_path,))
            result = cursor.fetchone()
            if result:
                # Caso comune e silente: file gia' indicizzato (es. evento duplicato
                # di polling). Niente INFO: sporcherebbe i log senza informazione utile.
                logging.debug(f"[=] '{relative_path}' gia' presente in Video. Skip.")
            else:
                logging.info(f"[+] Nuovo video '{relative_path}' -> accodo in Video_Temp.")
                query_insert = "INSERT IGNORE INTO Video_Temp (percorso_file) VALUES (%s)"
                cursor.execute(query_insert, (relative_path,))
                conn.commit()
                if cursor.rowcount > 0:
                    logging.info(f"[+] '{relative_path}' aggiunto a Video_Temp.")
                else:
                    logging.debug(f"[=] '{relative_path}' era gia' in Video_Temp.")
        except mysql.connector.Error as err:
            logging.error(f"Errore DB (Creazione) per {relative_path}: {err}")
        finally:
            if cursor: cursor.close()
            if conn and conn.is_connected(): conn.close()

    def on_modified(self, event):
        # Sottotitolo manuale sovrascritto: ri-allinea il DB (idempotente).
        if not event.is_directory and self._is_subtitle_file(event.src_path):
            sanitized = sanitize_path(event.src_path)
            if sanitized != event.src_path:
                return
            self._handle_subtitle_upsert(sanitized)
            return

        if self._is_path_excluded(event.src_path):
            return

        if event.is_directory:
            return
        
        # Bonifica immediata del nome se non conforme
        sanitized_path = sanitize_path(event.src_path)
        if sanitized_path != event.src_path:
            return

        if not self._is_video_file(event.src_path):
            return

        relative_path = self._get_relative_path(event.src_path)
        if not relative_path:
            return

        logging.info(f"[*] MODIFICA (FILE): Rilevata modifica al file video: {relative_path}")
        conn = None
        cursor = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            # Inserisce in Video_Temp per far rielaborare i metadata e rigenerare gli asset
            query_insert = "INSERT IGNORE INTO Video_Temp (percorso_file) VALUES (%s)"
            cursor.execute(query_insert, (relative_path,))
            conn.commit()
            if cursor.rowcount > 0:
                logging.info(f"Video modificato '{relative_path}' aggiunto a 'Video_Temp' per rielaborazione.")
        except mysql.connector.Error as err:
            logging.error(f"Errore DB (Modifica) per {relative_path}: {err}")
        finally:
            if cursor: cursor.close()
            if conn and conn.is_connected(): conn.close()

    def on_deleted(self, event):
        """
        Gestisce eliminazione di video, asset, cover categoria e cartelle categoria.
        Tutti questi cambi richiedono invalidazione cache Redis per riflettere
        subito in UI lo stato post-eliminazione.
        """
        # Sottotitolo manuale eliminato: rimuovi la riga dal DB (gestito a parte,
        # prima della logica asset/video). Nota: il file non esiste piu', quindi
        # _is_subtitle_file si basa solo sull'estensione.
        if not event.is_directory and event.src_path.lower().endswith(subs_common.SUB_EXTENSIONS):
            self._handle_subtitle_delete(event.src_path)
            return

        relative_path = self._get_relative_path(event.src_path)
        if not relative_path:
            return

        # Flag che indica se almeno una modifica al DB è stata applicata.
        # Solo in tal caso invalidiamo la cache.
        db_changed = False

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

                # Sottotitoli (.vtt) collegati: vanno rimossi dal disco prima del
                # DELETE FROM Video (la FK ON DELETE CASCADE cancella le righe DB,
                # ma non i file). Li raccogliamo qui finché il join è possibile.
                sub_files = []
                try:
                    cursor.execute(
                        "SELECT s.percorso_file FROM Sottotitoli s "
                        "JOIN Video v ON s.id_Video = v.id WHERE v.percorso_file = %s",
                        (relative_path,)
                    )
                    sub_files = [r['percorso_file'] for r in cursor.fetchall() if r.get('percorso_file')]
                except mysql.connector.Error:
                    sub_files = []  # tabella assente (feature non migrata)

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

                # Rimuovi i file .vtt dei sottotitoli rimasti orfani dopo il cascade.
                for sub_rel in sub_files:
                    if not sub_rel or sub_rel == 'mancante':
                        continue
                    sub_full = os.path.join(PATH_TO_MONITOR, sub_rel)
                    try:
                        os.remove(sub_full)
                        logging.info(f"File sottotitolo eliminato: {sub_rel}")
                    except FileNotFoundError:
                        pass
                    except Exception as e:
                        logging.error(f"Errore eliminazione sottotitolo {sub_full}: {e}")

            db_changed = True
        except mysql.connector.Error as err:
            logging.error(f"Errore DB (Eliminazione) per {relative_path}: {err}")
        finally:
            if cursor: cursor.close()
            if conn and conn.is_connected(): conn.close()

        if db_changed:
            invalidate_videos_and_categories(reason=f"eliminazione {relative_path}")

    # --- on_moved (MODIFICATO) ---
    def on_moved(self, event):
        """
        Gestisce lo spostamento/rinomina di file, asset E directory (Categorie).
        """
        # Sottotitoli manuali (.vtt/.srt): rinomina/spostamento. Rimuovi la riga
        # vecchia e, se la destinazione e' ancora un sottotitolo, re-importa.
        src_is_sub = (not event.is_directory) and event.src_path.lower().endswith(subs_common.SUB_EXTENSIONS)
        dest_is_sub = (not event.is_directory) and event.dest_path.lower().endswith(subs_common.SUB_EXTENSIONS)
        if src_is_sub or dest_is_sub:
            if src_is_sub:
                self._handle_subtitle_delete(event.src_path)
            if dest_is_sub:
                sanitized = sanitize_path(event.dest_path)
                if sanitized == event.dest_path:
                    self._handle_subtitle_upsert(sanitized)
            return

        # Bonifica immediata della destinazione se non conforme
        sanitized_dest = sanitize_path(event.dest_path)
        
        old_rel_path = self._get_relative_path(event.src_path)
        new_rel_path = self._get_relative_path(sanitized_dest)
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
            # Nome visualizzato: gli underscore (forzati dalla sanitize fs)
            # vengono riconvertiti in spazi per l'Admin/UI.
            new_category_display_name = new_category_name.replace('_', ' ')
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

            # 3-bis. Rinomina cartella Sottotitoli (stesso schema di copertine/anteprime).
            old_subs_dir_name = f"sottotitoli_{old_category_name}"
            new_subs_dir_name = f"sottotitoli_{new_category_name}"
            current_subs_dir_path = os.path.join(new_full_path_dir, old_subs_dir_name)
            target_subs_dir_path = os.path.join(new_full_path_dir, new_subs_dir_name)

            if os.path.exists(current_subs_dir_path):
                try:
                    os.rename(current_subs_dir_path, target_subs_dir_path)
                    logging.info(f"RINOMINATA cartella Sottotitoli: {old_subs_dir_name} -> {new_subs_dir_name}")
                except Exception as e:
                    logging.error(f"Fallita rinomina cartella Sottotitoli {current_subs_dir_path}: {e}")

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
                cursor.execute(query, (new_category_display_name, new_db_path, old_db_path))
                cat_rowcount = cursor.rowcount  # cattura PRIMA di altre query sullo stesso cursore

                # Aggiorna i path dei sottotitoli (.vtt): la cartella sottotitoli_<old>
                # è stata rinominata e il parent è cambiato. I percorso_file sono
                # salvati senza slash iniziale (es. "Cat/sottotitoli_Cat/video.en.vtt").
                old_subs_prefix = f"{old_rel_path}/sottotitoli_{old_category_name}/"
                new_subs_prefix = f"{new_rel_path}/sottotitoli_{new_category_name}/"
                try:
                    cursor.execute(
                        "UPDATE Sottotitoli SET percorso_file = REPLACE(percorso_file, %s, %s) "
                        "WHERE percorso_file LIKE %s",
                        (old_subs_prefix, new_subs_prefix, old_subs_prefix + '%')
                    )
                    if cursor.rowcount > 0:
                        logging.info(f"Aggiornati {cursor.rowcount} path sottotitoli per rinomina categoria.")
                except mysql.connector.Error as err_sub:
                    # Tabella Sottotitoli assente (feature non ancora migrata): ignora.
                    logging.debug(f"Update Sottotitoli saltato: {err_sub}")

                conn.commit()

                if cat_rowcount > 0:
                    logging.info(f"CATEGORIA Aggiornata: Nome='{new_category_display_name}', Percorso='{new_db_path}'")
                    invalidate_videos_and_categories(reason=f"rinomina categoria {old_db_path} -> {new_db_path}")
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

        # Spostamento/rinomina ha sempre conseguenze in UI:
        # titolo video, categoria, asset → invalida tutto il feed.
        invalidate_videos_and_categories(reason=f"spostamento {old_rel_path} -> {new_rel_path}")

def _sanitize_relative_path(rel_path):
    """
    Applica sanitize_name a ogni componente di un path relativo (in stile POSIX, '/').
    Usato per ricalcolare il path "sanificato" di un record DB partendo dal vecchio path.
    """
    if not rel_path or rel_path in ('/', ''):
        return rel_path
    has_leading = rel_path.startswith('/')
    parts = rel_path.strip('/').split('/')
    new_parts = []
    last_idx = len(parts) - 1
    for i, part in enumerate(parts):
        is_file = (i == last_idx) and ('.' in part)
        if is_conforming(part, is_file=is_file):
            new_parts.append(part)
        else:
            new_parts.append(sanitize_name(part, is_file=is_file))
    result = '/'.join(new_parts)
    if has_leading:
        result = '/' + result
    return result

def reconcile_db_after_sanitize(conn):
    """
    Dopo pre_scan_sanitize, allinea Categorie/Video al filesystem sanificato.
    - Riscrive Percorso/percorso_file/asset paths del DB sui nuovi nomi (con underscore).
    - Preserva il `Nome` originale delle categorie (con spazi) per Admin/UI.
    - Fonde eventuali duplicati creati da esecuzioni precedenti del bug
      (categoria vecchia con spazi + duplicata con underscore): mantiene la
      riga con Nome "umano", sposta i Video sulla riga giusta e cancella il duplicato.
    """
    logging.info("--- [Reconcile] Allineamento DB ai nomi sanificati su disco ---")
    changed = False
    try:
        cursor = conn.cursor(dictionary=True)

        # ---------- 1) CATEGORIE ----------
        cursor.execute("SELECT id, Nome, Percorso, Immagine_Sfondo FROM Categorie")
        cats = cursor.fetchall()
        # Indice per path (subirà mutazioni)
        cats_by_path = {c['Percorso']: c for c in cats}

        for cat in cats:
            old_path = cat['Percorso']
            if not old_path or old_path == '/':
                continue

            new_path = _sanitize_relative_path(old_path)
            if new_path == old_path:
                continue  # già conforme

            # Verifica che la nuova cartella esista davvero (altrimenti
            # ci penserà cleanup_missing_categories a rimuovere l'orfana).
            new_full = os.path.join(PATH_TO_MONITOR, new_path.lstrip('/'))
            if not os.path.isdir(new_full):
                continue

            # Determina il Nome "umano" da preservare/scegliere
            preserved_name = cat['Nome']
            if not preserved_name or '_' in preserved_name:
                # Se il Nome attuale è gia bruttino (underscores) prova a derivare
                # da Percorso vecchio (che storicamente ha gli spazi).
                derived = os.path.basename(old_path)
                if derived and ' ' in derived:
                    preserved_name = derived

            # Esiste già un duplicato con il nuovo path (creato da run precedenti)?
            dup = cats_by_path.get(new_path)
            if dup and dup['id'] != cat['id']:
                logging.info(
                    f"[Reconcile] Duplicato categoria: '{old_path}' (id={cat['id']}, Nome='{cat['Nome']}') "
                    f"<-> '{new_path}' (id={dup['id']}, Nome='{dup['Nome']}'). Fondo mantenendo Nome '{preserved_name}'."
                )
                cur2 = conn.cursor()
                # Sposta i video collegati al duplicato sulla riga "originale"
                cur2.execute(
                    "UPDATE Video SET id_Categoria = %s WHERE id_Categoria = %s",
                    (cat['id'], dup['id'])
                )
                # Eredita lo sfondo se la riga originale non ce l'ha
                if not cat['Immagine_Sfondo'] and dup['Immagine_Sfondo']:
                    cur2.execute(
                        "UPDATE Categorie SET Immagine_Sfondo = %s WHERE id = %s",
                        (dup['Immagine_Sfondo'], cat['id'])
                    )
                # Per evitare UNIQUE conflict sull'Immagine_Sfondo del duplicato,
                # azzeralo prima di cancellare.
                cur2.execute("UPDATE Categorie SET Immagine_Sfondo = NULL WHERE id = %s", (dup['id'],))
                cur2.execute("DELETE FROM Categorie WHERE id = %s", (dup['id'],))
                cur2.close()
                del cats_by_path[new_path]
                changed = True

            # Aggiorna la riga originale: nuovo Percorso, Nome con spazi preservato
            cur2 = conn.cursor()
            cur2.execute(
                "UPDATE Categorie SET Nome = %s, Percorso = %s WHERE id = %s",
                (preserved_name, new_path, cat['id'])
            )
            cur2.close()
            cats_by_path.pop(old_path, None)
            cat['Percorso'] = new_path
            cat['Nome'] = preserved_name
            cats_by_path[new_path] = cat
            logging.info(
                f"[Reconcile] Categoria id={cat['id']}: '{old_path}' -> '{new_path}' (Nome='{preserved_name}')"
            )
            changed = True

        conn.commit()

        # ---------- 2) VIDEO ----------
        cursor.execute("SELECT id, percorso_file, percorso_copertina, percorso_anteprima FROM Video")
        videos = cursor.fetchall()
        for v in videos:
            updates = {}
            for col in ('percorso_file', 'percorso_copertina', 'percorso_anteprima'):
                old = v[col]
                if not old or old == 'mancante':
                    continue
                new = _sanitize_relative_path(old)
                if new == old:
                    continue
                full = os.path.join(PATH_TO_MONITOR, new)
                if os.path.exists(full):
                    updates[col] = new
            if updates:
                set_clause = ', '.join(f"{k} = %s" for k in updates)
                params = list(updates.values()) + [v['id']]
                cur2 = conn.cursor()
                try:
                    cur2.execute(f"UPDATE Video SET {set_clause} WHERE id = %s", params)
                except mysql.connector.Error as err:
                    logging.error(f"[Reconcile] Update video id={v['id']} fallito: {err}")
                cur2.close()
                logging.info(f"[Reconcile] Video id={v['id']}: aggiornati {list(updates.keys())}")
                changed = True

        # ---------- 3) VIDEO_TEMP ----------
        cursor.execute("SELECT percorso_file FROM Video_Temp")
        temps = cursor.fetchall()
        for t in temps:
            old = t['percorso_file']
            new = _sanitize_relative_path(old)
            if new == old:
                continue
            full = os.path.join(PATH_TO_MONITOR, new)
            if not os.path.exists(full):
                continue
            cur2 = conn.cursor()
            try:
                cur2.execute(
                    "UPDATE Video_Temp SET percorso_file = %s WHERE percorso_file = %s",
                    (new, old)
                )
                changed = True
            except mysql.connector.Error as err:
                # Probabile conflitto INSERT IGNORE su PK: rimuovi il duplicato vecchio
                logging.warning(f"[Reconcile] Conflitto Video_Temp '{old}' -> '{new}': {err}. Rimuovo riga vecchia.")
                cur2.execute("DELETE FROM Video_Temp WHERE percorso_file = %s", (old,))
            cur2.close()

        conn.commit()
        cursor.close()
        logging.info("--- [Reconcile] Completato ---")
        if changed:
            invalidate_videos_and_categories(reason="reconcile DB post-sanitize")
    except Exception as e:
        logging.error(f"[Reconcile] Errore critico: {e}")

def cleanup_missing_videos(conn):
    logging.info("--- [Avvio Cleanup] Rimozione record video non esistenti su disco ---")
    deleted_count = 0
    try:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT id, percorso_file, percorso_copertina, percorso_anteprima FROM Video")
            rows = cursor.fetchall()
            
            for row in rows:
                rel_path = row['percorso_file']
                full_path = os.path.join(PATH_TO_MONITOR, rel_path)
                if not os.path.exists(full_path):
                    logging.info(f"Video non trovato su disco: {rel_path}. Rimuovo record ID {row['id']}.")
                    
                    # Rimuovi cover e anteprime rimaste orfane
                    for asset_key in ['percorso_copertina', 'percorso_anteprima']:
                        asset_rel = row[asset_key]
                        if asset_rel and asset_rel != 'mancante':
                            asset_full = os.path.join(PATH_TO_MONITOR, asset_rel)
                            if os.path.exists(asset_full):
                                try:
                                    os.remove(asset_full)
                                    logging.info(f"Rimosso asset orfano: {asset_rel}")
                                except Exception as e:
                                    logging.error(f"Errore rimozione asset {asset_rel}: {e}")
                    
                    cursor.execute("DELETE FROM Video WHERE id = %s", (row['id'],))
                    deleted_count += 1
            
            conn.commit()
            if deleted_count > 0:
                logging.info(f"Cleanup completato: rimossi {deleted_count} record video inesistenti.")
                invalidate_videos_and_categories(reason=f"cleanup {deleted_count} video mancanti")
            else:
                logging.info("Nessun record video obsoleto da rimuovere.")
    except Exception as e:
        logging.error(f"Errore durante il cleanup dei video mancanti: {e}")

def cleanup_missing_categories(conn):
    logging.info("--- [Avvio Cleanup] Rimozione categorie orfane ---")
    deleted_count = 0
    try:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT id, Nome, Percorso FROM Categorie")
            rows = cursor.fetchall()
            
            for row in rows:
                if row['Percorso'] == '/' or row['Percorso'] == '':
                    continue # Non eliminiamo mai la categoria Generale
                
                # Il percorso nel DB ha uno slash iniziale, lo togliamo per os.path.join
                rel_path = row['Percorso'].lstrip('/')
                full_path = os.path.join(PATH_TO_MONITOR, rel_path)
                
                if not os.path.exists(full_path):
                    logging.info(f"Categoria non trovata su disco: '{rel_path}'. Rimuovo record ID {row['id']}.")
                    cursor.execute("DELETE FROM Categorie WHERE id = %s", (row['id'],))
                    deleted_count += 1
            
            conn.commit()
            if deleted_count > 0:
                logging.info(f"Cleanup completato: rimosse {deleted_count} categorie orfane.")
                invalidate_videos_and_categories(reason=f"cleanup {deleted_count} categorie orfane")
    except Exception as e:
        logging.error(f"Errore durante il cleanup delle categorie mancanti: {e}")

# Match di filename tipo "Nome_File_1779748402.jpg" (10 cifre = Unix epoch a 32 bit).
# Estensioni: copertine (jpg/png/webp) + anteprime (mp4/webm/gif).
_TIMESTAMP_ASSET_RE = re.compile(
    r'^(?P<stem>.+)_(?P<ts>\d{10})(?P<ext>\.(?:jpg|jpeg|png|webp|mp4|webm|gif))$',
    re.IGNORECASE
)

def cleanup_timestamped_assets(conn):
    """
    Sistema definitivamente gli asset salvati con suffisso _<timestamp> dal
    vecchio bug del cache-busting filename (assets.php). Per ogni file
    matchato:
      - se NON esiste la versione "pulita" (<stem>.<ext>) -> rename del file
        e UPDATE dei record DB che lo referenziano.
      - se la versione pulita esiste gia' -> il file con timestamp e' un
        duplicato obsoleto, lo cancelliamo.

    Idempotente: al secondo avvio non trovera' piu' nulla.
    Limitato alle sole cartelle copertine_*/anteprime_* per non toccare
    nomi di file video legittimi (es. titoli che finiscono con cifre).
    """
    logging.info("--- [Cleanup TS] Normalizzazione asset con suffisso _<timestamp> ---")
    renamed = 0
    removed = 0
    db_updates = 0
    try:
        for root, dirs, files in os.walk(PATH_TO_MONITOR):
            dir_name = os.path.basename(root)
            if not (dir_name.startswith('copertine_') or dir_name.startswith('anteprime_')):
                continue

            for f in files:
                m = _TIMESTAMP_ASSET_RE.match(f)
                if not m:
                    continue
                # Validazione: timestamp deve essere in range plausibile
                # (2020-01-01 .. 2035-12-31). Evita di rinominare file
                # legittimi che contengono incidentalmente "_" + 10 cifre.
                try:
                    ts_int = int(m.group('ts'))
                except ValueError:
                    continue
                if not (1577836800 <= ts_int <= 2082758400):
                    continue

                old_full = os.path.join(root, f)
                new_name = m.group('stem') + m.group('ext')
                new_full = os.path.join(root, new_name)

                old_rel = os.path.relpath(old_full, PATH_TO_MONITOR).replace(os.sep, '/')
                new_rel = os.path.relpath(new_full, PATH_TO_MONITOR).replace(os.sep, '/')
                old_db = '/' + old_rel
                new_db = '/' + new_rel

                try:
                    if os.path.exists(new_full):
                        # Versione pulita gia' presente: il file con timestamp e' duplicato.
                        os.remove(old_full)
                        removed += 1
                        logging.info(f"[Cleanup TS] Duplicato rimosso: {old_rel}")
                    else:
                        os.rename(old_full, new_full)
                        renamed += 1
                        logging.info(f"[Cleanup TS] Rinominato: {old_rel} -> {new_rel}")
                except OSError as e:
                    logging.error(f"[Cleanup TS] Errore filesystem su {old_rel}: {e}")
                    continue

                # Aggiorna i record DB che referenziano il path vecchio.
                # Anche se abbiamo solo cancellato (duplicato), il DB potrebbe
                # ancora puntare al filename con timestamp -> lo facciamo puntare
                # a quello pulito.
                try:
                    with conn.cursor() as cursor:
                        cursor.execute(
                            "UPDATE Video SET percorso_copertina = %s WHERE percorso_copertina = %s",
                            (new_db, old_db)
                        )
                        db_updates += cursor.rowcount
                        cursor.execute(
                            "UPDATE Video SET percorso_anteprima = %s WHERE percorso_anteprima = %s",
                            (new_db, old_db)
                        )
                        db_updates += cursor.rowcount
                    conn.commit()
                except mysql.connector.Error as e:
                    logging.error(f"[Cleanup TS] Errore update DB per {old_rel}: {e}")

        if renamed or removed or db_updates:
            logging.info(
                f"[Cleanup TS] Completato: rinominati {renamed}, duplicati rimossi {removed}, "
                f"{db_updates} righe DB aggiornate."
            )
            invalidate_videos_and_categories(reason="cleanup_timestamped_assets")
        else:
            logging.info("[Cleanup TS] Nessun asset con suffisso timestamp trovato.")
    except Exception as e:
        logging.error(f"[Cleanup TS] Errore critico: {e}")


def cleanup_orphaned_assets(conn):
    import shutil
    import time
    logging.info("--- [Avvio Cleanup] Rimozione cartelle/file asset orfani ---")
    deleted_files = 0
    deleted_dirs = 0
    try:
        # Normalizza i path per il confronto: slash in avanti + niente slash
        # iniziale. CRITICO: l'upload da UI (assets.php) salva percorso_copertina
        # con uno slash iniziale ("/Cat/copertine_Cat/x.jpg"), mentre i worker e
        # os.path.relpath NON lo mettono. Senza questa normalizzazione le copertine
        # caricate a mano risultavano "orfane" e venivano cancellate al riavvio.
        def _norm(p):
            return p.replace('\\', '/').lstrip('/')

        valid_assets = set()
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT percorso_copertina, percorso_anteprima FROM Video")
            for row in cursor.fetchall():
                if row['percorso_copertina'] and row['percorso_copertina'] != 'mancante':
                    valid_assets.add(_norm(row['percorso_copertina']))
                if row['percorso_anteprima'] and row['percorso_anteprima'] != 'mancante':
                    valid_assets.add(_norm(row['percorso_anteprima']))

        current_time = time.time()
        for root, dirs, files in os.walk(PATH_TO_MONITOR, topdown=False):
            # Normalizziamo rel_root per avere gli slash in avanti
            rel_root = os.path.relpath(root, PATH_TO_MONITOR).replace('\\', '/')
            
            dir_name = os.path.basename(root)
            if dir_name.startswith('copertine_') or dir_name.startswith('anteprime_'):
                parent_dir = os.path.dirname(root)
                
                # Calcola il parent_name
                if os.path.realpath(parent_dir) == os.path.realpath(PATH_TO_MONITOR):
                    parent_name = "Generale"
                else:
                    parent_name = os.path.basename(parent_dir)
                
                is_wrong_name = (
                    (dir_name.startswith('copertine_') and dir_name != f"copertine_{parent_name}") or
                    (dir_name.startswith('anteprime_') and dir_name != f"anteprime_{parent_name}")
                )
                
                if is_wrong_name:
                    logging.info(f"Rimuovo cartella asset con nome obsoleto: {rel_root}")
                    try:
                        shutil.rmtree(root)
                        deleted_dirs += 1
                    except Exception as e:
                        logging.error(f"Errore rimozione {root}: {e}")
                    continue
                
                # Cartella valida, controlla i file interni
                for f in files:
                    file_rel_path = _norm(f"{rel_root}/{f}")
                    if file_rel_path not in valid_assets:
                        file_full_path = os.path.join(root, f)
                        if os.path.exists(file_full_path):
                            # Evita race condition con i worker Python in esecuzione (tolleranza 1 ora)
                            if current_time - os.path.getmtime(file_full_path) > 3600:
                                try:
                                    os.remove(file_full_path)
                                    deleted_files += 1
                                    logging.info(f"Rimosso file asset orfano: {file_rel_path}")
                                except Exception:
                                    pass
    except Exception as e:
        logging.error(f"Errore durante il cleanup degli asset orfani: {e}")
        
    if deleted_files > 0 or deleted_dirs > 0:
        logging.info(f"Cleanup asset completato: rimosse {deleted_dirs} cartelle obsolete e {deleted_files} file orfani.")

# --- Funzione Scansione ---
def _load_known_video_paths(conn):
    """
    Preload in memoria di tutti i percorso_file gia' presenti in Video e
    Video_Temp. Evita N query (una per file) durante perform_scan al restart:
    su una libreria di 200+ video si passa da ~200 SELECT a 2.
    """
    known = set()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT percorso_file FROM Video")
            known.update(row[0] for row in cursor.fetchall() if row[0])
            cursor.execute("SELECT percorso_file FROM Video_Temp")
            known.update(row[0] for row in cursor.fetchall() if row[0])
        logging.info(f"[Scan Iniziale] Preload: {len(known)} video gia' indicizzati nel DB.")
    except Exception as e:
        logging.error(f"[Scan Iniziale] Preload fallito (proseguo con check per-file): {e}")
    return known


def perform_scan(handler, conn=None):
    logging.info(f"--- [Scan Iniziale] Avvio scansione di {PATH_TO_MONITOR} ---")
    # Set dei path gia' noti al DB: per essi saltiamo on_created (niente query
    # ridondante, niente log INFO "gia' presente" che inondano il terminale).
    known_paths = _load_known_video_paths(conn) if conn is not None else set()

    scanned_total = 0
    already_known = 0
    newly_queued = 0
    try:
        for root, dirs, files in os.walk(PATH_TO_MONITOR, topdown=True):

            dirs[:] = [
                d for d in dirs
                if not d.startswith('.') and
                   not d.startswith('anteprime_') and
                   not d.startswith('copertine_') and
                   not d.startswith('sottotitoli_')
            ]

            for file in files:
                absolute_path = os.path.join(root, file)
                if handler._is_video_file(absolute_path):
                    scanned_total += 1
                    rel = handler._get_relative_path(absolute_path)
                    if rel and rel in known_paths:
                        # Gia' indicizzato: nessuna query DB, log a DEBUG.
                        already_known += 1
                        logging.debug(f"[Scan Iniziale] '{rel}' gia' noto, skip.")
                        continue
                    logging.info(f"[Scan Iniziale] Nuovo video: {rel or file}. Accodo.")
                    fake_event = FakeEvent(absolute_path, is_dir=False)
                    handler.on_created(fake_event)
                    newly_queued += 1
                elif handler._is_cover_file(absolute_path):
                    logging.debug(f"[Scan Iniziale] Trovata cover categoria: {file}. Elaborazione...")
                    fake_event = FakeEvent(absolute_path, is_dir=False)
                    handler.on_created(fake_event)

        logging.info(
            f"--- [Scan Iniziale] Completato: {scanned_total} video totali "
            f"({already_known} gia' indicizzati, {newly_queued} accodati). ---"
        )

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
    if not initial_conn:
        logging.critical("Impossibile stabilire la connessione iniziale al DB. Uscita.")
        sys.exit(1)

    event_handler = VideoHandler()

    # ORDINE CRITICO:
    # 1) Sanifica i nomi su disco (rinomine fs PRIMA che l'observer parta).
    # 2) Riallinea il DB ai nuovi nomi preservando i Nome con spazi e
    #    fondendo eventuali duplicati creati da run precedenti del bug.
    # 3) Cleanup di record/asset orfani (ora che i path sono coerenti).
    # 4) Scan iniziale per indicizzare nuovi video.
    pre_scan_sanitize(PATH_TO_MONITOR)
    reconcile_db_after_sanitize(initial_conn)
    # Normalizza i nomi degli asset col vecchio suffisso _<timestamp> PRIMA
    # del cleanup orfani: altrimenti i file timestampati verrebbero classificati
    # come orfani (non matchano il DB pulito) e cancellati invece che rinominati.
    cleanup_timestamped_assets(initial_conn)
    cleanup_missing_videos(initial_conn)
    cleanup_missing_categories(initial_conn)
    cleanup_orphaned_assets(initial_conn)
    logging.info("Cleanup iniziale completato.")

    # Passiamo la connessione viva: perform_scan la usa per il preload del set
    # dei video gia' indicizzati (evita N query SELECT nel loop di scansione).
    perform_scan(event_handler, conn=initial_conn)
    initial_conn.close()
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