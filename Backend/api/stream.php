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

$token = $_GET['stream_token'] ?? '';
$token_valid = false;

if ($token) {
    $decoded = base64_decode($token);
    $parts = explode(':', $decoded);
    if (count($parts) === 2) {
        $uid = $parts[0];
        $hash = $parts[1];
        $expected = hash_hmac('sha256', $uid, 'FranzPLAY_Stream_Auth_Key');
        if (hash_equals($expected, $hash)) {
            $token_valid = true;
        }
    }
}

if (!$token_valid && !isset($_SESSION['id_utente'])) {
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
    'vtt'  => 'text/vtt; charset=utf-8',
];
$is_video = in_array($estensione, ['mp4', 'mkv', 'webm', 'avi', 'mov']);
$content_type = $tipi_ammessi[$estensione] ?? 'application/octet-stream';

// Hardening browser
header('X-Content-Type-Options: nosniff');
header('Content-Type: ' . $content_type);
header('Content-Disposition: inline');
header('Accept-Ranges: bytes'); // Anche per Nginx, aiuta il client a sapere che può chiedere range.

// Strategia di caching:
// - Copertine/anteprime (asset thumbnail): `no-cache`, sempre rivalidate → una
//   cover/anteprima rigenerata (stesso filename) è visibile subito.
// - Video principali: short-cache range-friendly per seek/rewatch.
// Le anteprime sono .mp4 dentro cartelle "anteprime_*": vanno trattate come le
// copertine, NON come i video, altrimenti resterebbero stale come le cover.
$is_thumbnail_asset = in_array($estensione, ['jpg', 'jpeg', 'png', 'webp'])
    || preg_match('#/anteprime_[^/]+/[^/]+\.mp4$#i', '/' . $file_clean);
if ($is_thumbnail_asset) {
    // Copertine (filename STABILE ma contenuto mutevole): `no-cache` -> il
    // browser rivalida SEMPRE prima di riusare la copia in cache. Con
    // ETag/Last-Modified (nginx sul file statico in prod, PHP nel fallback dev)
    // la richiesta condizionale torna 304 quando la cover non è cambiata e 200
    // coi byte nuovi appena viene rigenerata/sostituita. Con `max-age=3600` il
    // browser mostrava invece la copertina vecchia fino a un'ora.
    header('Cache-Control: no-cache');
} else {
    // Cache estesa per consentire rewatch entro 5 min senza ri-fetch, e
    // stale-while-revalidate per evitare buffering visibile durante refresh.
    header('Cache-Control: private, max-age=300, stale-while-revalidate=600');
}


// ============================================================================
// SEZIONE 5: HANDOFF A NGINX (PRODUZIONE) — zero-copy via X-Accel-Redirect
// ============================================================================

$base_video_path = getenv('WATCH_DIR') ?: '/percorsoVideo';
$is_windows = (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN');

// In produzione Linux deleghiamo a Nginx: lui gestisce sendfile, range, ecc.
if (!$is_windows) {
    // IMPORTANTE: Nginx X-Accel-Redirect si aspetta un URI NON url-encodato!
    // Altrimenti i file con spazi (es. "Mio Video.mp4") falliscono con 404,
    // e il browser va in loop infinito di richieste perché Nginx risponde con HTML.
    header('X-Accel-Redirect: /protected_media/' . $file_clean);
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
$mtime = filemtime($full_path);
$etag = '"' . md5($file_clean . '|' . $mtime . '|' . $file_size) . '"';

// Conditional GET: se il client già possiede questa versione, 304 Not Modified.
$inm = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
$ims = $_SERVER['HTTP_IF_MODIFIED_SINCE'] ?? '';
header('ETag: ' . $etag);
header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
if ($inm === $etag || ($ims !== '' && strtotime($ims) >= $mtime)) {
    http_response_code(304);
    exit;
}

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
