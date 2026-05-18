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
require_once 'rate_limit.php';

// Anti-spam reset password: max 5 ogni 10 minuti per IP.
$ip_addr_rp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (strpos($ip_addr_rp, ',') !== false) {
    $ip_addr_rp = trim(explode(',', $ip_addr_rp)[0]);
}
checkRateLimit('reset_password', $ip_addr_rp, 5, 600);


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

            // Anti-enumeration: rispondi sempre con lo stesso messaggio, sia che
            // l'account esista o meno. Solo se esiste con email, generiamo realmente il token.
            $messaggio_generico = 'Se l\'account esiste e ha un\'email associata, le istruzioni sono state inviate.';

            if ($utente && !empty($utente['Email'])) {
                // Generazione Token e Scadenza
                $token = bin2hex(random_bytes(32));
                $expiry = date('Y-m-d H:i:s', strtotime('+1 hour'));

                $updated = executePreparedQuery(
                    "UPDATE Utenti SET ResetToken = ?, ResetTokenExpiry = ? WHERE id = ?",
                    "ssi",
                    [$token, $expiry, $utente['id']]
                );
                if ($updated === false) {
                    error_log("❌ [RESET] Impossibile salvare token per utente {$utente['id']}");
                    inviaRisposta(false, "Errore interno nel salvataggio token.", 500);
                }

                // LOGICA DI INVIO EMAIL (Simulazione)
                $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
                $link = "http://" . $host . "/reset-password?token=" . $token;
                error_log("📧 [SIMULAZIONE EMAIL RESET] To=" . $utente['Email'] . " | Link=" . $link);
            } else {
                // Logga internamente per diagnostica, ma rispondi generico al client.
                error_log("ℹ️ [RESET] Richiesta per identificativo inesistente: $user_input");
            }

            inviaRisposta(true, $messaggio_generico, 200);
            break;


        // --- FASE 2: APPLICAZIONE NUOVA PASSWORD ---
        case 'reset_password':
            $token = $input['token'] ?? '';
            $new_pass = $input['new_password'] ?? '';

            if (empty($token) || strlen($new_pass) < 8) {
                inviaRisposta(false, 'Parametri non validi o password troppo corta (min 8 caratteri).', 400);
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