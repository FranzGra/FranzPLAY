<?php
/**
 * ============================================================================
 * Backend/api/registrazione.php
 * ============================================================================
 * 
 * SCOPO:
 * Gestisce l'iscrizione di nuovi utenti alla piattaforma.
 * Implementa validazioni sintattiche e logiche per garantire l'integrità dei dati.
 * 
 * LOGICA:
 * - Hashing della password tramite PASSWORD_DEFAULT (bcrypt).
 * - Validazione unicità di Username ed Email.
 * - Restrizione sui caratteri dell'username per prevenire exploitation.
 * 
 * INPUT (JSON/POST):
 * - username (string): Min 3 caratteri, alfanumerico.
 * - password (string): Min 4 caratteri.
 * - email (string): Facoltativa, validata se presente.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once 'gestione_richiesta.php';
require_once 'database.php';
require_once 'rate_limit.php';

// Anti-spam registrazioni di massa: max 5 ogni 5 minuti per IP.
$ip_addr_reg = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (strpos($ip_addr_reg, ',') !== false) {
    $ip_addr_reg = trim(explode(',', $ip_addr_reg)[0]);
}
checkRateLimit('registrazione', $ip_addr_reg, 5, 300);

// Blocco registrazione se l'admin l'ha disabilitata (Impostazioni.registrazione_abilitata).
// Controllo server-side: il nascondere il bottone nel frontend NON basta, l'API
// deve rifiutare comunque le richieste dirette. Default permissivo se la chiave
// manca (DB pre-migrazione), coerente con l'INSERT IGNORE '1' in 02_migrations.sql.
$reg_enabled = '1';
$stmt_reg = $database->prepare("SELECT Valore_Impostazione FROM Impostazioni WHERE Chiave_Impostazione = 'registrazione_abilitata' LIMIT 1");
if ($stmt_reg && $stmt_reg->execute()) {
    $stmt_reg->bind_result($reg_val);
    if ($stmt_reg->fetch() && $reg_val !== null) {
        $reg_enabled = $reg_val;
    }
    $stmt_reg->close();
}
if ($reg_enabled === '0') {
    inviaRisposta(false, 'La registrazione di nuovi account è disabilitata.', 403);
}


// ============================================================================
// SEZIONE 2: VALIDAZIONE E SICUREZZA INPUT
// ============================================================================

// Normalizzazione input da JSON o POST standard.
// Se il body è JSON malformato, json_decode ritorna null. Diamo un errore esplicito
// invece di silenziosamente cadere su $_POST vuoto.
$raw_body = file_get_contents('php://input');
$json = null;
if ($raw_body !== '' && $raw_body !== false) {
    $json = json_decode($raw_body, true);
    if ($json === null && json_last_error() !== JSON_ERROR_NONE) {
        inviaRisposta(false, 'Corpo della richiesta JSON non valido.', 400);
    }
}
$input = $json ?? $_POST;

$username = trim($input['username'] ?? '');
$password = $input['password'] ?? '';
$email = trim($input['email'] ?? '');

// Verifiche obbligatorietà
if (empty($username) || empty($password)) {
    inviaRisposta(false, 'Username e Password sono campi obbligatori.', 400);
}

// Verifiche lunghezza
if (strlen($username) < 3 || strlen($password) < 8) {
    inviaRisposta(false, 'Dati troppo brevi: Username (min 3) o Password (min 8).', 400);
}

// Verifica caratteri username (solo lettere, numeri e underscore)
if (!preg_match('/^[a-zA-Z0-9_]+$/', $username)) {
    inviaRisposta(false, 'Username contenente caratteri non validi (usa solo lettere e numeri).', 400);
}

// Verifica sintassi email (se fornita)
if (!empty($email) && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    inviaRisposta(false, 'Il formato dell\'indirizzo email inserito non è valido.', 400);
}


// ============================================================================
// SEZIONE 3: GESTIONE INPUT (Normalizzazione DB)
// ============================================================================

// Email normalizzata lowercase per evitare account duplicati "User@x" vs "user@x".
// Se vuota usiamo NULL per coesistere con il vincolo UNIQUE in MySQL.
$emailParam = empty($email) ? null : strtolower($email);


// ============================================================================
// SEZIONE 4: LOGICA CORE (CONTROLLI DB E INSERIMENTO)
// ============================================================================

try {
    // 1. VERIFICA DISPONIBILITÀ (Username o Email già occupati)
    $stmt = $database->prepare("SELECT id FROM Utenti WHERE Nome_Utente = ? OR (Email IS NOT NULL AND Email = ?)");
    $stmt->bind_param("ss", $username, $emailParam);
    $stmt->execute();
    if ($stmt->fetch()) {
        inviaRisposta(false, 'Spiacenti, username o indirizzo email già associati a un altro account.', 409);
    }
    $stmt->close();

    // 2. PREPARAZIONE DATI E HASHING
    $password_hash = password_hash($password, PASSWORD_DEFAULT);

    // 3. INSERIMENTO NUOVO UTENTE
    $sql = "INSERT INTO Utenti (Nome_Utente, Password, Email, colore_Tema) VALUES (?, ?, ?, NULL)";
    $stmt = $database->prepare($sql);
    $stmt->bind_param("sss", $username, $password_hash, $emailParam);

    if ($stmt->execute()) {
        // ====================================================================
        // SEZIONE 5: RISPOSTA AL CLIENT
        // ====================================================================
        inviaRisposta(true, 'Profilo creato con successo! Ora puoi effettuare l\'accesso.', 201);
    } else {
        throw new Exception("Errore interno durante l'inserimento dell'utente.");
    }

} catch (Exception $e) {
    error_log("❌ [REGISTRAZIONE API ERROR] " . $e->getMessage());
    inviaRisposta(false, "Si è verificato un errore durante la creazione dell'account. Riprova più tardi.", 500);
}
?>