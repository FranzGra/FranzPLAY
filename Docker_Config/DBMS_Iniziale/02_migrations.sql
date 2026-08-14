-- ============================================================================
-- FranzPLAY - Migrazioni idempotenti
-- ============================================================================
-- Vengono eseguite dopo DBMS.sql dal docker-entrypoint-initdb.d.
-- Tutte le ALTER usano IF NOT EXISTS (MariaDB 10.3+) per idempotenza.
-- ============================================================================

-- Lock di processing per i worker Python (concorrenza tra istanze parallele).
ALTER TABLE `Video_Temp` ADD COLUMN IF NOT EXISTS `locked_at` DATETIME NULL;
ALTER TABLE `Video`      ADD COLUMN IF NOT EXISTS `locked_at` DATETIME NULL;

-- Indici di performance per worker_assets (cerca video con asset mancanti).
ALTER TABLE `Video` ADD INDEX IF NOT EXISTS `idx_video_assets_missing` (`percorso_copertina`(20), `percorso_anteprima`(20));

-- (Indice idx_spammers_user_time è già definito in DBMS.sql, non duplichiamo)

-- ----------------------------------------------------------------------------
-- Ottimizzazione video (remux fMP4 faststart): compatibilità cross-device
-- senza transcodifica. Vedi worker_optimizer.py.
--
-- ottimizzato:
--   NULL = mai analizzato (default, worker prende in carico)
--   1    = remux completato, file servito è fMP4 faststart
--   0    = remux non possibile (codec video incompatibile, es. VP9/AV1)
--          → su iOS verrà mostrato un avviso UI.
--
-- codec_video / codec_audio: snapshot del file servito (post-remux se ottimizzato=1).
--
-- cleanup_path / cleanup_at: file originale rinominato in attesa di cancellazione.
--   Failsafe: 24h di grace period dopo il remux prima della rimozione definitiva.
-- ----------------------------------------------------------------------------
ALTER TABLE `Video` ADD COLUMN IF NOT EXISTS `ottimizzato` TINYINT NULL;
ALTER TABLE `Video` ADD COLUMN IF NOT EXISTS `ottimizzato_at` DATETIME NULL;
ALTER TABLE `Video` ADD COLUMN IF NOT EXISTS `codec_video` VARCHAR(32) NULL;
ALTER TABLE `Video` ADD COLUMN IF NOT EXISTS `codec_audio` VARCHAR(32) NULL;
ALTER TABLE `Video` ADD COLUMN IF NOT EXISTS `cleanup_path` VARCHAR(500) NULL;
ALTER TABLE `Video` ADD COLUMN IF NOT EXISTS `cleanup_at` DATETIME NULL;

-- Indice per la query del worker optimizer (trova candidati con ottimizzato IS NULL).
ALTER TABLE `Video` ADD INDEX IF NOT EXISTS `idx_video_ottimizzato` (`ottimizzato`, `locked_at`);

-- Indice per la query di cleanup (trova file scaduti da cancellare).
ALTER TABLE `Video` ADD INDEX IF NOT EXISTS `idx_video_cleanup` (`cleanup_at`);

-- ----------------------------------------------------------------------------
-- Sottotitoli (generazione on-demand via Admin). Vedi worker_subtitles.py.
--
-- Il worker genera sottotitoli SOLO sotto comando esplicito dell'admin (nessuna
-- automazione): l'admin accoda un job dalla pagina Admin > Sottotitoli, scegliendo
-- la lingua parlata nel video (o 'auto' per il rilevamento automatico di Whisper)
-- e una o piu' lingue target. Per ogni lingua richiesta viene creata una riga.
--
-- tipo:
--   'trascrizione' = VTT nella lingua originale (output diretto di faster-whisper)
--   'traduzione'   = VTT tradotto da LibreTranslate a partire dalla trascrizione
--
-- stato:
--   'in_coda'      = accodato dall'admin, in attesa del worker
--   'elaborazione' = il worker lo sta processando
--   'completato'   = VTT pronto in percorso_file
--   'errore'       = generazione fallita (dettaglio in errore_msg)
--
-- lingua_origine: lingua parlata nel video scelta dall'admin ('auto' = rileva).
--   Per le righe 'trascrizione' con 'auto', il worker aggiorna `lingua` con il
--   codice ISO effettivamente rilevato a fine trascrizione.
--
-- percorso_file: path relativo del .vtt (es. "Cat/sottotitoli_Cat/video.en.vtt").
-- locked_at: lock di processing condiviso (claim atomico, stale-release 10 min).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Sottotitoli` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `id_Video` INT NOT NULL,
    `lingua` VARCHAR(8) NOT NULL COMMENT 'Codice ISO lingua target (it/en/es...) o auto in attesa di detection',
    `lingua_origine` VARCHAR(8) NULL COMMENT 'Lingua parlata nel video (codice ISO o "auto")',
    `tipo` ENUM('trascrizione','traduzione') NOT NULL DEFAULT 'trascrizione',
    `percorso_file` VARCHAR(512) NULL COMMENT 'Path relativo del file .vtt generato',
    `stato` ENUM('in_coda','elaborazione','completato','errore') NOT NULL DEFAULT 'in_coda',
    `modello_richiesto` VARCHAR(32) NULL COMMENT 'Modello Whisper scelto dall_admin per questo job (small/medium). NULL = usa default globale',
    `modello_usato` VARCHAR(32) NULL COMMENT 'Modello Whisper effettivamente usato (es. small)',
    `errore_msg` VARCHAR(500) NULL,
    `locked_at` DATETIME NULL,
    `generato_at` DATETIME NULL,
    `creato_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_sottotitoli_video_lingua` (`id_Video`, `lingua`),
    KEY `idx_sottotitoli_stato` (`stato`, `locked_at`),
    KEY `idx_sottotitoli_video` (`id_Video`),
    CONSTRAINT `fk_sottotitoli_video` FOREIGN KEY (`id_Video`)
        REFERENCES `Video`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Sottotitoli generati on-demand (Whisper + traduzione)';

-- Colonna modello_richiesto per i DB pre-esistenti (idempotente, MariaDB 10.3+).
ALTER TABLE `Sottotitoli`
    ADD COLUMN IF NOT EXISTS `modello_richiesto` VARCHAR(32) NULL
    COMMENT 'Modello Whisper scelto dall_admin per questo job (small/medium). NULL = usa default globale'
    AFTER `stato`;

-- Modello Whisper di default per la generazione sottotitoli (configurabile da Admin).
INSERT IGNORE INTO `Impostazioni` (`Chiave_Impostazione`, `Valore_Impostazione`, `Descrizione`) VALUES
('whisper_modello', 'small', 'Modello faster-whisper per i sottotitoli (tiny/base/small/medium)');

-- Abilita/disabilita la registrazione di nuovi account da parte dei guest.
-- '1' = registrazione aperta, '0' = solo l'admin puo' creare utenti.
INSERT IGNORE INTO `Impostazioni` (`Chiave_Impostazione`, `Valore_Impostazione`, `Descrizione`) VALUES
('registrazione_abilitata', '1', 'Se 1 i guest possono registrarsi; se 0 la registrazione e disabilitata');

-- ----------------------------------------------------------------------------
-- COPERTINE ONLINE (ricerca su database esterni). Vedi worker_covers.py.
--
-- Il worker cerca la copertina di un video su un provider esterno (oggi solo
-- ThePornDB) partendo dal nome file/titolo, scarica l'immagine e aggiorna
-- Video.percorso_copertina. NON sostituisce worker_assets: il frame ffmpeg
-- resta il fallback sempre disponibile e sempre rigenerabile.
--
-- stato:
--   'in_coda'       = accodato (auto-discovery o admin), attende il worker
--   'elaborazione'  = worker sta interrogando il provider / scaricando
--   'da_confermare' = candidati trovati ma sotto soglia (o modalita' "proposta"):
--                     NIENTE download, decide l'admin dalla UI
--   'applicato'     = immagine scaricata e Video.percorso_copertina aggiornato
--   'nessun_match'  = il provider non ha restituito nulla di utile
--   'errore'        = fallimento tecnico (rete/429/immagine corrotta), vedi errore_msg
--   'ignorato'      = l'admin ha escluso questo video dalla ricerca online
--
-- provider: predisposizione multi-provider (domani 'tmdb', 'tposterdb').
-- candidati_json: top-N risultati serializzati, per la scelta manuale in UI
--                 senza dover rifare la chiamata al provider.
-- locked_at: lock di processing PROPRIO. NON usare Video.locked_at: quello e'
--            gia' conteso tra worker_assets e worker_optimizer, e le chiamate
--            di rete bloccherebbero la coda ffmpeg.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Metadati_Online` (
    `id`             INT AUTO_INCREMENT PRIMARY KEY,
    `id_Video`       INT NOT NULL,
    `provider`       VARCHAR(16) NOT NULL DEFAULT 'tpdb',
    `stato`          ENUM('in_coda','elaborazione','da_confermare','applicato',
                          'nessun_match','errore','ignorato') NOT NULL DEFAULT 'in_coda',
    `origine_job`    ENUM('auto','manuale') NOT NULL DEFAULT 'auto' COMMENT 'I job manuali hanno priorita in coda',
    `query_usata`    VARCHAR(512) NULL COMMENT 'Stringa effettivamente inviata al provider',
    `match_id`       VARCHAR(64)  NULL COMMENT 'ID della scena sul provider (uuid per TPDB)',
    `match_titolo`   VARCHAR(512) NULL,
    `match_sito`     VARCHAR(128) NULL,
    `match_data`     DATE NULL,
    `match_score`    TINYINT UNSIGNED NULL COMMENT 'Confidenza 0-100 calcolata da noi, non dal provider',
    `url_immagine`   VARCHAR(1024) NULL,
    `candidati_json` TEXT NULL COMMENT 'Top-N candidati per la conferma manuale in UI',
    `errore_msg`     VARCHAR(500) NULL,
    `tentativi`      INT NOT NULL DEFAULT 0,
    `locked_at`      DATETIME NULL,
    `applicato_at`   DATETIME NULL,
    `creato_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `aggiornato_at`  DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_meta_video_provider` (`id_Video`, `provider`),
    KEY `idx_meta_stato` (`stato`, `locked_at`),
    KEY `idx_meta_video` (`id_Video`),
    CONSTRAINT `fk_meta_video` FOREIGN KEY (`id_Video`)
        REFERENCES `Video`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Ricerca copertine/metadati su database esterni';

-- Provenienza della copertina attuale. Serve a NON sovrascrivere mai una
-- copertina caricata a mano dall'admin, e a poter tornare al frame ffmpeg.
ALTER TABLE `Video` ADD COLUMN IF NOT EXISTS `copertina_origine`
    ENUM('ffmpeg','online','manuale') NULL
    COMMENT 'Provenienza di percorso_copertina: frame ffmpeg, download online o upload manuale';

-- Backfill: tutto cio' che esiste oggi viene dal frame ffmpeg o da un upload
-- manuale; non potendo distinguerli a posteriori assumiamo 'ffmpeg', che e'
-- l'ipotesi conservativa SOLO per la rigenerazione (un upload manuale
-- pre-esistente potrebbe essere sovrascritto se l'admin attiva la sovrascrittura;
-- e' documentato nella UI).
UPDATE `Video` SET `copertina_origine` = 'ffmpeg'
 WHERE `copertina_origine` IS NULL
   AND `percorso_copertina` IS NOT NULL
   AND `percorso_copertina` <> 'mancante';

-- Impostazioni del modulo copertine online (tutte con default conservativi:
-- a sistema spento e in modalita' manuale, cosi' l'aggiornamento non cambia
-- il comportamento di un'installazione esistente finche' l'admin non decide).
INSERT IGNORE INTO `Impostazioni` (`Chiave_Impostazione`, `Valore_Impostazione`, `Descrizione`) VALUES
('copertine_online_abilitato',     '0',                'Master switch: se 0 nessuna chiamata di rete viene mai effettuata'),
('copertine_online_provider',      'tpdb',             'Provider attivo per la ricerca copertine'),
('tpdb_api_token',                 '',                 'Token API ThePornDB. Mai restituito al frontend, solo mascherato'),
('copertine_online_modalita',      'manuale',          'manuale = solo job accodati dall admin; automatico = auto-discovery'),
('copertine_online_ambito',        'senza_copertina',  'Cosa cercare in automatico: senza_copertina | solo_nuovi | tutti'),
('copertine_online_sovrascrivi',   '0',                'Se 1 sostituisce anche le copertine gia generate da ffmpeg'),
('copertine_online_soglia_auto',   '75',               'Score minimo 0-100 per applicare senza conferma dell admin'),
('copertine_online_conferma_sempre','0',               'Se 1 nessun download automatico: ogni match passa da conferma manuale'),
('copertine_online_categorie',     '[]',               'JSON array di id categoria su cui operare. Vuoto = tutte'),
('copertine_online_finestra',      '',                 'Finestra oraria HH:MM-HH:MM per l auto-discovery. Vuoto = sempre'),
('copertine_online_max_giorno',    '200',              'Quota massima di chiamate al provider per giorno'),
('copertine_online_pausa_richieste','2',               'Secondi minimi tra due chiamate al provider'),
('copertine_online_max_tentativi', '3',                'Tentativi prima di marcare il job come errore definitivo'),
('copertine_online_priorita_ffmpeg','1',               'Se 1 ffmpeg genera subito il frame e l online lo sostituisce dopo'),
('copertine_online_attesa_max',    '30',               'Minuti oltre i quali ffmpeg procede comunque se l online non risponde');

-- ----------------------------------------------------------------------------
-- MULTI-PROVIDER. Ogni database online ha un proprio interruttore e un proprio
-- token; `copertine_provider_ordine` definisce la priorita' di interrogazione.
-- Il worker prova i provider in ordine e si ferma al primo match convincente:
-- cataloghi diversi coprono contenuti diversi (adulti vs film e serie).
--
-- Per aggiungere un provider servono tre passi allineati:
--   1. Backend/python_server/providers/<id>.py + registro in __init__.py
--   2. catalogo in Backend/api/cover_provider.php (lo legge la UI admin)
--   3. le due righe qui sotto (_attivo, _token)
-- ----------------------------------------------------------------------------
INSERT IGNORE INTO `Impostazioni` (`Chiave_Impostazione`, `Valore_Impostazione`, `Descrizione`) VALUES
('copertine_provider_ordine',      '["tpdb","tmdb"]',  'Ordine di interrogazione dei database online (JSON)'),
('copertine_provider_tpdb_attivo', '1',                'ThePornDB attivo'),
('copertine_provider_tpdb_token',  '',                 'Token API ThePornDB. Mai restituito al frontend'),
('copertine_provider_tmdb_attivo', '0',                'The Movie Database attivo'),
('copertine_provider_tmdb_token',  '',                 'Token API The Movie Database. Mai restituito al frontend');

-- Migrazione del token dal vecchio schema a provider singolo (idempotente).
UPDATE `Impostazioni` dest
  JOIN `Impostazioni` src ON src.`Chiave_Impostazione` = 'tpdb_api_token'
   SET dest.`Valore_Impostazione` = src.`Valore_Impostazione`
 WHERE dest.`Chiave_Impostazione` = 'copertine_provider_tpdb_token'
   AND (dest.`Valore_Impostazione` IS NULL OR dest.`Valore_Impostazione` = '')
   AND src.`Valore_Impostazione` <> '';

-- ----------------------------------------------------------------------------
-- Backoff esponenziale sui tentativi falliti delle copertine online.
--
-- PERCHE': senza questa colonna _gestisci_errore rimetteva il job in 'in_coda'
-- e claim_job (ORDER BY id ASC) lo ripescava al ciclo successivo, cioe' dopo
-- 1 secondo. Un blip di rete di pochi secondi bruciava tutti i tentativi di
-- copertine_online_max_tentativi e marcava il job 'errore' definitivo,
-- richiedendo un riaccodamento manuale per un problema transitorio.
--
-- Il worker scrive qui NOW() + 60 * 2^tentativi secondi (1min, 2min, 4min...)
-- e claim_job scarta i job non ancora maturi. I riaccodamenti manuali
-- dall'admin azzerano la colonna: se l'admin clicca, deve succedere adesso.
-- ----------------------------------------------------------------------------
ALTER TABLE `Metadati_Online`
    ADD COLUMN IF NOT EXISTS `prossimo_tentativo_at` DATETIME NULL
    COMMENT 'Non ritentare prima di questo istante (backoff esponenziale)';

ALTER TABLE `Metadati_Online`
    ADD INDEX IF NOT EXISTS `idx_meta_claim` (`stato`, `locked_at`, `prossimo_tentativo_at`);
