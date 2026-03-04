<?php
/**
 * ============================================================================
 * Backend/api/database.php
 * ============================================================================
 * 
 * SCOPO:
 * Motore di persistenza dati. Gestisce la connessione al database MySQL
 * e fornisce strumenti sicuri per l'esecuzione delle query.
 * 
 * VARIABILI ESPORTATE:
 * - $database (mysqli): Oggetto di connessione globale.
 * 
 * FUNZIONI DISPONIBILI:
 * - executePreparedQuery($query, $types, $params): Esecuzione sicura di query SQL.
 * 
 * SICUREZZA:
 * Utilizza credenziali fornite tramite variabili d'ambiente Docker.
 * Configura MySQLi in modalità strict (Exception) per prevenire leak di dati.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: CONFIGURAZIONE ERROR REPORTING
// ============================================================================

/**
 * Configure MySQLi per sollevare eccezioni in caso di errore.
 * Questo evita che i messaggi di errore SQL vengano stampati direttamente 
 * nel buffer d'uscita, rompendo il formato JSON.
 */
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);


// ============================================================================
// SEZIONE 2: CONNESSIONE AL SERVER (DOCKER ENVIRONMENT)
// ============================================================================

/**
 * Recupero parametri di connessione.
 * In ambiente Docker, l'host è solitamente il nome del servizio container ('mysql').
 */
$hostname = trim(getenv('MYSQL_HOST') ?: 'mysql');
$username = trim(getenv('MYSQL_USER') ?: 'root');
$password = trim(getenv('MYSQL_PASSWORD') ?: '');
$db_name = trim(getenv('MYSQL_DATABASE') ?: 'FranzPLAY_DBMS');

try {
    // Inizializzazione connessione
    $database = new mysqli($hostname, $username, $password, $db_name);

    // Configurazione Charset per supporto completo caratteri internazionali ed emoji
    $database->set_charset('utf8mb4');

    // Ottimizzazione performance per Raspberry Pi (timeout preventivi)
    $database->options(MYSQLI_OPT_CONNECT_TIMEOUT, 10);
    $database->options(MYSQLI_OPT_READ_TIMEOUT, 30);

    // Verifica vitalità connessione
    if (!$database->ping()) {
        throw new Exception("Il database non risponde al ping di controllo.");
    }

}
catch (Exception $e) {
    // Gestione errore critico di connessione
    error_log("❌ [DATABASE CONNECTION ERROR] " . $e->getMessage());

    $debugMessage = $e->getMessage(); // Cattura messaggio reale per debug

    // Se è disponibile la funzione di risposta standard, usiamola
    if (function_exists('inviaRisposta')) {
        inviaRisposta(false, "Il servizio database è momentaneamente offline. Dettaglio: " . $debugMessage, 500);
    }
    else {
        http_response_code(500);
        die(json_encode(["successo" => false, "messaggio" => "Errore fatale: Database offline. " . $debugMessage]));
    }
}


// ============================================================================
// SEZIONE 3: UTILITY E HELPER SQL (PREPARED STATEMENTS)
// ============================================================================

/**
 * Verifica se una tabella specifica esiste nel database attivo.
 */
function checkTableExists($tableName)
{
    global $database;
    $res = $database->query("SHOW TABLES LIKE '$tableName'");
    return ($res && $res->num_rows > 0);
}

/**
 * Esegue una serie di query SQL (es. da un file .sql).
 * Utile per l'inizializzazione del database via backend.
 */
function executeMultiQuery($sql)
{
    global $database;

    // 1. Rimuove i commenti -- (SQL standard)
    $sql = preg_replace('/--.*$/m', '', $sql);
    
    // 2. Rimuove i commenti /* ... */ (C-style)
    $sql = preg_replace('/\/\*.*?\*\//s', '', $sql);
    
    // 3. Splitta per ';' stando attenti a non splittare dentro i commenti (già rimossi)
    // Usiamo explode poiché lo schema è semplice e non ha ';' dentro stringhe/JSON.
    $queries = explode(';', $sql);
    
    foreach ($queries as $query) {
        $query = trim($query);
        if (empty($query)) continue;
        
        if (!$database->query($query)) {
            error_log("❌ [AUTO-INIT SQL ERROR] " . $database->error . " | SQL: " . substr($query, 0, 150) . "...");
            return false;
        }
    }

    return true;
}

/**
 * Esegue una query SQL utilizzando i Prepared Statements per prevenire SQL Injection.
 * 
 * @param string $query La query SQL con placeholder '?'.
 * @param string $types Stringa dei tipi dei parametri (es: 'is' -> integer, string).
 * @param array $params Array di valori da associare ai placeholder.
 * @return mysqli_result|bool Il set di risultati della query o True/False per query non-SELECT.
 */
function executePreparedQuery($query, $types = "", $params = [])
{
    global $database;

    try {
        $stmt = $database->prepare($query);

        if (!$stmt) {
            error_log("❌ [SQL PREPARE ERROR] " . $database->error . " | Query: $query");
            return false;
        }

        // Bind dinamico dei parametri se presenti
        if (!empty($params) && !empty($types)) {
            $stmt->bind_param($types, ...$params);
        }

        $stmt->execute();
        $result = $stmt->get_result();

        // Cattura righe modificate per query non-SELECT (es. DELETE/UPDATE)
        global $last_affected_rows;
        $last_affected_rows = $stmt->affected_rows;

        // Se get_result restituisce false, potrebbe essere una query non-SELECT (es. INSERT) o un errore.
        // Verifichiamo se c'è un errore reale.
        if ($result === false) {
            if ($stmt->errno !== 0) {
                throw new Exception($stmt->error);
            }
            return true; // Successo per query non-SELECT (INSERT, UPDATE, DELETE)
        }

        return $result;

    }
    catch (Exception $e) {
        error_log("❌ [SQL EXECUTE ERROR] " . $e->getMessage() . " | Query: $query");
        global $last_db_error;
        $last_db_error = $e->getMessage();
        return false;
    }
}
?>