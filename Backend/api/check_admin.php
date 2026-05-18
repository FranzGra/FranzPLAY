<?php
/**
 * ============================================================================
 * Backend/api/check_admin.php
 * ============================================================================
 * 
 * SCOPO:
 * Middleware di protezione per endpoint amministrativi.
 * Verifica la validità della sessione e i privilegi reali nel database.
 * 
 * UTILIZZO:
 * Deve essere incluso all'inizio di ogni script PHP che richiede permessi Admin.
 * Se la verifica fallisce, lo script interrompe l'esecuzione inviando un errore JSON.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once __DIR__ . '/gestione_richiesta.php';
require_once __DIR__ . '/database.php';

/**
 * Funzione helper locale per interrompere l'esecuzione in caso di errore.
 * Utilizza la funzione globale inviaRisposta() se definita.
 */
if (!function_exists('failJson')) {
    function failJson($msg, $code)
    {
        if (function_exists('inviaRisposta')) {
            inviaRisposta(false, $msg, $code);
        } else {
            http_response_code($code);
            echo json_encode(['successo' => false, 'messaggio' => $msg], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
}


// ============================================================================
// SEZIONE 2: AUTENTICAZIONE E SICUREZZA
// ============================================================================

// 1. Verifica Sessione Base
if (!isset($_SESSION['id_utente'])) {
    failJson('Risorsa riservata agli amministratori. Effettua il login.', 401);
}

// 2. Doppia Verifica Privilegi (Database)
// Non ci fidiamo ciecamente della variabile di sessione per operazioni critiche.
try {
    $id_utente = $_SESSION['id_utente'];
    $res = executePreparedQuery("SELECT Admin FROM Utenti WHERE id = ?", "i", [$id_utente]);
    $user = $res->fetch_assoc();

    if (!$user || (int) $user['Admin'] !== 1) {
        $ip_alert = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        error_log("🚨 [SECURITY ALERT] Tentativo accesso Admin non autorizzato. UserID=$id_utente IP=$ip_alert");
        // Difesa addizionale: se la sessione mente, distruggila per forzare re-login.
        $_SESSION['amministratore'] = false;
        failJson('Accesso Negato: Sono richiesti privilegi amministrativi.', 403);
    }

    // Audit dell'azione admin (richiesta autorizzata).
    $audit_ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $audit_action = $_POST['action'] ?? $_GET['action'] ?? 'unknown';
    error_log("[ADMIN AUDIT] user=$id_utente action=$audit_action ip=$audit_ip");

    // Se arriviamo qui, il controllo è superato e lo script chiamante può proseguire.

} catch (Exception $e) {
    error_log("❌ [CHECK_ADMIN ERROR] " . $e->getMessage());
    failJson('Errore durante la verifica dei privilegi.', 500);
}
?>