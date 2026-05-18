<?php
/**
 * ============================================================================
 * Backend/api/stream.php
 * ============================================================================
 *
 * SCOPO:
 * Gatekeeper di sicurezza per l'accesso ai file multimediali (Video/Immagini).
 * In produzione (Linux/Nginx) delega tutto a Nginx via X-Accel-Redirect (zero-copy).
 * In dev (Windows/PHP serve diretto) implementa streaming chunked con supporto
 * HTTP Range per consentire seek e ridurre l'occupazione RAM su Raspberry Pi.
 *
 * SICUREZZA:
 * - Validazione path tramite `safeJoinPath` e regole anti-traversal.
 * - White-list MIME e nosniff per evitare spoofing.
 *
 * PERFORMANCE:
 * - Disattivo l'output buffering PHP per non duplicare in RAM grossi video.
 * - Chunk da 256KB: equilibrio tra throughput e pressione memoria.
 * - Supporto Range (RFC 7233) per seek/pause/resume su browser.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: INIZIALIZZAZIONE E BOOTSTRAP
// ============================================================================

require_once 'gestione_richiesta.php';
require_once 'path_safety.php';

// Disattiva qualunque output buffer ereditato per non bufferizzare grossi file.
// (gestione_richiesta.php non ne accende, ma per sicurezza chiudiamo tutto.)
while (ob_get_level() > 0) { @ob_end_clean(); }


// ============================================================================
// SEZIONE 2: AUTENTICAZIONE
// ============================================================================

if (!isset($_SESSION['id_utente'])) {
    http_response_code(403);
    die("⛔ Accesso negato: Autenticazione richiesta per visualizzare il contenuto.");
}


// ============================================================================
// SEZIONE 3: VALIDAZIONE INPUT (anti directory-traversal)
// ============================================================================

$file_raw = $_GET['file'] ?? '';
if ($file_raw === '' || strpos($file_raw, "\0") !== false) {
    http_response_code(400);
    die("⚠️ Errore: Parametro file non valido.");
}

// Decodifica un singolo livello di URL encoding (es. %2e%2e -> ..) per
// intercettare poi traversal e percorsi assoluti.
$file_clean = rawurldecode($file_raw);
$file_clean = ltrim($file_clean, '/\\');

if ($file_clean === '') {
    http_response_code(400);
    die("⚠️ Errore: Nessun file specificato nella richiesta.");
}

// Rifiuto componenti pericolose: ".." (traversal), "~" e caratteri di controllo.
$pc_parts = preg_split('#[\\\\/]+#', $file_clean);
foreach ($pc_parts as $pc) {
    if ($pc === '..' || $pc === '~' || preg_match('/[\x00-\x1F]/', $pc)) {
        http_response_code(400);
        die("⚠️ Errore: Path non valido.");
    }
}
unset($pc, $pc_parts);
// Rifiuto path assoluti Unix/Windows.
if (preg_match('#^([/\\\\]|[A-Za-z]:[\\\\/])#', $file_clean)) {
    http_response_code(400);
    die("⚠️ Errore: Path assoluti non consentiti.");
}


// ============================================================================
// SEZIONE 4: MIME TYPE WHITELIST + HEADER COMUNI
// ============================================================================

$estensione = strtolower(pathinfo($file_clean, PATHINFO_EXTENSION));

$tipi_ammessi = [
    'mp4'  => 'video/mp4',
    'mkv'  => 'video/x-matroska',
    'webm' => 'video/webm',
    'avi'  => 'video/x-msvideo',
    'mov'  => 'video/quicktime',
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png'  => 'image/png',
    'webp' => 'image/webp',
];
$is_video = in_array($estensione, ['mp4', 'mkv', 'webm', 'avi', 'mov']);
$content_type = $tipi_ammessi[$estensione] ?? 'application/octet-stream';

// Hardening browser
header('X-Content-Type-Options: nosniff');
header('Content-Type: ' . $content_type);
header('Content-Disposition: inline');
header('Accept-Ranges: bytes'); // Anche per Nginx, aiuta il client a sapere che può chiedere range.

// Strategia di caching:
// - Immagini: cache aggressiva (1g): cambia URL se cambia il file.
// - Video: short-cache (immutable per qualche minuto) per permettere seek
//   senza dover rifare l'autorizzazione PHP ad ogni richiesta Range del browser.
if (in_array($estensione, ['jpg', 'jpeg', 'png', 'webp'])) {
    header('Cache-Control: public, max-age=86400, immutable');
} else {
    header('Cache-Control: private, max-age=60');
}


// ============================================================================
// SEZIONE 5: HANDOFF A NGINX (PRODUZIONE) — zero-copy via X-Accel-Redirect
// ============================================================================

$base_video_path = getenv('WATCH_DIR') ?: '/percorsoVideo';
$is_windows = (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN');

// In produzione Linux deleghiamo a Nginx: lui gestisce sendfile, range, ecc.
if (!$is_windows) {
    $parts = explode('/', $file_clean);
    $encoded_path = implode('/', array_map('rawurlencode', $parts));
    header('X-Accel-Redirect: /protected_media/' . $encoded_path);
    exit;
}


// ============================================================================
// SEZIONE 6: FALLBACK PHP (DEV/Windows) — Range + chunked streaming
// ============================================================================

$full_path = safeJoinPath($base_video_path, $file_clean);
if ($full_path === null || !is_file($full_path)) {
    http_response_code(404);
    die("⚠️ File non trovato.");
}

$file_size = filesize($full_path);
$start = 0;
$end = $file_size - 1;
$status = 200;

// Parsing dell'header Range (singolo range, formato "bytes=START-END").
if (!empty($_SERVER['HTTP_RANGE']) && $is_video) {
    if (preg_match('/^bytes=(\d*)-(\d*)$/', trim($_SERVER['HTTP_RANGE']), $m)) {
        $req_start = $m[1] !== '' ? (int)$m[1] : null;
        $req_end   = $m[2] !== '' ? (int)$m[2] : null;

        if ($req_start === null && $req_end !== null) {
            // suffix-byte-range: ultimi N byte
            $start = max(0, $file_size - $req_end);
            $end   = $file_size - 1;
        } else {
            $start = max(0, $req_start ?? 0);
            $end   = $req_end !== null ? min($req_end, $file_size - 1) : ($file_size - 1);
        }

        if ($start > $end || $start >= $file_size) {
            header("Content-Range: bytes */$file_size");
            http_response_code(416);
            exit;
        }
        $status = 206;
        header("Content-Range: bytes $start-$end/$file_size");
    }
}

http_response_code($status);
header('Content-Length: ' . ($end - $start + 1));

// Streaming a chunk: 256KB è un buon compromesso su Raspberry Pi.
// Non usiamo readfile() che spesso bufferizza l'intero file.
$fp = fopen($full_path, 'rb');
if ($fp === false) {
    http_response_code(500);
    exit;
}
fseek($fp, $start);
$bytes_left = $end - $start + 1;
$chunk_size = 256 * 1024;

// Disabilita time-limit per video lunghi.
@set_time_limit(0);

while ($bytes_left > 0 && !feof($fp)) {
    // Se il client ha abortito, smetti subito di leggere/scrivere.
    if (connection_aborted()) {
        break;
    }
    $read = ($bytes_left > $chunk_size) ? $chunk_size : $bytes_left;
    $buffer = fread($fp, $read);
    if ($buffer === false) {
        break;
    }
    echo $buffer;
    @ob_flush();
    flush();
    $bytes_left -= strlen($buffer);
}
fclose($fp);
exit;
?>
