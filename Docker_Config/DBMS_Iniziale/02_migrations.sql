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
