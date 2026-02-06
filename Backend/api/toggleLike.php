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
 * LOGICA:
 * Utilizza una transazione SQL per garantire che l'inserimento/rimozione del 
 * like e l'aggiornamento del contatore `Likes` nella tabella `Video` 
 * avvengano come operazione atomica.
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
// SEZIONE 2: AUTENTICAZIONE E SICUREZZA
// ============================================================================

// L'azione richiede un utente autenticato
if (!isset($_SESSION['id_utente'])) {
    inviaRisposta(false, 'Devi essere loggato per mettere like.', 401);
}

$id_utente = $_SESSION['id_utente'];


// ============================================================================
// SEZIONE 3: GESTIONE INPUT E VALIDAZIONE
// ============================================================================

$input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
$id_video = (int) ($input['videoId'] ?? 0);

if ($id_video <= 0) {
    inviaRisposta(false, 'Identificativo video non valido.', 400);
}


// ============================================================================
// SEZIONE 4: LOGICA CORE (TRANSAZIONE LIKE)
// ============================================================================

try {
    // Inizio transazione atomica
    $database->begin_transaction();

    // 1. Verifica se il like esiste già (uso dei backtick per la parola riservata `Like`)
    $res = executePreparedQuery("SELECT 1 FROM `Like` WHERE id_Utente = ? AND id_Video = ?", "ii", [$id_utente, $id_video]);
    $gia_messo = $res->fetch_assoc();

    if ($gia_messo) {
        // --- AZIONE: RIMOZIONE LIKE (UNLIKE) ---
        executePreparedQuery("DELETE FROM `Like` WHERE id_Utente = ? AND id_Video = ?", "ii", [$id_utente, $id_video]);

        // Decrementa il contatore globale, impedendo di scendere sotto lo zero
        $database->query("UPDATE Video SET Likes = GREATEST(0, Likes - 1) WHERE id = $id_video");

        $stato_finale = 'unliked';
        $messaggio = "Like rimosso.";

    } else {
        // --- AZIONE: AGGIUNTA LIKE ---
        executePreparedQuery("INSERT INTO `Like` (id_Utente, id_Video) VALUES (?, ?)", "ii", [$id_utente, $id_video]);

        // Incrementa il contatore globale
        $database->query("UPDATE Video SET Likes = Likes + 1 WHERE id = $id_video");

        $stato_finale = 'liked';
        $messaggio = "Hai messo like al video!";
    }

    // Conferma tutte le modifiche al DB
    $database->commit();


    // ============================================================================
    // SEZIONE 5: RISPOSTA AL CLIENT
    // ============================================================================
    inviaRisposta(true, $messaggio, 200, ['azione' => $stato_finale]);

} catch (Exception $e) {
    // In caso di errore, annulla ogni modifica parziale
    $database->rollback();
    error_log("❌ [TOGGLE_LIKE ERROR] Video ID: $id_video - " . $e->getMessage());
    inviaRisposta(false, "Si è verificato un errore durante l'aggiornamento del like.", 500);
}
?>