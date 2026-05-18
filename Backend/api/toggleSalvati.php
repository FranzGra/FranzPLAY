<?php
/**
 * ============================================================================
 * Backend/api/toggleSalvati.php
 * ============================================================================
 *
 * SCOPO:
 * Gestisce la lista dei video salvati ("Guarda più tardi") dell'utente.
 * Aggiunge il video se non presente, oppure lo rimuove se già salvato.
 *
 * LOGICA ATOMICA:
 * - INSERT IGNORE: evita violazioni di PRIMARY KEY su (id_Utente, id_Video)
 *   in caso di doppio click / richieste parallele.
 * - DELETE atomico per la rimozione.
 *
 * INPUT (JSON/POST):
 * - videoId (int): Identificativo del video da salvare/rimuovere.
 * - action (opzionale): 'save' | 'unsave' per evitare comportamento ping-pong.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once 'gestione_richiesta.php';
require_once 'database.php';


// ============================================================================
// SEZIONE 2: AUTENTICAZIONE
// ============================================================================

if (!isset($_SESSION['id_utente'])) {
    inviaRisposta(false, 'È necessario autenticarsi per salvare i video.', 401);
}
$id_utente = $_SESSION['id_utente'];


// ============================================================================
// SEZIONE 3: GESTIONE INPUT
// ============================================================================

$input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
$id_video = (int) ($input['videoId'] ?? 0);
$desired = isset($input['action']) ? strtolower(trim((string)$input['action'])) : null;

if ($id_video <= 0) {
    inviaRisposta(false, 'ID video non valido o mancante.', 400);
}


// ============================================================================
// SEZIONE 4: LOGICA CORE (ATOMICA)
// ============================================================================

try {
    // Stato corrente per il toggle (se action non specificata).
    $res = executePreparedQuery(
        "SELECT 1 FROM Salvati WHERE id_Utente = ? AND id_Video = ?",
        "ii",
        [$id_utente, $id_video]
    );
    $gia_salvato = $res && $res->fetch_assoc();

    if ($desired === 'save') $azione_da_eseguire = 'save';
    elseif ($desired === 'unsave') $azione_da_eseguire = 'unsave';
    else $azione_da_eseguire = $gia_salvato ? 'unsave' : 'save';

    if ($azione_da_eseguire === 'unsave') {
        executePreparedQuery(
            "DELETE FROM Salvati WHERE id_Utente = ? AND id_Video = ?",
            "ii",
            [$id_utente, $id_video]
        );
        $messaggio = "Rimosso dai video salvati.";
        $azione = 'unsaved';
    } else {
        // INSERT IGNORE: idempotente sotto richieste parallele.
        executePreparedQuery(
            "INSERT IGNORE INTO Salvati (id_Utente, id_Video) VALUES (?, ?)",
            "ii",
            [$id_utente, $id_video]
        );
        $messaggio = "Aggiunto ai video salvati!";
        $azione = 'saved';
    }

    // ============================================================================
    // SEZIONE 5: RISPOSTA AL CLIENT
    // ============================================================================
    inviaRisposta(true, $messaggio, 200, ['azione' => $azione]);

} catch (Exception $e) {
    error_log("❌ [TOGGLE_SALVATI ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore durante l'aggiornamento dei preferiti.", 500);
}
?>
