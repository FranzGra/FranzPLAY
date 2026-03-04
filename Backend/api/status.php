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

header('Content-Type: application/json; charset=utf-8');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once 'database.php';

global $database;

try {
    // 1. Verifica se la tabella Utenti esiste
    $checkTable = $database->query("SHOW TABLES LIKE 'Utenti'");

    if ($checkTable->num_rows === 0) {
        // La tabella non esiste: il database è vuoto o non inizializzato
        echo json_encode([
            "success" => true,
            "needsSetup" => true,
            "isConfigured" => false,
            "debug" => "Tabella Utenti mancante"
        ]);
        exit;
    }

    // 2. Se la tabella esiste, conta gli utenti
    $res = $database->query("SELECT COUNT(*) as num_utenti FROM Utenti");
    $row = $res->fetch_assoc();
    $num_utenti = (int)$row['num_utenti'];

    $needsSetup = ($num_utenti === 0);

    echo json_encode([
        "success" => true,
        "needsSetup" => $needsSetup,
        "isConfigured" => !$needsSetup
    ]);

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
        http_response_code(500);
        echo json_encode([
            "success" => false,
            "needsSetup" => false,
            "avviso" => "Errore verifica stato sistema: " . $e->getMessage()
        ]);
    }
}

$database->close();
?>