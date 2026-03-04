<?php
/**
 * ============================================================================
 * Backend/api/stream.php
 * ============================================================================
 * 
 * SCOPO:
 * Gatekeeper di sicurezza per l'accesso ai file multimediali (Video/Immagini).
 * Impedisce l'accesso diretto ai file tramite URL pubblici e delega a Nginx
 * l'invio efficiente del contenuto previa autorizzazione PHP.
 * 
 * TECNOLOGIA:
 * Sfrutta Nginx 'X-Accel-Redirect'. PHP verifica i permessi, mentre Nginx
 * gestisce l'I/O del file fisico (ottimizzato per alte prestazioni).
 * 
 * CONFIGURAZIONE NGINX RICHIESTA:
 * Deve esistere una 'location /protected_media/' marcata come 'internal'.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once 'gestione_richiesta.php';


// ============================================================================
// SEZIONE 2: AUTENTICAZIONE E SICUREZZA
// ============================================================================

// 1. Verifica Sessione
if (!isset($_SESSION['id_utente'])) {
    http_response_code(403);
    die("⛔ Accesso negato: Autenticazione richiesta per visualizzare il contenuto.");
}

// 2. Prevenzione Directory Traversal
$file_raw = $_GET['file'] ?? '';
$file_clean = str_replace(["\0", ".."], "", $file_raw);
$file_clean = ltrim($file_clean, '/'); // Assicura path relativo


// ============================================================================
// SEZIONE 3: GESTIONE INPUT E VALIDAZIONE
// ============================================================================

if (empty($file_clean)) {
    http_response_code(400);
    die("⚠️ Errore: Nessun file specificato nella richiesta.");
}


// ============================================================================
// SEZIONE 4: LOGICA CORE (DEFINIZIONE MIME E CACHE)
// ============================================================================

$estensione = strtolower(pathinfo($file_clean, PATHINFO_EXTENSION));

// Mappatura White-list MIME Types
$tipi_ammessi = [
    'mp4' => 'video/mp4',
    'mkv' => 'video/x-matroska',
    'webm' => 'video/webm',
    'avi' => 'video/x-msvideo',
    'mov' => 'video/quicktime',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp'
];

$content_type = $tipi_ammessi[$estensione] ?? 'application/octet-stream';

// Strategia di Caching in base al tipo di file
if (in_array($estensione, ['jpg', 'jpeg', 'png', 'webp'])) {
    // Immagini: caching aggressivo (1 ora) per ottimizzare il caricamento gallery
    header('Cache-Control: public, max-age=3600');
    header('Expires: ' . gmdate('D, d M Y H:i:s', time() + 3600) . ' GMT');
} else {
    // Video: nessuna cache per permettere seek corretti e controllo costante
    header('Cache-Control: private, no-cache, no-store, must-revalidate');
    header('Pragma: no-cache');
    header('Expires: 0');
}

header('Content-Type: ' . $content_type);
header('Content-Disposition: inline'); // Riproduzione diretta anziché download


// ============================================================================
// SEZIONE 5: HANDOFF A NGINX (REDIRECT INTERNO) O FALLBACK PHP
// ============================================================================

// Se siamo in un ambiente locale (Windows/XAMPP) senza Nginx configurato,
// X-Accel-Redirect non funzionerà. Facciamo un check basico.
// NOTA: In produzione con Nginx, meglio gestire tramite variabile ENV o config.
$use_nginx_accel = getenv('USE_NGINX_ACCEL') !== 'false'; // Default true, ma disattivabile

// Tentativo di capire se siamo su Windows/Dev senza percorsoVideo
// Se il file esiste fisicamente nel percorso relativo del progetto (setup dev semplificato)
// o se abbiamo un path base alternativo.
// Per ora, assumiamo che se la richiesta arriva qui e NON c'è nginx, dobbiamo servire il file.

// Base path dai setting o env
$base_video_path = getenv('WATCH_DIR') ?: '/percorsoVideo';

// Fallback semplice: se il file esiste in una directory "assets" relativa (setup tipico dev)
// o se riusciamo a trovarlo. Dato che non conosciamo il path assoluto reale (problema riscontrato in admin.php),
// proviamo a servire se possibile, altrimenti affidiamoci a X-Accel.

// Manteniamo X-Accel per la produzione, ma aggiungiamo un fallback se siamo sicuri di essere in DEV.
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    // FIX PER WINDOWS DEV: Sostituiamo X-Accel con readfile se rileviamo ambiente Windows
    // e se riusciamo a determinare il path (che è difficile senza config).
    // MA, se l'utente ha i file in una cartella mappata, readfile fallirà comunque se il path è sbagliato.

    // TENTATIVO DI SALVATAGGIO IN DEV:
    $full_path = $base_video_path . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $file_clean);

    if (file_exists($full_path)) {
        header('Content-Length: ' . filesize($full_path));
        readfile($full_path);
    } else {
        // Fallback disperato: redirigi a Nginx sperando che l'alias funzioni
        header('X-Accel-Redirect: /protected_media/' . $file_clean);
    }
} else {
    // FIX ENCODING: X-Accel-Redirect richiede un URI valido.
    // Se il file contiene spazi o caratteri speciali, vanno encodati (es. "My Video" -> "My%20Video").
    // Non possiamo usare urlencode su tutto perché encoderebbe anche gli slash "/".
    $parts = explode('/', $file_clean);
    $encoded_parts = array_map('rawurlencode', $parts);
    $encoded_path = implode('/', $encoded_parts);

    // Comunica a Nginx di servire il file dalla directory interna protetta
    header('X-Accel-Redirect: /protected_media/' . $encoded_path);
}

exit;
?>