<?php
/**
 * ============================================================================
 * Backend/api/status.php
 * ============================================================================
 * 
 * SCOPO:
 * Verifica se l'applicazione è già stata configurata.
 * Un'applicazione si considera "da configurare" se non esiste NESSUN utente
 * nella tabella Utenti.
 * ============================================================================
 */

// CORS coerente con gestione_richiesta.php (whitelist degli origin invece di "*").
$allowed_origins_status = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://frontend:5173',
    'http://localhost',
    'http://localhost:80'
];
$origin_status = $_SERVER['HTTP_ORIGIN'] ?? '';
header('Content-Type: application/json; charset=utf-8');
if (in_array($origin_status, $allowed_origins_status)) {
    header("Access-Control-Allow-Origin: $origin_status");
    header("Access-Control-Allow-Credentials: true");
}
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once 'database.php';
require_once 'cache.php';

global $database, $Cache;

$STATUS_CACHE_KEY = 'system_status_v1';

try {
    // 1. Verifica REALE che la tabella Utenti esista PRIMA di consultare la cache.
    //    Motivo: se il DB è stato wipato dopo che la cache aveva memorizzato
    //    isConfigured=true, la cache sarebbe stantia e il frontend mostrerebbe
    //    Login invece del Setup Wizard. Costo: una query SHOW TABLES — trascurabile.
    $checkTable = $database->query("SHOW TABLES LIKE 'Utenti'");

    if ($checkTable->num_rows === 0) {
        // La tabella non esiste: DB vuoto o non inizializzato.
        // Invalidiamo qualsiasi cache stantia che dicesse il contrario.
        if (isset($Cache) && is_object($Cache)) {
            $Cache->delete($STATUS_CACHE_KEY);
        }
        $payload = [
            "success" => true,
            "needsSetup" => true,
            "isConfigured" => false
        ];
        echo json_encode($payload);
        exit;
    }

    // 2. Tabella esiste: ora possiamo consultare la cache.
    if (isset($Cache) && is_object($Cache)) {
        $cached_status = $Cache->get($STATUS_CACHE_KEY);
        if (is_array($cached_status) && isset($cached_status['isConfigured'])) {
            echo json_encode($cached_status);
            exit;
        }
    }

    // 3. Se la tabella esiste, conta gli utenti
    $res = $database->query("SELECT COUNT(*) as num_utenti FROM Utenti");
    $row = $res->fetch_assoc();
    $num_utenti = (int)$row['num_utenti'];

    $needsSetup = ($num_utenti === 0);

    $payload = [
        "success" => true,
        "needsSetup" => $needsSetup,
        "isConfigured" => !$needsSetup
    ];

    // Cachiamo solo lo stato "configurato" (5 min): il caso "needsSetup" può
    // cambiare in qualsiasi momento al primo wizard di setup.
    if (!$needsSetup && isset($Cache) && is_object($Cache)) {
        $Cache->set($STATUS_CACHE_KEY, $payload, 300);
    }

    echo json_encode($payload);

}
catch (Exception $e) {
    // Se c'è un errore (es. tabella mancante che SHOW TABLES non ha preso o altro)
    // verifichiamo se l'errore indica che la tabella non esiste.
    if (strpos($e->getMessage(), "doesn't exist") !== false || strpos($e->getMessage(), "not found") !== false) {
        echo json_encode([
            "success" => true,
            "needsSetup" => true,
            "isConfigured" => false
        ]);
    }
    else {
        error_log("❌ [STATUS ERROR] " . $e->getMessage());
        http_response_code(500);
        echo json_encode([
            "success" => false,
            "needsSetup" => false,
            "avviso" => "Errore verifica stato sistema"
        ]);
    }
}
?>