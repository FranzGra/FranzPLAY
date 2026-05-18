<?php
/**
 * ============================================================================
 * Backend/api/setup_auth.php
 * ============================================================================
 *
 * SCOPO:
 * Migration Utility per l'aggiornamento dello schema del Database.
 * Aggiunge le colonne necessarie per la gestione Email e Reset Password
 * alla tabella 'Utenti' esistente.
 *
 * UTILIZZO:
 * Eseguibile solo da amministratori autenticati. Le migrazioni vengono
 * eseguite all'interno di una transazione per garantire atomicità.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once 'gestione_richiesta.php';
require_once 'database.php';


// ============================================================================
// SEZIONE 2: SICUREZZA E CONTROLLI ACCESSO
// ============================================================================

// Le migrazioni dello schema DB sono operazioni distruttive: richiedono privilegi admin.
if (empty($_SESSION['amministratore'])) {
    inviaRisposta(false, 'Accesso non autorizzato. Solo gli amministratori possono eseguire migrazioni.', 403);
}

$logs = [];


// ============================================================================
// SEZIONE 3: UTILITY E HELPER
// ============================================================================

/**
 * Verifica se una specifica colonna esiste in una tabella.
 * Whitelist regex obbligatoria su $table e $column per prevenire SQL injection
 * (SHOW COLUMNS non accetta prepared statements per i nomi di oggetto).
 */
function checkColumnExists($db, $table, $column)
{
    if (!preg_match('/^[A-Za-z0-9_]+$/', $table) || !preg_match('/^[A-Za-z0-9_]+$/', $column)) {
        throw new Exception("Nome tabella/colonna non valido: $table.$column");
    }
    $res = $db->query("SHOW COLUMNS FROM `$table` LIKE '" . $db->real_escape_string($column) . "'");
    return $res && $res->num_rows > 0;
}


// ============================================================================
// SEZIONE 4: LOGICA CORE (MIGRAZIONE DATI ATOMICA)
// ============================================================================

try {
    $database->begin_transaction();

    // 1. GESTIONE COLONNA EMAIL
    if (!checkColumnExists($database, 'Utenti', 'Email')) {
        if (!$database->query("ALTER TABLE Utenti ADD COLUMN Email VARCHAR(255) NULL UNIQUE AFTER Password")) {
            throw new Exception("ALTER Email fallita: " . $database->error);
        }
        $logs[] = "✅ Migrazione: Colonna 'Email' aggiunta con successo.";
    } else {
        $logs[] = "ℹ️ Saltato: Colonna 'Email' già presente.";
    }

    // 2. GESTIONE COLONNE RESET TOKEN (Recupero Password)
    if (!checkColumnExists($database, 'Utenti', 'ResetToken')) {
        if (!$database->query("ALTER TABLE Utenti ADD COLUMN ResetToken VARCHAR(255) NULL AFTER Email")) {
            throw new Exception("ALTER ResetToken fallita: " . $database->error);
        }
        if (!$database->query("ALTER TABLE Utenti ADD COLUMN ResetTokenExpiry DATETIME NULL AFTER ResetToken")) {
            throw new Exception("ALTER ResetTokenExpiry fallita: " . $database->error);
        }
        $logs[] = "✅ Migrazione: Colonne per il Reset Password aggiunte.";
    } else {
        $logs[] = "ℹ️ Saltato: Colonne ResetToken già presenti.";
    }

    $database->commit();

    // ============================================================================
    // SEZIONE 5: RISPOSTA AL CLIENT
    // ============================================================================
    inviaRisposta(true, "Migrazione Database completata correttamente.", 200, ['dettagli' => $logs]);

} catch (Exception $e) {
    @$database->rollback();
    error_log("❌ [SETUP DB ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore SQL durante la migrazione: " . $e->getMessage(), 500);
}
?>
