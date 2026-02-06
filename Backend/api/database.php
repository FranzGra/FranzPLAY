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
$hostname = getenv('MYSQL_HOST') ?: 'mysql';
$username = getenv('MYSQL_USER') ?: 'root';
$password = getenv('MYSQL_PASSWORD') ?: '';
$db_name = getenv('MYSQL_DATABASE') ?: 'FranzTube_DBMS';

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

} catch (Exception $e) {
    // Gestione errore critico di connessione
    error_log("❌ [DATABASE CONNECTION ERROR] " . $e->getMessage());

    // Se è disponibile la funzione di risposta standard, usiamola
    if (function_exists('inviaRisposta')) {
        inviaRisposta(false, "Il servizio database è momentaneamente offline.", 500);
    } else {
        http_response_code(500);
        die(json_encode(["successo" => false, "messaggio" => "Errore fatale: Database offline."]));
    }
}


// ============================================================================
// SEZIONE 3: UTILITY E HELPER SQL (PREPARED STATEMENTS)
// ============================================================================

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
        return $stmt->get_result();

    } catch (Exception $e) {
        error_log("❌ [SQL EXECUTE ERROR] " . $e->getMessage() . " | Query: $query");
        return false;
    }
}
?>