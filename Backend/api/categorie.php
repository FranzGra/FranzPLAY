<?php
/**
 * ============================================================================
 * Backend/api/categorie.php
 * ============================================================================
 * 
 * SCOPO:
 * Fornisce la lista completa delle categorie disponibili nel sistema.
 * Utilizzato per popolare menu di navigazione, filtri di ricerca e badge UI.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once 'gestione_richiesta.php';
require_once 'database.php';
require_once 'cache.php';


// ============================================================================
// SEZIONE 2: AUTENTICAZIONE E SICUREZZA
// ============================================================================

// L'accesso alle categorie è vincolato agli utenti loggati
if (!isset($_SESSION['id_utente'])) {
    inviaRisposta(false, 'Sessione non valida. Accedi per visualizzare i contenuti.', 401);
}


// ============================================================================
// SEZIONE 3: LOGICA CORE (RECUPERO CATEGORIE)
// ============================================================================

try {
    global $Cache;
    $cacheKey = 'categorie_list_v1';
    $lista_categorie = null;

    // 1) Tenta dal Redis cache (TTL 10 min). Le categorie cambiano raramente.
    if (isset($Cache) && is_object($Cache)) {
        $cached = $Cache->get($cacheKey);
        if (is_array($cached)) {
            $lista_categorie = $cached;
        }
    }

    // 2) Cache miss: fallback al DB.
    if ($lista_categorie === null) {
        $query = "SELECT id, Nome, Percorso, Immagine_Sfondo, Colore_Default FROM Categorie ORDER BY Nome ASC";
        $res = executePreparedQuery($query);
        if (!$res) {
            throw new Exception("Nessun dato restituito dalla query delle categorie.");
        }
        $lista_categorie = $res->fetch_all(MYSQLI_ASSOC);

        if (isset($Cache) && is_object($Cache)) {
            $Cache->set($cacheKey, $lista_categorie, 600); // 10 minuti
        }
    }

    // ========================================================================
    // SEZIONE 4: RISPOSTA AL CLIENT
    // ========================================================================
    inviaRisposta(true, 'Lista categorie caricata', 200, ['dati' => $lista_categorie]);

} catch (Exception $e) {
    error_log("❌ [CATEGORIE API ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore durante il recupero delle categorie.", 500);
}
?>