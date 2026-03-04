<?php
/**
 * ============================================================================
 * Backend/api/rimuoviDaCronologia.php
 * ============================================================================
 * 
 * SCOPO:
 * Gestisce la rimozione o il nascondimento dei video dalla cronologia utente.
 * Supporta diverse modalità di pulizia in base al contesto UI.
 * 
 * AZIONI SUPPORTATE:
 * - soft (default): Imposta continua_a_guardare = 0. Nasconde dalla home ma
 *                  mantiene il progresso salvato per futuri utilizzi.
 * - hard: Elimina fisicamente il record dal database.
 * - clear: Svuota l'intera cronologia dell'utente loggato.
 * 
 * INPUT (JSON/POST):
 * - videoId (int): ID del video da rimuovere (eccetto per 'clear').
 * - action (string): Tipo di rimozione ('soft', 'hard', 'clear').
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

// Verifica che l'utente sia loggato
if (!isset($_SESSION['id_utente'])) {
    inviaRisposta(false, 'Operazione non consentita senza login.', 401);
}

$id_utente = $_SESSION['id_utente'];


// ============================================================================
// SEZIONE 3: GESTIONE INPUT E PARAMETRI
// ============================================================================

$input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
$id_video = (int) ($input['videoId'] ?? 0);
$tipo_azione = $input['action'] ?? 'soft';


// ============================================================================
// SEZIONE 4: LOGICA CORE (PULIZIA CRONOLOGIA)
// ============================================================================

try {
    switch ($tipo_azione) {

        // --- CASO 1: PULIZIA TOTALE ---
        case 'clear':
            executePreparedQuery("DELETE FROM Cronologia WHERE id_Utente = ?", "i", [$id_utente]);
            $messaggio = "Cronologia svuotata con successo.";
            break;

        // --- CASO 2: RIMOZIONE DEFINITIVA SINGOLA ---
        case 'hard':
            if ($id_video <= 0)
                inviaRisposta(false, 'Specificare un ID video valido per la rimozione.', 400);

            executePreparedQuery("DELETE FROM Cronologia WHERE id_Utente = ? AND id_Video = ?", "ii", [$id_utente, $id_video]);
            $messaggio = "Video eliminato dalla cronologia.";
            break;

        // --- CASO 3: NASCONDIMENTO DALLA HOME (SOFT) ---
        case 'soft':
        default:
            if ($id_video <= 0)
                inviaRisposta(false, 'Specificare un ID video valido per l\'azione.', 400);

            executePreparedQuery(
                "UPDATE Cronologia SET continua_a_guardare = 0 WHERE id_Utente = ? AND id_Video = ?",
                "ii",
                [$id_utente, $id_video]
            );
            $messaggio = "Il video non comparirà più tra quelli da continuare.";
            break;
    }


    // ============================================================================
    // SEZIONE 5: RISPOSTA AL CLIENT
    // ============================================================================
    inviaRisposta(true, $messaggio, 200);

} catch (Exception $e) {
    error_log("❌ [RIMUOVI_CRONOLOGIA ERROR] Azione: $tipo_azione - " . $e->getMessage());
    inviaRisposta(false, "Errore durante la modifica della cronologia.", 500);
}
?>