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

    // Calcolo durata in secondi: accetta solo formati HH:MM:SS, H:MM, MM:SS.
    $durata_totale = 0;
    if ($video_info && !empty($video_info['Durata'])) {
        $durata_str = trim($video_info['Durata']);
        if (preg_match('/^\d{1,3}(:\d{1,2}){1,2}$/', $durata_str)) {
            $parti = array_reverse(explode(':', $durata_str));
            $moltiplicatore = 1;
            foreach ($parti as $parte) {
                $durata_totale += (int) $parte * $moltiplicatore;
                $moltiplicatore *= 60;
            }
        }
    }

    // 2. Logica di completamento (calcolo lato PHP solo come hint;
    // l'autorità è la formula MySQL che evita race condition).
    // Se non conosciamo la durata, lasciamo il record in continua-a-guardare.

    // 3. UPSERT ATOMICO E IDEMPOTENTE
    // - progresso: prendiamo il MAX tra il valore corrente e quello in arrivo
    //   per evitare regressioni causate da richieste fuori ordine.
    // - continua_a_guardare: 0 se progresso >= 90% della durata, 1 altrimenti.
    //   Tutto calcolato lato MySQL in un singolo statement.
    $sql = "INSERT INTO Cronologia
              (id_Utente, id_Video, progresso_secondi, continua_a_guardare, ultimo_aggiornamento)
            VALUES (?, ?, ?,
                CASE WHEN ? > 0 AND (? / ?) >= 0.9 THEN 0 ELSE 1 END,
                NOW())
            ON DUPLICATE KEY UPDATE
              progresso_secondi = GREATEST(progresso_secondi, VALUES(progresso_secondi)),
              continua_a_guardare = CASE
                  WHEN ? > 0 AND (GREATEST(progresso_secondi, VALUES(progresso_secondi)) / ?) >= 0.9
                  THEN 0 ELSE 1 END,
              ultimo_aggiornamento = NOW()";

    // Bind: id_utente, id_video, progresso (per INSERT),
    //       durata, progresso, durata (per CASE INSERT),
    //       durata, durata (per CASE UPDATE)
    $ok = executePreparedQuery(
        $sql,
        "iiiiiiii",
        [
            $id_utente, $id_video, $progresso,
            $durata_totale, $progresso, max(1, $durata_totale),
            $durata_totale, max(1, $durata_totale)
        ]
    );

    if ($ok !== false) {
        $completato = ($durata_totale > 0 && ($progresso / $durata_totale) >= 0.9);
        inviaRisposta(true, 'Sincronizzazione completata', 200, [
            'completato' => $completato
        ]);
    } else {
        throw new Exception("Errore durante l'esecuzione della query di aggiornamento cronologia.");
    }

} catch (Exception $e) {
    error_log("❌ [AGG_MINUTAGGIO ERROR] " . $e->getMessage());
    inviaRisposta(false, 'Errore tecnico nel salvataggio del progresso video.', 500);
}
?>