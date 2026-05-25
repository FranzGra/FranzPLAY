<?php
if (!defined('ADMIN_API'))
    exit('Nessun accesso diretto consentito.');

require_once __DIR__ . '/../path_safety.php';

/**
 * Traduce il codice di errore in $_FILES['x']['error'] in un messaggio
 * leggibile. Senza questo, "move_uploaded_file" fallisce silenziosamente e
 * l'utente vede solo "Errore durante lo spostamento del file caricato"
 * anche quando la causa reale è il limite PHP upload_max_filesize.
 */
function describeUploadError($err)
{
    switch ((int) $err) {
        case UPLOAD_ERR_OK: return null;
        case UPLOAD_ERR_INI_SIZE:
            return 'File troppo grande: supera upload_max_filesize del server ('
                . ini_get('upload_max_filesize') . ').';
        case UPLOAD_ERR_FORM_SIZE: return 'File troppo grande (limite del form).';
        case UPLOAD_ERR_PARTIAL: return 'Upload interrotto: il file è arrivato solo in parte.';
        case UPLOAD_ERR_NO_FILE: return 'Nessun file ricevuto.';
        case UPLOAD_ERR_NO_TMP_DIR: return 'Cartella temporanea PHP non disponibile.';
        case UPLOAD_ERR_CANT_WRITE: return 'Impossibile scrivere il file su disco.';
        case UPLOAD_ERR_EXTENSION: return 'Upload bloccato da un\'estensione PHP.';
        default: return 'Errore upload sconosciuto (codice ' . (int) $err . ').';
    }
}

/**
 * Validazione completa di una entry $_FILES. Lancia eccezione con dettagli
 * utili al primo problema. Va chiamata PRIMA di toccare tmp_name.
 */
function assertUploadOk($fileEntry, $fieldLabel)
{
    if (!is_array($fileEntry)) {
        throw new Exception("Campo upload '$fieldLabel' mancante nella richiesta.");
    }
    $errMsg = describeUploadError($fileEntry['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($errMsg !== null) {
        throw new Exception("$fieldLabel: $errMsg");
    }
    if (empty($fileEntry['tmp_name']) || !is_uploaded_file($fileEntry['tmp_name'])) {
        throw new Exception("$fieldLabel: file temporaneo non valido (possibile attacco o upload corrotto).");
    }
    if (($fileEntry['size'] ?? 0) <= 0) {
        throw new Exception("$fieldLabel: file vuoto (0 byte).");
    }
}

switch ($action) {
    case 'upload_copertina':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        assertUploadOk($_FILES['file_copertina'] ?? null, 'Copertina');

        // Recupero informazioni per determinare il percorso di destinazione
        $res = executePreparedQuery(
            "SELECT v.percorso_file, v.percorso_copertina, c.Nome as Nome_Cat FROM Video v LEFT JOIN Categorie c ON v.id_Categoria = c.id WHERE v.id = ?",
            "i",
            [$id_video]
        );
        $info = $res->fetch_assoc();

        if (!$info)
            throw new Exception("Video non trovato (ID: $id_video)");

        // La copertina deve stare nella cartella copertine_[NomeCartellaDisco].
        // Importante: NON usiamo Categorie.Nome (che contiene gli spazi), ma il
        // basename della cartella su disco (che il watcher sanifica con underscore).
        // Altrimenti creiamo "copertine_Freeuse MILF" anziché "copertine_Freeuse_MILF"
        // e Python worker_assets / PHP non si trovano d'accordo sulla destinazione.
        $video_rel_dir = trim(dirname($info['percorso_file']), '.\\/');
        if ($video_rel_dir == '.')
            $video_rel_dir = "";

        $cat_folder_name = $video_rel_dir !== "" ? basename($video_rel_dir) : 'Generale';
        $cover_dir_name = 'copertine_' . $cat_folder_name;
        $video_rel_dir = $video_rel_dir ? $video_rel_dir . '/' . $cover_dir_name : $cover_dir_name;

        global $BASE_VIDEO_PATH;
        // Rimuovi vecchia copertina (con path safety)
        if ($info['percorso_copertina'] && $info['percorso_copertina'] != 'mancante') {
            $old_full_path = safeJoinPath($BASE_VIDEO_PATH, ltrim($info['percorso_copertina'], '/\\'));
            if ($old_full_path !== null && file_exists($old_full_path)) {
                @unlink($old_full_path);
            }
        }

        $target_dir = safeJoinPath($BASE_VIDEO_PATH, ltrim($video_rel_dir, '/\\'));
        if ($target_dir === null) {
            error_log("🚨 [SECURITY] Path traversal in upload_copertina: $video_rel_dir");
            throw new Exception("Percorso copertina non valido");
        }

        if (!file_exists($target_dir)) {
            if (!@mkdir($target_dir, 0755, true)) {
                throw new Exception("Impossibile creare la cartella di destinazione: $target_dir");
            }
        }

        // Validazione cartella e permessi
        if (!is_writable($target_dir))
            throw new Exception("Permessi di scrittura negati nella cartella asset: $target_dir");

        // Validazione tipo file (MIME)
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($finfo, $_FILES['file_copertina']['tmp_name']);
        finfo_close($finfo);

        $allowed_mimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        if (!in_array($mime, $allowed_mimes))
            throw new Exception("Formato immagine non supportato: $mime");

        $ext_map = ['image/jpeg' => 'jpg', 'image/jpg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        $ext = $ext_map[$mime];

        // Rinomina la copertina con lo stesso nome del video + timestamp
        // (cache-busting: l'URL cambia ad ogni upload, niente cache stantia nei browser).
        $filename_no_ext = pathinfo($info['percorso_file'], PATHINFO_FILENAME);
        $new_filename = $filename_no_ext . "_" . time() . "." . $ext;
        $target_file = $target_dir . DIRECTORY_SEPARATOR . $new_filename;

        if (!@move_uploaded_file($_FILES['file_copertina']['tmp_name'], $target_file)) {
            $reason = is_writable($target_dir) ? 'cause sconosciute' : "permessi negati su $target_dir";
            $free = @disk_free_space($target_dir);
            if ($free !== false && $free < $_FILES['file_copertina']['size'] * 2) {
                $reason = 'spazio disco insufficiente (' . round($free / 1048576) . ' MB liberi)';
            }
            throw new Exception("Spostamento copertina fallito: $reason. Destinazione: $target_file");
        }
        if (true) {
            // DB path always uses forward slashes for URL compatibility
            $db_rel_path = str_replace(DIRECTORY_SEPARATOR, '/', $video_rel_dir);
            $db_path = '/' . ($db_rel_path ? $db_rel_path . '/' : '') . $new_filename;

            executePreparedQuery("UPDATE Video SET percorso_copertina = ? WHERE id = ?", "si", [$db_path, $id_video]);
            global $Cache;
            if (isset($Cache) && is_object($Cache)) {
                // Invalidazione mirata: lista pubblica + categorie.
                $Cache->deletePattern('videos_list_*');
                $Cache->delete('categorie_list_v1');
            }
            inviaRisposta(true, 'Copertina caricata e aggiornata', 200, ['nuovo_path' => $db_path]);
        }
        break;

    case 'rimuovi_copertina':
        $id = (int) ($_POST['id_video'] ?? 0);

        $res = executePreparedQuery("SELECT percorso_copertina FROM Video WHERE id = ?", "i", [$id]);
        $video = $res->fetch_assoc();

        if (!$video)
            throw new Exception("Video non trovato");

        global $BASE_VIDEO_PATH;
        if ($video['percorso_copertina'] && $video['percorso_copertina'] != 'mancante') {
            $full_path = safeJoinPath($BASE_VIDEO_PATH, ltrim($video['percorso_copertina'], '/\\'));
            if ($full_path === null) {
                error_log("🚨 [SECURITY] Path traversal in rimuovi_copertina: " . $video['percorso_copertina']);
            } elseif (file_exists($full_path) && !@unlink($full_path)) {
                error_log("⚠️ Errore eliminazione copertina: $full_path");
            }
        }

        executePreparedQuery("UPDATE Video SET percorso_copertina = NULL WHERE id = ?", "i", [$id]);
        global $Cache;
        if (isset($Cache) && is_object($Cache)) {
            // Invalidazione mirata: solo la lista video pubblica (Home/Categorie)
            // e la lista categorie. MAI flush() globale — distruggerebbe i
            // contatori del rate limiter, lo status cachato e tutto il resto.
            $Cache->deletePattern('videos_list_*');
            $Cache->delete('categorie_list_v1');
        }
        inviaRisposta(true, 'Copertina rimossa (in coda per rigenerazione)');
        break;

    case 'upload_anteprima':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        assertUploadOk($_FILES['file_anteprima'] ?? null, 'Anteprima');

        $res = executePreparedQuery(
            "SELECT v.percorso_file, v.percorso_anteprima, c.Nome as Nome_Cat FROM Video v LEFT JOIN Categorie c ON v.id_Categoria = c.id WHERE v.id = ?",
            "i",
            [$id_video]
        );
        $info = $res->fetch_assoc();

        if (!$info)
            throw new Exception("Video non trovato (ID: $id_video)");

        // Vedi commento upload_copertina: usiamo il nome della cartella su disco
        // (sanificato con underscore) e NON Categorie.Nome (con spazi).
        $video_rel_dir = trim(dirname($info['percorso_file']), '.\\/');
        $cat_folder_name = $video_rel_dir !== "" ? basename($video_rel_dir) : 'Generale';
        $preview_dir_name = 'anteprime_' . $cat_folder_name;
        $video_rel_dir = $video_rel_dir ? $video_rel_dir . '/' . $preview_dir_name : $preview_dir_name;

        global $BASE_VIDEO_PATH;
        // Rimuovi vecchia anteprima (con path safety)
        if ($info['percorso_anteprima'] && $info['percorso_anteprima'] != 'mancante') {
            $old_full_path = safeJoinPath($BASE_VIDEO_PATH, ltrim($info['percorso_anteprima'], '/\\'));
            if ($old_full_path !== null && file_exists($old_full_path)) {
                @unlink($old_full_path);
            }
        }

        $target_dir = safeJoinPath($BASE_VIDEO_PATH, ltrim($video_rel_dir, '/\\'));
        if ($target_dir === null) {
            error_log("🚨 [SECURITY] Path traversal in upload_anteprima: $video_rel_dir");
            throw new Exception("Percorso anteprima non valido");
        }

        if (!file_exists($target_dir)) {
            if (!@mkdir($target_dir, 0755, true)) {
                throw new Exception("Impossibile creare la cartella di destinazione: $target_dir");
            }
        }

        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($finfo, $_FILES['file_anteprima']['tmp_name']);
        finfo_close($finfo);

        $allowed_mimes = ['video/mp4', 'video/webm', 'image/gif', 'image/webp'];
        if (!in_array($mime, $allowed_mimes))
            throw new Exception("Formato anteprima non supportato: $mime");

        $ext_map = ['video/mp4' => 'mp4', 'video/webm' => 'webm', 'image/gif' => 'gif', 'image/webp' => 'webp'];
        $ext = $ext_map[$mime];

        // Stesso cache-busting via timestamp del case upload_copertina.
        $filename_no_ext = pathinfo($info['percorso_file'], PATHINFO_FILENAME);
        $new_filename = $filename_no_ext . "_" . time() . "." . $ext;
        $target_file = $target_dir . DIRECTORY_SEPARATOR . $new_filename;

        if (!@move_uploaded_file($_FILES['file_anteprima']['tmp_name'], $target_file)) {
            $reason = is_writable($target_dir) ? 'cause sconosciute' : "permessi negati su $target_dir";
            $free = @disk_free_space($target_dir);
            if ($free !== false && $free < $_FILES['file_anteprima']['size'] * 2) {
                $reason = 'spazio disco insufficiente (' . round($free / 1048576) . ' MB liberi)';
            }
            throw new Exception("Spostamento anteprima fallito: $reason. Destinazione: $target_file");
        }
        $db_rel_path = str_replace(DIRECTORY_SEPARATOR, '/', $video_rel_dir);
        $db_path = '/' . ($db_rel_path ? $db_rel_path . '/' : '') . $new_filename;

        executePreparedQuery("UPDATE Video SET percorso_anteprima = ? WHERE id = ?", "si", [$db_path, $id_video]);
        global $Cache;
        if (isset($Cache) && is_object($Cache)) {
            // Invalidazione mirata: lista pubblica + categorie.
            $Cache->deletePattern('videos_list_*');
            $Cache->delete('categorie_list_v1');
        }
        inviaRisposta(true, 'Anteprima caricata e aggiornata', 200, ['nuovo_path' => $db_path]);
        break;

    case 'rimuovi_anteprima':
        $id = (int) ($_POST['id_video'] ?? 0);

        $res = executePreparedQuery("SELECT percorso_anteprima FROM Video WHERE id = ?", "i", [$id]);
        $video = $res->fetch_assoc();

        if (!$video)
            throw new Exception("Video non trovato");

        global $BASE_VIDEO_PATH;
        if ($video['percorso_anteprima'] && $video['percorso_anteprima'] != 'mancante') {
            $full_path = safeJoinPath($BASE_VIDEO_PATH, ltrim($video['percorso_anteprima'], '/\\'));
            if ($full_path === null) {
                error_log("🚨 [SECURITY] Path traversal in rimuovi_anteprima: " . $video['percorso_anteprima']);
            } elseif (file_exists($full_path)) {
                @unlink($full_path);
            }
        }

        executePreparedQuery("UPDATE Video SET percorso_anteprima = NULL WHERE id = ?", "i", [$id]);
        global $Cache;
        if (isset($Cache) && is_object($Cache)) {
            // Invalidazione mirata, niente flush() globale (vedi sopra).
            $Cache->deletePattern('videos_list_*');
            $Cache->delete('categorie_list_v1');
        }
        inviaRisposta(true, 'Anteprima rimossa');
        break;
}
?>