<?php
if (!defined('ADMIN_API'))
    exit('Nessun accesso diretto consentito.');

require_once __DIR__ . '/../path_safety.php';

/**
 * Conformità di un singolo componente di path secondo le stesse regole del
 * watcher (is_conforming): solo [a-zA-Z0-9._-], niente __/../-- né _/-/ ai bordi,
 * estensione lowercase. Serve al rescan per NON accodare in Video_Temp nomi
 * "sporchi" (spazi/accenti) che poi fallirebbero ffprobe: quelli li sanifica
 * e li accoda il watcher.
 */
function adminRescanIsConformingComponent($name, $isFile)
{
    if ($name === '') return false;
    if (preg_match('/[^a-zA-Z0-9._-]/', $name)) return false;
    if (strpos($name, '__') !== false || strpos($name, '..') !== false || strpos($name, '--') !== false) return false;
    if ($name[0] === '_' || $name[0] === '-') return false;
    $last = substr($name, -1);
    if ($last === '_' || $last === '-') return false;
    if ($isFile) {
        $ext = pathinfo($name, PATHINFO_EXTENSION);
        if ($ext !== '' && $ext !== strtolower($ext)) return false;
    }
    return true;
}

function adminRescanIsConforming($rel)
{
    $parts = explode('/', $rel);
    $lastIdx = count($parts) - 1;
    foreach ($parts as $i => $p) {
        if (!adminRescanIsConformingComponent($p, $i === $lastIdx)) return false;
    }
    return true;
}

switch ($action) {
    case 'lista_video':
        $limit = (int) ($_POST['limit'] ?? 20);
        $offset = (int) ($_POST['offset'] ?? 0);
        $query_search = $_POST['query'] ?? '';

        $sql = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima, v.Likes,
                       v.Formato, v.Durata, v.altezza_video, v.ottimizzato, v.codec_video, v.codec_audio,
                       c.Nome as Nome_Categoria, v.id_Categoria
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
        if (isset($Cache) && is_object($Cache)) {
            // Invalida sia la lista categorie sia tutte le liste video cachate
            // (videos.php cache per type='all' con TTL 5min: senza questo
            // delete-pattern il titolo nuovo non comparirebbe in "Caricati di recente"
            // fino allo scadere del TTL).
            $Cache->delete('categorie_list_v1');
            $Cache->deletePattern('videos_list_*');
        }
        inviaRisposta(true, 'Informazioni video aggiornate con successo');
        break;

    case 'reottimizza_video':
        $id = (int) ($_POST['id'] ?? 0);
        if ($id <= 0)
            throw new Exception("ID Video non valido");

        // Reset dei flag worker: il worker_optimizer riprendera il video al prossimo poll.
        // locked_at azzerato per liberare eventuali lock orfani.
        executePreparedQuery(
            "UPDATE Video SET ottimizzato = NULL, ottimizzato_at = NULL, locked_at = NULL WHERE id = ?",
            "i",
            [$id]
        );

        global $Cache;
        if (isset($Cache) && is_object($Cache)) {
            $Cache->deletePattern('videos_list_*');
        }
        inviaRisposta(true, 'Video ri-accodato per ottimizzazione');
        break;

    case 'rescan_video':
        // Scansiona il filesystem e accoda in Video_Temp i video presenti su
        // disco ma assenti sia da Video sia da Video_Temp. Equivale a un perform_scan
        // del watcher lanciato on-demand dall'admin, senza attendere restart/re-scan.
        global $BASE_VIDEO_PATH;

        $base_real = realpath($BASE_VIDEO_PATH);
        if ($base_real === false || !is_dir($base_real)) {
            inviaRisposta(false, "Cartella video non accessibile ($BASE_VIDEO_PATH)", 500);
        }

        // Set dei path già noti (Video + Video_Temp): niente ri-accodamento.
        $known = [];
        if ($r = $database->query("SELECT percorso_file FROM Video")) {
            while ($row = $r->fetch_row()) { $known[$row[0]] = true; }
        }
        if ($r = $database->query("SELECT percorso_file FROM Video_Temp")) {
            while ($row = $r->fetch_row()) { $known[$row[0]] = true; }
        }

        $video_exts = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'];
        $enqueued = 0;
        $already = 0;
        $to_sanitize = 0;

        try {
            $dir = new RecursiveDirectoryIterator($base_real, FilesystemIterator::SKIP_DOTS);
            // Esclude cartelle nascoste e cartelle asset generate dai worker.
            $filter = new RecursiveCallbackFilterIterator($dir, function ($current) {
                $name = $current->getFilename();
                if ($current->isDir()) {
                    if ($name === '' || $name[0] === '.') return false;
                    if (strncmp($name, 'copertine_', 10) === 0) return false;
                    if (strncmp($name, 'anteprime_', 10) === 0) return false;
                    if (strncmp($name, 'sottotitoli_', 12) === 0) return false;
                }
                return true;
            });
            $it = new RecursiveIteratorIterator($filter, RecursiveIteratorIterator::LEAVES_ONLY);

            foreach ($it as $file) {
                if (!$file->isFile() || $file->isLink()) continue;
                $fname = $file->getFilename();
                if ($fname === '' || $fname[0] === '.') continue;
                // Backup/temporanei del worker_optimizer: non sono video reali.
                if (strpos($fname, '.bak.') !== false || strpos($fname, '.tmp.') !== false) continue;
                $ext = strtolower(pathinfo($fname, PATHINFO_EXTENSION));
                if (!in_array($ext, $video_exts, true)) continue;

                // Path relativo POSIX, come lo salva il watcher.
                $rel = ltrim(str_replace('\\', '/', substr($file->getPathname(), strlen($base_real))), '/');
                if ($rel === '') continue;

                if (isset($known[$rel])) { $already++; continue; }

                // Nomi non conformi: li lasciamo al watcher (che sanifica + accoda),
                // per non reintrodurre righe Video_Temp con spazi/accenti.
                if (!adminRescanIsConforming($rel)) { $to_sanitize++; continue; }

                executePreparedQuery("INSERT IGNORE INTO Video_Temp (percorso_file) VALUES (?)", "s", [$rel]);
                $known[$rel] = true;
                $enqueued++;
            }
        } catch (Throwable $e) {
            error_log("❌ [RESCAN] Errore scansione: " . $e->getMessage());
            inviaRisposta(false, "Errore durante la scansione: " . $e->getMessage(), 500);
        }

        inviaRisposta(
            true,
            "Rescan completato: $enqueued nuovi video accodati.",
            200,
            ['accodati' => $enqueued, 'gia_presenti' => $already, 'da_sanificare' => $to_sanitize]
        );
        break;

    case 'elimina_video':
        $id = (int) ($_POST['id_video'] ?? 0);

        // Recupero i path dei file per eliminarli fisicamente
        $res = executePreparedQuery("SELECT percorso_file, percorso_copertina, percorso_anteprima FROM Video WHERE id = ?", "i", [$id]);
        $info = $res->fetch_assoc();

        // Rimozione dal DB
        executePreparedQuery("DELETE FROM Video WHERE id = ?", "i", [$id]);

        // Rimozione file fisici dal disco (con sandbox path safety)
        if ($info) {
            global $BASE_VIDEO_PATH;
            foreach ($info as $key => $path) {
                if (!$path || $path === 'mancante') continue;

                $full_path = safeJoinPath($BASE_VIDEO_PATH, ltrim($path, '/\\'));
                if ($full_path === null) {
                    error_log("🚨 [SECURITY] Path traversal bloccato in elimina_video: $path");
                    continue;
                }
                if (file_exists($full_path) && !@unlink($full_path)) {
                    error_log("⚠️ Errore eliminazione file: $full_path");
                }
            }
        }

        global $Cache;
        if (isset($Cache) && is_object($Cache)) {
            // Invalida sia la lista categorie sia tutte le liste video cachate
            // (videos.php cache per type='all' con TTL 5min: senza questo
            // delete-pattern il titolo nuovo non comparirebbe in "Caricati di recente"
            // fino allo scadere del TTL).
            $Cache->delete('categorie_list_v1');
            $Cache->deletePattern('videos_list_*');
        }
        inviaRisposta(true, 'Video ed elementi correlati (file/anteprime) rimossi');
        break;
}
?>