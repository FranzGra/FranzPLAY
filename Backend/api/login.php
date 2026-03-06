<?php
/**
 * ============================================================================
 * Backend/api/login.php
 * ============================================================================
 * 
 * SCOPO:
 * Gestisce l'autenticazione degli utenti nel sistema.
 * Include meccanismi di sicurezza anti-spam (Rate Limiting) per prevenire
 * attacchi brute-force basati su username.
 * 
 * LOGICA DI SICUREZZA:
 * - Recupero IP compatibile con Reverse Proxy (X-Forwarded-For).
 * - Ban temporaneo di 30 secondi dopo 3 tentativi falliti in 30 secondi.
 * - Logging costante di ogni tentativo (successi e fallimenti).
 * 
 * INPUT (JSON):
 * - username (string): Nome utente per l'accesso.
 * - password (string): Password in chiaro (verificata via hash).
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once 'gestione_richiesta.php';
require_once 'database.php';


// ============================================================================
// SEZIONE 2: SICUREZZA AMBIENTE (RECUPERO IP)
// ============================================================================

/**
 * Identifica l'indirizzo IP reale del client, gestendo eventuali
 * strati di proxy o bilanciatori di carico.
 */
$ip_address = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (strpos($ip_address, ',') !== false) {
    $ip_address = trim(explode(',', $ip_address)[0]);
}


// ============================================================================
// SEZIONE 3: GESTIONE INPUT
// ============================================================================

// Decodifica del body JSON inviato dal frontend
$input = json_decode(file_get_contents('php://input'), true);
$nome_utente = isset($input['username']) ? trim($input['username']) : '';
$password = $input['password'] ?? '';

if (empty($nome_utente) || empty($password)) {
    inviaRisposta(false, 'Inserisci username e password per continuare', 400);
}


// ============================================================================
// SEZIONE 4: LOGICA CORE (AUTENTICAZIONE E ANTI-SPAM)
// ============================================================================

try {
    // 1. CONTROLLO BAN ATTIVO (Solo se la tabella esiste)
    if (checkTableExists('Spammers')) {
        $stmt = $database->prepare(
            "SELECT bloccato_fino_a FROM Spammers WHERE Nome_Utente = ? AND bloccato_fino_a > NOW()"
        );
        $stmt->bind_param('s', $nome_utente);
        $stmt->execute();
        $stmt->bind_result($fine_blocco);

        if ($stmt->fetch()) {
            $stmt->close();
            $secondi_rimanenti = strtotime($fine_blocco) - time();
            error_log("⚠️ [LOGIN SECURITY] Tentativo su account bloccato: $nome_utente (IP: $ip_address)");
            inviaRisposta(false, "Account temporaneamente bloccato per troppi tentativi. Riprova tra $secondi_rimanenti secondi.", 429);
        }
        $stmt->close();
    }

    // 2. RECUPERO DATI UTENTE
    if (!checkTableExists('Utenti')) {
        throw new Exception("Tabella Utenti non trovata. Inizializzazione necessaria.");
    }

    $stmt = $database->prepare(
        "SELECT id, Nome_Utente, Password, Admin, Immagine_Profilo, colore_Tema FROM Utenti WHERE Nome_Utente = ?"
    );
    $stmt->bind_param('s', $nome_utente);
    $stmt->execute();
    $result = $stmt->get_result();
    $utente = $result->fetch_assoc();
    $stmt->close();

    // 3. VERIFICA PASSWORD
    $login_successo = ($utente && password_verify($password, $utente['Password']));

    // 4. REGISTRAZIONE ACCESSO (Solo se la tabella esiste)
    if (checkTableExists('Accessi')) {
        $stmt = $database->prepare(
            "INSERT INTO Accessi (indirizzo_Ip, successo, Nome_Utente, data_ora_tentativo) VALUES (?, ?, ?, NOW())"
        );
        $successo_int = $login_successo ? 1 : 0;
        $stmt->bind_param('sis', $ip_address, $successo_int, $nome_utente);
        $stmt->execute();
        $stmt->close();

        // 5. GESTIONE FALLIMENTO E RATE LIMITING
        if (!$login_successo) {
            // Conta i fallimenti recenti per questo username
            $stmt = $database->prepare(
                "SELECT COUNT(*) FROM Accessi WHERE Nome_Utente = ? AND successo = 0 AND data_ora_tentativo > DATE_SUB(NOW(), INTERVAL 30 SECOND)"
            );
            $stmt->bind_param('s', $nome_utente);
            $stmt->execute();
            $stmt->bind_result($tentativi_falliti);
            $stmt->fetch();
            $stmt->close();

            // Se supera i 3 tentativi e la tabella Spammers esiste, applica il ban
            if ($tentativi_falliti >= 3 && checkTableExists('Spammers')) {
                $stmt = $database->prepare(
                    "INSERT INTO Spammers (Nome_Utente, indirizzo_Ip, bloccato_fino_a) 
                     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 SECOND)) 
                     ON DUPLICATE KEY UPDATE indirizzo_Ip = VALUES(indirizzo_Ip), bloccato_fino_a = DATE_ADD(NOW(), INTERVAL 30 SECOND)"
                );
                $stmt->bind_param('ss', $nome_utente, $ip_address);
                $stmt->execute();
                $stmt->close();

                error_log("🚨 [SECURITY BAN] Username bloccato: $nome_utente (IP: $ip_address)");
                inviaRisposta(false, 'Troppi tentativi falliti. Accesso bloccato per 30 secondi.', 429);
            }
        }
    }

    if (!$login_successo) {
        inviaRisposta(false, 'Credenziali di accesso non valide', 401);
    }

    // Recupero il tema di default globale dal DB
    $res_default = $database->query("SELECT Valore_Impostazione FROM Impostazioni WHERE Chiave_Impostazione = 'colore_tema_default'");
    $row_default = $res_default->fetch_assoc();
    $app_default_theme = $row_default ? $row_default['Valore_Impostazione'] : '#dc2626';

    // 6. LOGIN RIUSCITO: INIZIALIZZAZIONE SESSIONE
    $_SESSION['id_utente'] = $utente['id'];
    $_SESSION['nome_utente'] = $utente['Nome_Utente'];
    $_SESSION['amministratore'] = (bool) $utente['Admin'];
    $_SESSION['immagine_profilo'] = $utente['Immagine_Profilo'];
    $_SESSION['colore_theme'] = $utente['colore_Tema'] ?? $app_default_theme;

    // Aggiorna timestamp ultimo accesso
    $stmt = $database->prepare("UPDATE Utenti SET ultimo_Accesso = NOW() WHERE id = ?");
    $stmt->bind_param('i', $utente['id']);
    $stmt->execute();
    $stmt->close();

    error_log("✅ [LOGIN SUCCESS] {$utente['Nome_Utente']} (ID: {$utente['id']}) IP: $ip_address");


    // ============================================================================
    // SEZIONE 5: RISPOSTA AL CLIENT
    // ============================================================================
    inviaRisposta(true, "Benvenuto, {$utente['Nome_Utente']}", 200, [
        'user' => [
            'username' => $utente['Nome_Utente'],
            'avatar' => $utente['Immagine_Profilo'],
            'isAdmin' => (bool) $utente['Admin'],
            'themeColor' => $utente['colore_Tema'], // Return NULL if unset
            'appDefaultThemeColor' => $app_default_theme
        ]
    ]);

} catch (Exception $e) {
    error_log("❌ [LOGIN CRITICAL ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore durante il processo di login.", 500);
}
?>