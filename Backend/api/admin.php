<?php
/**
 * ============================================================================
 * Backend/api/admin.php
 * ============================================================================
 * 
 * SCOPO:
 * Punto di ingresso per tutte le operazioni amministrative del sistema.
 * Gestisce CRUD per video, categorie, utenti e monitoraggio del server.
 * 
 * AZIONI SUPPORTATE:
 * - lista_video / dettagli_video / aggiorna_info_video / elimina_video
 * - upload_copertina (gestione asset fisici)
 * - lista_categorie / aggiorna_categoria / upload_sfondo_categoria
 * - lista_utenti / toggle_admin / elimina_utente
 * - stato_server (statistiche disco e PHP)
 * 
 * SICUREZZA:
 * Richiede privilegi di amministratore verificati tramite check_admin.php.
 * Inibisce l'output di errori HTML per preservare l'integrità del JSON.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E CONFIGURAZIONE
// ============================================================================

// Include bootstrap, database e controlli di sicurezza admin
require_once 'check_admin.php';
require_once 'cache.php';

// Disabilita visualizzazione errori a schermo per non rompere il JSON
ini_set('display_errors', 0);
error_reporting(E_ALL);

// Costanti di sistema
// FIX: Usa variabile d'ambiente o fallback a path standard
$BASE_VIDEO_PATH = getenv('WATCH_DIR') ?: '/percorsoVideo';


// ============================================================================
// SEZIONE 2: AUTENTICAZIONE E SICUREZZA
// ============================================================================

/**
 * NOTA: La sicurezza è gestita nativamente da check_admin.php.
 * Se l'esecuzione arriva a questo punto, l'utente è autenticato e admin.
 */


// ============================================================================
// SEZIONE 3: GESTIONE INPUT E NORMALIZZAZIONE
// ============================================================================

// Gestione input JSON (da api.js o simili) che caricano il body in php://input
$input = json_decode(file_get_contents('php://input'), true);
if (is_array($input)) {
    $_POST = array_merge($_POST, $input);
}

$action = $_POST['action'] ?? '';


// ============================================================================
// SEZIONE 4: LOGICA CORE (CRUD E UTILITY)
// ============================================================================

try {
    switch ($action) {

        // --- GESTIONE VIDEO ---

        case 'lista_video':
            $limit = (int) ($_POST['limit'] ?? 20);
            $offset = (int) ($_POST['offset'] ?? 0);
            $query_search = $_POST['query'] ?? '';

            $sql = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima, v.Likes, c.Nome as Nome_Categoria, v.id_Categoria 
                    FROM Video v LEFT JOIN Categorie c ON v.id_Categoria = c.id ";
            $params = [];
            $types = "";

            if ($query_search) {
                $sql .= "WHERE v.Titolo LIKE ? ";
                $params[] = "%$query_search%";
                $types .= "s";
            }

            $sql .= "ORDER BY v.id DESC LIMIT ? OFFSET ?";
            $params[] = $limit;
            $params[] = $offset;
            $types .= "ii";

            $res = executePreparedQuery($sql, $types, $params);
            $data = $res->fetch_all(MYSQLI_ASSOC);

            inviaRisposta(true, 'Lista video caricata', 200, ['dati' => $data]);
            break;

        case 'dettagli_video':
            $id = (int) ($_POST['id'] ?? 0);
            if ($id <= 0)
                throw new Exception("ID Video non valido");

            // 1. Dati del Video
            $res = executePreparedQuery(
                "SELECT v.*, c.Nome as Nome_Categoria FROM Video v LEFT JOIN Categorie c ON v.id_Categoria = c.id WHERE v.id = ?",
                "i",
                [$id]
            );
            $video = $res->fetch_assoc();

            // 2. Lista Categorie completa (per il selettore nel frontend)
            $res_cats = $database->query("SELECT id, Nome FROM Categorie ORDER BY Nome ASC");
            $cats = $res_cats->fetch_all(MYSQLI_ASSOC);

            inviaRisposta(true, 'Dettagli video recuperati', 200, ['video' => $video, 'categorie' => $cats]);
            break;

        case 'aggiorna_info_video':
            $id = (int) $_POST['id'];
            $titolo = trim($_POST['titolo'] ?? '');
            $id_cat = (int) $_POST['id_categoria'];

            if (empty($titolo))
                throw new Exception("Il titolo non può essere vuoto");

            executePreparedQuery(
                "UPDATE Video SET Titolo = ?, id_Categoria = ? WHERE id = ?",
                "sii",
                [$titolo, $id_cat, $id]
            );

            global $Cache;
            $Cache->flush();
            inviaRisposta(true, 'Informazioni video aggiornate con successo');
            break;

        case 'upload_copertina':
            $id_video = (int) ($_POST['id_video'] ?? 0);
            if (!isset($_FILES['file_copertina']))
                throw new Exception("File copertina mancante");

            // Recupero informazioni per determinare il percorso di destinazione
            $res = executePreparedQuery(
                "SELECT v.percorso_file, c.Nome as Nome_Cat FROM Video v LEFT JOIN Categorie c ON v.id_Categoria = c.id WHERE v.id = ?",
                "i",
                [$id_video]
            );
            $info = $res->fetch_assoc();

            if (!$info)
                throw new Exception("Video non trovato (ID: $id_video)");

            // La copertina deve stare nella stessa cartella del file video
            $video_rel_dir = dirname($info['percorso_file']);
            if ($video_rel_dir == '.')
                $video_rel_dir = "";

            // Normalize slashes
            $video_rel_dir = str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $video_rel_dir);
            $base_path = str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $BASE_VIDEO_PATH);

            $target_dir = $base_path . ($video_rel_dir ? DIRECTORY_SEPARATOR . $video_rel_dir : '');

            // Validazione cartella e permessi
            if (!file_exists($target_dir))
                throw new Exception("Percorso non trovato su disco: $target_dir");
            if (!is_writable($target_dir))
                throw new Exception("Permessi di scrittura negati nella cartella asset");

            // Validazione tipo file (MIME)
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime = finfo_file($finfo, $_FILES['file_copertina']['tmp_name']);
            finfo_close($finfo);

            $allowed_mimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
            if (!in_array($mime, $allowed_mimes))
                throw new Exception("Formato immagine non supportato: $mime");

            $ext_map = ['image/jpeg' => 'jpg', 'image/jpg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
            $ext = $ext_map[$mime];

            // Rinomina la copertina con lo stesso nome del video
            $filename_no_ext = pathinfo($info['percorso_file'], PATHINFO_FILENAME);
            $new_filename = $filename_no_ext . "." . $ext;
            $target_file = $target_dir . DIRECTORY_SEPARATOR . $new_filename;

            if (move_uploaded_file($_FILES['file_copertina']['tmp_name'], $target_file)) {
                // DB path always uses forward slashes for URL compatibility
                $db_rel_path = str_replace(DIRECTORY_SEPARATOR, '/', $video_rel_dir);
                $db_path = '/' . ($db_rel_path ? $db_rel_path . '/' : '') . $new_filename;

                executePreparedQuery("UPDATE Video SET percorso_copertina = ? WHERE id = ?", "si", [$db_path, $id_video]);
                global $Cache;
                $Cache->flush();
                inviaRisposta(true, 'Copertina caricata e aggiornata', 200, ['nuovo_path' => $db_path]);
            } else {
                throw new Exception("Errore durante lo spostamento del file caricato");
            }
            break;

        case 'rimuovi_copertina':
            $id = (int) ($_POST['id_video'] ?? 0);

            $res = executePreparedQuery("SELECT percorso_copertina FROM Video WHERE id = ?", "i", [$id]);
            $video = $res->fetch_assoc();

            if (!$video)
                throw new Exception("Video non trovato");

            if ($video['percorso_copertina'] && $video['percorso_copertina'] != 'mancante') {
                // Normalizzazione path per Windows/Unix
                $clean_path = ltrim(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $video['percorso_copertina']), DIRECTORY_SEPARATOR);
                $full_path = $BASE_VIDEO_PATH . DIRECTORY_SEPARATOR . $clean_path;

                if (file_exists($full_path)) {
                    if (!@unlink($full_path)) {
                        error_log("⚠️ Errore eliminazione copertina: $full_path");
                    }
                }
            }

            executePreparedQuery("UPDATE Video SET percorso_copertina = NULL WHERE id = ?", "i", [$id]);
            global $Cache;
            $Cache->flush();
            inviaRisposta(true, 'Copertina rimossa (in coda per rigenerazione)');
            break;

        case 'upload_anteprima':
            $id_video = (int) ($_POST['id_video'] ?? 0);
            if (!isset($_FILES['file_anteprima']))
                throw new Exception("File anteprima mancante");

            $res = executePreparedQuery("SELECT v.percorso_file FROM Video v WHERE v.id = ?", "i", [$id_video]);
            $info = $res->fetch_assoc();

            if (!$info)
                throw new Exception("Video non trovato (ID: $id_video)");

            $video_rel_dir = trim(dirname($info['percorso_file']), '.\\/');
            $base_path = rtrim(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $BASE_VIDEO_PATH), DIRECTORY_SEPARATOR);
            $target_dir = $base_path . ($video_rel_dir ? DIRECTORY_SEPARATOR . $video_rel_dir : '');

            if (!file_exists($target_dir))
                throw new Exception("Percorso non trovato su disco: $target_dir");

            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime = finfo_file($finfo, $_FILES['file_anteprima']['tmp_name']);
            finfo_close($finfo);

            $allowed_mimes = ['video/mp4', 'video/webm', 'image/gif', 'image/webp'];
            if (!in_array($mime, $allowed_mimes))
                throw new Exception("Formato anteprima non supportato: $mime");

            $ext_map = ['video/mp4' => 'mp4', 'video/webm' => 'webm', 'image/gif' => 'gif', 'image/webp' => 'webp'];
            $ext = $ext_map[$mime];

            $filename_no_ext = pathinfo($info['percorso_file'], PATHINFO_FILENAME);
            $new_filename = $filename_no_ext . "_preview." . $ext;
            $target_file = $target_dir . DIRECTORY_SEPARATOR . $new_filename;

            if (move_uploaded_file($_FILES['file_anteprima']['tmp_name'], $target_file)) {
                $db_rel_path = str_replace(DIRECTORY_SEPARATOR, '/', $video_rel_dir);
                $db_path = '/' . ($db_rel_path ? $db_rel_path . '/' : '') . $new_filename;

                executePreparedQuery("UPDATE Video SET percorso_anteprima = ? WHERE id = ?", "si", [$db_path, $id_video]);
                global $Cache;
                $Cache->flush();
                inviaRisposta(true, 'Anteprima caricata e aggiornata', 200, ['nuovo_path' => $db_path]);
            } else {
                throw new Exception("Errore durante lo spostamento del file caricato");
            }
            break;

        case 'rimuovi_anteprima':
            $id = (int) ($_POST['id_video'] ?? 0);

            $res = executePreparedQuery("SELECT percorso_anteprima FROM Video WHERE id = ?", "i", [$id]);
            $video = $res->fetch_assoc();

            if (!$video)
                throw new Exception("Video non trovato");

            if ($video['percorso_anteprima'] && $video['percorso_anteprima'] != 'mancante') {
                $clean_path = ltrim(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $video['percorso_anteprima']), DIRECTORY_SEPARATOR);
                $full_path = $BASE_VIDEO_PATH . DIRECTORY_SEPARATOR . $clean_path;

                if (file_exists($full_path)) {
                    @unlink($full_path);
                }
            }

            executePreparedQuery("UPDATE Video SET percorso_anteprima = NULL WHERE id = ?", "i", [$id]);
            global $Cache;
            $Cache->flush();
            inviaRisposta(true, 'Anteprima rimossa');
            break;

        case 'elimina_video':
            $id = (int) ($_POST['id_video'] ?? 0);

            // Recupero i path dei file per eliminarli fisicamente
            $res = executePreparedQuery("SELECT percorso_file, percorso_copertina, percorso_anteprima FROM Video WHERE id = ?", "i", [$id]);
            $info = $res->fetch_assoc();

            // Rimozione dal DB
            executePreparedQuery("DELETE FROM Video WHERE id = ?", "i", [$id]);

            // Rimozione file fisici dal disco
            if ($info) {
                foreach ($info as $key => $path) {
                    if ($path && $path != 'mancante') {
                        // Normalizzazione path per Windows/Unix
                        $clean_path = ltrim(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $path), DIRECTORY_SEPARATOR);
                        $full_path = $BASE_VIDEO_PATH . DIRECTORY_SEPARATOR . $clean_path;

                        // Tentativo di eliminazione se il file esiste
                        if (file_exists($full_path)) {
                            if (!@unlink($full_path)) {
                                error_log("⚠️ Errore eliminazione file: $full_path");
                            }
                        }
                    }
                }
            }

            global $Cache;
            $Cache->flush();
            inviaRisposta(true, 'Video ed elementi correlati (file/anteprime) rimossi');
            break;


        // --- GESTIONE CATEGORIE ---

        case 'lista_categorie':
            $sql = "SELECT c.*, (SELECT COUNT(*) FROM Video v WHERE v.id_Categoria = c.id) as num_video FROM Categorie c ORDER BY c.Nome ASC";
            $res = $database->query($sql);
            inviaRisposta(true, 'Elenco categorie caricato', 200, ['dati' => $res->fetch_all(MYSQLI_ASSOC)]);
            break;

        case 'aggiorna_categoria':
            $id = (int) $_POST['id'];
            $nome = trim($_POST['nome'] ?? '');
            if (empty($nome))
                throw new Exception("Il nome della categoria è obbligatorio");

            executePreparedQuery("UPDATE Categorie SET Nome = ? WHERE id = ?", "si", [$nome, $id]);
            global $Cache;
            $Cache->flush();
            inviaRisposta(true, 'Categoria aggiornata con successo');
            break;

        case 'salva_colore_categoria':
            $id = (int) ($_POST['id_categoria'] ?? 0);
            $colore = $_POST['colore'] ?? '';
            // Se stringa vuota o non valorizzato, verrà salvato come NULL nel DB tramite gestione intelligente se facciamo un if.

            if (empty($colore)) {
                executePreparedQuery("UPDATE Categorie SET Colore_Default = NULL WHERE id = ?", "i", [$id]);
            } else {
                executePreparedQuery("UPDATE Categorie SET Colore_Default = ? WHERE id = ?", "si", [$colore, $id]);
            }

            global $Cache;
            $Cache->flush();
            inviaRisposta(true, 'Colore categoria aggiornato con successo');
            break;

        case 'upload_sfondo_categoria':
            $id = (int) ($_POST['id_categoria'] ?? 0);
            if (!isset($_FILES['file_sfondo']))
                throw new Exception("File sfondo mancante");

            if ($_FILES['file_sfondo']['error'] !== UPLOAD_ERR_OK) {
                throw new Exception("Errore durante l'upload del file (Codice: " . $_FILES['file_sfondo']['error'] . ")");
            }

            $res = executePreparedQuery("SELECT Nome, Percorso FROM Categorie WHERE id = ?", "i", [$id]);
            $cat = $res->fetch_assoc();
            if (!$cat)
                throw new Exception("Categoria non trovata");

            // Verifica formato
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime = finfo_file($finfo, $_FILES['file_sfondo']['tmp_name']);
            finfo_close($finfo);

            if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'])) {
                throw new Exception("Formato non valido: $mime");
            }

            $target_dir = $BASE_VIDEO_PATH . '/' . ltrim($cat['Percorso'], '/');
            if (!file_exists($target_dir))
                throw new Exception("Cartella di destinazione non esistente: $target_dir");
            if (!is_writable($target_dir))
                throw new Exception("Permessi negati nella cartella: $target_dir");

            $ext = ($mime == 'image/png') ? 'png' : (($mime == 'image/webp') ? 'webp' : 'jpg');
            $new_filename = "cover." . $ext;

            // Fix path separator for Windows
            $target_file = $target_dir . DIRECTORY_SEPARATOR . $new_filename;

            if (move_uploaded_file($_FILES['file_sfondo']['tmp_name'], $target_file)) {
                $db_rel_path = ltrim($cat['Percorso'], '/');
                $db_path = '/' . $db_rel_path . '/' . $new_filename;
                executePreparedQuery("UPDATE Categorie SET Immagine_Sfondo = ? WHERE id = ?", "si", [$db_path, $id]);
                global $Cache;
                $Cache->flush();
                inviaRisposta(true, 'Sfondo categoria aggiornato', 200, ['nuovo_path' => $db_path]);
            } else {
                throw new Exception("Errore nel salvataggio fisico del file");
            }
            break;

        case 'rimuovi_sfondo_categoria':
            $id = (int) ($_POST['id_categoria'] ?? 0);

            $res = executePreparedQuery("SELECT Immagine_Sfondo FROM Categorie WHERE id = ?", "i", [$id]);
            $cat = $res->fetch_assoc();

            if (!$cat)
                throw new Exception("Categoria non trovata");

            if ($cat['Immagine_Sfondo']) {
                $path = ltrim($cat['Immagine_Sfondo'], '/');
                // Path fisico completo
                $full_path = $BASE_VIDEO_PATH . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $path);

                if (file_exists($full_path)) {
                    if (!@unlink($full_path)) {
                        // Logghiamo l'errore ma procediamo col DB update se possibile, 
                        // oppure lanciamo eccezione. Qui scegliamo di pulire il DB comunque o di avvisare.
                        error_log("⚠️ Impossibile eliminare fisicamente lo sfondo: $full_path");
                    }
                }
            }

            executePreparedQuery("UPDATE Categorie SET Immagine_Sfondo = NULL WHERE id = ?", "i", [$id]);
            global $Cache;
            $Cache->flush();
            inviaRisposta(true, 'Sfondo rimosso con successo');
            break;


        // --- GESTIONE UTENTI ---

        case 'lista_utenti':
            $res = $database->query("SELECT id, Nome_Utente, ultimo_Accesso, Admin, Immagine_Profilo FROM Utenti ORDER BY id ASC");
            inviaRisposta(true, 'Lista utenti caricata', 200, ['dati' => $res->fetch_all(MYSQLI_ASSOC)]);
            break;

        case 'toggle_admin':
            $id = (int) $_POST['id_utente'];
            if ($id == $_SESSION['id_utente'])
                throw new Exception("Non puoi modificare i tuoi permessi admin");

            executePreparedQuery("UPDATE Utenti SET Admin = NOT Admin WHERE id = ?", "i", [$id]);
            inviaRisposta(true, 'Permessi utente aggiornati');
            break;


        case 'elimina_utente':
            $id = (int) $_POST['id_utente'];
            if ($id == $_SESSION['id_utente'])
                throw new Exception("Non puoi eliminare il tuo stesso account amministratore");

            executePreparedQuery("DELETE FROM Utenti WHERE id = ?", "i", [$id]);
            inviaRisposta(true, 'Utente eliminato definitivamente');
            break;

        case 'aggiungi_utente':
            $username = trim($_POST['username'] ?? '');
            $password = $_POST['password'] ?? '';
            $is_admin = isset($_POST['is_admin']) && $_POST['is_admin'] === 'true' ? 1 : 0;

            if (empty($username) || empty($password)) {
                throw new Exception("Username e Password sono obbligatori.");
            }

            // Verifica se l'utente esiste già
            $stmt = $database->prepare("SELECT id FROM Utenti WHERE Nome_Utente = ?");
            $stmt->bind_param("s", $username);
            $stmt->execute();
            if ($stmt->fetch()) {
                $stmt->close();
                throw new Exception("Username già esistente.");
            }
            $stmt->close();

            // Hash della password
            $hashed_password = password_hash($password, PASSWORD_DEFAULT);

            // Inserimento utente
            $stmt = $database->prepare("INSERT INTO Utenti (Nome_Utente, Password, Admin, ultimo_Accesso) VALUES (?, ?, ?, NULL)");
            $stmt->bind_param("ssi", $username, $hashed_password, $is_admin);
            $stmt->execute();
            $stmt->close();

            inviaRisposta(true, 'Utente creato con successo');
            break;

        case 'reset_password_utente':
            $target_id = $_POST['id_utente'] ?? null;
            $new_password = $_POST['nuova_password'] ?? '';

            if (!$target_id || empty($new_password)) {
                inviaRisposta(false, "ID utente e Nuova Password sono obbligatori.", 400);
            }

            if (strlen($new_password) < 4) {
                inviaRisposta(false, 'La password deve avere almeno 4 caratteri.', 400);
            }

            // Eseguiamo l'hash
            $hashed_password = password_hash($new_password, PASSWORD_DEFAULT);

            if (executePreparedQuery("UPDATE Utenti SET Password = ? WHERE id = ?", "si", [$hashed_password, $target_id])) {
                inviaRisposta(true, "Password dell'utente reimpostata con successo.", 200);
            } else {
                throw new Exception("Errore durante l'aggiornamento della password.");
            }
            break;

        case 'lista_accessi':
            $res = $database->query("SELECT id, indirizzo_Ip, data_ora_tentativo, successo, Nome_Utente FROM Accessi ORDER BY data_ora_tentativo DESC LIMIT 500");
            inviaRisposta(true, 'Lista accessi caricata', 200, ['dati' => $res->fetch_all(MYSQLI_ASSOC)]);
            break;

        case 'salva_impostazioni_globali':
            $tema = $_POST['tema_default'] ?? null;
            if ($tema) {
                // Valida colore esadecimale (semplice)
                if (preg_match('/^#[a-f0-9]{6}$/i', $tema)) {
                    $descrizione = 'Colore primario di default per schermata Login e utenti senza personalizzazione';
                    executePreparedQuery(
                        "INSERT INTO Impostazioni (Chiave_Impostazione, Valore_Impostazione, Descrizione) VALUES ('colore_tema_default', ?, ?) ON DUPLICATE KEY UPDATE Valore_Impostazione = ?",
                        "sss",
                        [$tema, $descrizione, $tema]
                    );

                    // Pulisci Cache per ricaricare le info la prossima volta
                    if (isset($Cache) && is_object($Cache)) {
                        $Cache->delete('impostazioni_globali');
                    }
                    inviaRisposta(true, 'Impostazioni salvate con successo');
                } else {
                    inviaRisposta(false, 'Colore Hex non valido', 400);
                }
            } else {
                inviaRisposta(false, 'Nessun dato da salvare', 400);
            }
            break;

        // --- DIAGNOSTICA SERVER ---

        case 'stato_server':
            $path = $BASE_VIDEO_PATH;

            // FIX: Se il percorso configured non esiste (es. dev in Windows), usiamo la cartella corrente
            // per evitare Fatal Error su disk_total_space
            if (!file_exists($path)) {
                $path = __DIR__;
            }

            // Suppress error in case of permission issues even if exists
            $total = @disk_total_space($path) ?: 0;
            $free = @disk_free_space($path) ?: 0;
            $used = $total - $free;

            $stats = [
                'disco_totale_gb' => $total > 0 ? round($total / 1073741824, 2) : 0,
                'disco_usato_gb' => $total > 0 ? round($used / 1073741824, 2) : 0,
                'disco_libero_gb' => $total > 0 ? round($free / 1073741824, 2) : 0,
                'disco_percentuale' => $total > 0 ? round(($used / $total) * 100, 1) : 0,
                'php_upload_max' => ini_get('upload_max_filesize'),
                'php_post_max' => ini_get('post_max_size'),
                'db_version' => $database->server_info
            ];

            inviaRisposta(true, 'Statistiche server aggiornate', 200, ['dati' => $stats]);
            break;

        case 'salva_logo':
            require_once 'cache.php';
            global $Cache;

            $primo = trim($_POST['logo_part_1'] ?? '');
            $secondo = trim($_POST['logo_part_2'] ?? '');

            if (empty($primo) || empty($secondo)) {
                throw new Exception("Entrambe le parti del logo sono obbligatorie");
            }

            executePreparedQuery("INSERT INTO Impostazioni (Chiave_Impostazione, Valore_Impostazione) VALUES ('logo_part_1', ?) ON DUPLICATE KEY UPDATE Valore_Impostazione = ?", "ss", [$primo, $primo]);
            executePreparedQuery("INSERT INTO Impostazioni (Chiave_Impostazione, Valore_Impostazione) VALUES ('logo_part_2', ?) ON DUPLICATE KEY UPDATE Valore_Impostazione = ?", "ss", [$secondo, $secondo]);

            if (isset($Cache) && is_object($Cache)) {
                $Cache->delete('impostazioni_globali');
            }

            inviaRisposta(true, 'Logo aggiornato con successo');
            break;

        default:
            inviaRisposta(false, "Azione amministrativa non supportata: $action", 400);
    }

} catch (Throwable $e) {
    error_log("❌ [ADMIN ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore: " . $e->getMessage(), 500);
}


// ============================================================================
// SEZIONE 5: CHIUSURA
// ============================================================================
$database->close();
?>