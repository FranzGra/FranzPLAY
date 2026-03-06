<?php
if (!defined('ADMIN_API'))
    exit('Nessun accesso diretto consentito.');

switch ($action) {
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
        if (isset($Cache) && is_object($Cache))
            $Cache->flush();
        inviaRisposta(true, 'Informazioni video aggiornate con successo');
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
                    global $BASE_VIDEO_PATH;
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
        if (isset($Cache) && is_object($Cache))
            $Cache->flush();
        inviaRisposta(true, 'Video ed elementi correlati (file/anteprime) rimossi');
        break;
}
?>