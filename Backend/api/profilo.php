<?php
/**
 * ============================================================================
 * Backend/api/profilo.php
 * ============================================================================
 * 
 * SCOPO:
 * Gestisce tutte le operazioni legate al profilo dell'utente loggato.
 * Include la modifica dei dati personali, preferenze grafiche e sicurezza.
 * 
 * AZIONI SUPPORTATE:
 * - ottieni_info_utente: Recupera metadati utente (username, avatar, tema).
 * - cambia_tema: Aggiorna il colore esadecimale del tema UI.
 * - cambia_immagine_profilo: Gestisce l'upload e la sostituzione dell'avatar.
 * - cambia_username: Modifica il nome utente con validazione unicità.
 * - cambia_password: Aggiorna la credenziale di accesso con verifica attuale.
 * - elimina_profilo_utente: Rimuove definitivamente l'account e i dati associati.
 * 
 * SICUREZZA:
 * Richiede autenticazione obbligatoria tramite sessione PHP.
 * Protegge contro upload di file malevoli tramite validazione MIME reale.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once 'gestione_richiesta.php';
require_once 'database.php';


// ============================================================================
// SEZIONE 2: AUTENTICAZIONE E SICUREZZA
// ============================================================================

// Blocca l'accesso se l'utente non è autenticato
if (!isset($_SESSION['id_utente'])) {
    inviaRisposta(false, 'Sessione scaduta o non valida. Effettua nuovamente il login.', 401);
}

$id_utente = $_SESSION['id_utente'];


// ============================================================================
// SEZIONE 3: GESTIONE INPUT E PARAMETRI
// ============================================================================

$azione = $_POST['action'] ?? '';


// ============================================================================
// SEZIONE 4: LOGICA CORE (GESTIONE PROFILO)
// ============================================================================

try {
    switch ($azione) {

        // --- RECUPERA DATI UTENTE ---
        case 'ottieni_info_utente':
            $res = executePreparedQuery(
                "SELECT Nome_Utente, Immagine_Profilo, Admin, colore_Tema, preferenze_home FROM Utenti WHERE id = ?",
                "i",
                [$id_utente]
            );
            $row = $res->fetch_assoc();

            if ($row) {
                // Sincronizza i dati in sessione per coerenza
                $_SESSION['nome_utente'] = $row['Nome_Utente'];
                $_SESSION['immagine_profilo'] = $row['Immagine_Profilo'];

                inviaRisposta(true, 'Profilo caricato', 200, [
                    'user' => [
                        'username' => $row['Nome_Utente'],
                        'avatar' => $row['Immagine_Profilo'],
                        'isAdmin' => (bool) $row['Admin'],
                        'themeColor' => $row['colore_Tema'] ?? '#ff6923',
                        'homePreferences' => json_decode($row['preferenze_home'] ?? '{}', true)
                    ]
                ]);
            } else {
                session_destroy();
                inviaRisposta(false, 'Account utente non trovato nel sistema.', 404);
            }
            break;

        // --- SALVA PREFERENZE HOME ---
        case 'salva_preferenze_home':
            $prefs = $_POST['preferenze'] ?? '{}';
            
            // Validazione basilare JSON
            json_decode($prefs);
            if (json_last_error() !== JSON_ERROR_NONE) {
                inviaRisposta(false, 'Formato JSON non valido.', 400);
            }

            if (executePreparedQuery("UPDATE Utenti SET preferenze_home = ? WHERE id = ?", "si", [$prefs, $id_utente])) {
                inviaRisposta(true, 'Preferenze salvate.', 200);
            } else {
                throw new Exception("Errore aggiornamento preferenze.");
            }
            break;

        // --- CAMBIA TEMA UI ---
        case 'cambia_tema':
            $nuovo_colore = trim($_POST['colore_tema'] ?? '');

            // Validazione colore Hex (#RRGGBB)
            if (!preg_match('/^#[a-f0-9]{6}$/i', $nuovo_colore)) {
                inviaRisposta(false, 'Formato colore non valido (richiesto esadecimale es: #FF0000).', 400);
            }

            if (executePreparedQuery("UPDATE Utenti SET colore_Tema = ? WHERE id = ?", "si", [$nuovo_colore, $id_utente])) {
                $_SESSION['colore_theme'] = $nuovo_colore;
                inviaRisposta(true, 'Preferenza tema salvata!', 200, ['themeColor' => $nuovo_colore]);
            } else {
                throw new Exception("Errore durante l'aggiornamento del tema nel database.");
            }
            break;

        // --- CAMBIA AVATAR (UPLOAD) ---
        case 'cambia_immagine_profilo':
            if (!isset($_FILES['immagine_profilo']) || $_FILES['immagine_profilo']['error'] !== UPLOAD_ERR_OK) {
                inviaRisposta(false, 'Errore nel caricamento del file immagine.', 400);
            }

            $file = $_FILES['immagine_profilo'];

            // Validazione MIME reale per sicurezza
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime = finfo_file($finfo, $file['tmp_name']);
            finfo_close($finfo);

            $allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
            if (!in_array($mime, $allowed)) {
                inviaRisposta(false, 'Tipo file non supportato (carica JPG, PNG o WEBP).', 400);
            }

            $ext_map = ['image/jpeg' => 'jpg', 'image/jpg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
            $ext = $ext_map[$mime];

            $upload_dir = '/var/www/sessioni/immagini_utenti/';
            if (!file_exists($upload_dir))
                mkdir($upload_dir, 0777, true);

            // Rimuove la precedente immagine se esistente
            if (!empty($_SESSION['immagine_profilo'])) {
                $old_path = $upload_dir . $_SESSION['immagine_profilo'];
                if (file_exists($old_path))
                    @unlink($old_path);
            }

            // Genera nuovo nome file unico
            $new_filename = "user_{$id_utente}_" . time() . ".{$ext}";

            if (move_uploaded_file($file['tmp_name'], $upload_dir . $new_filename)) {
                executePreparedQuery("UPDATE Utenti SET Immagine_Profilo = ? WHERE id = ?", "si", [$new_filename, $id_utente]);
                $_SESSION['immagine_profilo'] = $new_filename;
                inviaRisposta(true, 'Immagine profilo aggiornata con successo', 200, ['url' => $new_filename]);
            } else {
                throw new Exception("Errore fisico nel salvataggio dell'immagine sul server.");
            }
            break;

        // --- CAMBIA USERNAME ---
        case 'cambia_username':
            $nuovo_nome = trim($_POST['nuovo_nome_utente'] ?? '');

            if (strlen($nuovo_nome) < 3) {
                inviaRisposta(false, 'Il nome utente deve contenere almeno 3 caratteri.', 400);
            }
            if (!preg_match('/^[a-zA-Z0-9_]+$/', $nuovo_nome)) {
                inviaRisposta(false, 'Caratteri non validi: usa solo lettere, numeri e underscore.', 400);
            }

            if (executePreparedQuery("UPDATE Utenti SET Nome_Utente = ? WHERE id = ?", "si", [$nuovo_nome, $id_utente])) {
                $_SESSION['nome_utente'] = $nuovo_nome;
                inviaRisposta(true, 'Profilo rinominato correttamente.', 200);
            } else {
                inviaRisposta(false, 'Questo nome utente è già occupato da un altro account.', 409);
            }
            break;

        // --- CAMBIA PASSWORD ---
        case 'cambia_password':
            $old = $_POST['password_attuale'] ?? '';
            $new = $_POST['nuova_password'] ?? '';
            $conf = $_POST['conferma_password'] ?? '';

            if ($new !== $conf) {
                inviaRisposta(false, 'La nuova password e la conferma non corrispondono.', 400);
            }
            if (strlen($new) < 4) {
                inviaRisposta(false, 'La password è troppo fragile (minimo 4 caratteri).', 400);
            }

            // Verifica che la password attuale sia corretta
            $res = executePreparedQuery("SELECT Password FROM Utenti WHERE id = ?", "i", [$id_utente]);
            $row = $res->fetch_assoc();

            if (!$row || !password_verify($old, $row['Password'])) {
                inviaRisposta(false, 'La password attuale inserita non è corretta.', 401);
            }

            // Applica il nuovo hash
            $hash = password_hash($new, PASSWORD_DEFAULT);
            executePreparedQuery("UPDATE Utenti SET Password = ? WHERE id = ?", "si", [$hash, $id_utente]);

            inviaRisposta(true, 'Password di accesso aggiornata con successo.', 200);
            break;

        // --- ELIMINA ACCOUNT ---
        case 'elimina_profilo_utente':
            // Rimuove fisicamente l'avatar se presente
            if (!empty($_SESSION['immagine_profilo'])) {
                $img_path = '/var/www/sessioni/immagini_utenti/' . $_SESSION['immagine_profilo'];
                if (file_exists($img_path))
                    @unlink($img_path);
            }

            executePreparedQuery("DELETE FROM Utenti WHERE id = ?", "i", [$id_utente]);

            session_destroy();
            inviaRisposta(true, 'Account eliminato definitivamente dal sistema.', 200);
            break;

        default:
            inviaRisposta(false, "Azione profilo non riconosciuta: $azione", 400);
    }

} catch (Exception $e) {
    error_log("❌ [PROFILO API ERROR] " . $e->getMessage());
    inviaRisposta(false, "Errore interno durante la gestione del profilo.", 500);
}

// Chiusura implicita
?>