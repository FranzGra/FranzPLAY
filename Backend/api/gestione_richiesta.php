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

// Anti-cache HTTP per tutte le risposte JSON delle API.
// Motivo: il browser e i proxy intermedi cachevano response come
// /videos.php?type=all&limit=5 fino a quando l'utente non faceva un hard
// reload, mostrando dati stantii (es. copertina ancora "null" dopo che il
// worker_assets l'aveva generata). Con no-store la cache lato client non
// avviene mai → la cache Redis lato server resta unica fonte di verità.
// Gli endpoint che servono immagini/video (stream.php) hanno cache headers propri.
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");
header("Expires: 0");


// ============================================================================
// SEZIONE 2: GESTIONE SESSIONE E COOKIE
// ============================================================================

/**
 * Configurazione Sessione su Redis, CON FALLBACK SU FILE.
 *
 * In base all'architettura per RPi4 usiamo Redis per evitare scritture su SD
 * card. Ma Redis NON deve essere un single point of failure: se il container
 * cade, il save_handler 'redis' fa fallire session_start() e con esso OGNI
 * endpoint (questo file è incluso da tutti), catalogo pubblico compreso.
 *
 * Quindi: probe rapido, e se Redis non risponde ripieghiamo su file in
 * /App_Data/Sessions (già creata e chownata a www-data dall'entrypoint).
 * Le scritture su SD tornano solo nella finestra di degrado, non a regime.
 *
 * Il probe costa un connect() con timeout 0.5s SOLO quando Redis è giù; a
 * regime la connessione riesce al primo colpo ed è nell'ordine dei microsecondi
 * sulla rete docker interna.
 */
$redisHost = getenv('REDIS_HOST') ?: 'redis';
$redisPort = (int) (getenv('REDIS_PORT') ?: 6379);
$redisPwd = getenv('REDIS_PASSWORD');

// Costruisce la stringa di connessione per il save_path
$savePath = "tcp://$redisHost:$redisPort";
if (!empty($redisPwd)) {
    $savePath .= "?auth=" . urlencode($redisPwd);
}

$sessionFallbackDir = getenv('SESSION_FALLBACK_DIR') ?: '/App_Data/Sessions';

/**
 * Memoria a breve termine dell'esito del probe.
 *
 * MISURATO: con Redis raggiungibile il probe costa 0.02 ms (irrilevante), ma
 * con Redis GIÙ costa ~500 ms — il timeout di connect — e lo pagherebbe OGNI
 * richiesta di OGNI worker PHP-FPM. Su hardware come RPi/ZimaBlade significa
 * saturare il pool e rendere il sito inusabile proprio mentre stiamo cercando
 * di tenerlo in piedi.
 *
 * Con questo marcatore, in degrado solo UNA richiesta ogni REDIS_DOWN_TTL
 * secondi paga il probe; tutte le altre pagano una filemtime() (microsecondi).
 * Il file vive nella cartella delle sessioni di fallback, che è già garantita
 * scrivibile da www-data; il prefisso "." lo tiene fuori dal garbage collector
 * di PHP, che considera solo i file "sess_*".
 */
$redisDownFlag = $sessionFallbackDir . '/.redis_non_raggiungibile';
$redisDownTtl = (int) (getenv('REDIS_DOWN_TTL') ?: 10);

$sessionRedisOk = false;
$saltaProbe = false;

if (is_file($redisDownFlag)) {
    $eta = time() - (int) @filemtime($redisDownFlag);
    if ($eta >= 0 && $eta < $redisDownTtl) {
        $saltaProbe = true;   // sappiamo già che è giù: non riproviamo adesso
    }
}

if (!$saltaProbe && class_exists('Redis')) {
    $probe = null;
    try {
        $probe = new Redis();
        // 0.3s è abbondante: Redis vive sulla rete docker interna e risponde in
        // meno di un millisecondo. Serve solo a non restare appesi se è morto.
        $probeTimeout = (float) (getenv('REDIS_SESSION_PROBE_TIMEOUT') ?: 0.3);
        if (@$probe->connect($redisHost, $redisPort, $probeTimeout)) {
            // Con requirepass attivo, senza auth ogni comando risponde NOAUTH:
            // dobbiamo autenticarci qui o il probe direbbe "ok" a torto.
            $sessionRedisOk = (empty($redisPwd) || @$probe->auth($redisPwd));
        }
    } catch (Throwable $e) {
        $sessionRedisOk = false;
    }
    if ($probe instanceof Redis) {
        try { @$probe->close(); } catch (Throwable $e) { /* già chiuso */ }
    }

    // Aggiorna il marcatore in base all'esito appena misurato.
    if ($sessionRedisOk) {
        if (is_file($redisDownFlag)) {
            @unlink($redisDownFlag);   // Redis è tornato: si riprende subito
        }
    } elseif (is_dir($sessionFallbackDir)) {
        @touch($redisDownFlag);
    }
}

// Esportiamo l'esito del probe: cache.php lo riusa per NON ripetere un secondo
// tentativo di connessione. Senza questo, con Redis giù ogni richiesta pagava
// 0.5s di probe + 1.0s di timeout in cache.php = 1.5s di latenza aggiunta.
$GLOBALS['__REDIS_DISPONIBILE'] = $sessionRedisOk;

if ($sessionRedisOk) {
    ini_set('session.save_handler', 'redis');
    ini_set('session.save_path', $savePath);
} else {
    // DEGRADO CONTROLLATO: niente Redis → sessioni su disco. Il sito resta in
    // piedi (login, admin, streaming). Le sessioni già in Redis non sono
    // leggibili da qui: gli utenti dovranno rifare login finché Redis non torna.
    if (!is_dir($sessionFallbackDir)) {
        @mkdir($sessionFallbackDir, 0770, true);
    }
    if (is_dir($sessionFallbackDir) && is_writable($sessionFallbackDir)) {
        ini_set('session.save_handler', 'files');
        ini_set('session.save_path', $sessionFallbackDir);
        error_log("⚠️ [SESSION] Redis non raggiungibile: fallback su file in $sessionFallbackDir.");
    } else {
        // Ultima spiaggia: lasciamo il default di PHP (di solito /tmp). Meglio
        // una sessione effimera che un 500 su tutta l'API.
        error_log("⚠️ [SESSION] Redis giù e $sessionFallbackDir non scrivibile: uso il default di PHP.");
    }
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
// Rileva automaticamente HTTPS (considerando reverse proxy).
$is_https = (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off')
    || (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');

session_set_cookie_params([
    'lifetime' => $session_lifetime,
    'path' => '/',
    'domain' => '',
    'secure' => $is_https, // Cookie marcato Secure solo sotto HTTPS, altrimenti il browser lo scarterebbe in dev.
    'httponly' => true,
    'samesite' => 'Lax'
]);

// Avvio del motore delle sessioni.
// Protetto: anche col fallback attivo un handler può fallire (disco pieno,
// permessi). In quel caso proseguiamo SENZA sessione invece di fatalare: gli
// endpoint pubblici continuano a rispondere JSON, quelli autenticati daranno
// un 401 pulito da check_admin.php / dai controlli su $_SESSION.
if (session_status() === PHP_SESSION_NONE) {
    try {
        if (!@session_start()) {
            error_log("⚠️ [SESSION] session_start() fallita: proseguo senza sessione.");
        }
    } catch (Throwable $e) {
        error_log("⚠️ [SESSION] Eccezione in session_start(): " . $e->getMessage());
    }
}

// Garantisce che $_SESSION sia sempre un array: senza sessione attiva PHP non
// la popola, e i `isset($_SESSION['id_utente'])` sparsi negli endpoint
// darebbero warning invece di un 401 pulito.
if (!isset($_SESSION) || !is_array($_SESSION)) {
    $_SESSION = [];
}


// ============================================================================
// SEZIONE 2-bis: NORMALIZZAZIONE DEL BODY JSON
// ============================================================================

/**
 * Il frontend invia i POST come JSON in php://input, che PHP non popola in
 * $_POST. Facciamo qui il merge, PRIMA che qualunque endpoint legga $_POST.
 *
 * Storicamente il merge viveva in admin.php, DOPO l'include di check_admin.php:
 * l'audit log leggeva quindi $_POST['action'] quando era ancora vuoto e
 * registrava "action=unknown" per ogni singola operazione amministrativa,
 * rendendo la traccia di audit inutilizzabile.
 *
 * Solo per Content-Type JSON: le richieste multipart (upload copertine, sfondi,
 * immagini profilo) hanno il body gia' consumato da PHP e php://input vuoto.
 */
$__content_type = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
if (stripos($__content_type, 'application/json') !== false) {
    $__raw = file_get_contents('php://input');
    if ($__raw !== false && $__raw !== '') {
        $__parsed = json_decode($__raw, true);
        if (is_array($__parsed)) {
            $_POST = array_merge($_POST, $__parsed);
        }
    }
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