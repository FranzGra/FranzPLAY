<?php
/**
 * ============================================================================
 * Backend/api/gestione_richiesta.php
 * ============================================================================
 * 
 * SCOPO:
 * Architettura di base dell'API. Gestisce il ciclo di vita di ogni richiesta.
 * Si occupa di:
 * 1. Policy CORS (Cross-Origin Resource Sharing).
 * 2. Gestione centralizzata delle sessioni e dei cookie.
 * 3. Output JSON standardizzato tramite inviaRisposta().
 * 
 * UTILIZZO:
 * Deve essere il primo file incluso da ogni endpoint API.
 * ============================================================================
 */


// ============================================================================
// PROTEZIONE INCLUSIONI MULTIPLE
// ============================================================================
if (defined('GESTIONE_RICHIESTA_LOADED'))
    return;
define('GESTIONE_RICHIESTA_LOADED', true);


// ============================================================================
// SEZIONE 1: CONFIGURAZIONE CORS
// ============================================================================

/**
 * Whitelist dei domini autorizzati. 
 * Include l'ambiente locale (Vite/React) e la configurazione Docker per la produzione.
 */
$allowed_origins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://frontend:5173',
    'http://localhost',
    'http://localhost:80'
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

if (in_array($origin, $allowed_origins)) {
    header("Access-Control-Allow-Origin: $origin");
    header("Access-Control-Allow-Credentials: true");
    header("Access-Control-Max-Age: 86400"); // Cache delle autorizzazioni per 24 ore
}

// Gestione "Preflight" (richieste OPTIONS inviate dai browser)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    if (isset($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_METHOD'])) {
        header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
    }
    if (isset($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'])) {
        header("Access-Control-Allow-Headers: {$_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS']}");
    }
    http_response_code(204);
    exit(0);
}

// Forza il tipo di contenuto in uscita come JSON UTF-8
header("Content-Type: application/json; charset=UTF-8");


// ============================================================================
// SEZIONE 2: GESTIONE SESSIONE E COOKIE
// ============================================================================

/**
 * Percorso persistente per i file di sessione (mappato su volume Docker).
 * Garantisce che gli utenti non vengano sloggati al riavvio del container PHP.
 */
$sessionPath = '/App_Data/Sessions';

if (!file_exists($sessionPath)) {
    @mkdir($sessionPath, 0777, true);
}

if (is_writable($sessionPath)) {
    session_save_path($sessionPath);
}

// Configurazione durata sessione (30 giorni) per un'esperienza d'uso fluida
$session_lifetime = 30 * 24 * 60 * 60;
ini_set('session.gc_maxlifetime', $session_lifetime);
ini_set('session.cookie_lifetime', $session_lifetime);

/**
 * Impostazioni di sicurezza per i cookie.
 * - HTTPOnly: Nasconde il cookie a JS (anti-XSS).
 * - SameSite=Lax: Protezione base contro CSRF.
 */
session_set_cookie_params([
    'lifetime' => $session_lifetime,
    'path' => '/',
    'domain' => '',
    'secure' => false, // Da mettere a TRUE se si abilita HTTPS in produzione
    'httponly' => true,
    'samesite' => 'Lax'
]);

// Avvio del motore delle sessioni
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}


// ============================================================================
// SEZIONE 3: UTILITY - RISPOSTA JSON STANDARDIZZATA
// ============================================================================

/**
 * Invia una risposta JSON strutturata e termina l'esecuzione.
 * 
 * @param bool   $success  Esito dell'operazione.
 * @param string $message Testo da mostrare all'utente o loggare a frontend.
 * @param int    $code      Codice di stato HTTP.
 * @param array  $extra     Dati aggiuntivi (es. liste video, token, ecc).
 */
function inviaRisposta($success, $message, $code = 200, $extra = [])
{
    http_response_code($code);

    $response = [
        'success' => (bool) $success,
        'message' => (string) $message
    ];

    if (!empty($extra)) {
        $response = array_merge($response, $extra);
    }

    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}