<?php
if (!defined('ADMIN_API'))
    exit('Nessun accesso diretto consentito.');

switch ($action) {
    case 'salva_impostazioni_globali':
        $tema = $_POST['tema_default'] ?? null;
        if ($tema) {
            // Valida colore esadecimale (semplice)
            if (preg_match('/^#[a-f0-9]{6}$/i', $tema)) {
                $descrizione = 'Colore primario di default per schermata Login e utenti senza personalizzazione';
                executePreparedQuery(
                    "INSERT INTO Impostazioni (Chiave_Impostazione, Valore_Impostazione, Descrizione) VALUES ('colore_tema_default', ?, ?) ON DUPLICATE KEY UPDATE Valore_Impostazione = ?",
                    "sss",
                    [$tema, $descrizione, $tema]
                );

                // Pulisci Cache per ricaricare le info la prossima volta
                global $Cache;
                if (isset($Cache) && is_object($Cache)) {
                    $Cache->delete('impostazioni_globali');
                }
                inviaRisposta(true, 'Impostazioni salvate con successo');
            } else {
                inviaRisposta(false, 'Colore Hex non valido', 400);
            }
        } else {
            inviaRisposta(false, 'Nessun dato da salvare', 400);
        }
        break;

    case 'salva_registrazione':
        // Abilita/disabilita la registrazione guest. Accetta valori truthy/falsy.
        $raw = $_POST['abilitata'] ?? null;
        if ($raw === null) {
            inviaRisposta(false, 'Parametro mancante', 400);
        }
        $val = in_array((string) $raw, ['1', 'true', 'on', 'yes'], true) ? '1' : '0';

        executePreparedQuery(
            "INSERT INTO Impostazioni (Chiave_Impostazione, Valore_Impostazione, Descrizione)
             VALUES ('registrazione_abilitata', ?, 'Se 1 i guest possono registrarsi; se 0 la registrazione e disabilitata')
             ON DUPLICATE KEY UPDATE Valore_Impostazione = ?",
            "ss",
            [$val, $val]
        );

        // Invalida la cache delle impostazioni pubbliche (lette da impostazioni.php).
        global $Cache;
        if (isset($Cache) && is_object($Cache)) {
            $Cache->delete('impostazioni_globali');
        }
        inviaRisposta(true, $val === '1' ? 'Registrazione abilitata' : 'Registrazione disabilitata', 200, ['abilitata' => $val]);
        break;

    case 'stato_server':
        global $BASE_VIDEO_PATH;
        $path = $BASE_VIDEO_PATH;

        // FIX: Se il percorso configured non esiste (es. dev in Windows), usiamo la cartella corrente
        // per evitare Fatal Error su disk_total_space
        if (!file_exists($path)) {
            $path = __DIR__;
        }

        // Suppress error in case of permission issues even if exists
        $total = @disk_total_space($path) ?: 0;
        $free = @disk_free_space($path) ?: 0;
        $used = $total - $free;

        global $database;

        // Helper locale: ritorna il singolo valore scalare di una COUNT/aggregazione, 0 se fallisce
        $scalar = function ($query) {
            $res = executePreparedQuery($query);
            if ($res && ($row = $res->fetch_row())) {
                return (int) $row[0];
            }
            return 0;
        };

        $stats = [
            'disco_totale_gb' => $total > 0 ? round($total / 1073741824, 2) : 0,
            'disco_usato_gb' => $total > 0 ? round($used / 1073741824, 2) : 0,
            'disco_libero_gb' => $total > 0 ? round($free / 1073741824, 2) : 0,
            'disco_percentuale' => $total > 0 ? round(($used / $total) * 100, 1) : 0,
            'php_upload_max' => ini_get('upload_max_filesize'),
            'php_post_max' => ini_get('post_max_size'),
            'db_version' => $database->server_info,

            // --- Statistiche libreria (Drop & Watch pipeline) ---
            'video_totali' => $scalar("SELECT COUNT(*) FROM Video"),
            'video_ottimizzati' => $scalar("SELECT COUNT(*) FROM Video WHERE ottimizzato = 1"),
            'video_da_analizzare' => $scalar("SELECT COUNT(*) FROM Video WHERE ottimizzato IS NULL"),
            'video_in_ingestione' => $scalar("SELECT COUNT(*) FROM Video_Temp"),
            'asset_mancanti' => $scalar("SELECT COUNT(*) FROM Video WHERE percorso_copertina IS NULL OR percorso_anteprima IS NULL"),
            'categorie_totali' => $scalar("SELECT COUNT(*) FROM Categorie"),
            'utenti_totali' => $scalar("SELECT COUNT(*) FROM Utenti"),
            'utenti_admin' => $scalar("SELECT COUNT(*) FROM Utenti WHERE Admin = 1"),
            'commenti_totali' => $scalar("SELECT COUNT(*) FROM Commenti"),
            'sottotitoli_totali' => $scalar("SELECT COUNT(*) FROM Sottotitoli WHERE stato = 'completato'"),
            'sottotitoli_in_coda' => $scalar("SELECT COUNT(*) FROM Sottotitoli WHERE stato IN ('in_coda','elaborazione')"),
        ];

        inviaRisposta(true, 'Statistiche server aggiornate', 200, ['dati' => $stats]);
        break;

    case 'salva_logo':
        require_once 'cache.php';
        global $Cache;

        $primo = trim($_POST['logo_part_1'] ?? '');
        $secondo = trim($_POST['logo_part_2'] ?? '');

        if (empty($primo) || empty($secondo)) {
            throw new Exception("Entrambe le parti del logo sono obbligatorie");
        }

        executePreparedQuery("INSERT INTO Impostazioni (Chiave_Impostazione, Valore_Impostazione) VALUES ('logo_part_1', ?) ON DUPLICATE KEY UPDATE Valore_Impostazione = ?", "ss", [$primo, $primo]);
        executePreparedQuery("INSERT INTO Impostazioni (Chiave_Impostazione, Valore_Impostazione) VALUES ('logo_part_2', ?) ON DUPLICATE KEY UPDATE Valore_Impostazione = ?", "ss", [$secondo, $secondo]);

        if (isset($Cache) && is_object($Cache)) {
            $Cache->delete('impostazioni_globali');
        }

        inviaRisposta(true, 'Logo aggiornato con successo');
        break;
}
?>