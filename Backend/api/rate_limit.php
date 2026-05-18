<?php
/**
 * ============================================================================
 * Backend/api/rate_limit.php
 * ============================================================================
 *
 * SCOPO:
 * Rate limiter token-bucket basato su Redis (fail-open: se Redis è down,
 * il limit è disabilitato per non bloccare il servizio).
 *
 * USO:
 * require_once 'rate_limit.php';
 * checkRateLimit('reset_password', $ip, 5, 60);  // max 5 req/60s per IP su questa azione
 *
 * Su Raspberry Pi è leggerissimo: una INCR + EXPIRE per ogni check.
 * ============================================================================
 */

if (defined('RATE_LIMIT_LOADED')) return;
define('RATE_LIMIT_LOADED', true);

require_once 'cache.php';

/**
 * Verifica il rate limit per (action, identifier). Se superato, risponde 429 e termina.
 *
 * @param string $action      Etichetta dell'azione (es. 'login', 'reset_password').
 * @param string $identifier  IP o username o id_utente del client.
 * @param int    $max         Massimo numero di richieste nella finestra.
 * @param int    $window_sec  Durata della finestra in secondi.
 * @return void  Termina con HTTP 429 se il limite è superato.
 */
function checkRateLimit($action, $identifier, $max = 30, $window_sec = 60)
{
    global $Cache;
    if (!isset($Cache) || !is_object($Cache)) return; // Fail-open: nessuna Redis → niente limit.

    // Hash leggero su identifier per gestire IP IPv6 lunghi/caratteri speciali
    // crc32 è veloce e disponibile in PHP <= 7. Più che sufficiente come bucket.
    $key = "rl:{$action}:" . dechex(crc32((string)$identifier));

    try {
        $count = $Cache->incr($key);
        if ($count === 1) {
            // Prima richiesta nella finestra: imposta il TTL.
            $Cache->expire($key, $window_sec);
        }
        if ($count > $max) {
            $retry_after = $window_sec;
            header('Retry-After: ' . $retry_after);
            http_response_code(429);
            // Output JSON-coerente con il resto dell'API.
            echo json_encode([
                'success' => false,
                'message' => 'Troppe richieste. Riprova tra qualche secondo.',
                'retryAfter' => $retry_after
            ]);
            exit;
        }
    } catch (Throwable $e) {
        // Fail-open su errore Redis: non blocchiamo il servizio.
        error_log("[RATE_LIMIT] Skip per errore: " . $e->getMessage());
    }
}
?>
