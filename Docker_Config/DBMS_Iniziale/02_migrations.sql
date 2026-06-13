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
