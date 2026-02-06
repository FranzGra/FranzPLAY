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
    $query = "SELECT id, Nome, Percorso, Immagine_Sfondo FROM Categorie ORDER BY Nome ASC";

    // Utilizziamo executePreparedQuery per coerenza con lo standard del progetto
    $res = executePreparedQuery($query);

    if ($res) {
        $lista_categorie = $res->fetch_all(MYSQLI_ASSOC);


        // ============================================================================
        // SEZIONE 4: RISPOSTA AL CLIENT
        // ============================================================================
        inviaRisposta(true, 'Lista categorie caricata', 200, ['dati' => $lista_categorie]);

    } else {
        throw new Exception("Nessun dato restituito dalla query delle categorie.");
    }

} catch (Exception $e) {
    error_log("❌ [CATEGORIE API ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore durante il recupero delle categorie.", 500);
}
?>