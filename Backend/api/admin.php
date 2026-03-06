<?php
/**
 * ============================================================================
 * Backend/api/admin.php
 * ============================================================================
 * 
 * SCOPO:
 * Punto di ingresso per tutte le operazioni amministrative del sistema.
 * Gestisce CRUD per video, categorie, utenti e monitoraggio del server.
 * 
 * AZIONI SUPPORTATE:
 * - lista_video / dettagli_video / aggiorna_info_video / elimina_video
 * - upload_copertina (gestione asset fisici)
 * - lista_categorie / aggiorna_categoria / upload_sfondo_categoria
 * - lista_utenti / toggle_admin / elimina_utente
 * - stato_server (statistiche disco e PHP)
 * 
 * SICUREZZA:
 * Richiede privilegi di amministratore verificati tramite check_admin.php.
 * Inibisce l'output di errori HTML per preservare l'integrità del JSON.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E CONFIGURAZIONE
// ============================================================================

// Include bootstrap, database e controlli di sicurezza admin
require_once 'check_admin.php';
require_once 'cache.php';

// Disabilita visualizzazione errori a schermo per non rompere il JSON
ini_set('display_errors', 0);
error_reporting(E_ALL);

// Costanti di sistema
// FIX: Usa variabile d'ambiente o fallback a path standard
$BASE_VIDEO_PATH = getenv('WATCH_DIR') ?: '/percorsoVideo';

define('ADMIN_API', true);

// ============================================================================
// SEZIONE 2: AUTENTICAZIONE E SICUREZZA
// ============================================================================

/**
 * NOTA: La sicurezza è gestita nativamente da check_admin.php.
 * Se l'esecuzione arriva a questo punto, l'utente è autenticato e admin.
 */


// ============================================================================
// SEZIONE 3: GESTIONE INPUT E NORMALIZZAZIONE
// ============================================================================

// Gestione input JSON (da api.js o simili) che caricano il body in php://input
$input = json_decode(file_get_contents('php://input'), true);
if (is_array($input)) {
    $_POST = array_merge($_POST, $input);
}

$action = $_POST['action'] ?? '';


// ============================================================================
// SEZIONE 4: LOGICA CORE (ROUTING)
// ============================================================================

try {
    $routes = [
        'videos' => ['lista_video', 'dettagli_video', 'aggiorna_info_video', 'elimina_video'],
        'assets' => ['upload_copertina', 'rimuovi_copertina', 'upload_anteprima', 'rimuovi_anteprima'],
        'categories' => ['lista_categorie', 'aggiorna_categoria', 'salva_colore_categoria', 'upload_sfondo_categoria', 'rimuovi_sfondo_categoria'],
        'users' => ['lista_utenti', 'toggle_admin', 'elimina_utente', 'aggiungi_utente', 'reset_password_utente', 'lista_accessi'],
        'system' => ['salva_impostazioni_globali', 'stato_server', 'salva_logo']
    ];

    $module_found = false;
    foreach ($routes as $module => $actions) {
        if (in_array($action, $actions)) {
            require_once __DIR__ . '/admin_modules/' . $module . '.php';
            $module_found = true;
            break;
        }
    }

    if (!$module_found) {
        inviaRisposta(false, "Azione amministrativa non supportata o definita: $action", 400);
    }

} catch (Throwable $e) {
    error_log("❌ [ADMIN ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore: " . $e->getMessage(), 500);
}


// ============================================================================
// SEZIONE 5: CHIUSURA
// ============================================================================
$database->close();
?>