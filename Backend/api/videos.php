<?php
/**
 * ============================================================================
 * Backend/api/videos.php
 * ============================================================================
 * 
 * SCOPO:
 * Controller avanzato per la gestione e il recupero dei video.
 * Implementa logiche di Caching (Redis) e Fulltext Search per massime performance.
 * 
 * ENDPOINTS E PARAMETRI (GET):
 * - id (int): Se presente, recupera il dettaglio del singolo video.
 * - q (string): Query di ricerca (usa Fulltext se >= 3 caratteri).
 * - category_id (int): Filtro per categoria specifica.
 * - type (string): Tipo lista ('all', 'liked', 'saved', 'history').
 * - limit / offset (int): Paginazione.
 * - seed (int): Seme per randomizzazione deterministica dei risultati.
 * 
 * CARATTERISTICHE:
 * - RESTful: Risponde esclusivamente a richieste GET.
 * - Caching: Integra Redis per velocizzare il caricamento del feed pubblico.
 * - Sicurezza: Prepared statements obbligatori per ogni query.
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

// Verifica sessione utente
if (!isset($_SESSION['id_utente'])) {
    inviaRisposta(false, 'Non autorizzato - Effettua il login', 401);
}

$id_utente = $_SESSION['id_utente'];
$method = $_SERVER['REQUEST_METHOD'];

// Validazione Metodo HTTP
if ($method !== 'GET') {
    inviaRisposta(false, "Metodo HTTP non consentito. Usa GET.", 405);
}


// ============================================================================
// SEZIONE 3: GESTIONE INPUT E UTILITY
// ============================================================================

/**
 * Recupera un parametro dalla query string GET in modo sicuro.
 */
function getQueryParam($key, $default = null)
{
    return $_GET[$key] ?? $default;
}

// Parametri principali
$id_video_target = getQueryParam('id'); // Per dettaglio singolo
$limit = (int) getQueryParam('limit', 12);
$offset = (int) getQueryParam('offset', 0);
$search = getQueryParam('q');
$cat_id = (int) getQueryParam('category_id');
$type = getQueryParam('type', 'all'); // 'all', 'liked', 'saved', 'history'
$seed = (int) getQueryParam('seed');


// ============================================================================
// SEZIONE 4: LOGICA CORE (DETTAGLIO O LISTA)
// ============================================================================

try {
    // --- CASO A: RECUPERO DETTAGLIO SINGOLO VIDEO ---
    if ($id_video_target) {
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

        $res = executePreparedQuery($query, "iiii", [$id_utente, $id_utente, $id_utente, $id_video_target]);
        $video = $res->fetch_assoc();

        if ($video) {
            $video['is_liked'] = (bool) $video['is_liked'];
            $video['is_saved'] = (bool) $video['is_saved'];
            $video['progresso_secondi'] = (int) ($video['progresso_secondi'] ?? 0);
            inviaRisposta(true, "Video trovato", 200, ['video' => $video]);
        } else {
            inviaRisposta(false, "Video non trovato", 404);
        }
    }


    // --- CASO B: RECUPERO LISTA VIDEO (FEED / FILTRI) ---

    // 1. Integrazione Cache (Redis)
    require_once 'cache.php';

    // Caching attivo solo per liste generiche (tipo 'all')
    $shouldCache = ($type === 'all');
    $cacheParams = [$limit, $offset, $search, $cat_id, $type, $seed];
    $cacheKey = "videos_list_" . md5(serialize($cacheParams));

    if ($shouldCache) {
        $cachedData = $Cache->get($cacheKey);
        if ($cachedData) {
            inviaRisposta(true, "Lista caricata (da cache)", 200, ['dati' => $cachedData]);
        }
    }

    // 2. Costruzione Query Dinamica
    $query = "SELECT v.id, v.Titolo, v.percorso_copertina, v.percorso_anteprima, 
                     v.Durata, v.Likes, c.Nome as Nome_Categoria ";

    // Switch per tabelle di join in base al tipo di lista richiesta
    if ($type === 'history') {
        $query .= ", cr.progresso_secondi FROM Cronologia cr JOIN Video v ON cr.id_Video = v.id ";
    } else if ($type === 'saved') {
        $query .= "FROM Salvati s JOIN Video v ON s.id_Video = v.id ";
    } else if ($type === 'liked') {
        $query .= "FROM `Like` l JOIN Video v ON l.id_Video = v.id ";
    } else {
        $query .= "FROM Video v ";
    }

    $query .= "LEFT JOIN Categorie c ON v.id_Categoria = c.id ";

    // 3. Definizione Filtri (WHERE)
    $conditions = [];
    $params = [];
    $types = "";

    if ($type === 'history') {
        $conditions[] = "cr.id_Utente = ?";
        $conditions[] = "cr.continua_a_guardare = 1";
        $params[] = $id_utente;
        $types .= "i";
    } else if ($type === 'saved') {
        $conditions[] = "s.id_Utente = ?";
        $params[] = $id_utente;
        $types .= "i";
    } else if ($type === 'liked') {
        $conditions[] = "l.id_Utente = ?";
        $params[] = $id_utente;
        $types .= "i";
    }

    if ($cat_id > 0) {
        $conditions[] = "v.id_Categoria = ?";
        $params[] = $cat_id;
        $types .= "i";
    }

    // 4. Logica Ricerca (Fulltext vs Like)
    if (!empty($search)) {
        if (strlen($search) < 3) {
            // Ricerca base per stringhe corte
            $conditions[] = "v.Titolo LIKE ?";
            $params[] = "%$search%";
            $types .= "s";
        } else {
            // Fulltext search avanzata per stringhe lunghe
            $searchTerms = explode(' ', $search);
            $formattedSearch = '';
            foreach ($searchTerms as $term) {
                if (strlen($term) > 2)
                    $formattedSearch .= "+$term* ";
            }
            $formattedSearch = trim($formattedSearch);

            if (empty($formattedSearch)) {
                $conditions[] = "v.Titolo LIKE ?";
                $params[] = "%$search%";
                $types .= "s";
            } else {
                $conditions[] = "MATCH(v.Titolo) AGAINST(? IN BOOLEAN MODE)";
                $params[] = $formattedSearch;
                $types .= "s";
            }
        }
    }

    if (!empty($conditions)) {
        $query .= "WHERE " . implode(" AND ", $conditions) . " ";
    }

    // 5. Ordinamento (ORDER BY)
    if ($type === 'history') {
        $query .= "ORDER BY cr.ultimo_aggiornamento DESC ";
    } else if ($type === 'saved') {
        $query .= "ORDER BY s.data_ora_salvato DESC ";
    } else if ($type === 'liked') {
        $query .= "ORDER BY l.data_ora_like DESC ";
    } else if (!empty($search)) {
        $query .= "ORDER BY v.Titolo ASC ";
    } else if ($seed > 0) {
        $query .= "ORDER BY RAND($seed) ";
    } else {
        $query .= "ORDER BY v.data_Pubblicazione DESC, v.id DESC ";
    }

    // 6. Paginazione
    $query .= "LIMIT ? OFFSET ?";
    $params[] = $limit;
    $params[] = $offset;
    $types .= "ii";

    // 7. Esecuzione e salvataggio in Cache
    $res = executePreparedQuery($query, $types, $params);
    $dati = $res->fetch_all(MYSQLI_ASSOC);

    if ($shouldCache && !empty($dati)) {
        $Cache->set($cacheKey, $dati, 300); // Scadenza 5 minuti
    }


    // ============================================================================
    // SEZIONE 5: RISPOSTA AL CLIENT
    // ============================================================================
    inviaRisposta(true, "Lista video caricata con successo", 200, ['dati' => $dati]);

} catch (Exception $e) {
    error_log("❌ [VIDEOS API ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore interno durante il recupero dei video.", 500);
}
?>