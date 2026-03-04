<?php
/**
 * ============================================================================
 * Backend/api/impostazioni.php
 * ============================================================================
 * 
 * SCOPO:
 * Esporta le impostazioni pubbliche del sistema, come ad esempio le parti
 * del logo da mostrare nel frontend.
 * ============================================================================
 */

header('Content-Type: application/json; charset=utf-8');

// Permettiamo le richieste CORS per lo sviluppo
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Gestione preflight CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once 'database.php';
require_once 'cache.php';

global $Cache;
global $database;

try {
    $logo_data = null;

    // 1. Tenta di caricare dalla cache Redis
    if (isset($Cache) && is_object($Cache)) {
        $logo_data = $Cache->get('impostazioni_globali');
    }

    // 2. Fallback su database in caso di cache miss
    if (!$logo_data) {
        $res = $database->query("SELECT Chiave_Impostazione, Valore_Impostazione FROM Impostazioni WHERE Chiave_Impostazione IN ('logo_part_1', 'logo_part_2', 'colore_tema_default')");

        $logo_data = [
            'logo_part_1' => 'FRANZ',
            'logo_part_2' => 'PLAY',
            'colore_tema_default' => '#dc2626'
        ];

        if ($res) {
            while ($row = $res->fetch_assoc()) {
                if ($row['Valore_Impostazione']) {
                    $logo_data[$row['Chiave_Impostazione']] = $row['Valore_Impostazione'];
                }
            }
        }

        // Salva in cache per 24 ore
        if (isset($Cache) && is_object($Cache)) {
            $Cache->set('impostazioni_globali', $logo_data, 86400);
        }
    }

    echo json_encode(["success" => true, "dati" => $logo_data]);

} catch (Exception $e) {
    // Risposta di fallback sicura in caso di errore
    http_response_code(200);
    echo json_encode([
        "success" => true,
        "dati" => [
            "logo_part_1" => "FRANZ",
            "logo_part_2" => "PLAY",
            "colore_tema_default" => "#dc2626"
        ],
        "avviso" => "Errore recupero da database: " . $e->getMessage()
    ]);
}

$database->close();
?>