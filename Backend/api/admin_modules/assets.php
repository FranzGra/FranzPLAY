<?php
if (!defined('ADMIN_API'))
    exit('Nessun accesso diretto consentito.');

switch ($action) {
    case 'upload_copertina':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        if (!isset($_FILES['file_copertina']))
            throw new Exception("File copertina mancante");

        // Recupero informazioni per determinare il percorso di destinazione
        $res = executePreparedQuery(
            "SELECT v.percorso_file, v.percorso_copertina, c.Nome as Nome_Cat FROM Video v LEFT JOIN Categorie c ON v.id_Categoria = c.id WHERE v.id = ?",
            "i",
            [$id_video]
        );
        $info = $res->fetch_assoc();

        if (!$info)
            throw new Exception("Video non trovato (ID: $id_video)");

        // La copertina deve stare nella cartella copertine_[Categoria]
        $video_rel_dir = trim(dirname($info['percorso_file']), '.\\/');
        if ($video_rel_dir == '.')
            $video_rel_dir = "";

        $cat_name = $info['Nome_Cat'] ?: 'Generale';
        $cover_dir_name = 'copertine_' . $cat_name;
        $video_rel_dir = $video_rel_dir ? $video_rel_dir . '/' . $cover_dir_name : $cover_dir_name;

        global $BASE_VIDEO_PATH;
        // Rimuovi vecchia copertina se esiste per evitare file orfani
        if ($info['percorso_copertina'] && $info['percorso_copertina'] != 'mancante') {
            $old_full_path = $BASE_VIDEO_PATH . DIRECTORY_SEPARATOR . ltrim(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $info['percorso_copertina']), DIRECTORY_SEPARATOR);
            if (file_exists($old_full_path)) {
                @unlink($old_full_path);
            }
        }

        // Normalize slashes
        $video_rel_dir = str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $video_rel_dir);
        $base_path = rtrim(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $BASE_VIDEO_PATH), DIRECTORY_SEPARATOR);

        $target_dir = $base_path . DIRECTORY_SEPARATOR . ltrim($video_rel_dir, DIRECTORY_SEPARATOR);

        if (!file_exists($target_dir)) {
            if (!@mkdir($target_dir, 0777, true)) {
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
            if (isset($Cache) && is_object($Cache))
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

        global $BASE_VIDEO_PATH;
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
        if (isset($Cache) && is_object($Cache))
            $Cache->flush();
        inviaRisposta(true, 'Copertina rimossa (in coda per rigenerazione)');
        break;

    case 'upload_anteprima':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        if (!isset($_FILES['file_anteprima']))
            throw new Exception("File anteprima mancante");

        $res = executePreparedQuery(
            "SELECT v.percorso_file, v.percorso_anteprima, c.Nome as Nome_Cat FROM Video v LEFT JOIN Categorie c ON v.id_Categoria = c.id WHERE v.id = ?",
            "i",
            [$id_video]
        );
        $info = $res->fetch_assoc();

        if (!$info)
            throw new Exception("Video non trovato (ID: $id_video)");

        $video_rel_dir = trim(dirname($info['percorso_file']), '.\\/');

        $cat_name = $info['Nome_Cat'] ?: 'Generale';
        $preview_dir_name = 'anteprime_' . $cat_name;
        $video_rel_dir = $video_rel_dir ? $video_rel_dir . '/' . $preview_dir_name : $preview_dir_name;

        global $BASE_VIDEO_PATH;
        // Rimuovi vecchia anteprima se esiste
        if ($info['percorso_anteprima'] && $info['percorso_anteprima'] != 'mancante') {
            $old_full_path = $BASE_VIDEO_PATH . DIRECTORY_SEPARATOR . ltrim(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $info['percorso_anteprima']), DIRECTORY_SEPARATOR);
            if (file_exists($old_full_path)) {
                @unlink($old_full_path);
            }
        }

        $video_rel_dir = str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $video_rel_dir);
        $base_path = rtrim(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $BASE_VIDEO_PATH), DIRECTORY_SEPARATOR);
        $target_dir = $base_path . DIRECTORY_SEPARATOR . ltrim($video_rel_dir, DIRECTORY_SEPARATOR);

        if (!file_exists($target_dir)) {
            if (!@mkdir($target_dir, 0777, true)) {
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

        $filename_no_ext = pathinfo($info['percorso_file'], PATHINFO_FILENAME);
        $new_filename = $filename_no_ext . "." . $ext;
        $target_file = $target_dir . DIRECTORY_SEPARATOR . $new_filename;

        if (move_uploaded_file($_FILES['file_anteprima']['tmp_name'], $target_file)) {
            $db_rel_path = str_replace(DIRECTORY_SEPARATOR, '/', $video_rel_dir);
            $db_path = '/' . ($db_rel_path ? $db_rel_path . '/' : '') . $new_filename;

            executePreparedQuery("UPDATE Video SET percorso_anteprima = ? WHERE id = ?", "si", [$db_path, $id_video]);
            global $Cache;
            if (isset($Cache) && is_object($Cache))
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

        global $BASE_VIDEO_PATH;
        if ($video['percorso_anteprima'] && $video['percorso_anteprima'] != 'mancante') {
            $clean_path = ltrim(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $video['percorso_anteprima']), DIRECTORY_SEPARATOR);
            $full_path = $BASE_VIDEO_PATH . DIRECTORY_SEPARATOR . $clean_path;

            if (file_exists($full_path)) {
                @unlink($full_path);
            }
        }

        executePreparedQuery("UPDATE Video SET percorso_anteprima = NULL WHERE id = ?", "i", [$id]);
        global $Cache;
        if (isset($Cache) && is_object($Cache))
            $Cache->flush();
        inviaRisposta(true, 'Anteprima rimossa');
        break;
}
?>