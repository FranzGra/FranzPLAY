<?php
/**
 * logout.php - Termina sessione utente
 */

require_once 'gestione_richiesta.php';

// ==================== LOG UTENTE ====================

// ============================================================================
// SEZIONE 2: LOGICA CORE (TERMINAZIONE SESSIONE)
// ============================================================================

// Pulisce l'array globale della sessione
$_SESSION = [];

// Se la sessione è basata su cookie, resetta il cookie di sessione
if (ini_get("session.use_cookies")) {
    $params = session_get_cookie_params();
    setcookie(
        session_name(),
        '',
        time() - 42000,
        $params["path"],
        $params["domain"],
        $params["secure"],
        $params["httponly"]
    );
}

// Distrugge definitivamente i dati sul server
session_destroy();


// ============================================================================
// SEZIONE 3: RISPOSTA AL CLIENT
// ============================================================================

inviaRisposta(true, 'Disconnessione effettuata con successo. A presto!', 200);
?>