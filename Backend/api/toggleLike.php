<?php
/**
 * ============================================================================
 * Backend/api/toggleLike.php
 * ============================================================================
 *
 * SCOPO:
 * Gestisce l'aggiunta o la rimozione di un "Like" da parte dell'utente.
 * Mantiene la coerenza tra la tabella di relazione e il contatore nel video.
 *
 * LOGICA ATOMICA:
 * - INSERT IGNORE per evitare violazioni di PRIMARY KEY sotto richieste parallele;
 *   se `affected_rows` è 1 (nuovo like) incrementiamo il contatore.
 * - Per l'unlike, DELETE atomico: se `affected_rows` è 1 (rimosso), decrementiamo.
 * - GREATEST(0, ...) per evitare contatori negativi se il DB ha drift legacy.
 * - Tutto in transazione per atomicità rispetto a tabella Video / Like.
 *
 * INPUT (JSON/POST):
 * - videoId (int): ID del video su cui agire.
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
    inviaRisposta(false, 'Devi essere loggato per mettere like.', 401);
}
$id_utente = $_SESSION['id_utente'];


// ============================================================================
// SEZIONE 3: GESTIONE INPUT
// ============================================================================

$input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
$id_video = (int) ($input['videoId'] ?? 0);

if ($id_video <= 0) {
    inviaRisposta(false, 'Identificativo video non valido.', 400);
}

// L'azione esplicita evita comportamenti "ping-pong" sotto doppio click rapido.
// Se non specificata, manteniamo la logica originale di "toggle" basato sullo stato corrente.
$desired = isset($input['action']) ? strtolower(trim((string)$input['action'])) : null;


// ============================================================================
// SEZIONE 4: LOGICA CORE (TRANSAZIONE ATOMICA)
// ============================================================================

try {
    $database->begin_transaction();

    // Stato corrente (può cambiare per altre richieste prima del COMMIT, ma il
    // controllo finale è basato sugli affected_rows degli INSERT/DELETE atomici).
    $res = executePreparedQuery(
        "SELECT 1 FROM `Like` WHERE id_Utente = ? AND id_Video = ?",
        "ii",
        [$id_utente, $id_video]
    );
    $gia_messo = $res && $res->fetch_assoc();

    // Determina l'azione: se il client specifica 'like'/'unlike' la rispettiamo,
    // altrimenti facciamo toggle in base allo stato.
    if ($desired === 'like') $azione = 'like';
    elseif ($desired === 'unlike') $azione = 'unlike';
    else $azione = $gia_messo ? 'unlike' : 'like';

    if ($azione === 'unlike') {
        // DELETE atomico: ritorna affected_rows>0 solo se il record c'era davvero.
        executePreparedQuery(
            "DELETE FROM `Like` WHERE id_Utente = ? AND id_Video = ?",
            "ii",
            [$id_utente, $id_video]
        );
        global $last_affected_rows;
        if ($last_affected_rows > 0) {
            // Decremento condizionale tramite prepared statement (no SQL injection).
            executePreparedQuery(
                "UPDATE Video SET Likes = GREATEST(0, Likes - 1) WHERE id = ?",
                "i",
                [$id_video]
            );
        }
        $stato_finale = 'unliked';
        $messaggio = "Like rimosso.";
    } else {
        // INSERT IGNORE: sotto richieste parallele dello stesso utente sullo stesso
        // video, una vince e l'altra non incrementa due volte il contatore.
        executePreparedQuery(
            "INSERT IGNORE INTO `Like` (id_Utente, id_Video) VALUES (?, ?)",
            "ii",
            [$id_utente, $id_video]
        );
        global $last_affected_rows;
        if ($last_affected_rows > 0) {
            executePreparedQuery(
                "UPDATE Video SET Likes = Likes + 1 WHERE id = ?",
                "i",
                [$id_video]
            );
        }
        $stato_finale = 'liked';
        $messaggio = "Hai messo like al video!";
    }

    $database->commit();

    // ============================================================================
    // SEZIONE 5: RISPOSTA AL CLIENT
    // ============================================================================
    inviaRisposta(true, $messaggio, 200, ['azione' => $stato_finale]);

} catch (Exception $e) {
    @$database->rollback();
    error_log("❌ [TOGGLE_LIKE ERROR] Video ID: $id_video - " . $e->getMessage());
    inviaRisposta(false, "Si è verificato un errore durante l'aggiornamento del like.", 500);
}
?>
