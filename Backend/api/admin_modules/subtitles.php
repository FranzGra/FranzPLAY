<?php
/**
 * ============================================================================
 * Backend/api/admin_modules/subtitles.php
 * ============================================================================
 *
 * SCOPO:
 * Gestione dei sottotitoli generati on-demand (Whisper + traduzione LibreTranslate).
 * La generazione NON è automatica: l'admin accoda esplicitamente i job, che il
 * worker_subtitles.py processa leggendo la tabella `Sottotitoli`.
 *
 * AZIONI SUPPORTATE:
 * - lista_video_sottotitoli : lista video con stato sottotitoli + filtri
 * - stato_sottotitoli       : righe sottotitoli di un singolo video (polling UI)
 * - genera_sottotitoli      : accoda la generazione (trascrizione + traduzioni)
 * - rigenera_sottotitolo    : rimette in coda una singola riga (es. dopo errore)
 * - elimina_sottotitolo     : elimina riga + file .vtt dal disco
 *
 * SICUREZZA: ereditata da admin.php (check_admin.php). Path .vtt validati con
 * path_safety.php prima di toccare il filesystem.
 * ============================================================================
 */

if (!defined('ADMIN_API'))
    exit('Nessun accesso diretto consentito.');

require_once __DIR__ . '/../path_safety.php';

// Lingue ammesse per source/target (whitelist anti-input arbitrario).
// Italiano + inglese coprono il caso d'uso principale; le altre sono pronte se
// si aggiungono i modelli a LibreTranslate (LT_LOAD_ONLY nel docker-compose).
$LINGUE_AMMESSE = ['it', 'en', 'es', 'fr', 'de', 'pt'];

switch ($action) {

    // ------------------------------------------------------------------
    // LISTA VIDEO + STATO SOTTOTITOLI (con filtri)
    // ------------------------------------------------------------------
    case 'lista_video_sottotitoli':
        $limit  = (int) ($_POST['limit'] ?? 30);
        $offset = (int) ($_POST['offset'] ?? 0);
        if ($limit < 1)   $limit = 1;
        if ($limit > 100) $limit = 100;
        if ($offset < 0)  $offset = 0;

        $query_search = trim($_POST['query'] ?? '');
        // filtro: 'tutti' | 'con' (con almeno un sottotitolo completato) | 'senza'
        $filtro = $_POST['filtro'] ?? 'tutti';
        if (!in_array($filtro, ['tutti', 'con', 'senza'], true)) $filtro = 'tutti';
        // filtro lingua: mostra solo video che hanno QUELLA lingua completata
        $lingua_filtro = $_POST['lingua'] ?? '';
        if ($lingua_filtro !== '' && !in_array($lingua_filtro, $LINGUE_AMMESSE, true)) {
            $lingua_filtro = '';
        }

        $sql = "SELECT v.id, v.Titolo, v.percorso_copertina, v.Durata, v.Formato,
                       c.Nome AS Nome_Categoria,
                       COUNT(s.id) AS sub_totali,
                       SUM(s.stato = 'completato') AS sub_completati,
                       SUM(s.stato = 'in_coda' OR s.stato = 'elaborazione') AS sub_in_corso,
                       SUM(s.stato = 'errore') AS sub_errore,
                       GROUP_CONCAT(
                           CONCAT_WS(':', s.lingua, s.stato, s.tipo)
                           ORDER BY s.lingua SEPARATOR ','
                       ) AS sottotitoli_raw
                FROM Video v
                LEFT JOIN Sottotitoli s ON s.id_Video = v.id
                LEFT JOIN Categorie c ON v.id_Categoria = c.id ";

        $params = [];
        $types = "";
        $where = [];

        if ($query_search !== '') {
            $where[] = "v.Titolo LIKE ?";
            $params[] = "%$query_search%";
            $types .= "s";
        }
        if (!empty($where)) {
            $sql .= "WHERE " . implode(" AND ", $where) . " ";
        }

        $sql .= "GROUP BY v.id ";

        // Filtri post-aggregazione (HAVING)
        $having = [];
        if ($filtro === 'con') {
            $having[] = "sub_completati > 0";
        } elseif ($filtro === 'senza') {
            $having[] = "IFNULL(sub_completati, 0) = 0";
        }
        if ($lingua_filtro !== '') {
            $having[] = "SUM(s.lingua = ? AND s.stato = 'completato') > 0";
            $params[] = $lingua_filtro;
            $types .= "s";
        }
        if (!empty($having)) {
            $sql .= "HAVING " . implode(" AND ", $having) . " ";
        }

        $sql .= "ORDER BY v.id DESC LIMIT ? OFFSET ?";
        $params[] = $limit;
        $params[] = $offset;
        $types .= "ii";

        $res = executePreparedQuery($sql, $types, $params);
        $data = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];

        inviaRisposta(true, 'Lista video sottotitoli caricata', 200, ['dati' => $data]);
        break;

    // ------------------------------------------------------------------
    // CODA DI TRASCRIZIONE: tutti i job non completati + le righe completate
    // dei video coinvolti (per mostrare l'avanzamento del flow nella UI).
    // ------------------------------------------------------------------
    case 'coda_sottotitoli':
        $sql = "SELECT s.id, s.id_Video, v.Titolo, v.percorso_copertina, v.Durata,
                       s.lingua, s.lingua_origine, s.tipo, s.stato, s.modello_usato,
                       s.errore_msg, s.creato_at, s.generato_at
                FROM Sottotitoli s
                JOIN Video v ON s.id_Video = v.id
                WHERE s.id_Video IN (
                    SELECT DISTINCT id_Video FROM Sottotitoli
                    WHERE stato IN ('in_coda','elaborazione','errore')
                )
                ORDER BY FIELD(s.stato,'elaborazione','in_coda','errore','completato'),
                         s.id_Video ASC, s.tipo ASC, s.lingua ASC";
        $res = executePreparedQuery($sql, "", []);
        $righe = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];

        inviaRisposta(true, 'Coda di trascrizione', 200, ['dati' => $righe]);
        break;

    // ------------------------------------------------------------------
    // DETTAGLIO RIGHE SOTTOTITOLI DI UN VIDEO (per modale + polling)
    // ------------------------------------------------------------------
    case 'stato_sottotitoli':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        if ($id_video <= 0) throw new Exception("ID Video non valido");

        $res = executePreparedQuery(
            "SELECT id, lingua, lingua_origine, tipo, stato, percorso_file,
                    modello_usato, errore_msg, generato_at, creato_at
             FROM Sottotitoli WHERE id_Video = ? ORDER BY tipo ASC, lingua ASC",
            "i", [$id_video]
        );
        $righe = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];

        inviaRisposta(true, 'Stato sottotitoli', 200, ['dati' => $righe]);
        break;

    // ------------------------------------------------------------------
    // ACCODA GENERAZIONE (trascrizione + eventuali traduzioni)
    // ------------------------------------------------------------------
    case 'genera_sottotitoli':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        if ($id_video <= 0) throw new Exception("ID Video non valido");

        // Lingua parlata nel video: 'auto' oppure un codice ammesso.
        $lingua_origine = $_POST['lingua_origine'] ?? 'auto';
        if ($lingua_origine !== 'auto' && !in_array($lingua_origine, $LINGUE_AMMESSE, true)) {
            throw new Exception("Lingua origine non valida");
        }

        // Lingue dei sottotitoli da produrre (array di codici).
        $lingue = $_POST['lingue'] ?? [];
        if (!is_array($lingue)) $lingue = [$lingue];
        // Sanifica/deduplica
        $lingue = array_values(array_unique(array_filter($lingue, function ($l) use ($LINGUE_AMMESSE) {
            return in_array($l, $LINGUE_AMMESSE, true);
        })));
        if (empty($lingue)) throw new Exception("Seleziona almeno una lingua per i sottotitoli");

        // Verifica che il video esista
        $resV = executePreparedQuery("SELECT id FROM Video WHERE id = ?", "i", [$id_video]);
        if (!$resV || !$resV->fetch_assoc()) {
            inviaRisposta(false, "Video non trovato", 404);
        }

        // Per ogni lingua richiesta crea/riaccoda una riga.
        // tipo = 'trascrizione' se la lingua coincide con la sorgente esplicita,
        //        altrimenti 'traduzione'. Con sorgente 'auto' il worker decide a
        //        runtime (vedi worker_subtitles._finalize_transcription_row).
        $accodate = 0;
        foreach ($lingue as $lang) {
            $tipo = ($lingua_origine !== 'auto' && $lang === $lingua_origine)
                ? 'trascrizione' : 'traduzione';

            executePreparedQuery(
                "INSERT INTO Sottotitoli (id_Video, lingua, lingua_origine, tipo, stato)
                 VALUES (?, ?, ?, ?, 'in_coda')
                 ON DUPLICATE KEY UPDATE
                    lingua_origine = VALUES(lingua_origine),
                    tipo = VALUES(tipo),
                    stato = 'in_coda',
                    errore_msg = NULL,
                    locked_at = NULL",
                "isss", [$id_video, $lang, $lingua_origine, $tipo]
            );
            $accodate++;
        }

        inviaRisposta(true, "Generazione accodata per $accodate lingua/e", 200, ['accodate' => $accodate]);
        break;

    // ------------------------------------------------------------------
    // RIGENERA UNA SINGOLA RIGA (rimette in coda)
    // ------------------------------------------------------------------
    case 'rigenera_sottotitolo':
        $id_sub = (int) ($_POST['id_sottotitolo'] ?? 0);
        if ($id_sub <= 0) throw new Exception("ID sottotitolo non valido");

        executePreparedQuery(
            "UPDATE Sottotitoli SET stato = 'in_coda', errore_msg = NULL, locked_at = NULL WHERE id = ?",
            "i", [$id_sub]
        );
        inviaRisposta(true, "Sottotitolo rimesso in coda");
        break;

    // ------------------------------------------------------------------
    // ELIMINA UNA RIGA + IL FILE .VTT DAL DISCO
    // ------------------------------------------------------------------
    case 'elimina_sottotitolo':
        $id_sub = (int) ($_POST['id_sottotitolo'] ?? 0);
        if ($id_sub <= 0) throw new Exception("ID sottotitolo non valido");

        $res = executePreparedQuery("SELECT percorso_file FROM Sottotitoli WHERE id = ?", "i", [$id_sub]);
        $row = $res ? $res->fetch_assoc() : null;

        executePreparedQuery("DELETE FROM Sottotitoli WHERE id = ?", "i", [$id_sub]);

        if ($row && !empty($row['percorso_file'])) {
            global $BASE_VIDEO_PATH;
            $full = safeJoinPath($BASE_VIDEO_PATH, ltrim($row['percorso_file'], '/\\'));
            if ($full === null) {
                error_log("🚨 [SECURITY] Path traversal bloccato in elimina_sottotitolo: " . $row['percorso_file']);
            } elseif (file_exists($full) && !@unlink($full)) {
                error_log("⚠️ Errore eliminazione VTT: $full");
            }
        }

        inviaRisposta(true, "Sottotitolo eliminato");
        break;
}
?>
