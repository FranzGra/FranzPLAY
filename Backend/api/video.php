<?php
/**
 * ============================================================================
 * Backend/api/video.php
 * ============================================================================
 *
 * SCOPO:
 * Gestisce il recupero dei video per diverse sezioni: Home, Categorie,
 * Ricerca, Cronologia, Salvati e Piaciuti.
 *
 * AZIONI SUPPORTATE:
 * - dettaglio_completo: Recupera tutti i dati di un singolo video (per player)
 * - tutti: Lista video per la Home (con supporto Seed per ordine casuale)
 * - video_per_categoria: Filtra video per ID categoria
 * - piu_piaciuti: Video ordinati per numero di likes
 * - cerca: Ricerca testuale per titolo
 * - cronologia: Video che l'utente sta guardando (continua a guardare)
 * - storico_completo: Cronologia totale dell'utente
 * - utente_salvati_home / utente_salvati_profilo: Video salvati dall'utente
 * - utente_piaciuti: Video a cui l'utente ha messo like
 *
 * INPUT (POST):
 * - action (string): L'azione da compiere
 * - limit (int): Numero massimo di risultati (default 12)
 * - offset (int): Offset per paginazione (default 0)
 * - seed (int): Seme per ordinamento casuale deterministico
 * - id_video / id_categoria / query: Parametri specifici per l'azione
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once 'gestione_richiesta.php';
require_once 'database.php';


// ============================================================================
// SEZIONE 2: AUTENTICAZIONE E SICUREZZA
// ============================================================================

// Tutte le azioni in questo file richiedono un utente loggato
if (!isset($_SESSION['id_utente'])) {
    inviaRisposta(false, 'Non autorizzato', 401);
}

$id_utente = $_SESSION['id_utente'];


// ============================================================================
// SEZIONE 3: GESTIONE INPUT E PARAMETRI
// ============================================================================

$action = $_POST['action'] ?? 'tutti';
$limit = isset($_POST['limit']) ? (int) $_POST['limit'] : 12;
$offset = isset($_POST['offset']) ? (int) $_POST['offset'] : 0;
$seed = isset($_POST['seed']) ? (int) $_POST['seed'] : 0;


// ============================================================================
// SEZIONE 4: LOGICA CORE E OPERAZIONI DATABASE
// ============================================================================

$dati = [];
$query = "";
$types = "";
$params = [];

try {
    switch ($action) {

        // --- DETTAGLIO COMPLETO (PLAYER) ---
        case 'dettaglio_completo':
            $id_video = isset($_POST['id_video']) ? (int) $_POST['id_video'] : 0;

            if ($id_video <= 0) {
                inviaRisposta(false, "ID Video non valido", 400);
            }

            $query = "SELECT
                        v.id, v.percorso_file, v.Titolo, v.Durata, v.Formato,
                        v.percorso_copertina, v.Likes, v.data_Pubblicazione,
                        c.id as id_Categoria, c.Nome as Nome_Categoria,
                        (SELECT 1 FROM `Like` WHERE id_Utente = ? AND id_Video = v.id) as is_liked,
                        (SELECT 1 FROM Salvati WHERE id_Utente = ? AND id_Video = v.id) as is_saved,
                        (SELECT progresso_secondi FROM Cronologia WHERE id_Utente = ? AND id_Video = v.id) as progresso_secondi
                      FROM Video v
                      LEFT JOIN Categorie c ON v.id_Categoria = c.id
                      WHERE v.id = ?";

            $stmt = $database->prepare($query);
            $stmt->bind_param("iiii", $id_utente, $id_utente, $id_utente, $id_video);
            $stmt->execute();
            $res = $stmt->get_result();
            $video = $res->fetch_assoc();
            $stmt->close();

            if ($video) {
                $video['is_liked'] = (bool) $video['is_liked'];
                $video['is_saved'] = (bool) $video['is_saved'];
                $video['progresso_secondi'] = (int) ($video['progresso_secondi'] ?? 0);
                inviaRisposta(true, "Video trovato", 200, ['video' => $video]);
            } else {
                inviaRisposta(false, "Video non trovato", 404);
            }
            return;

        // --- HOME PAGE (TUTTI - ORDERE CASUALE O DATA) ---
        case 'tutti':
            $query = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima,
                             v.Durata, v.Likes, c.Nome as Nome_Categoria
                      FROM Video v
                      LEFT JOIN Categorie c ON v.id_Categoria = c.id ";

            // Se c'è un seed, ordina in modo casuale deterministico, altrimenti per data
            if ($seed > 0) {
                $query .= "ORDER BY RAND($seed) ";
            } else {
                $query .= "ORDER BY v.data_Pubblicazione DESC, v.id DESC ";
            }

            $query .= "LIMIT ? OFFSET ?";
            $types = "ii";
            $params = [$limit, $offset];
            break;

        // --- VIDEO PER CATEGORIA ---
        case 'video_per_categoria':
            $id_cat = isset($_POST['id_categoria']) ? (int) $_POST['id_categoria'] : 0;
            $query = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima, v.Durata, v.Likes, c.Nome as Nome_Categoria
                      FROM Video v
                      LEFT JOIN Categorie c ON v.id_Categoria = c.id
                      WHERE v.id_Categoria = ?
                      ORDER BY v.data_Pubblicazione DESC, v.id DESC
                      LIMIT ? OFFSET ?";
            $types = "iii";
            $params = [$id_cat, $limit, $offset];
            break;

        // --- VIDEO PIÙ PIACIUTI ---
        case 'piu_piaciuti':
            $query = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima, v.Durata, v.Likes, c.Nome as Nome_Categoria
                      FROM Video v
                      LEFT JOIN Categorie c ON v.id_Categoria = c.id
                      WHERE v.Likes > 0
                      ORDER BY v.Likes DESC, v.id DESC
                      LIMIT ? OFFSET ?";
            $types = "ii";
            $params = [$limit, $offset];
            break;

        // --- RICERCA VIDEO ---
        case 'cerca':
            $testo = $_POST['query'] ?? '';
            if (empty(trim($testo))) {
                inviaRisposta(true, "Query vuota", 200, ['dati' => []]);
            }
            $searchTerm = "%" . $testo . "%";
            $query = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima, v.Durata, v.Likes, c.Nome as Nome_Categoria
                      FROM Video v
                      LEFT JOIN Categorie c ON v.id_Categoria = c.id
                      WHERE v.Titolo LIKE ?
                      ORDER BY v.Titolo ASC
                      LIMIT ? OFFSET ?";
            $types = "sii";
            $params = [$searchTerm, $limit, $offset];
            break;

        // --- CONTINUA A GUARDARE ---
        case 'cronologia':
            $query = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima, v.Durata, v.Likes, c.Nome as Nome_Categoria, cr.progresso_secondi
                      FROM Cronologia cr
                      JOIN Video v ON cr.id_Video = v.id
                      LEFT JOIN Categorie c ON v.id_Categoria = c.id
                      WHERE cr.id_Utente = ? AND cr.continua_a_guardare = 1
                      ORDER BY cr.ultimo_aggiornamento DESC
                      LIMIT ? OFFSET ?";
            $types = "iii";
            $params = [$id_utente, $limit, $offset];
            break;

        // --- STORICO COMPLETO ---
        case 'storico_completo':
            $query = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima, v.Durata, v.Likes, c.Nome as Nome_Categoria, cr.progresso_secondi, cr.ultimo_aggiornamento
                      FROM Cronologia cr
                      JOIN Video v ON cr.id_Video = v.id
                      LEFT JOIN Categorie c ON v.id_Categoria = c.id
                      WHERE cr.id_Utente = ?
                      ORDER BY cr.ultimo_aggiornamento DESC
                      LIMIT ? OFFSET ?";
            $types = "iii";
            $params = [$id_utente, $limit, $offset];
            break;

        // --- VIDEO SALVATI ---
        case 'utente_salvati_home':
        case 'utente_salvati_profilo':
            $query = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima, v.Durata, v.Likes, c.Nome as Nome_Categoria
                      FROM Salvati s
                      JOIN Video v ON s.id_Video = v.id
                      LEFT JOIN Categorie c ON v.id_Categoria = c.id
                      WHERE s.id_Utente = ?
                      ORDER BY s.data_ora_salvato DESC
                      LIMIT ? OFFSET ?";
            $types = "iii";
            $params = [$id_utente, $limit, $offset];
            break;

        // --- VIDEO PIACIUTI ---
        case 'utente_piaciuti':
            $query = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima, v.Durata, v.Likes, c.Nome as Nome_Categoria
                      FROM `Like` l
                      JOIN Video v ON l.id_Video = v.id
                      LEFT JOIN Categorie c ON v.id_Categoria = c.id
                      WHERE l.id_Utente = ?
                      ORDER BY l.data_ora_like DESC
                      LIMIT ? OFFSET ?";
            $types = "iii";
            $params = [$id_utente, $limit, $offset];
            break;

        default:
            inviaRisposta(false, "Azione non valida: $action", 400);
    }

    // Esecuzione query se definita
    if ($query) {
        $res = executePreparedQuery($query, $types, $params);
        if ($res) {
            $dati = $res->fetch_all(MYSQLI_ASSOC);
        } else {
            throw new Exception("Errore esecuzione query SQL.");
        }
    }


    // ============================================================================
    // SEZIONE 5: RISPOSTA AL CLIENT
    // ============================================================================
    inviaRisposta(true, "Video caricati con successo", 200, ['dati' => $dati]);

} catch (Exception $e) {
    error_log("❌ [VIDEO API ERROR] " . $e->getMessage());
    inviaRisposta(false, "Si è verificato un errore nel caricamento dei video.", 500);
}

// Chiusura implicita dalla fine dello script
?>