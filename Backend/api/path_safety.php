<?php
/**
 * ============================================================================
 * Backend/api/path_safety.php
 * ============================================================================
 *
 * SCOPO:
 * Funzioni di utilità per la validazione sicura dei percorsi file.
 * Previene Directory Traversal attack (es. "../../etc/passwd",
 * "....//bypass", null byte, URL encoding) confinando l'operazione
 * all'interno della base directory autorizzata.
 *
 * USO TIPICO:
 * $safe = safeJoinPath($BASE_VIDEO_PATH, $userInput);
 * if ($safe === null) { inviaRisposta(false, "Path non valido", 400); }
 * ============================================================================
 */

if (defined('PATH_SAFETY_LOADED')) return;
define('PATH_SAFETY_LOADED', true);


/**
 * Costruisce un path assoluto a partire da $base e $relative.
 * Ritorna il path normalizzato SOLO se è contenuto in $base.
 * Ritorna null in caso di tentativo di traversal, null byte, o symlink che
 * esce dalla base.
 *
 * NB: il file/directory NON deve necessariamente esistere; la normalizzazione
 * avviene su componenti per supportare creazione di nuovi file in subdir.
 */
function safeJoinPath($base, $relative)
{
    if (!is_string($base) || !is_string($relative)) return null;

    // 1) Stripping di null byte e caratteri pericolosi
    if (strpos($relative, "\0") !== false) return null;

    // 2) URL-decode preventivo (un solo passaggio per evitare doppia decodifica maliziosa)
    $rel = $relative;
    // Rifiuta esplicitamente schema/URL e percorsi assoluti tipo Unix/Windows
    if (preg_match('#^(?:[a-z][a-z0-9+\-.]*:)#i', $rel)) return null;
    if (preg_match('#^([/\\\\]|[A-Za-z]:[\\\\/])#', $rel)) {
        // path assoluti non sono accettati come input "relative"
        return null;
    }

    // 3) Normalizza separatori e split
    $rel = str_replace('\\', '/', $rel);
    $parts = explode('/', $rel);
    $stack = [];
    foreach ($parts as $p) {
        if ($p === '' || $p === '.') continue;
        if ($p === '..') {
            // Rifiuta qualsiasi parent traversal: il path deve restare DENTRO la base.
            if (empty($stack)) return null;
            array_pop($stack);
            continue;
        }
        // Rifiuta nomi che contengono solo punti (es "....") o caratteri di controllo
        if (preg_match('/[\x00-\x1F]/', $p)) return null;
        $stack[] = $p;
    }
    $normalized_rel = implode(DIRECTORY_SEPARATOR, $stack);

    // 4) Normalizza la base
    $base_norm = rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $base), DIRECTORY_SEPARATOR);
    $full = $base_norm . DIRECTORY_SEPARATOR . $normalized_rel;

    // 5) Se esistono, usa realpath per resolvere symlink e verifica prefix sulla base reale.
    $base_real = realpath($base_norm);
    if ($base_real === false) {
        // La base non esiste: rifiuta per sicurezza in produzione.
        return null;
    }
    $full_real = realpath($full);
    if ($full_real !== false) {
        // Il path esiste: verifica che la realpath sia ancora dentro la base reale.
        if (strncmp($full_real, $base_real . DIRECTORY_SEPARATOR, strlen($base_real) + 1) !== 0
            && $full_real !== $base_real) {
            return null;
        }
        return $full_real;
    }

    // Il path non esiste ancora: verifichiamo che il percorso pulito sia logicamente
    // dentro la base. Poiché abbiamo già rimosso ".." e percorsi assoluti, e abbiamo
    // costruito $full come "$base_norm/$normalized_rel", $full è per costruzione
    // un sotto-percorso testuale di $base_norm. Verifichiamolo come safety net.
    if (strncmp($full, $base_norm . DIRECTORY_SEPARATOR, strlen($base_norm) + 1) !== 0
        && $full !== $base_norm) {
        return null;
    }

    // Se la directory parent esiste, verifichiamo la sua realpath (resolve symlink).
    $parent = dirname($full);
    $parent_real = realpath($parent);
    if ($parent_real !== false) {
        if (strncmp($parent_real, $base_real . DIRECTORY_SEPARATOR, strlen($base_real) + 1) !== 0
            && $parent_real !== $base_real) {
            return null;
        }
        return $parent_real . DIRECTORY_SEPARATOR . basename($full);
    }

    // Parent non esiste: ritorniamo comunque il path costruito (sotto-percorso testuale di base).
    return $full;
}
?>
