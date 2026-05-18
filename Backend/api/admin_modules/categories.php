<?php
if (!defined('ADMIN_API'))
    exit('Nessun accesso diretto consentito.');

require_once __DIR__ . '/../path_safety.php';

switch ($action) {
    case 'lista_categorie':
        // LEFT JOIN + GROUP BY al posto della subquery correlata (N+1).
        // Su 100 categorie passiamo da 101 query a 1 sola.
        $sql = "SELECT c.*, COUNT(v.id) AS num_video
                FROM Categorie c
                LEFT JOIN Video v ON v.id_Categoria = c.id
                GROUP BY c.id
                ORDER BY c.Nome ASC";
        $res = $database->query($sql);
        if (!$res) {
            throw new Exception("Errore query lista categorie");
        }
        inviaRisposta(true, 'Elenco categorie caricato', 200, ['dati' => $res->fetch_all(MYSQLI_ASSOC)]);
        break;

    case 'aggiorna_categoria':
        $id = (int) $_POST['id'];
        $nome = trim($_POST['nome'] ?? '');
        if (empty($nome))
            throw new Exception("Il nome della categoria è obbligatorio");

        executePreparedQuery("UPDATE Categorie SET Nome = ? WHERE id = ?", "si", [$nome, $id]);
        global $Cache;
        if (isset($Cache) && is_object($Cache)) {
            // Invalidazione MIRATA invece di flush() globale (più efficiente).
            $Cache->delete('categorie_list_v1');
            $Cache->delete('impostazioni_globali');
        }
        inviaRisposta(true, 'Categoria aggiornata con successo');
        break;

    case 'salva_colore_categoria':
        $id = (int) ($_POST['id_categoria'] ?? 0);
        $colore = $_POST['colore'] ?? '';

        if (empty($colore)) {
            executePreparedQuery("UPDATE Categorie SET Colore_Default = NULL WHERE id = ?", "i", [$id]);
        } else {
            executePreparedQuery("UPDATE Categorie SET Colore_Default = ? WHERE id = ?", "si", [$colore, $id]);
        }

        global $Cache;
        if (isset($Cache) && is_object($Cache)) {
            // Invalidazione MIRATA invece di flush() globale (più efficiente).
            $Cache->delete('categorie_list_v1');
            $Cache->delete('impostazioni_globali');
        }
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

        global $BASE_VIDEO_PATH;
        $target_dir = safeJoinPath($BASE_VIDEO_PATH, ltrim($cat['Percorso'], '/\\'));
        if ($target_dir === null) {
            error_log("🚨 [SECURITY] Path traversal in upload_sfondo_categoria: " . $cat['Percorso']);
            throw new Exception("Percorso categoria non valido");
        }
        if (!file_exists($target_dir))
            throw new Exception("Cartella di destinazione non esistente");
        if (!is_writable($target_dir))
            throw new Exception("Permessi negati nella cartella di destinazione");

        $ext = ($mime == 'image/png') ? 'png' : (($mime == 'image/webp') ? 'webp' : 'jpg');
        $new_filename = "cover." . $ext;

        $target_file = $target_dir . DIRECTORY_SEPARATOR . $new_filename;

        if (move_uploaded_file($_FILES['file_sfondo']['tmp_name'], $target_file)) {
            $db_rel_path = ltrim(str_replace(DIRECTORY_SEPARATOR, '/', $cat['Percorso']), '/');
            $db_path = '/' . $db_rel_path . '/' . $new_filename;
            executePreparedQuery("UPDATE Categorie SET Immagine_Sfondo = ? WHERE id = ?", "si", [$db_path, $id]);
            global $Cache;
            if (isset($Cache) && is_object($Cache))
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

        global $BASE_VIDEO_PATH;
        if ($cat['Immagine_Sfondo']) {
            $full_path = safeJoinPath($BASE_VIDEO_PATH, ltrim($cat['Immagine_Sfondo'], '/\\'));
            if ($full_path === null) {
                error_log("🚨 [SECURITY] Path traversal in rimuovi_sfondo_categoria: " . $cat['Immagine_Sfondo']);
            } elseif (file_exists($full_path) && !@unlink($full_path)) {
                error_log("⚠️ Impossibile eliminare fisicamente lo sfondo: $full_path");
            }
        }

        executePreparedQuery("UPDATE Categorie SET Immagine_Sfondo = NULL WHERE id = ?", "i", [$id]);
        global $Cache;
        if (isset($Cache) && is_object($Cache)) {
            // Invalidazione MIRATA invece di flush() globale (più efficiente).
            $Cache->delete('categorie_list_v1');
            $Cache->delete('impostazioni_globali');
        }
        inviaRisposta(true, 'Sfondo rimosso con successo');
        break;
}
?>