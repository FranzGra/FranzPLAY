<?php
/**
 * ============================================================================
 * Backend/api/setup.php
 * ============================================================================
 * 
 * SCOPO:
 * Endpoint finale del First-Time Wizard. Riceve i dati iniziali (Utente,
 * Logo, Tema) e li salva nel database.
 * 
 * SICUREZZA:
 * L'endpoint si rifiuta di funzionare se esiste già almeno un utente
 * nel sistema (needsSetup = false).
 * ============================================================================
 */

require_once 'gestione_richiesta.php';
require_once 'database.php';
require_once 'cache.php';

global $database;
global $Cache;

// 1. VERIFICA SICUREZZA E STATO SISTEMA
try {
    // Controlliamo se esiste la tabella utenti
    $tableExists = checkTableExists('Utenti');

    if ($tableExists) {
        $res = $database->query("SELECT COUNT(*) as num_utenti FROM Utenti");
        $row = $res->fetch_assoc();
        if ((int)$row['num_utenti'] > 0) {
            inviaRisposta(false, "Sistema già configurato. Accesso al setup negato.", 403);
        }
    }
    else {
        // LA TABELLA NON ESISTE: DOBBIAMO INIZIALIZZARE IL DATABASE
        // Leggiamo lo schema SQL dal file mappato nel container
        $sqlPath = '/var/www/Docker_Config/DBMS_Iniziale/DBMS.sql';

        if (!file_exists($sqlPath)) {
            throw new Exception("File di inizializzazione database non trovato in $sqlPath. Verifica il mount dei volumi.");
        }

        $sql = file_get_contents($sqlPath);
        if (!executeMultiQuery($sql)) {
            throw new Exception("Errore durante l'inizializzazione dello schema database.");
        }

        // Piccolo delay per dare tempo a MySQL/MariaDB di stabilizzare le tabelle appena create
        usleep(500000);
    }
}
catch (Exception $e) {
    inviaRisposta(false, "Errore verifica/inizializzazione sistema: " . $e->getMessage(), 500);
}

// 2. LETTURA DATI
$data = json_decode(file_get_contents("php://input"), true);

$username = trim($data['username'] ?? '');
$password = trim($data['password'] ?? '');
$logo_part_1 = trim($data['logo_part_1'] ?? 'FRANZ');
$logo_part_2 = trim($data['logo_part_2'] ?? 'PLAY');
$colore_tema_default = trim($data['colore_tema_default'] ?? '#dc2626');

// Validazione base
if (empty($username) || empty($password)) {
    inviaRisposta(false, "Username e Password sono obbligatori", 400);
}

if (strlen($password) < 4) {
    inviaRisposta(false, "La password deve contenere almeno 4 caratteri", 400);
}

// 3. ESECUZIONE SETUP
$database->begin_transaction();

try {
    // A. Cancellazione impostazioni vecchie/sporche
    $database->query("DELETE FROM Impostazioni WHERE Chiave_Impostazione IN ('logo_part_1', 'logo_part_2', 'colore_tema_default')");

    // B. Inserimento nuove impostazioni grafiche
    $sql_impostazioni = "INSERT INTO Impostazioni (Chiave_Impostazione, Valore_Impostazione) VALUES (?, ?)";

    executePreparedQuery($sql_impostazioni, "ss", ['logo_part_1', $logo_part_1]);
    executePreparedQuery($sql_impostazioni, "ss", ['logo_part_2', $logo_part_2]);
    executePreparedQuery($sql_impostazioni, "ss", ['colore_tema_default', $colore_tema_default]);

    // C. Creazione Utente Amministratore
    $hash_password = password_hash($password, PASSWORD_BCRYPT);
    $sql_utente = "INSERT INTO Utenti (Nome_Utente, Password, Admin) VALUES (?, ?, TRUE)";

    $success = executePreparedQuery($sql_utente, "ss", [$username, $hash_password]);
    if (!$success) {
        throw new Exception("Errore durante la creazione dell'amministratore (username già in uso?)");
    }

    // D. Invalida la Cache se esiste
    if (isset($Cache) && is_object($Cache)) {
        $Cache->delete('impostazioni_globali');
    }

    $database->commit();
    inviaRisposta(true, "Configurazione iniziale completata con successo.", 200);

}
catch (Exception $e) {
    $database->rollback();
    error_log("❌ [SETUP ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore durante il salvataggio della configurazione: " . $e->getMessage(), 500);
}
?>