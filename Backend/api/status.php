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
    // Conta gli utenti nel database
    $res = $database->query("SELECT COUNT(*) as num_utenti FROM Utenti");

    if (!$res) {
        throw new Exception("Errore nel conteggio utenti: " . $database->error);
    }

    $row = $res->fetch_assoc();
    $num_utenti = (int) $row['num_utenti'];

    $needsSetup = ($num_utenti === 0);

    echo json_encode([
        "success" => true,
        "needsSetup" => $needsSetup,
        "isConfigured" => !$needsSetup
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "needsSetup" => false,
        "avviso" => "Errore verifica stato sistema: " . $e->getMessage()
    ]);
}

$database->close();
?>