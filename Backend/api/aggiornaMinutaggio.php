<?php
/**
 * ============================================================================
 * Backend/api/aggiornaMinutaggio.php
 * ============================================================================
 * 
 * SCOPO:
 * Tiene traccia del progresso di visione di un video per l'utente loggato.
 * Gestisce automaticamente lo stato "Continua a guardare" in base alla percentuale.
 * 
 * LOGICA DI COMPLETAMENTO:
 * Se l'utente ha guardato più del 90% della durata totale, il video viene 
 * rimosso dalla lista "Continua a guardare" (continua_a_guardare = 0).
 * 
 * INPUT (JSON/POST):
 * - id_video (int): ID del video in visione.
 * - progresso (int): Secondi trascorsi dall'inizio.
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

// Protezione area riservata
if (!isset($_SESSION['id_utente'])) {
    inviaRisposta(false, 'Utente non autenticato. Impossibile salvare il progresso.', 401);
}

$id_utente = $_SESSION['id_utente'];


// ============================================================================
// SEZIONE 3: GESTIONE INPUT E VALIDAZIONE
// ============================================================================

$input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
$id_video = (int) ($input['id_video'] ?? 0);
$progresso = (int) ($input['progresso'] ?? -1);

if ($id_video <= 0 || $progresso < 0) {
    inviaRisposta(false, 'Parametri della richiesta non validi.', 400);
}


// ============================================================================
// SEZIONE 4: LOGICA CORE (CALCOLO E PERSISTENZA)
// ============================================================================

try {
    // 1. RECUPERO DURATA TOTALE VIDEO
    $res = executePreparedQuery("SELECT Durata FROM Video WHERE id = ?", "i", [$id_video]);
    $video_info = $res->fetch_assoc();

    // Calcolo della durata in secondi (formato HH:MM:SS o MM:SS)
    $durata_totale = 0;
    if ($video_info && !empty($video_info['Durata'])) {
        $parti = array_reverse(explode(':', $video_info['Durata']));
        $moltiplicatore = 1;

        foreach ($parti as $parte) {
            $durata_totale += (int) $parte * $moltiplicatore;
            $moltiplicatore *= 60;
        }
    }

    // 2. LOGICA DI COMPLETAMENTO
    // Se siamo oltre il 90%, lo consideriamo concluso per pulizia UI
    $mostra_in_continua = 1;
    if ($durata_totale > 0) {
        $percentuale_visione = ($progresso / $durata_totale) * 100;
        if ($percentuale_visione >= 90) {
            $mostra_in_continua = 0;
        }
    }

    // 3. AGGIORNAMENTO CRONOLOGIA (UPSERT)
    $sql = "INSERT INTO Cronologia 
              (id_Utente, id_Video, progresso_secondi, continua_a_guardare, ultimo_aggiornamento) 
            VALUES (?, ?, ?, ?, NOW()) 
            ON DUPLICATE KEY UPDATE 
              progresso_secondi = VALUES(progresso_secondi), 
              continua_a_guardare = VALUES(continua_a_guardare),
              ultimo_aggiornamento = NOW()";

    if (executePreparedQuery($sql, "iiii", [$id_utente, $id_video, $progresso, $mostra_in_continua])) {

        // ========================================================================
        // SEZIONE 5: RISPOSTA AL CLIENT
        // ========================================================================
        inviaRisposta(true, 'Sincronizzazione completata', 200, [
            'completato' => ($mostra_in_continua === 0)
        ]);

    } else {
        throw new Exception("Errore durante l'esecuzione della query di aggiornamento cronologia.");
    }

} catch (Exception $e) {
    error_log("❌ [AGG_MINUTAGGIO ERROR] " . $e->getMessage());
    inviaRisposta(false, 'Errore tecnico nel salvataggio del progresso video.', 500);
}
?>