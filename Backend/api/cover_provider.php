<?php
/**
 * ============================================================================
 * Backend/api/cover_provider.php
 * ============================================================================
 *
 * SCOPO:
 * Client PHP per i provider di copertine online + download sicuro delle
 * immagini. E' il gemello di Backend/python_server/providers/ e image_fetch.py:
 * il worker Python lavora in background, questo serve alle azioni SINCRONE
 * dell'admin (ricerca live nel modale, applica subito, testa connessione).
 *
 * ⚠️ SE MODIFICHI LA LOGICA QUI, AGGIORNA ANCHE IL LATO PYTHON (e viceversa).
 *    In particolare: costruzione query, scelta dell'immagine, guardie SSRF.
 *
 * COMPORTAMENTO API VERIFICATO SUL CAMPO (vedi commenti in providers/tpdb.py):
 *  - `parse=` vuole il formato `sito.data.nome`, col nome file grezzo non trova
 *    nulla, e puo' restituire un singolo risultato sicuro e SBAGLIATO.
 *  - L'immagine da usare e' `background` (16:9), non `posters` (verticale 2:3).
 *  - L'estensione nell'URL mente: va dedotta dai magic bytes.
 *  - La ricerca funziona anche senza token; il dettaglio scena richiede token.
 * ============================================================================
 */

if (defined('COVER_PROVIDER_LOADED')) return;
define('COVER_PROVIDER_LOADED', true);

require_once __DIR__ . '/path_safety.php';

define('TPDB_API_BASE', 'https://api.theporndb.net');
define('TMDB_API_BASE', 'https://api.themoviedb.org/3');
define('TMDB_IMAGE_BASE', 'https://image.tmdb.org/t/p/w1280');

/**
 * CATALOGO DEI PROVIDER — deve restare allineato a
 * Backend/python_server/providers/__init__.py::PROVIDER_META.
 * Il worker Python usa il proprio registro per eseguire; questo serve alla UI
 * admin per elencare i database configurabili e sapere quali richiedono token.
 */
function coverCatalogoProvider()
{
    return [
        'tpdb' => [
            'id' => 'tpdb',
            'etichetta' => 'ThePornDB',
            'contenuti' => 'Contenuti per adulti',
            'token_obbligatorio' => false,
            'url_token' => 'https://theporndb.net/user/api-tokens',
            'icona' => 'adulti',
            'costo_ricerca' => 'Nessun limite osservato',
            'nota' => "La ricerca funziona anche senza token; serve per i dati di dettaglio.",
            'guida' => [
                "Crea un account gratuito su theporndb.net e accedi.",
                "Apri il menu del tuo profilo e vai su «API Tokens».",
                "Premi «Create Token», dai un nome qualsiasi (es. FranzPLAY) e conferma.",
                "Copia il token generato e incollalo qui sopra.",
            ],
        ],
        'tmdb' => [
            'id' => 'tmdb',
            'etichetta' => 'The Movie Database',
            'contenuti' => 'Film e serie TV',
            'token_obbligatorio' => true,
            'url_token' => 'https://www.themoviedb.org/settings/api',
            'icona' => 'cinema',
            'costo_ricerca' => 'Nessun limite stretto',
            'nota' => "Accetta sia la API Key (v3) sia il Read Access Token (v4).",
            'guida' => [
                "Crea un account gratuito su themoviedb.org e verifica l'email.",
                "Vai su «Impostazioni» → «API» (oppure apri direttamente il link qui sotto).",
                "Richiedi una chiave scegliendo l'uso «Developer / Personale»: l'approvazione è immediata.",
                "Copia il campo «API Key (v3 auth)» oppure «API Read Access Token» e incollalo qui sopra: vanno bene entrambi.",
            ],
        ],
        'youtube' => [
            'id' => 'youtube',
            'etichetta' => 'YouTube',
            'contenuti' => 'Video scaricati da YouTube',
            // Facoltativa: senza chiave restano coperti i file con l'ID nel
            // nome, a costo zero e fuori dal perimetro della Data API.
            'token_obbligatorio' => false,
            // Link diretto alla LIBRERIA, non alle credenziali: il passo in cui
            // quasi tutti si bloccano e' l'abilitazione dell'API, che va fatta
            // PRIMA di creare la chiave (altrimenti la chiave esiste ma risponde 403).
            'url_token' => 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
            'icona' => 'youtube',
            'costo_ricerca' => '100 unità su 10.000 al giorno (~100 ricerche)',
            'nota' => "Senza chiave funzionano solo i file con l'ID nel nome (gratis). "
                . "La ricerca per titolo richiede una chiave e costa 100 unità sulle "
                . "10.000 giornaliere: circa 100 ricerche al giorno. Le copertine "
                . "vengono ri-scaricate ogni 25 giorni come richiesto dalle policy YouTube.",
            'guida' => [
                "Apri Google Cloud Console con il tuo account Google (il link qui sotto ti porta già al punto giusto).",
                "In alto, nel selettore dei progetti, crea un nuovo progetto: nome libero, es. «FranzPLAY».",
                "⚠️ Passo cruciale: nella pagina che si apre premi «ABILITA» per la YouTube Data API v3. Se salti questo passo la chiave verrà creata ma risponderà sempre 403.",
                "Vai su «Credenziali» nel menu a sinistra → «＋ CREA CREDENZIALI» → «Chiave API».",
                "Copia la chiave che compare e incollala qui sopra.",
                "Consigliato: premi «Limita chiave» e sotto «Restrizioni API» seleziona solo «YouTube Data API v3». Così, se la chiave finisse in mani sbagliate, non potrebbe fare altro.",
            ],
            'guida_nota' => "Serve solo per cercare per titolo. Se i tuoi file scaricati con yt-dlp hanno già l'ID nel nome (es. «Titolo [dQw4w9WgXcQ].mp4»), la copertina si scarica senza alcuna chiave.",
        ],
    ];
}

/** Chiavi Impostazioni di un provider. */
function coverChiaveToken($id)  { return 'copertine_provider_' . $id . '_token'; }
function coverChiaveAttivo($id) { return 'copertine_provider_' . $id . '_attivo'; }

/**
 * Ordine di interrogazione configurato, filtrato sul catalogo reale.
 * I provider registrati ma non ancora presenti nell'ordine finiscono in coda,
 * cosi' aggiungerne uno non richiede di riscrivere l'impostazione.
 */
function coverOrdineProvider()
{
    $catalogo = coverCatalogoProvider();
    $grezzo = coverImpostazione('copertine_provider_ordine', '');
    $ordine = json_decode($grezzo ?: '[]', true);
    if (!is_array($ordine)) $ordine = [];

    $finale = [];
    foreach ($ordine as $id) {
        if (isset($catalogo[$id]) && !in_array($id, $finale, true)) $finale[] = $id;
    }
    foreach (array_keys($catalogo) as $id) {
        if (!in_array($id, $finale, true)) $finale[] = $id;
    }
    return $finale;
}

/** Provider attivi e utilizzabili, in ordine: [['id'=>..,'token'=>..], ...]. */
function coverProviderAttivi()
{
    $catalogo = coverCatalogoProvider();
    $attivi = [];
    foreach (coverOrdineProvider() as $id) {
        if (coverImpostazione(coverChiaveAttivo($id), '0') !== '1') continue;
        $token = coverImpostazione(coverChiaveToken($id), '');
        // Retrocompatibilita' con lo schema a provider singolo.
        if ($id === 'tpdb' && $token === '') {
            $token = coverImpostazione('tpdb_api_token', '');
        }
        if ($catalogo[$id]['token_obbligatorio'] && $token === '') continue;
        $attivi[] = ['id' => $id, 'token' => $token];
    }
    return $attivi;
}
define('COVER_HTTP_TIMEOUT', 20);
define('COVER_MAX_IMAGE_BYTES', 8 * 1024 * 1024);
define('COVER_USER_AGENT', 'FranzPLAY/1.0 (self-hosted media server)');

/**
 * Token tecnici di release da scartare dal nome file: sono rumore che fa
 * crollare il match testuale. Speculare a NOISE_TOKENS in providers/base.py.
 */
function coverNoiseTokens()
{
    static $tokens = null;
    if ($tokens === null) {
        $tokens = array_flip([
            'xxx','webdl','web','dl','bluray','brrip','dvdrip','hdrip','webrip',
            'x264','x265','h264','h265','hevc','avc','aac','ac3','dts','opus',
            '1080p','2160p','720p','480p','360p','4k','uhd','sd','hd','fullhd',
            'internal','proper','repack','multi','ita','eng','sub','subs',
            'mp4','mkv','avi','wmv','mov',
        ]);
    }
    return $tokens;
}

/**
 * Inverte la sanificazione del watcher (che sostituisce i non-alfanumerici con
 * underscore). Senza questo passaggio il match sul provider crolla.
 */
function coverDesanitize($testo)
{
    if (!is_string($testo) || $testo === '') return '';
    $t = str_replace(['_', '.', '-'], ' ', $testo);
    return trim(preg_replace('/\s+/', ' ', $t));
}

/** Estrae una data ISO dal testo. Ritorna ['data' => 'YYYY-MM-DD'|null, 'resto' => string]. */
function coverEstraiData($testo)
{
    $pattern = [
        ['/\b(20\d{2})[ ._-]?(\d{2})[ ._-]?(\d{2})\b/', 'ymd'],
        ['/\b(\d{2})[ ._-](\d{2})[ ._-](20\d{2})\b/', 'dmy'],
        ['/\b(\d{2})[ ._-](\d{2})[ ._-](\d{2})\b/', 'ymd_corto'],
    ];
    foreach ($pattern as $p) {
        if (!preg_match($p[0], $testo, $m, PREG_OFFSET_CAPTURE)) continue;
        $a = (int) $m[1][0]; $b = (int) $m[2][0]; $c = (int) $m[3][0];
        if ($p[1] === 'ymd')            { $anno = $a; $mese = $b; $giorno = $c; }
        elseif ($p[1] === 'dmy')        { $giorno = $a; $mese = $b; $anno = $c; }
        else                            { $anno = 2000 + $a; $mese = $b; $giorno = $c; }
        if ($mese < 1 || $mese > 12 || $giorno < 1 || $giorno > 31) continue;

        $inizio = $m[0][1];
        $lunghezza = strlen($m[0][0]);
        $resto = trim(substr($testo, 0, $inizio) . ' ' . substr($testo, $inizio + $lunghezza));
        return [
            'data' => sprintf('%04d-%02d-%02d', $anno, $mese, $giorno),
            'resto' => preg_replace('/\s+/', ' ', $resto),
        ];
    }
    return ['data' => null, 'resto' => $testo];
}

/** Toglie gruppi tra parentesi e token tecnici. */
function coverRimuoviRumore($testo)
{
    $t = preg_replace('/[\[(][^\])]*[\])]/', ' ', $testo);
    $noise = coverNoiseTokens();
    $tenute = [];
    foreach (preg_split('/\s+/', $t, -1, PREG_SPLIT_NO_EMPTY) as $parola) {
        $chiave = strtolower(trim($parola, '-_.'));
        if (isset($noise[$chiave])) continue;
        $tenute[] = $parola;
    }
    return trim(preg_replace('/\s+/', ' ', implode(' ', $tenute)));
}

/**
 * Scompone il path del video in (site, data, nome) e produce i tentativi di
 * ricerca ordinati. Speculare a providers/base.py::build_query.
 *
 * In FranzPLAY la cartella categoria coincide spesso con lo studio, quindi la
 * usiamo come componente `site` del formato `parse=sito.data.nome`.
 */
function coverBuildQuery($percorso_file, $titolo_db = null, $provider = 'tpdb')
{
    $stem = pathinfo($percorso_file, PATHINFO_FILENAME);
    $dir = trim(dirname($percorso_file), './\\');
    $cartella = ($dir !== '' && $dir !== '.') ? basename($dir) : '';

    $nome_grezzo = coverDesanitize($stem);
    $estratto = coverEstraiData($nome_grezzo);
    $nome = coverRimuoviRumore($estratto['resto']);
    $data = $estratto['data'];
    $site = coverDesanitize($cartella);

    // ⚠️ RIMOZIONE DEL PREFISSO: SOLO PER ThePornDB.
    // Su TPDB la cartella e' lo STUDIO e il nome file spesso lo ripete:
    // "Blacked/Blacked Sofia Lee" -> cercare "Blacked.Blacked Sofia Lee"
    // peggiora il match, quindi si toglie il duplicato.
    //
    // Su YouTube e TMDB la cartella e' una semplice CATEGORIA e il titolo va
    // cercato INTERO: da "Forza_Horizon_6/Forza_Horizon_6_Gameplay_impressionante"
    // togliere il prefisso lascerebbe "Gameplay impressionante", che non
    // corrisponde ad alcun video reale. E' anche cio' che faceva "accorciare"
    // visibilmente il titolo nel campo di ricerca.
    if ($provider === 'tpdb' && $site !== '' && stripos($nome, $site) === 0) {
        $nome = trim(substr($nome, strlen($site)), " -.");
    }
    if ($nome === '' && $titolo_db) {
        $nome = coverRimuoviRumore(coverDesanitize($titolo_db));
    }

    $tentativi = [];
    if ($site && $data && $nome) $tentativi[] = ['parse', "$site.$data.$nome"];
    if ($site && $nome)          $tentativi[] = ['parse', "$site.$nome"];
    if ($data && $nome)          $tentativi[] = ['parse', "$data.$nome"];
    if ($nome) {
        $tentativi[] = ['parse', $nome];
        $tentativi[] = ['q', $nome];
    }

    return ['site' => $site, 'data' => $data, 'nome' => $nome, 'tentativi' => $tentativi];
}

/**
 * Confidenza 0-100 calcolata da NOI: l'API non ne fornisce una e restituisce
 * risultati errati con la stessa apparente sicurezza di quelli giusti.
 * Speculare a providers/base.py::score_match (stessi pesi, stessa taratura).
 */
function coverScoreMatch($candidato, $query, $durata_sec = null)
{
    similar_text(
        mb_strtolower($query['nome'] ?? ''),
        mb_strtolower($candidato['title'] ?? ''),
        $percentuale
    );
    $punti = $percentuale * 0.70;

    $site_q = str_replace(' ', '', mb_strtolower($query['site'] ?? ''));
    $site_c = str_replace(' ', '', mb_strtolower($candidato['site'] ?? ''));
    if ($site_q !== '' && $site_c !== '') {
        similar_text($site_q, $site_c, $sim_sito);
        if ($sim_sito > 85)      $punti += 20;
        elseif ($sim_sito > 60)  $punti += 10;
    }

    $data_q = $query['data'] ?? null;
    $data_c = substr($candidato['date'] ?? '', 0, 10);
    if ($data_q && $data_c) {
        $punti += ($data_q === $data_c) ? 10 : -10;
    }

    $durata_c = (int) ($candidato['duration'] ?? 0);
    if ($durata_sec && $durata_c) {
        $scarto = abs($durata_sec - $durata_c) / $durata_sec;
        if ($scarto <= 0.05)      $punti += 5;
        elseif ($scarto > 0.25)   $punti -= 10;
    }

    return max(0, min(100, (int) round($punti)));
}

/**
 * Sceglie l'immagine da usare come copertina.
 * `background` per primo: e' l'unico 16:9, coerente con la UI aspect-video.
 */
function coverScegliImmagine($scena)
{
    foreach (['large', 'full', 'medium'] as $k) {
        if (!empty($scena['background'][$k])) return $scena['background'][$k];
    }
    if (!empty($scena['image'])) return $scena['image'];
    foreach (['large', 'full', 'medium'] as $k) {
        if (!empty($scena['posters'][$k])) return $scena['posters'][$k];
    }
    if (!empty($scena['poster'])) return $scena['poster'];
    return null;
}

/** Porta una scena TPDB nel formato normalizzato comune. */
function coverNormalizzaScena($scena)
{
    $performers = [];
    foreach (($scena['performers'] ?? []) as $p) {
        if (!empty($p['name'])) $performers[] = $p['name'];
    }
    $tags = [];
    foreach (($scena['tags'] ?? []) as $t) {
        if (!empty($t['name'])) $tags[] = $t['name'];
    }
    return [
        'id' => $scena['id'] ?? '',
        'title' => $scena['title'] ?? '',
        'site' => $scena['site']['name'] ?? '',
        'date' => substr($scena['date'] ?? '', 0, 10),
        'duration' => (int) ($scena['duration'] ?? 0),
        'image_url' => coverScegliImmagine($scena),
        // Gia' pronti per la Fase 2 (descrizione, attrici/attori, tag).
        'description' => $scena['description'] ?? '',
        'performers' => $performers,
        'tags' => $tags,
    ];
}

/**
 * Chiamata GET all'API del provider.
 * Ritorna ['ok' => bool, 'dati' => array|null, 'errore' => string, 'http' => int].
 */
function coverApiGet($percorso, $params, $token)
{
    $url = TPDB_API_BASE . $percorso . '?' . http_build_query($params);

    $ch = curl_init($url);
    $headers = ['Accept: application/json'];
    if (!empty($token)) $headers[] = 'Authorization: Bearer ' . $token;

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => COVER_HTTP_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,   // niente redirect automatici
        CURLOPT_SSL_VERIFYPEER => true,    // verifica TLS SEMPRE attiva
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => COVER_USER_AGENT,
    ]);
    $corpo = curl_exec($ch);
    $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err_curl = curl_error($ch);
    curl_close($ch);

    if ($corpo === false) {
        return ['ok' => false, 'dati' => null, 'http' => 0,
                'errore' => 'errore di rete: ' . $err_curl];
    }
    if ($http === 401) {
        return ['ok' => false, 'dati' => null, 'http' => 401,
                'errore' => 'token del provider assente o non valido'];
    }
    if ($http === 429 || $http === 503) {
        return ['ok' => false, 'dati' => null, 'http' => $http,
                'errore' => 'il provider sta limitando le richieste (HTTP ' . $http . '), riprova tra qualche minuto'];
    }
    if ($http !== 200) {
        return ['ok' => false, 'dati' => null, 'http' => $http,
                'errore' => 'il provider ha risposto HTTP ' . $http];
    }

    $json = json_decode($corpo, true);
    if (!is_array($json)) {
        return ['ok' => false, 'dati' => null, 'http' => $http,
                'errore' => 'risposta non JSON dal provider'];
    }
    return ['ok' => true, 'dati' => $json, 'http' => $http, 'errore' => ''];
}

// ---------------------------------------------------------------------------
// TMDB — film e serie TV. Gemello di providers/tmdb.py (vedi le note li').
// Immagine usata: `backdrop_path` (16:9), non `poster_path` (2:3 verticale).
// ---------------------------------------------------------------------------

/** Il token v4 di TMDB e' un JWT: inizia per "eyJ". Il v3 va in query string. */
function coverTmdbTokenV4($token) { return strncmp($token, 'eyJ', 3) === 0; }

function coverApiGetTmdb($percorso, $params, $token)
{
    if ($token === '') {
        return ['ok' => false, 'dati' => null, 'http' => 401,
                'errore' => 'The Movie Database richiede un token'];
    }
    $headers = ['Accept: application/json'];
    if (coverTmdbTokenV4($token)) {
        $headers[] = 'Authorization: Bearer ' . $token;
    } else {
        $params['api_key'] = $token;
    }

    $ch = curl_init(TMDB_API_BASE . $percorso . '?' . http_build_query($params));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => COVER_HTTP_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => COVER_USER_AGENT,
    ]);
    $corpo = curl_exec($ch);
    $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($corpo === false) {
        return ['ok' => false, 'dati' => null, 'http' => 0, 'errore' => 'errore di rete: ' . $err];
    }
    if ($http === 401 || $http === 403) {
        return ['ok' => false, 'dati' => null, 'http' => $http,
                'errore' => 'token The Movie Database assente o non valido'];
    }
    if ($http === 429) {
        return ['ok' => false, 'dati' => null, 'http' => 429,
                'errore' => 'The Movie Database sta limitando le richieste, riprova tra poco'];
    }
    if ($http !== 200) {
        return ['ok' => false, 'dati' => null, 'http' => $http,
                'errore' => 'The Movie Database ha risposto HTTP ' . $http];
    }
    $json = json_decode($corpo, true);
    if (!is_array($json)) {
        return ['ok' => false, 'dati' => null, 'http' => $http, 'errore' => 'risposta non JSON'];
    }
    return ['ok' => true, 'dati' => $json, 'http' => $http, 'errore' => ''];
}

function coverNormalizzaTmdb($elemento, $tipo)
{
    $titolo = $tipo === 'tv' ? ($elemento['name'] ?? '') : ($elemento['title'] ?? '');
    $data = $tipo === 'tv' ? ($elemento['first_air_date'] ?? '') : ($elemento['release_date'] ?? '');

    $immagine = !empty($elemento['backdrop_path'])
        ? TMDB_IMAGE_BASE . $elemento['backdrop_path']
        : (!empty($elemento['poster_path']) ? TMDB_IMAGE_BASE . $elemento['poster_path'] : null);

    return [
        'id' => $tipo . '-' . ($elemento['id'] ?? ''),
        'title' => $titolo,
        'site' => $tipo === 'movie' ? 'Film' : 'Serie TV',
        'date' => substr($data, 0, 10),
        'duration' => 0,   // non presente nella ricerca TMDB
        'image_url' => $immagine,
        'description' => $elemento['overview'] ?? '',
        'performers' => [],
        'tags' => [],
    ];
}

// ---------------------------------------------------------------------------
// YOUTUBE — gemello di providers/youtube.py. Vedi li' le note su conformita',
// costo della quota e formati delle miniature.
//
// Due strade: l'ID nel nome file (costo zero, nessuna API) e la ricerca per
// titolo via Data API v3 (100 unita' su 10.000 al giorno).
// ---------------------------------------------------------------------------

define('YT_API_BASE', 'https://www.googleapis.com/youtube/v3');
define('YT_IMG_BASE', 'https://i.ytimg.com/vi');

/**
 * Cerca un ID YouTube nel nome file. DELIBERATAMENTE PERMISSIVA: la forma
 * sanificata dal watcher (parentesi quadre -> underscore) rende l'underscore
 * ambiguo, quindi la verifica vera la fa coverYoutubeMiglioreMiniatura(), che
 * ottiene 404 se l'ID non esiste.
 */
function coverYoutubeIdDaNome($nome)
{
    if (!$nome) return null;
    $stem = preg_replace('/\.[A-Za-z0-9]{2,4}$/', '', $nome);

    foreach (['/\[([0-9A-Za-z_-]{11})\]/', '/\(([0-9A-Za-z_-]{11})\)/'] as $p) {
        if (preg_match($p, $stem, $m)) return $m[1];
    }
    if (preg_match('/_([0-9A-Za-z_-]{11})_*$/', $stem, $m)) return $m[1];
    if (strlen($stem) > 15) {
        $coda = substr($stem, -11);
        if (preg_match('/^[0-9A-Za-z_-]{11}$/', $coda)) return $coda;
    }
    return null;
}

function coverYoutubeUrlMiniatura($id, $formato = 'maxresdefault')
{
    return YT_IMG_BASE . '/' . $id . '/' . $formato . '.jpg';
}

/**
 * Miglior miniatura 16:9 realmente esistente.
 * Solo maxresdefault (1278x720) e mqdefault (320x180) sono 16:9; sddefault e
 * hqdefault sono 4:3 e mostrerebbero bande nere. maxresdefault manca su
 * parecchi video, quindi va verificato con una HEAD.
 * NB: richieste a i.ytimg.com, non alla Data API: nessuna quota, nessuna chiave.
 */
function coverYoutubeMiglioreMiniatura($id)
{
    foreach (['maxresdefault', 'mqdefault'] as $formato) {
        $url = coverYoutubeUrlMiniatura($id, $formato);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_NOBODY => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_USERAGENT => COVER_USER_AGENT,
        ]);
        curl_exec($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($http === 200) return $url;
    }
    return null;
}

function coverApiGetYoutube($percorso, $params, $token)
{
    if ($token === '') {
        return ['ok' => false, 'dati' => null, 'http' => 401,
                'errore' => 'la ricerca per titolo su YouTube richiede una chiave API'];
    }
    $params['key'] = $token;

    $ch = curl_init(YT_API_BASE . $percorso . '?' . http_build_query($params));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_TIMEOUT => COVER_HTTP_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => COVER_USER_AGENT,
    ]);
    $corpo = curl_exec($ch);
    $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($corpo === false) {
        return ['ok' => false, 'dati' => null, 'http' => 0, 'errore' => 'errore di rete: ' . $err];
    }
    $json = json_decode($corpo, true);

    // Google mette il motivo vero nel corpo: mostrarlo tale e quale evita
    // all'admin di indovinare fra "chiave sbagliata" e "API non abilitata".
    if ($http !== 200) {
        $msg = $json['error']['message'] ?? ('HTTP ' . $http);
        $motivo = $json['error']['errors'][0]['reason'] ?? '';
        if ($motivo === 'accessNotConfigured' || stripos($msg, 'has not been used') !== false) {
            $msg = "La YouTube Data API v3 non è abilitata su questo progetto Google Cloud. "
                 . "Aprila dalla libreria API e premi ABILITA, poi riprova. (dettaglio: $msg)";
        } elseif (stripos($msg, 'quota') !== false) {
            $msg = "Quota giornaliera YouTube esaurita: $msg";
        } elseif (stripos($msg, 'API key not valid') !== false) {
            // Verificato: con una chiave inventata Google risponde 400 badRequest
            // con questo messaggio. Cause tipiche: spazi copiati insieme alla
            // chiave, oppure chiave di un altro progetto.
            $msg = "Chiave non valida. Controlla di averla copiata per intero e senza spazi, "
                 . "e che appartenga al progetto in cui hai abilitato la YouTube Data API v3.";
        } elseif ($motivo === 'ipRefererBlocked' || stripos($msg, 'referer') !== false) {
            $msg = "La chiave ha una restrizione di applicazione (siti web / IP) che blocca le "
                 . "chiamate dal server. Imposta «Restrizioni applicazione: Nessuna». (dettaglio: $msg)";
        }
        return ['ok' => false, 'dati' => null, 'http' => $http, 'errore' => $msg];
    }
    if (!is_array($json)) {
        return ['ok' => false, 'dati' => null, 'http' => $http, 'errore' => 'risposta non JSON'];
    }
    return ['ok' => true, 'dati' => $json, 'http' => $http, 'errore' => ''];
}

function coverNormalizzaYoutube($videoId, $titolo, $canale, $data, $descrizione = '')
{
    return [
        'id' => $videoId,
        'title' => $titolo ?: '',
        'site' => $canale ?: 'YouTube',
        'date' => substr($data ?: '', 0, 10),
        'duration' => 0,   // non presente in search.list
        'image_url' => coverYoutubeUrlMiniatura($videoId, 'maxresdefault'),
        'description' => $descrizione ?: '',
        'performers' => [],
        'tags' => [],
        'source_url' => 'https://www.youtube.com/watch?v=' . $videoId,
    ];
}

/**
 * Ricerca su TUTTI i provider attivi, in ordine di priorita'.
 * Si ferma al primo che produce un match sopra `soglia_stop`.
 *
 * Ritorna ['ok', 'query', 'candidati', 'errore'].
 */
function coverCercaMulti($percorso_file, $titolo_db, $durata_sec,
                         $limit = 12, $soglia_stop = 101, $query_manuale = null)
{
    $attivi = coverProviderAttivi();
    if (empty($attivi)) {
        return ['ok' => false, 'query' => ['nome' => ''], 'candidati' => [],
                'errore' => "Nessun database online attivo. Attivane almeno uno in Admin > Copertine."];
    }

    $tutti = [];
    $query = null;
    $errori = [];

    foreach ($attivi as $p) {
        $esito = coverCercaCandidati($percorso_file, $titolo_db, $durata_sec,
                                     $p['token'], $limit, $soglia_stop,
                                     $query_manuale, $p['id']);
        if ($query === null) $query = $esito['query'];
        if (!$esito['ok']) {
            $errori[] = $p['id'] . ': ' . $esito['errore'];
            continue;
        }
        foreach ($esito['candidati'] as $c) {
            $c['provider'] = $p['id'];
            $tutti[] = $c;
        }
        if (!empty($esito['candidati'])) {
            $max = max(array_column($esito['candidati'], 'score'));
            if ($max >= $soglia_stop) break;
        }
    }

    if (empty($tutti) && !empty($errori)) {
        return ['ok' => false, 'query' => $query ?: ['nome' => ''], 'candidati' => [],
                'errore' => implode(' · ', $errori)];
    }

    usort($tutti, function ($a, $b) { return $b['score'] <=> $a['score']; });
    return ['ok' => true, 'query' => $query ?: ['nome' => ''], 'candidati' => $tutti, 'errore' => ''];
}

/**
 * Ricerca su UN provider: prova i tentativi in ordine, normalizza, assegna lo
 * score e si ferma appena trova un match forte (per non bruciare chiamate).
 *
 * Ritorna ['ok' => bool, 'query' => array, 'candidati' => array, 'errore' => string].
 */
function coverCercaCandidati($percorso_file, $titolo_db, $durata_sec, $token,
                             $limit = 10, $soglia_stop = 80, $query_manuale = null,
                             $provider = 'tpdb')
{
    if ($query_manuale !== null && trim($query_manuale) !== '') {
        // Ricerca digitata a mano dall'admin: niente euristiche sul path.
        $query = ['site' => '', 'data' => null, 'nome' => trim($query_manuale),
                  'tentativi' => [['q', trim($query_manuale)]]];
    } else {
        $query = coverBuildQuery($percorso_file, $titolo_db, $provider);
    }

    $visti = [];
    $ultimo_errore = '';

    // --- YOUTUBE: strada a COSTO ZERO ---
    // Se il nome file contiene un ID, la copertina si ottiene senza toccare la
    // Data API: nessuna quota, nessuna chiave, e nessun dato ottenuto tramite
    // API (quindi fuori dal perimetro delle policy sulla conservazione).
    if ($provider === 'youtube') {
        $videoId = coverYoutubeIdDaNome(basename($percorso_file ?: ''));
        if ($videoId) {
            $url = coverYoutubeMiglioreMiniatura($videoId);
            if ($url) {
                $c = coverNormalizzaYoutube($videoId, $titolo_db ?: $query['nome'], 'YouTube', '');
                $c['image_url'] = $url;
                $c['score'] = 100;              // l'ID e' un'identificazione esatta
                $c['via'] = 'id_nel_nome';
                return ['ok' => true, 'query' => $query, 'candidati' => [$c], 'errore' => ''];
            }
        }
    }

    // TMDB e YouTube non hanno un endpoint "parse": qualunque tentativo diventa
    // una ricerca testuale, quindi ne basta uno solo (gli altri sarebbero
    // duplicati che sprecano quota).
    $tentativi = in_array($provider, ['tmdb', 'youtube'], true)
        ? [['q', $query['nome']]]
        : $query['tentativi'];

    foreach ($tentativi as $tentativo) {
        list($modo, $valore) = $tentativo;
        if ($valore === '') continue;

        $trovati = [];
        if ($provider === 'tmdb') {
            foreach ([['movie', '/search/movie'], ['tv', '/search/tv']] as $t) {
                $res = coverApiGetTmdb($t[1], ['query' => $valore, 'include_adult' => 'false'], $token);
                if (!$res['ok']) {
                    $ultimo_errore = $res['errore'];
                    if (in_array($res['http'], [401, 403, 429], true)) break 2;
                    continue;
                }
                foreach (array_slice($res['dati']['results'] ?? [], 0, $limit) as $el) {
                    $trovati[] = coverNormalizzaTmdb($el, $t[0]);
                }
            }
        } elseif ($provider === 'youtube') {
            $res = coverApiGetYoutube('/search', [
                'part' => 'snippet', 'type' => 'video',
                'q' => $valore, 'maxResults' => min($limit, 25),
            ], $token);
            if (!$res['ok']) {
                $ultimo_errore = $res['errore'];
                break;   // quota o chiave: inutile insistere
            }
            foreach (($res['dati']['items'] ?? []) as $item) {
                $vid = $item['id']['videoId'] ?? '';
                if (!$vid) continue;
                $sn = $item['snippet'] ?? [];
                $trovati[] = coverNormalizzaYoutube(
                    $vid, $sn['title'] ?? '', $sn['channelTitle'] ?? '',
                    $sn['publishedAt'] ?? '', $sn['description'] ?? '');
            }
        } else {
            $res = coverApiGet('/scenes', [$modo => $valore, 'limit' => $limit], $token);
            if (!$res['ok']) {
                $ultimo_errore = $res['errore'];
                // 401/429 sono definitivi: inutile insistere con gli altri tentativi.
                if (in_array($res['http'], [401, 429, 503], true)) break;
                continue;
            }
            foreach (($res['dati']['data'] ?? []) as $scena) {
                $trovati[] = coverNormalizzaScena($scena);
            }
        }

        foreach ($trovati as $c) {
            if (empty($c['id']) || empty($c['image_url'])) continue;
            if (isset($visti[$c['id']])) continue;
            $c['score'] = coverScoreMatch($c, $query, $durata_sec);
            $c['via'] = $modo;
            $visti[$c['id']] = $c;
        }
        if (!empty($visti)) {
            $massimo = max(array_column($visti, 'score'));
            if ($massimo >= $soglia_stop) break;
        }
    }

    if (empty($visti) && $ultimo_errore !== '') {
        return ['ok' => false, 'query' => $query, 'candidati' => [], 'errore' => $ultimo_errore];
    }

    $candidati = array_values($visti);
    usort($candidati, function ($a, $b) { return $b['score'] <=> $a['score']; });
    return ['ok' => true, 'query' => $query, 'candidati' => $candidati, 'errore' => ''];
}

// ---------------------------------------------------------------------------
// DOWNLOAD IMMAGINE — guardie identiche a image_fetch.py
// ---------------------------------------------------------------------------

/**
 * Guardia SSRF: https obbligatorio + l'host deve risolvere SOLO a IP pubblici.
 * Una allowlist di host non e' praticabile: le immagini di TPDB stanno anche su
 * CDN di studio terzi (verificato: media-public-ht.project1content.com).
 */
function coverUrlConsentito($url)
{
    if (!is_string($url) || $url === '') return [false, 'URL mancante'];
    $parts = parse_url($url);
    if ($parts === false || empty($parts['host'])) return [false, 'URL malformato'];
    if (($parts['scheme'] ?? '') !== 'https') return [false, 'schema non https'];

    $host = $parts['host'];
    $indirizzi = [];

    // Se l'host e' gia' un IP letterale, non serve risolvere.
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $indirizzi[] = $host;
    } else {
        $v4 = @gethostbynamel($host);
        if (is_array($v4)) $indirizzi = array_merge($indirizzi, $v4);
        $record = @dns_get_record($host, DNS_AAAA);
        if (is_array($record)) {
            foreach ($record as $r) {
                if (!empty($r['ipv6'])) $indirizzi[] = $r['ipv6'];
            }
        }
    }

    if (empty($indirizzi)) return [false, 'host non risolvibile'];

    foreach ($indirizzi as $ip) {
        $pubblico = filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        );
        if ($pubblico === false) {
            return [false, "l'host risolve a un IP privato o riservato (possibile SSRF)"];
        }
    }
    return [true, ''];
}

/** Estensione dedotta dai MAGIC BYTES, mai dall'URL (che mente). */
function coverDeduciEstensione($primi_byte)
{
    if (strncmp($primi_byte, "\xFF\xD8\xFF", 3) === 0) return 'jpg';
    if (strncmp($primi_byte, "\x89PNG\r\n\x1a\n", 8) === 0) return 'png';
    if (substr($primi_byte, 0, 4) === 'RIFF' && substr($primi_byte, 8, 4) === 'WEBP') return 'webp';
    return null;
}

/**
 * Scarica un'immagine e la scrive ATOMICAMENTE (.tmp + rename).
 * `$destinazione_senza_ext` e' il path completo senza suffisso.
 *
 * Ritorna ['ok' => bool, 'path' => string, 'ext' => string, 'byte' => int, 'errore' => string].
 */
function coverScaricaImmagine($url, $destinazione_senza_ext, $max_hop = 3)
{
    $corrente = $url;

    for ($hop = 0; $hop <= $max_hop; $hop++) {
        list($ok, $motivo) = coverUrlConsentito($corrente);
        if (!$ok) {
            return ['ok' => false, 'errore' => "URL rifiutato ($motivo)"];
        }

        $ch = curl_init($corrente);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => COVER_HTTP_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_FOLLOWLOCATION => false,   // i redirect li validiamo a mano
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => COVER_USER_AGENT,
            // Interrompe il trasferimento se supera il limite: niente bombe.
            CURLOPT_NOPROGRESS => false,
            // cURL invoca la callback con 5 argomenti: li dichiariamo tutti.
            // Ritornando != 0 il trasferimento viene abortito: e' cosi' che
            // fermiamo un download prima che riempia la RAM.
            CURLOPT_PROGRESSFUNCTION => function ($ch, $attesi_dl, $scaricati, $attesi_ul, $inviati) {
                return ($scaricati > COVER_MAX_IMAGE_BYTES) ? 1 : 0;
            },
        ]);
        $corpo = curl_exec($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $redirect = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
        $err_curl = curl_error($ch);
        curl_close($ch);

        if ($corpo === false) {
            if (stripos($err_curl, 'aborted') !== false || stripos($err_curl, 'callback') !== false) {
                return ['ok' => false, 'errore' => 'immagine troppo grande (oltre ' . COVER_MAX_IMAGE_BYTES . ' byte)'];
            }
            return ['ok' => false, 'errore' => 'errore di rete: ' . $err_curl];
        }

        if (in_array($http, [301, 302, 303, 307, 308], true)) {
            if (empty($redirect)) {
                return ['ok' => false, 'errore' => 'redirect senza destinazione'];
            }
            $corrente = $redirect;   // nuovo giro: l'host viene rivalidato
            continue;
        }

        if ($http !== 200) {
            return ['ok' => false, 'errore' => 'il server immagini ha risposto HTTP ' . $http];
        }
        if (strlen($corpo) === 0) {
            return ['ok' => false, 'errore' => 'risposta vuota'];
        }
        if (strlen($corpo) > COVER_MAX_IMAGE_BYTES) {
            return ['ok' => false, 'errore' => 'immagine troppo grande'];
        }

        $ext = coverDeduciEstensione(substr($corpo, 0, 16));
        if ($ext === null) {
            return ['ok' => false, 'errore' => "il contenuto non e' un'immagine riconosciuta"];
        }

        $path_finale = $destinazione_senza_ext . '.' . $ext;
        $cartella = dirname($path_finale);
        if (!is_dir($cartella) && !@mkdir($cartella, 0755, true)) {
            return ['ok' => false, 'errore' => "impossibile creare la cartella $cartella"];
        }
        $path_tmp = $path_finale . '.tmp';
        if (@file_put_contents($path_tmp, $corpo) === false) {
            return ['ok' => false, 'errore' => 'scrittura su disco fallita (permessi?)'];
        }
        if (!@rename($path_tmp, $path_finale)) {
            @unlink($path_tmp);
            return ['ok' => false, 'errore' => 'rename atomico fallito'];
        }

        return ['ok' => true, 'path' => $path_finale, 'ext' => $ext,
                'byte' => strlen($corpo), 'errore' => ''];
    }

    return ['ok' => false, 'errore' => 'troppi redirect consecutivi'];
}

/**
 * Percorso della copertina per un video, coerente con asset_paths.py e con
 * admin_modules/assets.php.
 *
 * ⚠️ Il suffisso della cartella si ricava dal BASENAME DELLA CARTELLA SU DISCO
 * (sanificata con underscore dal watcher), NON da Categorie.Nome (che ha gli
 * spazi): altrimenti si creano due cartelle diverse e gli asset diventano orfani.
 *
 * Ritorna ['dir_rel' => string, 'stem' => string].
 */
function coverPercorsoCopertina($percorso_file)
{
    $dir_rel = trim(dirname($percorso_file), './\\');
    if ($dir_rel === '.') $dir_rel = '';
    $nome_cartella = $dir_rel !== '' ? basename($dir_rel) : 'Generale';
    $cartella_copertine = 'copertine_' . $nome_cartella;
    $dir_finale = $dir_rel !== '' ? $dir_rel . '/' . $cartella_copertine : $cartella_copertine;

    return [
        'dir_rel' => $dir_finale,
        'stem' => pathinfo($percorso_file, PATHINFO_FILENAME),
    ];
}

/**
 * True se la colonna esiste nel DB corrente. Risultato memorizzato per richiesta.
 *
 * PERCHE' SERVE:
 * 02_migrations.sql gira SOLO su volume MariaDB vergine; sui DB gia' esistenti
 * le colonne nuove le aggiunge worker_covers._ensure_schema all'avvio del
 * worker. Durante un aggiornamento c'e' quindi una finestra in cui PHP e' gia'
 * nuovo ma il worker non ha ancora migrato. Invece di far fallire l'azione
 * dell'admin con un errore SQL, degradiamo: la funzionalita' legata alla
 * colonna si attiva da sola appena la migrazione e' passata.
 *
 * Per non avere mai questa finestra: `scripts/aggiorna.sh` prima del restart.
 */
function coverColonnaEsiste($tabella, $colonna)
{
    static $cache = [];
    $chiave = "$tabella.$colonna";
    if (isset($cache[$chiave])) {
        return $cache[$chiave];
    }

    $res = executePreparedQuery(
        "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
        "ss", [$tabella, $colonna]
    );
    $row = $res ? $res->fetch_assoc() : null;
    $cache[$chiave] = ($row && (int) $row['n'] > 0);
    return $cache[$chiave];
}

/**
 * Frammento SQL che azzera il backoff, o stringa vuota se la colonna non c'e'
 * ancora. Da concatenare dentro un SET / ON DUPLICATE KEY UPDATE.
 *
 * Un riaccodamento manuale deve partire SUBITO: se l'admin clicca, deve
 * succedere adesso, senza scontare il backoff di un tentativo automatico
 * fallito in precedenza.
 */
function coverResetBackoffSql($prefisso = ', ')
{
    return coverColonnaEsiste('Metadati_Online', 'prossimo_tentativo_at')
        ? $prefisso . 'prossimo_tentativo_at = NULL'
        : '';
}

/** Legge una singola impostazione con default. */
function coverImpostazione($chiave, $default = '')
{
    $res = executePreparedQuery(
        "SELECT Valore_Impostazione AS v FROM Impostazioni WHERE Chiave_Impostazione = ? LIMIT 1",
        "s", [$chiave]
    );
    $row = $res ? $res->fetch_assoc() : null;
    if ($row === null || $row['v'] === null) return $default;
    return $row['v'];
}
?>
