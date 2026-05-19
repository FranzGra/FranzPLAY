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
