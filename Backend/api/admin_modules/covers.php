<?php
/**
 * ============================================================================
 * Backend/api/admin_modules/covers.php
 * ============================================================================
 *
 * SCOPO:
 * Gestione della ricerca copertine su database esterni (oggi ThePornDB).
 * Speculare a admin_modules/subtitles.php: la coda vive su DB (Metadati_Online)
 * e worker_covers.py la consuma in background; qui stanno la configurazione e
 * le azioni SINCRONE dell'admin.
 *
 * AZIONI SUPPORTATE:
 * - copertine_impostazioni       : legge la configurazione (token MASCHERATO)
 * - salva_copertine_impostazioni : salva la configurazione
 * - salva_token_provider         : salva/cancella il token API
 * - test_provider                : chiamata di prova (diagnostica)
 * - cerca_copertina_online       : ricerca live per il modale di un video
 * - applica_copertina_online     : scarica e imposta subito una copertina
 * - accoda_copertina_online      : accoda job (singolo / categoria / massa)
 * - stato_copertine              : lista video + stato, per la pagina admin
 * - coda_copertine               : solo i job non conclusi
 * - conferma_copertina           : applica un candidato salvato dal worker
 * - ignora_copertina             : esclude un video dalla ricerca online
 * - ripristina_copertina_ffmpeg  : undo -> torna al frame generato da ffmpeg
 * - proxy_immagine_online        : proxy per le miniature nella UI admin
 *
 * SICUREZZA:
 * - ereditata da admin.php (check_admin.php)
 * - il TOKEN non viene MAI restituito al frontend, solo mascherato
 * - ogni URL esterno passa dalla guardia SSRF di cover_provider.php
 * - ogni path passa da safeJoinPath()
 * ============================================================================
 */

if (!defined('ADMIN_API'))
    exit('Nessun accesso diretto consentito.');

require_once __DIR__ . '/../path_safety.php';
require_once __DIR__ . '/../cover_provider.php';

/** Chiavi configurabili + validatore. Nessun'altra chiave viene accettata. */
function coverChiaviAmmesse()
{
    return [
        'copertine_online_abilitato'        => 'bool',
        'copertine_online_provider'         => 'provider',
        'copertine_online_modalita'         => 'modalita',
        'copertine_online_ambito'           => 'ambito',
        'copertine_online_sovrascrivi'      => 'bool',
        'copertine_online_soglia_auto'      => 'percentuale',
        'copertine_online_conferma_sempre'  => 'bool',
        'copertine_online_categorie'        => 'json_ids',
        'copertine_online_finestra'         => 'finestra',
        'copertine_online_max_giorno'       => 'intero',
        'copertine_online_pausa_richieste'  => 'intero',
        'copertine_online_max_tentativi'    => 'intero',
        'copertine_online_priorita_ffmpeg'  => 'bool',
        'copertine_online_attesa_max'       => 'intero',
    ];
}

/**
 * Valida un valore secondo il tipo dichiarato. Lancia Exception se non valido:
 * meglio un errore esplicito che una configurazione sporca che il worker poi
 * interpreta a modo suo.
 */
function coverValidaValore($chiave, $tipo, $valore)
{
    switch ($tipo) {
        case 'bool':
            return in_array((string) $valore, ['1', 'true', 'on', 'yes'], true) ? '1' : '0';

        case 'provider':
            $v = strtolower(trim((string) $valore));
            if (!in_array($v, ['tpdb'], true)) {
                throw new Exception("Provider non supportato: $v");
            }
            return $v;

        case 'modalita':
            $v = strtolower(trim((string) $valore));
            if (!in_array($v, ['manuale', 'automatico'], true)) {
                throw new Exception("Modalita non valida: $v");
            }
            return $v;

        case 'ambito':
            $v = strtolower(trim((string) $valore));
            if (!in_array($v, ['senza_copertina', 'solo_nuovi', 'tutti'], true)) {
                throw new Exception("Ambito non valido: $v");
            }
            return $v;

        case 'percentuale':
            $n = (int) $valore;
            if ($n < 0) $n = 0;
            if ($n > 100) $n = 100;
            return (string) $n;

        case 'intero':
            $n = (int) $valore;
            if ($n < 0) $n = 0;
            if ($n > 100000) $n = 100000;
            return (string) $n;

        case 'json_ids':
            // Accetta sia array (da JSON body) sia stringa JSON.
            $lista = is_array($valore) ? $valore : json_decode((string) $valore, true);
            if (!is_array($lista)) $lista = [];
            $puliti = [];
            foreach ($lista as $id) {
                $n = (int) $id;
                if ($n > 0) $puliti[] = $n;
            }
            return json_encode(array_values(array_unique($puliti)));

        case 'finestra':
            $v = trim((string) $valore);
            if ($v === '') return '';
            if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/', $v)) {
                throw new Exception("Finestra oraria non valida (formato atteso HH:MM-HH:MM): $v");
            }
            return $v;
    }
    throw new Exception("Tipo di impostazione sconosciuto: $tipo");
}

function coverSalvaImpostazione($chiave, $valore)
{
    executePreparedQuery(
        "INSERT INTO Impostazioni (Chiave_Impostazione, Valore_Impostazione)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE Valore_Impostazione = ?",
        "sss", [$chiave, $valore, $valore]
    );
}

/** Invalidazione mirata: mai flush() globale (distruggerebbe rate limit e sessioni). */
function coverInvalidaCache()
{
    global $Cache;
    if (isset($Cache) && is_object($Cache)) {
        $Cache->deletePattern('videos_list_*');
        $Cache->delete('categorie_list_v1');
        $Cache->delete('impostazioni_globali');
    }
}

/** Maschera il token: l'admin deve poter verificare "quale" token c'e', non leggerlo. */
function coverMascheraToken($token)
{
    $t = (string) $token;
    if ($t === '') return '';
    if (strlen($t) <= 4) return str_repeat('•', strlen($t));
    return str_repeat('•', 8) . substr($t, -4);
}

/** Durata "HH:MM" -> secondi, per lo scoring. */
function coverDurataInSecondi($durata)
{
    if (!$durata || strpos((string) $durata, ':') === false) return null;
    $pezzi = explode(':', (string) $durata);
    if (count($pezzi) < 2) return null;
    return ((int) $pezzi[0]) * 3600 + ((int) $pezzi[1]) * 60;
}

switch ($action) {

    // ------------------------------------------------------------------
    // CONFIGURAZIONE
    // ------------------------------------------------------------------
    case 'copertine_impostazioni':
        $chiavi = array_keys(coverChiaviAmmesse());
        $segnaposti = implode(',', array_fill(0, count($chiavi), '?'));
        $tipi = str_repeat('s', count($chiavi));

        $res = executePreparedQuery(
            "SELECT Chiave_Impostazione AS k, Valore_Impostazione AS v
             FROM Impostazioni WHERE Chiave_Impostazione IN ($segnaposti)",
            $tipi, $chiavi
        );

        // Default allineati a 02_migrations.sql e a worker_covers.DEFAULT_SETTINGS.
        $dati = [
            'copertine_online_abilitato' => '0',
            'copertine_online_provider' => 'tpdb',
            'copertine_online_modalita' => 'manuale',
            'copertine_online_ambito' => 'senza_copertina',
            'copertine_online_sovrascrivi' => '0',
            'copertine_online_soglia_auto' => '75',
            'copertine_online_conferma_sempre' => '0',
            'copertine_online_categorie' => '[]',
            'copertine_online_finestra' => '',
            'copertine_online_max_giorno' => '200',
            'copertine_online_pausa_richieste' => '2',
            'copertine_online_max_tentativi' => '3',
            'copertine_online_priorita_ffmpeg' => '1',
            'copertine_online_attesa_max' => '30',
        ];
        if ($res) {
            while ($row = $res->fetch_assoc()) {
                if ($row['v'] !== null) $dati[$row['k']] = $row['v'];
            }
        }

        // Il token NON esce mai in chiaro (retrocompatibilita' schema singolo).
        $token = coverImpostazione('tpdb_api_token', '');
        $dati['token_configurato'] = ($token !== '');
        $dati['token_masked'] = coverMascheraToken($token);

        // --- Elenco dei database online configurabili ---
        // Il catalogo vive in cover_provider.php; qui aggiungiamo lo stato
        // salvato. I token escono SOLO mascherati.
        $catalogo = coverCatalogoProvider();
        $providers = [];
        foreach (coverOrdineProvider() as $id) {
            $meta = $catalogo[$id];
            $tok = coverImpostazione(coverChiaveToken($id), '');
            if ($id === 'tpdb' && $tok === '') $tok = $token;   // migrazione dolce
            $providers[] = array_merge($meta, [
                'attivo' => coverImpostazione(coverChiaveAttivo($id), '0') === '1',
                'token_configurato' => $tok !== '',
                'token_masked' => coverMascheraToken($tok),
                'utilizzabile' => !($meta['token_obbligatorio'] && $tok === ''),
            ]);
        }
        $dati['providers'] = $providers;

        inviaRisposta(true, 'Impostazioni copertine caricate', 200, ['dati' => $dati]);
        break;

    // ------------------------------------------------------------------
    // CONFIGURAZIONE DI UN SINGOLO PROVIDER (attivazione / token / ordine)
    // ------------------------------------------------------------------
    case 'salva_provider':
        $id = trim((string) ($_POST['provider'] ?? ''));
        $catalogo = coverCatalogoProvider();
        if (!isset($catalogo[$id])) {
            throw new Exception("Database online sconosciuto: $id");
        }

        if (array_key_exists('attivo', $_POST)) {
            $val = in_array((string) $_POST['attivo'], ['1', 'true', 'on', 'yes'], true) ? '1' : '0';
            coverSalvaImpostazione(coverChiaveAttivo($id), $val);
        }
        if (array_key_exists('token', $_POST)) {
            $tok = trim((string) $_POST['token']);
            if (strlen($tok) > 255) throw new Exception("Token troppo lungo (max 255 caratteri)");
            coverSalvaImpostazione(coverChiaveToken($id), $tok);
            // Manteniamo allineata la vecchia chiave: il worker di installazioni
            // non ancora aggiornate continua a leggere quella.
            if ($id === 'tpdb') coverSalvaImpostazione('tpdb_api_token', $tok);
        }

        coverInvalidaCache();
        inviaRisposta(true, 'Database aggiornato');
        break;

    case 'salva_ordine_provider':
        $ordine = $_POST['ordine'] ?? [];
        if (!is_array($ordine)) $ordine = json_decode((string) $ordine, true) ?: [];
        $catalogo = coverCatalogoProvider();
        $puliti = [];
        foreach ($ordine as $id) {
            if (isset($catalogo[$id]) && !in_array($id, $puliti, true)) $puliti[] = $id;
        }
        if (empty($puliti)) throw new Exception("Ordine non valido");
        coverSalvaImpostazione('copertine_provider_ordine', json_encode($puliti));
        coverInvalidaCache();
        inviaRisposta(true, 'Priorità aggiornata', 200, ['ordine' => $puliti]);
        break;

    case 'salva_copertine_impostazioni':
        $ammesse = coverChiaviAmmesse();
        $salvate = 0;
        foreach ($ammesse as $chiave => $tipo) {
            if (!array_key_exists($chiave, $_POST)) continue;
            $valore = coverValidaValore($chiave, $tipo, $_POST[$chiave]);
            coverSalvaImpostazione($chiave, $valore);
            $salvate++;
        }
        if ($salvate === 0) {
            inviaRisposta(false, 'Nessuna impostazione valida da salvare', 400);
        }
        coverInvalidaCache();
        inviaRisposta(true, "Impostazioni salvate ($salvate voci)", 200, ['salvate' => $salvate]);
        break;

    case 'salva_token_provider':
        // Stringa vuota = cancella il token. Il valore non viene mai rimandato indietro.
        $token = trim((string) ($_POST['token'] ?? ''));
        if (strlen($token) > 255) {
            throw new Exception("Token troppo lungo (max 255 caratteri)");
        }
        coverSalvaImpostazione('tpdb_api_token', $token);
        coverInvalidaCache();
        inviaRisposta(true, $token === '' ? 'Token rimosso' : 'Token salvato', 200, [
            'token_configurato' => $token !== '',
            'token_masked' => coverMascheraToken($token),
        ]);
        break;

    case 'test_provider':
        // Il master switch e' una garanzia forte del modulo ("a modulo spento
        // NESSUNA chiamata di rete viene mai effettuata"): vale anche per la
        // diagnostica, altrimenti non e' una garanzia. Coerente con
        // cerca_copertina_online, che gia' lo controlla.
        if (coverImpostazione('copertine_online_abilitato', '0') !== '1') {
            inviaRisposta(true, 'Test non eseguito', 200, [
                'dati' => [
                    'ok' => false,
                    'messaggio' => "Il modulo copertine online e' disattivato: "
                                 . "attivalo qui sopra per poter testare la connessione.",
                    'latenza_ms' => 0,
                ],
            ]);
        }

        // Prova di connessione su UN provider specifico (default: TPDB, per
        // compatibilita' con le chiamate precedenti al multi-provider).
        $id = trim((string) ($_POST['provider'] ?? 'tpdb'));
        $catalogo = coverCatalogoProvider();
        if (!isset($catalogo[$id])) throw new Exception("Database online sconosciuto: $id");

        $token = coverImpostazione(coverChiaveToken($id), '');
        if ($id === 'tpdb' && $token === '') $token = coverImpostazione('tpdb_api_token', '');

        $inizio = microtime(true);
        if ($id === 'youtube') {
            // Senza chiave il provider e' comunque utile: copre tutti i file
            // che hanno l'ID nel nome, a costo zero. Non e' un errore.
            if ($token === '') {
                inviaRisposta(true, 'Test completato', 200, [
                    'dati' => [
                        'provider' => $id,
                        'ok' => true,
                        'messaggio' => "Nessuna chiave configurata: funzionano solo i video con "
                            . "l'ID nel nome del file, gratuitamente. Per la ricerca per titolo "
                            . "serve una chiave API.",
                        'latenza_ms' => 0,
                    ],
                ]);
            }
            $res = coverApiGetYoutube('/search', [
                'part' => 'snippet', 'type' => 'video', 'q' => 'test', 'maxResults' => 1,
            ], $token);
            $n = count($res['dati']['items'] ?? []);
            $ok_msg = "Connessione riuscita ($n risultato di prova). Ogni ricerca per titolo "
                . "costa 100 unità sulle 10.000 giornaliere: circa 100 ricerche al giorno.";
        } elseif ($id === 'tmdb') {
            $res = coverApiGetTmdb('/search/movie', ['query' => 'matrix'], $token);
            $conteggio = $res['dati']['total_results'] ?? '?';
            $ok_msg = "Connessione riuscita ($conteggio risultati sulla query di prova)";
        } else {
            $res = coverApiGet('/scenes', ['q' => 'test', 'limit' => 1], $token);
            $conteggio = $res['dati']['meta']['total'] ?? '?';
            $ok_msg = $token !== ''
                ? "Connessione riuscita con token attivo ($conteggio scene indicizzate)"
                : "Connessione riuscita SENZA token: la ricerca funziona, ma il dettaglio richiede il token";
        }
        $latenza = (int) round((microtime(true) - $inizio) * 1000);

        inviaRisposta(true, 'Test completato', 200, [
            'dati' => [
                'provider' => $id,
                'ok' => (bool) $res['ok'],
                'messaggio' => $res['ok'] ? $ok_msg : $res['errore'],
                'latenza_ms' => $latenza,
            ],
        ]);
        break;

    // ------------------------------------------------------------------
    // RICERCA LIVE (modale del singolo video)
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // DATABASE DISPONIBILI PER LA RICERCA
    // Serve al modale del singolo video: l'admin sceglie DOVE cercare prima
    // di spendere una richiesta. Con YouTube a 100 unità per ricerca,
    // interrogare tutti i database per un video che viene da uno solo è uno
    // spreco misurabile.
    // ------------------------------------------------------------------
    case 'provider_per_ricerca':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        $percorso = '';
        if ($id_video > 0) {
            $resV = executePreparedQuery("SELECT percorso_file FROM Video WHERE id = ?", "i", [$id_video]);
            $rowV = $resV ? $resV->fetch_assoc() : null;
            $percorso = $rowV['percorso_file'] ?? '';
        }

        $catalogo = coverCatalogoProvider();
        $lista = [];
        foreach (coverProviderAttivi() as $p) {
            $meta = $catalogo[$p['id']];
            $voce = [
                'id' => $p['id'],
                'etichetta' => $meta['etichetta'],
                'contenuti' => $meta['contenuti'],
                'costo' => $meta['costo_ricerca'] ?? 'Nessun costo noto',
                'gratis' => true,
                // Chiave dell'icona: la UI la mappa su un componente lucide.
                // Si usano icone generiche, non loghi dei marchi: distinguono
                // visivamente senza ridistribuire asset di terzi.
                'icona' => $meta['icona'] ?? 'database',
            ];
            // YouTube: se il nome file contiene un ID VALIDO, la ricerca non
            // passa dalla Data API e non consuma quota.
            //
            // ⚠️ Non basta che l'estrazione trovi qualcosa: coverYoutubeIdDaNome()
            // è deliberatamente permissiva e su un nome lungo restituisce gli
            // ultimi 11 caratteri come candidato. Bisogna VERIFICARE che la
            // miniatura esista davvero (una HEAD a i.ytimg.com, niente quota),
            // altrimenti si promette "gratis" per un video qualunque e poi la
            // ricerca consuma 100 unità a sorpresa.
            if ($p['id'] === 'youtube') {
                $voce['gratis'] = false;
                $vid = $percorso !== '' ? coverYoutubeIdDaNome(basename($percorso)) : null;
                if ($vid && coverYoutubeMiglioreMiniatura($vid)) {
                    $voce['gratis'] = true;
                    $voce['costo'] = 'Gratis: questo video ha già il suo ID nel nome del file';
                }
            }
            $lista[] = $voce;
        }

        inviaRisposta(true, 'Database disponibili', 200, ['dati' => $lista]);
        break;

    case 'cerca_copertina_online':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        if ($id_video <= 0) throw new Exception("ID Video non valido");

        if (coverImpostazione('copertine_online_abilitato', '0') !== '1') {
            inviaRisposta(false, "La ricerca copertine online e' disattivata. Attivala in Admin > Copertine.", 400);
        }

        $res = executePreparedQuery(
            "SELECT id, percorso_file, Titolo, Durata FROM Video WHERE id = ?",
            "i", [$id_video]
        );
        $video = $res ? $res->fetch_assoc() : null;
        if (!$video) inviaRisposta(false, "Video non trovato", 404);

        $query_manuale = trim((string) ($_POST['query'] ?? ''));
        // Database scelto dall'admin nel modale. Vuoto o 'tutti' = interroga
        // tutti gli attivi (comportamento precedente, ancora disponibile).
        $solo_provider = trim((string) ($_POST['provider'] ?? ''));

        if ($solo_provider !== '' && $solo_provider !== 'tutti') {
            $catalogo = coverCatalogoProvider();
            if (!isset($catalogo[$solo_provider])) {
                throw new Exception("Database online sconosciuto: $solo_provider");
            }
            // Il token si prende dalla configurazione, mai dal client.
            $token = coverImpostazione(coverChiaveToken($solo_provider), '');
            if ($solo_provider === 'tpdb' && $token === '') {
                $token = coverImpostazione('tpdb_api_token', '');
            }
            $esito = coverCercaCandidati(
                $video['percorso_file'],
                $video['Titolo'],
                coverDurataInSecondi($video['Durata']),
                $token,
                12,
                101,                  // niente stop anticipato in ricerca manuale
                $query_manuale !== '' ? $query_manuale : null,
                $solo_provider
            );
            // Marca la provenienza, così la UI può mostrarla sui risultati.
            foreach ($esito['candidati'] as &$c) { $c['provider'] = $solo_provider; }
            unset($c);
        } else {
            $esito = coverCercaMulti(
                $video['percorso_file'],
                $video['Titolo'],
                coverDurataInSecondi($video['Durata']),
                12,
                101,
                $query_manuale !== '' ? $query_manuale : null
            );
        }

        if (!$esito['ok']) {
            inviaRisposta(false, "Ricerca fallita: " . $esito['errore'], 502);
        }

        inviaRisposta(true, count($esito['candidati']) . ' risultati', 200, [
            'dati' => $esito['candidati'],
            'query' => $esito['query']['nome'],
            'query_dettaglio' => [
                'site' => $esito['query']['site'],
                'data' => $esito['query']['data'],
                'nome' => $esito['query']['nome'],
            ],
        ]);
        break;

    // ------------------------------------------------------------------
    // APPLICA UNA COPERTINA (download immediato)
    // ------------------------------------------------------------------
    case 'applica_copertina_online':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        $url = trim((string) ($_POST['url_immagine'] ?? ''));
        if ($id_video <= 0) throw new Exception("ID Video non valido");
        if ($url === '') throw new Exception("URL immagine mancante");

        $res = executePreparedQuery(
            "SELECT id, percorso_file, percorso_copertina FROM Video WHERE id = ?",
            "i", [$id_video]
        );
        $video = $res ? $res->fetch_assoc() : null;
        if (!$video) inviaRisposta(false, "Video non trovato", 404);

        global $BASE_VIDEO_PATH;
        $percorsi = coverPercorsoCopertina($video['percorso_file']);
        $target_dir = safeJoinPath($BASE_VIDEO_PATH, ltrim($percorsi['dir_rel'], '/\\'));
        if ($target_dir === null) {
            error_log("🚨 [SECURITY] Path traversal in applica_copertina_online: " . $percorsi['dir_rel']);
            throw new Exception("Percorso copertina non valido");
        }

        $esito = coverScaricaImmagine($url, $target_dir . DIRECTORY_SEPARATOR . $percorsi['stem']);
        if (!$esito['ok']) {
            inviaRisposta(false, "Download fallito: " . $esito['errore'], 502);
        }

        $db_path = $percorsi['dir_rel'] . '/' . $percorsi['stem'] . '.' . $esito['ext'];

        // Rimuovi la copertina precedente se aveva un'altra estensione: senza
        // questo resterebbe su disco finche' il watcher non la vede orfana.
        $vecchia = $video['percorso_copertina'];
        if ($vecchia && $vecchia !== 'mancante' && $vecchia !== $db_path) {
            $vecchio_full = safeJoinPath($BASE_VIDEO_PATH, ltrim($vecchia, '/\\'));
            if ($vecchio_full !== null && file_exists($vecchio_full)) {
                @unlink($vecchio_full);
            }
        }

        // Se il DB non recepisce, l'immagine appena scritta e' orfana: il
        // watcher la cancellerebbe dopo un'ora e l'admin non saprebbe perche'.
        // Rimuoviamola subito e segnaliamo l'errore, come fa gia'
        // worker_covers.applica_candidato sul suo ramo di rollback.
        $ok_update = executePreparedQuery(
            "UPDATE Video SET percorso_copertina = ?, copertina_origine = 'online' WHERE id = ?",
            "si", [$db_path, $id_video]
        );
        if ($ok_update === false) {
            @unlink($esito['path']);
            inviaRisposta(false, "Copertina scaricata ma non registrata: errore del database.", 500);
        }

        // Registra l'esito anche nella coda, cosi' la pagina Copertine e il
        // worker sanno che questo video e' stato risolto a mano.
        executePreparedQuery(
            "INSERT INTO Metadati_Online (id_Video, provider, stato, origine_job, match_id,
                                          match_titolo, match_sito, match_data, match_score,
                                          url_immagine, applicato_at, locked_at, errore_msg)
             VALUES (?, 'tpdb', 'applicato', 'manuale', ?, ?, ?, ?, ?, ?, NOW(), NULL, NULL)
             ON DUPLICATE KEY UPDATE
                stato = 'applicato', origine_job = 'manuale', match_id = VALUES(match_id),
                match_titolo = VALUES(match_titolo), match_sito = VALUES(match_sito),
                match_data = VALUES(match_data), match_score = VALUES(match_score),
                url_immagine = VALUES(url_immagine), applicato_at = NOW(),
                locked_at = NULL, errore_msg = NULL, tentativi = 0",
            "issssis", [
                $id_video,
                (string) ($_POST['match_id'] ?? ''),
                (string) ($_POST['match_titolo'] ?? ''),
                (string) ($_POST['match_sito'] ?? ''),
                (($_POST['match_data'] ?? '') !== '' ? (string) $_POST['match_data'] : null),
                (int) ($_POST['match_score'] ?? 100),
                $url,
            ]
        );

        coverInvalidaCache();
        inviaRisposta(true, 'Copertina scaricata e applicata', 200, [
            'nuovo_path' => $db_path,
            'byte' => $esito['byte'],
            'formato' => $esito['ext'],
        ]);
        break;

    // ------------------------------------------------------------------
    // CONFERMA DI UN CANDIDATO PROPOSTO DAL WORKER
    // ------------------------------------------------------------------
    case 'conferma_copertina':
        $id_meta = (int) ($_POST['id_meta'] ?? 0);
        $indice = (int) ($_POST['indice_candidato'] ?? 0);
        if ($id_meta <= 0) throw new Exception("ID job non valido");

        $res = executePreparedQuery(
            "SELECT m.id, m.id_Video, m.candidati_json, v.percorso_file, v.percorso_copertina
             FROM Metadati_Online m JOIN Video v ON v.id = m.id_Video WHERE m.id = ?",
            "i", [$id_meta]
        );
        $riga = $res ? $res->fetch_assoc() : null;
        if (!$riga) inviaRisposta(false, "Job non trovato", 404);

        $candidati = json_decode($riga['candidati_json'] ?? '[]', true);
        if (!is_array($candidati) || !isset($candidati[$indice])) {
            inviaRisposta(false, "Candidato non disponibile: rilancia la ricerca", 400);
        }
        $scelto = $candidati[$indice];
        if (empty($scelto['image_url'])) {
            inviaRisposta(false, "Il candidato selezionato non ha un'immagine", 400);
        }

        global $BASE_VIDEO_PATH;
        $percorsi = coverPercorsoCopertina($riga['percorso_file']);
        $target_dir = safeJoinPath($BASE_VIDEO_PATH, ltrim($percorsi['dir_rel'], '/\\'));
        if ($target_dir === null) {
            error_log("🚨 [SECURITY] Path traversal in conferma_copertina: " . $percorsi['dir_rel']);
            throw new Exception("Percorso copertina non valido");
        }

        $esito = coverScaricaImmagine($scelto['image_url'],
                                      $target_dir . DIRECTORY_SEPARATOR . $percorsi['stem']);
        if (!$esito['ok']) {
            inviaRisposta(false, "Download fallito: " . $esito['errore'], 502);
        }

        $db_path = $percorsi['dir_rel'] . '/' . $percorsi['stem'] . '.' . $esito['ext'];
        $vecchia = $riga['percorso_copertina'];
        if ($vecchia && $vecchia !== 'mancante' && $vecchia !== $db_path) {
            $vecchio_full = safeJoinPath($BASE_VIDEO_PATH, ltrim($vecchia, '/\\'));
            if ($vecchio_full !== null && file_exists($vecchio_full)) @unlink($vecchio_full);
        }

        $ok_update = executePreparedQuery(
            "UPDATE Video SET percorso_copertina = ?, copertina_origine = 'online' WHERE id = ?",
            "si", [$db_path, $riga['id_Video']]
        );
        if ($ok_update === false) {
            @unlink($esito['path']);
            inviaRisposta(false, "Copertina scaricata ma non registrata: errore del database.", 500);
        }

        executePreparedQuery(
            "UPDATE Metadati_Online SET stato = 'applicato', match_id = ?, match_titolo = ?,
                    match_sito = ?, match_data = ?, match_score = ?, url_immagine = ?,
                    applicato_at = NOW(), locked_at = NULL, errore_msg = NULL, tentativi = 0
             WHERE id = ?",
            "ssssisi", [
                (string) ($scelto['id'] ?? ''),
                (string) ($scelto['title'] ?? ''),
                (string) ($scelto['site'] ?? ''),
                (($scelto['date'] ?? '') !== '' ? $scelto['date'] : null),
                (int) ($scelto['score'] ?? 0),
                (string) $scelto['image_url'],
                $id_meta,
            ]
        );

        coverInvalidaCache();
        inviaRisposta(true, 'Copertina confermata e applicata', 200, ['nuovo_path' => $db_path]);
        break;

    // ------------------------------------------------------------------
    // ACCODA JOB (singolo video, categoria, o massa)
    // ------------------------------------------------------------------
    case 'accoda_copertina_online':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        $id_categoria = (int) ($_POST['id_categoria'] ?? 0);
        $filtro = (string) ($_POST['filtro'] ?? '');
        $provider = coverImpostazione('copertine_online_provider', 'tpdb');

        // Un riaccodamento manuale deve ripartire subito, senza scontare il
        // backoff lasciato da un tentativo automatico fallito.
        $reset_backoff = coverResetBackoffSql();

        // aggiornato_at ESPLICITO, non affidato a ON UPDATE CURRENT_TIMESTAMP:
        // MariaDB salta del tutto l'UPDATE quando i valori nuovi coincidono con
        // quelli vecchi (riaccodare un job gia' 'in_coda' con tentativi=0 non
        // cambia nulla), e in quel caso la colonna resterebbe al timestamp
        // vecchio. worker_assets misura su di essa la finestra di attesa
        // dell'online: senza questo, riaccodare non riarmerebbe il gate.
        $tocca_timestamp = ", aggiornato_at = NOW()";

        if ($id_video > 0) {
            executePreparedQuery(
                "INSERT INTO Metadati_Online (id_Video, provider, stato, origine_job)
                 VALUES (?, ?, 'in_coda', 'manuale')
                 ON DUPLICATE KEY UPDATE stato = 'in_coda', origine_job = 'manuale',
                                         errore_msg = NULL, locked_at = NULL, tentativi = 0"
                 . $reset_backoff . $tocca_timestamp,
                "is", [$id_video, $provider]
            );
            inviaRisposta(true, 'Video accodato per la ricerca copertina', 200, ['accodati' => 1]);
        }

        // --- Bulk ---
        $condizioni = ["(v.copertina_origine IS NULL OR v.copertina_origine <> 'manuale')"];
        $parametri = [];
        $tipi = "";

        if ($id_categoria > 0) {
            $condizioni[] = "v.id_Categoria = ?";
            $parametri[] = $id_categoria;
            $tipi .= "i";
        }
        if ($filtro === 'senza_copertina') {
            $condizioni[] = "(v.percorso_copertina IS NULL OR v.percorso_copertina = 'mancante')";
        }
        $where = implode(' AND ', $condizioni);

        // Conteggio REALE prima dell'INSERT. Non si puo' usare affected_rows:
        // con ON DUPLICATE KEY UPDATE MySQL conta 2 per ogni riga aggiornata,
        // e 0 se i valori non cambiano. Verificato: riaccodando 2 video il
        // messaggio diceva "Accodati 0 video".
        $res_count = executePreparedQuery(
            "SELECT COUNT(*) AS n FROM Video v WHERE $where", $tipi, $parametri
        );
        $row_count = $res_count ? $res_count->fetch_assoc() : null;
        $accodati = $row_count ? (int) $row_count['n'] : 0;

        $sql = "INSERT INTO Metadati_Online (id_Video, provider, stato, origine_job)
                SELECT v.id, ?, 'in_coda', 'manuale' FROM Video v
                WHERE $where
                ON DUPLICATE KEY UPDATE stato = 'in_coda', origine_job = 'manuale',
                                        errore_msg = NULL, locked_at = NULL, tentativi = 0"
                . $reset_backoff . $tocca_timestamp;

        // Il provider e' il primo placeholder (sta nella SELECT, prima del WHERE).
        executePreparedQuery($sql, "s" . $tipi, array_merge([$provider], $parametri));

        inviaRisposta(true, "Accodati $accodati video", 200, ['accodati' => $accodati]);
        break;

    case 'ignora_copertina':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        if ($id_video <= 0) throw new Exception("ID Video non valido");
        $provider = coverImpostazione('copertine_online_provider', 'tpdb');

        executePreparedQuery(
            "INSERT INTO Metadati_Online (id_Video, provider, stato, origine_job, errore_msg)
             VALUES (?, ?, 'ignorato', 'manuale', 'escluso manualmente dall_admin')
             ON DUPLICATE KEY UPDATE stato = 'ignorato', locked_at = NULL,
                                     errore_msg = 'escluso manualmente dall_admin'",
            "is", [$id_video, $provider]
        );
        inviaRisposta(true, 'Video escluso dalla ricerca copertine online');
        break;

    // ------------------------------------------------------------------
    // UNDO: torna al frame ffmpeg
    // ------------------------------------------------------------------
    case 'ripristina_copertina_ffmpeg':
        $id_video = (int) ($_POST['id_video'] ?? 0);
        if ($id_video <= 0) throw new Exception("ID Video non valido");

        $res = executePreparedQuery(
            "SELECT percorso_copertina FROM Video WHERE id = ?", "i", [$id_video]
        );
        $video = $res ? $res->fetch_assoc() : null;
        if (!$video) inviaRisposta(false, "Video non trovato", 404);

        global $BASE_VIDEO_PATH;
        if ($video['percorso_copertina'] && $video['percorso_copertina'] !== 'mancante') {
            $full = safeJoinPath($BASE_VIDEO_PATH, ltrim($video['percorso_copertina'], '/\\'));
            if ($full === null) {
                error_log("🚨 [SECURITY] Path traversal in ripristina_copertina_ffmpeg: " . $video['percorso_copertina']);
            } elseif (file_exists($full)) {
                @unlink($full);
            }
        }

        // percorso_copertina = NULL -> worker_assets rigenera il frame al giro dopo.
        executePreparedQuery(
            "UPDATE Video SET percorso_copertina = NULL, copertina_origine = NULL WHERE id = ?",
            "i", [$id_video]
        );
        // Il job resta come storico ma non deve riapplicare la copertina online.
        executePreparedQuery(
            // Filtrato per provider: la tabella e' UNIQUE(id_Video, provider) e
            // ora i provider sono piu' di uno, quindi senza filtro spegneremmo
            // anche i job di database online che l'admin non ha toccato.
            "UPDATE Metadati_Online SET stato = 'ignorato', locked_at = NULL,
                    errore_msg = 'ripristinato al frame ffmpeg dall_admin'
             WHERE id_Video = ? AND provider = ?",
            "is", [$id_video, coverImpostazione('copertine_online_provider', 'tpdb')]
        );

        coverInvalidaCache();
        inviaRisposta(true, 'Copertina online rimossa: verra rigenerata da ffmpeg');
        break;

    // ------------------------------------------------------------------
    // LISTE PER LA UI
    // ------------------------------------------------------------------
    case 'stato_copertine':
        $limit  = (int) ($_POST['limit'] ?? 30);
        $offset = (int) ($_POST['offset'] ?? 0);
        if ($limit < 1)   $limit = 1;
        if ($limit > 100) $limit = 100;
        if ($offset < 0)  $offset = 0;

        $ricerca = trim((string) ($_POST['query'] ?? ''));
        $filtro = (string) ($_POST['filtro'] ?? 'tutti');
        if (!in_array($filtro, ['tutti', 'online', 'ffmpeg', 'senza', 'da_confermare', 'errore'], true)) {
            $filtro = 'tutti';
        }

        $sql = "SELECT v.id, v.Titolo, v.percorso_copertina, v.copertina_origine, v.Durata,
                       c.Nome AS Nome_Categoria, c.id AS id_Categoria,
                       m.id AS id_meta, m.stato, m.match_titolo, m.match_sito, m.match_data,
                       m.match_score, m.url_immagine, m.candidati_json, m.errore_msg,
                       m.tentativi, m.origine_job, m.applicato_at
                FROM Video v
                LEFT JOIN Categorie c ON v.id_Categoria = c.id
                -- Filtro sul provider attivo: la tabella e' UNIQUE(id_Video,
                -- provider), quindi senza questo vincolo ogni video comparirebbe
                -- una volta per ogni database online configurato.
                LEFT JOIN Metadati_Online m ON m.id_Video = v.id AND m.provider = ? ";

        $where = [];
        // Il placeholder del provider sta nella JOIN, quindi PRIMA di ogni
        // parametro del WHERE: deve essere il primo dell'array.
        $parametri = [coverImpostazione('copertine_online_provider', 'tpdb')];
        $tipi = "s";

        if ($ricerca !== '') {
            $where[] = "v.Titolo LIKE ?";
            $parametri[] = "%$ricerca%";
            $tipi .= "s";
        }
        if ($filtro === 'online')            $where[] = "v.copertina_origine = 'online'";
        elseif ($filtro === 'ffmpeg')        $where[] = "v.copertina_origine = 'ffmpeg'";
        elseif ($filtro === 'senza')         $where[] = "(v.percorso_copertina IS NULL OR v.percorso_copertina = 'mancante')";
        elseif ($filtro === 'da_confermare') $where[] = "m.stato = 'da_confermare'";
        elseif ($filtro === 'errore')        $where[] = "m.stato = 'errore'";

        if (!empty($where)) $sql .= "WHERE " . implode(' AND ', $where) . " ";
        $sql .= "ORDER BY v.id DESC LIMIT ? OFFSET ?";
        $parametri[] = $limit;
        $parametri[] = $offset;
        $tipi .= "ii";

        $res = executePreparedQuery($sql, $tipi, $parametri);
        $dati = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];

        inviaRisposta(true, 'Stato copertine caricato', 200, ['dati' => $dati]);
        break;

    case 'coda_copertine':
        $sql = "SELECT m.id AS id_meta, m.id_Video, v.Titolo, v.percorso_copertina,
                       v.copertina_origine, c.Nome AS Nome_Categoria,
                       m.stato, m.origine_job, m.match_titolo, m.match_sito, m.match_data,
                       m.match_score, m.url_immagine, m.candidati_json, m.errore_msg,
                       m.tentativi, m.query_usata, m.creato_at
                FROM Metadati_Online m
                JOIN Video v ON v.id = m.id_Video
                LEFT JOIN Categorie c ON v.id_Categoria = c.id
                WHERE m.stato IN ('in_coda','elaborazione','da_confermare','errore')
                ORDER BY FIELD(m.stato,'elaborazione','da_confermare','in_coda','errore'),
                         (m.origine_job = 'manuale') DESC, m.id ASC
                LIMIT 200";
        $res = executePreparedQuery($sql, "", []);
        $dati = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];

        // Conteggi per i badge della UI.
        $res2 = executePreparedQuery(
            "SELECT stato, COUNT(*) AS n FROM Metadati_Online GROUP BY stato", "", []
        );
        $conteggi = [];
        if ($res2) {
            while ($r = $res2->fetch_assoc()) $conteggi[$r['stato']] = (int) $r['n'];
        }

        inviaRisposta(true, 'Coda copertine', 200, ['dati' => $dati, 'conteggi' => $conteggi]);
        break;

    // ------------------------------------------------------------------
    // PROXY MINIATURE
    // Le anteprime dei candidati stanno su CDN esterni. Le facciamo passare da
    // qui cosi' il browser dell'admin non contatta direttamente il CDN (niente
    // referer, niente richieste cross-origin verso terzi) e la guardia SSRF
    // resta l'unica porta verso l'esterno.
    // ------------------------------------------------------------------
    case 'proxy_immagine_online':
        $url = trim((string) ($_GET['url'] ?? $_POST['url'] ?? ''));
        if ($url === '') {
            http_response_code(400);
            exit;
        }
        list($ok, $motivo) = coverUrlConsentito($url);
        if (!$ok) {
            error_log("🚨 [SECURITY] proxy_immagine_online ha rifiutato $url ($motivo)");
            http_response_code(403);
            exit;
        }

        // I redirect NON si seguono con FOLLOWLOCATION (aggirerebbe la guardia
        // SSRF), ma vanno seguiti a mano rivalidando l'host a ogni hop: i CDN
        // degli studi rispondono spessissimo 301/302, e trattarli come errore
        // lasciava le miniature dei candidati rotte nella UI admin.
        // Stesso schema di coverScaricaImmagine().
        $corrente = $url;
        $corpo = false;
        $http = 0;
        for ($hop = 0; $hop <= 3; $hop++) {
            $ch = curl_init($corrente);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => COVER_HTTP_TIMEOUT,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_USERAGENT => COVER_USER_AGENT,
            ]);
            $corpo = curl_exec($ch);
            $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $redirect = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
            curl_close($ch);

            if ($corpo === false) break;

            if (in_array($http, [301, 302, 303, 307, 308], true)) {
                if (empty($redirect)) { $corpo = false; break; }
                // L'host di destinazione ripassa dalla guardia SSRF: e' cio'
                // che impedisce a un URL esterno di farci raggiungere la rete
                // interna tramite un redirect.
                list($ok_r, $motivo_r) = coverUrlConsentito($redirect);
                if (!$ok_r) {
                    error_log("🚨 [SECURITY] proxy_immagine_online: redirect rifiutato verso $redirect ($motivo_r)");
                    http_response_code(403);
                    exit;
                }
                $corrente = $redirect;
                continue;
            }
            break;
        }

        if ($corpo === false || $http !== 200 || strlen($corpo) > COVER_MAX_IMAGE_BYTES) {
            http_response_code(502);
            exit;
        }
        $ext = coverDeduciEstensione(substr($corpo, 0, 16));
        if ($ext === null) {
            http_response_code(415);
            exit;
        }
        $mime = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'][$ext];

        // Ripuliamo gli header JSON impostati dal bootstrap: qui esce un'immagine.
        header_remove('Content-Type');
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . strlen($corpo));
        header('Cache-Control: private, max-age=300');
        header('X-Content-Type-Options: nosniff');
        echo $corpo;
        exit;
}
?>
