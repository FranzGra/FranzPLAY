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

        executePreparedQuery("UPDATE Utenti SET Admin = NOT Admin WHERE id = ?", "i", [$id]);
        inviaRisposta(true, 'Permessi utente aggiornati');
        break;

    case 'elimina_utente':
        $id = (int) $_POST['id_utente'];
        if ($id == $_SESSION['id_utente'])
            throw new Exception("Non puoi eliminare il tuo stesso account amministratore");

        executePreparedQuery("DELETE FROM Utenti WHERE id = ?", "i", [$id]);
        inviaRisposta(true, 'Utente eliminato definitivamente');
        break;

    case 'aggiungi_utente':
        $username = trim($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';
        $is_admin = isset($_POST['is_admin']) && $_POST['is_admin'] === 'true' ? 1 : 0;

        if (empty($username) || empty($password)) {
            throw new Exception("Username e Password sono obbligatori.");
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

        if (strlen($new_password) < 4) {
            inviaRisposta(false, 'La password deve avere almeno 4 caratteri.', 400);
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