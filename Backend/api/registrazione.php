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


// ============================================================================
// SEZIONE 2: VALIDAZIONE E SICUREZZA INPUT
// ============================================================================

// Normalizzazione input da JSON o POST standard
$input = json_decode(file_get_contents('php://input'), true) ?? $_POST;

$username = trim($input['username'] ?? '');
$password = $input['password'] ?? '';
$email = trim($input['email'] ?? '');

// Verifiche obbligatorietà
if (empty($username) || empty($password)) {
    inviaRisposta(false, 'Username e Password sono campi obbligatori.', 400);
}

// Verifiche lunghezza
if (strlen($username) < 3 || strlen($password) < 4) {
    inviaRisposta(false, 'Dati troppo brevi: Username (min 3) o Password (min 4).', 400);
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

// Se l'email è vuota, usiamo NULL per evitare conflitti con vincoli UNIQUE nel DB
$emailParam = empty($email) ? null : $email;


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
    $sql = "INSERT INTO Utenti (Nome_Utente, Password, Email) VALUES (?, ?, ?)";
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