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
 * Eseguire manualmente una tantum per adeguare il DB alle nuove funzionalità.
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

// Per sicurezza, questo script dovrebbe essere protetto. 
// Decommenta se vuoi limitarne l'uso solo agli amministratori loggati.
// if (empty($_SESSION['amministratore'])) inviaRisposta(false, 'Accesso non autorizzato', 403);

$logs = [];


// ============================================================================
// SEZIONE 3: UTILITY E HELPER
// ============================================================================

/**
 * Verifica se una specifica colonna esiste in una tabella.
 */
function checkColumnExists($db, $table, $column)
{
    $res = $db->query("SHOW COLUMNS FROM `$table` LIKE '$column'");
    return $res && $res->num_rows > 0;
}


// ============================================================================
// SEZIONE 4: LOGICA CORE (MIGRAZIONE DATI)
// ============================================================================

try {
    // 1. GESTIONE COLONNA EMAIL
    if (!checkColumnExists($database, 'Utenti', 'Email')) {
        $database->query("ALTER TABLE Utenti ADD COLUMN Email VARCHAR(255) NULL UNIQUE AFTER Password");
        $logs[] = "✅ Migrazione: Colonna 'Email' aggiunta con successo.";
    } else {
        $logs[] = "ℹ️ Saltato: Colonna 'Email' già presente.";
    }

    // 2. GESTIONE COLONNE RESET TOKEN (Recupero Password)
    if (!checkColumnExists($database, 'Utenti', 'ResetToken')) {
        $database->query("ALTER TABLE Utenti ADD COLUMN ResetToken VARCHAR(255) NULL AFTER Email");
        $database->query("ALTER TABLE Utenti ADD COLUMN ResetTokenExpiry DATETIME NULL AFTER ResetToken");
        $logs[] = "✅ Migrazione: Colonne per il Reset Password aggiunte.";
    } else {
        $logs[] = "ℹ️ Saltato: Colonne ResetToken già presenti.";
    }


    // ============================================================================
    // SEZIONE 5: RISPOSTA AL CLIENT
    // ============================================================================
    inviaRisposta(true, "Migrazione Database completata correttamente.", 200, ['dettagli' => $logs]);

} catch (Exception $e) {
    error_log("❌ [SETUP DB ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore SQL durante la migrazione: " . $e->getMessage(), 500);
}
?>