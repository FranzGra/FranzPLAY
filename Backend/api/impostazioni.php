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

// CORS coerente: whitelist invece di "*" per non esporre il backend a tutti.
$allowed_origins_imp = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://frontend:5173',
    'http://localhost',
    'http://localhost:80'
];
$origin_imp = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin_imp, $allowed_origins_imp)) {
    header("Access-Control-Allow-Origin: $origin_imp");
    header("Access-Control-Allow-Credentials: true");
}
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Gestione preflight CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
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
        $res = $database->query("SELECT Chiave_Impostazione, Valore_Impostazione FROM Impostazioni WHERE Chiave_Impostazione IN ('logo_part_1', 'logo_part_2', 'colore_tema_default', 'registrazione_abilitata')");

        $logo_data = [
            'logo_part_1' => 'FRANZ',
            'logo_part_2' => 'PLAY',
            'colore_tema_default' => '#dc2626',
            'registrazione_abilitata' => '1'
        ];

        if ($res) {
            while ($row = $res->fetch_assoc()) {
                // ATTENZIONE: NON usare if ($valore) — in PHP la stringa '0' è
                // falsy, quindi un toggle salvato come '0' (es. registrazione
                // disabilitata) verrebbe scartato e resterebbe il default '1'.
                if ($row['Valore_Impostazione'] !== null && $row['Valore_Impostazione'] !== '') {
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
    error_log("❌ [IMPOSTAZIONI ERROR] " . $e->getMessage());
    // Risposta di fallback sicura senza leakare dettagli al client
    http_response_code(200);
    echo json_encode([
        "success" => true,
        "dati" => [
            "logo_part_1" => "FRANZ",
            "logo_part_2" => "PLAY",
            "colore_tema_default" => "#dc2626",
            "registrazione_abilitata" => "1"
        ],
        "avviso" => "Impostazioni temporanee (fallback)"
    ]);
}
?>