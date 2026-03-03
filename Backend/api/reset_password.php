<?php
/**
 * ============================================================================
 * Backend/api/reset_password.php
 * ============================================================================
 * 
 * SCOPO:
 * Gestisce il flusso sicuro per il recupero della password dimenticata.
 * Il processo si divide in due fasi:
 * 1. Richiesta Token: Verifica l'utente e genera un link temporaneo.
 * 2. Reset Password: Valida il token e aggiorna la credenziale.
 * 
 * SICUREZZA:
 * - Token casuali crittograficamente sicuri (bin2hex + random_bytes).
 * - Scadenza temporale dei token (TTL 1 ora).
 * - Invalidazione del token dopo l'uso (Anti-replay).
 * - Simulazione invio email tramite logging server per facilità di debug in ambiente dev.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once 'gestione_richiesta.php';
require_once 'database.php';


// ============================================================================
// SEZIONE 2: GESTIONE INPUT E PARAMETRI
// ============================================================================

$input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
$azione = $input['action'] ?? '';


// ============================================================================
// SEZIONE 3: LOGICA CORE (FASI DI RESET)
// ============================================================================

try {
    switch ($azione) {

        // --- FASE 1: RICHIESTA LINK DI RESET ---
        case 'request_reset':
            $user_input = trim($input['input'] ?? ''); // Può essere Username o Email

            if (empty($user_input)) {
                inviaRisposta(false, 'È necessario inserire lo username o l\'email associata.', 400);
            }

            // Ricerca dell'utente delegata a query preparata
            $res = executePreparedQuery(
                "SELECT id, Email FROM Utenti WHERE Nome_Utente = ? OR Email = ?",
                "ss",
                [$user_input, $user_input]
            );
            $utente = $res->fetch_assoc();

            // Nota: In produzione sarebbe meglio non rivelare l'esistenza dell'account,
            // ma in questo contesto diamo feedback per semplicità.
            if (!$utente || empty($utente['Email'])) {
                inviaRisposta(false, 'Nessun account trovato o nessuna email associata a questo profilo.', 404);
            }

            // Generazione Token e Scadenza
            $token = bin2hex(random_bytes(32));
            $expiry = date('Y-m-d H:i:s', strtotime('+1 hour'));

            executePreparedQuery(
                "UPDATE Utenti SET ResetToken = ?, ResetTokenExpiry = ? WHERE id = ?",
                "ssi",
                [$token, $expiry, $utente['id']]
            );

            // LOGICA DI INVIO EMAIL (Simulazione)
            $link = "http://" . $_SERVER['HTTP_HOST'] . "/reset-password?token=" . $token;
            error_log("\n📧 [SIMULAZIONE INVIO EMAIL RESET] ----------------");
            error_log("A: " . $utente['Email']);
            error_log("OGGETTO: Recupero Password FranzPLAY");
            error_log("LINK: " . $link);
            error_log("--------------------------------------------------\n");

            inviaRisposta(true, 'Istruzioni inviate! Controlla la tua casella email (o i log del server).', 200);
            break;


        // --- FASE 2: APPLICAZIONE NUOVA PASSWORD ---
        case 'reset_password':
            $token = $input['token'] ?? '';
            $new_pass = $input['new_password'] ?? '';

            if (empty($token) || strlen($new_pass) < 4) {
                inviaRisposta(false, 'Parametri non validi o password troppo corta (min 4 caratteri).', 400);
            }

            // Verifica validità e scadenza token
            $res = executePreparedQuery(
                "SELECT id FROM Utenti WHERE ResetToken = ? AND ResetTokenExpiry > NOW()",
                "s",
                [$token]
            );
            $utente = $res->fetch_assoc();

            if (!$utente) {
                inviaRisposta(false, 'Il link di reset è scaduto o non è più valido.', 400);
            }

            // Hash della nuova password e pulizia token (invalidazione)
            $hash = password_hash($new_pass, PASSWORD_DEFAULT);
            executePreparedQuery(
                "UPDATE Utenti SET Password = ?, ResetToken = NULL, ResetTokenExpiry = NULL WHERE id = ?",
                "si",
                [$hash, $utente['id']]
            );

            inviaRisposta(true, 'Ottimo! La tua password è stata aggiornata. Ora puoi accedere.', 200);
            break;


        default:
            inviaRisposta(false, "Azione di reset non supportata: $azione", 400);
    }

} catch (Exception $e) {
    error_log("❌ [RESET PASSWORD ERROR] " . $e->getMessage());
    inviaRisposta(false, "Si è verificato un errore tecnico nel recupero password.", 500);
}
?>