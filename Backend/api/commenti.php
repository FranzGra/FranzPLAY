<?php
/**
 * ============================================================================
 * Backend/api/commenti.php
 * ============================================================================
 * 
 * SCOPO:
 * Gestisce il ciclo di vita dei commenti ai video (CRUD).
 * Permette agli utenti di leggere, pubblicare e rimuovere commenti.
 * 
 * AZIONI SUPPORTATE:
 * - leggi: Recupera i commenti di un video specifico con dati autore.
 * - scrivi: Pubblica un nuovo commento testuale.
 * - elimina: Rimuove un commento (permesso all'autore o all'admin).
 * 
 * SICUREZZA:
 * - Sanitizzazione input testuale.
 * - Verifica permessi di eliminazione lato server.
 * - Limitazione lunghezza commenti.
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

// Verifica sessione utente obbligatoria
if (!isset($_SESSION['id_utente'])) {
    inviaRisposta(false, 'Devi essere autenticato per interagire con i commenti.', 401);
}

$id_utente = $_SESSION['id_utente'];
$is_admin = $_SESSION['amministratore'] ?? false;


// ============================================================================
// SEZIONE 3: GESTIONE INPUT E PARAMETRI
// ============================================================================

$input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
$azione = $input['action'] ?? '';


// ============================================================================
// SEZIONE 4: LOGICA CORE (CRUD COMMENTI)
// ============================================================================

try {
    switch ($azione) {

        // --- 1. LETTURA COMMENTI ---
        case 'leggi':
            $id_video = (int) ($input['id_video'] ?? 0);

            // Recupera commenti, dati autore e flag proprietario
            $query = "SELECT c.id, c.testo_commento, c.data_ora_commento, 
                             u.Nome_Utente, u.Immagine_Profilo,
                             (c.id_Utente = ?) AS is_mio
                       FROM Commenti c
                       JOIN Utenti u ON c.id_Utente = u.id
                       WHERE c.id_Video = ?
                       ORDER BY c.data_ora_commento DESC";

            $res = executePreparedQuery($query, "ii", [$id_utente, $id_video]);
            $lista = $res->fetch_all(MYSQLI_ASSOC);

            // Normalizzazione dati per il frontend
            foreach ($lista as &$item) {
                $item['is_mio'] = (bool) $item['is_mio'];
            }

            inviaRisposta(true, 'Commenti caricati', 200, ['dati' => $lista]);
            break;

        // --- 2. PUBBLICAZIONE NUOVO COMMENTO ---
        case 'scrivi':
            $id_video = (int) ($input['id_video'] ?? 0);
            $testo = trim($input['testo'] ?? '');

            if ($id_video <= 0 || empty($testo)) {
                inviaRisposta(false, 'Il testo del commento non può essere vuoto.', 400);
            }

            // Validazione lunghezza per prevenire abusi (max 2000 car.)
            if (mb_strlen($testo) > 2000) {
                inviaRisposta(false, 'Il commento è troppo lungo. Massimo 2000 caratteri.', 400);
            }

            $sql = "INSERT INTO Commenti (id_Utente, id_Video, testo_commento) VALUES (?, ?, ?)";
            if (executePreparedQuery($sql, "iis", [$id_utente, $id_video, $testo])) {
                inviaRisposta(true, 'Commento pubblicato con successo!');
            } else {
                global $last_db_error;
                throw new Exception("Errore DB durante l'inserimento: " . ($last_db_error ?? 'Sconosciuto'));
            }
            break;

        // --- 3. ELIMINAZIONE COMMENTO ---
        case 'elimina':
            $id_commento = (int) ($input['id_commento'] ?? 0);

            // Logica di sicurezza: cancella solo se l'utente è l'autore o è un amministratore
            $sql = "DELETE FROM Commenti WHERE id = ? AND (id_Utente = ? OR ? = 1)";
            $admin_flag = $is_admin ? 1 : 0;

            $res = executePreparedQuery($sql, "iii", [$id_commento, $id_utente, $admin_flag]);
            global $last_affected_rows;

            if ($last_affected_rows > 0) {
                inviaRisposta(true, 'Commento rimosso.');
            } else {
                inviaRisposta(false, 'Non hai l\'autorizzazione per eliminare questo commento o il commento non esiste.', 403);
            }
            break;

        default:
            inviaRisposta(false, "Azione commenti non gestita: $azione", 400);
    }

} catch (Exception $e) {
    error_log("❌ [COMMENTI API ERROR] " . $e->getMessage());
    inviaRisposta(false, "Si è verificato un errore nella gestione dei commenti.", 500);
}
?>