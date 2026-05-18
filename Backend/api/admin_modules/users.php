<?php
if (!defined('ADMIN_API'))
    exit('Nessun accesso diretto consentito.');

switch ($action) {
    case 'lista_utenti':
        $res = $database->query("SELECT id, Nome_Utente, ultimo_Accesso, Admin, Immagine_Profilo FROM Utenti ORDER BY id ASC");
        inviaRisposta(true, 'Lista utenti caricata', 200, ['dati' => $res->fetch_all(MYSQLI_ASSOC)]);
        break;

    case 'toggle_admin':
        $id = (int) $_POST['id_utente'];
        if ($id == $_SESSION['id_utente'])
            throw new Exception("Non puoi modificare i tuoi permessi admin");

        // Anti-lockout: se il target è admin e sarebbe l'ultimo admin rimasto, blocca.
        $res_t = executePreparedQuery("SELECT Admin FROM Utenti WHERE id = ?", "i", [$id]);
        $target = $res_t ? $res_t->fetch_assoc() : null;
        if ($target && (int)$target['Admin'] === 1) {
            $res_cnt = $database->query("SELECT COUNT(*) AS cnt FROM Utenti WHERE Admin = 1");
            $row_cnt = $res_cnt ? $res_cnt->fetch_assoc() : ['cnt' => 0];
            if ((int)$row_cnt['cnt'] <= 1) {
                throw new Exception("Operazione bloccata: deve restare almeno un amministratore nel sistema.");
            }
        }

        executePreparedQuery("UPDATE Utenti SET Admin = NOT Admin WHERE id = ?", "i", [$id]);
        error_log("[ADMIN AUDIT] toggle_admin user=$id by={$_SESSION['id_utente']}");
        inviaRisposta(true, 'Permessi utente aggiornati');
        break;

    case 'elimina_utente':
        $id = (int) $_POST['id_utente'];
        if ($id == $_SESSION['id_utente'])
            throw new Exception("Non puoi eliminare il tuo stesso account amministratore");

        // Anti-lockout: se l'utente da eliminare è admin e sarebbe l'ultimo admin, blocca.
        $res_t = executePreparedQuery("SELECT Admin FROM Utenti WHERE id = ?", "i", [$id]);
        $target = $res_t ? $res_t->fetch_assoc() : null;
        if ($target && (int)$target['Admin'] === 1) {
            $res_cnt = $database->query("SELECT COUNT(*) AS cnt FROM Utenti WHERE Admin = 1");
            $row_cnt = $res_cnt ? $res_cnt->fetch_assoc() : ['cnt' => 0];
            if ((int)$row_cnt['cnt'] <= 1) {
                throw new Exception("Impossibile eliminare l'ultimo amministratore rimasto.");
            }
        }

        executePreparedQuery("DELETE FROM Utenti WHERE id = ?", "i", [$id]);
        error_log("[ADMIN AUDIT] elimina_utente user=$id by={$_SESSION['id_utente']}");
        inviaRisposta(true, 'Utente eliminato definitivamente');
        break;

    case 'aggiungi_utente':
        $username = trim($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';
        $is_admin = isset($_POST['is_admin']) && $_POST['is_admin'] === 'true' ? 1 : 0;

        if (empty($username) || empty($password)) {
            throw new Exception("Username e Password sono obbligatori.");
        }
        if (strlen($password) < 8) {
            throw new Exception("La password deve avere almeno 8 caratteri.");
        }
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $username)) {
            throw new Exception("Lo username può contenere solo lettere, numeri e underscore.");
        }

        // Verifica se l'utente esiste già
        $stmt = $database->prepare("SELECT id FROM Utenti WHERE Nome_Utente = ?");
        $stmt->bind_param("s", $username);
        $stmt->execute();
        if ($stmt->fetch()) {
            $stmt->close();
            throw new Exception("Username già esistente.");
        }
        $stmt->close();

        // Hash della password
        $hashed_password = password_hash($password, PASSWORD_DEFAULT);

        // Inserimento utente
        $stmt = $database->prepare("INSERT INTO Utenti (Nome_Utente, Password, Admin, ultimo_Accesso, colore_Tema) VALUES (?, ?, ?, NULL, NULL)");
        $stmt->bind_param("ssi", $username, $hashed_password, $is_admin);
        $stmt->execute();
        $stmt->close();

        inviaRisposta(true, 'Utente creato con successo');
        break;

    case 'reset_password_utente':
        $target_id = $_POST['id_utente'] ?? null;
        $new_password = $_POST['nuova_password'] ?? '';

        if (!$target_id || empty($new_password)) {
            inviaRisposta(false, "ID utente e Nuova Password sono obbligatori.", 400);
        }

        if (strlen($new_password) < 8) {
            inviaRisposta(false, 'La password deve avere almeno 8 caratteri.', 400);
        }

        // Eseguiamo l'hash
        $hashed_password = password_hash($new_password, PASSWORD_DEFAULT);

        if (executePreparedQuery("UPDATE Utenti SET Password = ? WHERE id = ?", "si", [$hashed_password, $target_id])) {
            inviaRisposta(true, "Password dell'utente reimpostata con successo.", 200);
        } else {
            throw new Exception("Errore durante l'aggiornamento della password.");
        }
        break;

    case 'lista_accessi':
        $res = $database->query("SELECT id, indirizzo_Ip, data_ora_tentativo, successo, Nome_Utente FROM Accessi ORDER BY data_ora_tentativo DESC LIMIT 500");
        inviaRisposta(true, 'Lista accessi caricata', 200, ['dati' => $res->fetch_all(MYSQLI_ASSOC)]);
        break;
}
?>