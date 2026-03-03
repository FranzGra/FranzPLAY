-- ============================================================================
-- FranzPLAY - Schema Database MySQL
-- ============================================================================
-- 
-- DESCRIZIONE:
-- Schema completo del database per la piattaforma di video streaming FranzPLAY.
-- Include tabelle per video, utenti, categorie, interazioni e sistema anti-spam.
--
-- CHARSET: utf8mb4 (supporta emoji e caratteri speciali)
-- ENGINE: InnoDB (transazioni, foreign keys, performance)
--
-- MODIFICHE RECENTI:
-- - Tabella Spammers: Cambiata logica da IP-based a USERNAME-based
--   (compatibilità con VPN/Reverse Proxy)
-- ============================================================================


-- ============================================================================
-- TABELLA: Impostazioni
-- ============================================================================
-- 
-- SCOPO:
-- Configurazione dinamica del server (percorsi, minutaggi, durate).
-- Permette modifiche senza toccare il codice PHP.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Impostazioni` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `Chiave_Impostazione` VARCHAR(255) NOT NULL UNIQUE COMMENT 'Nome parametro (es. percorso_video)',
    `Valore_Impostazione` TEXT COMMENT 'Valore attuale del parametro',
    `Descrizione` TEXT COMMENT 'Descrizione leggibile del parametro'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Configurazione dinamica server';

-- Valori predefiniti
INSERT IGNORE INTO `Impostazioni` (`Chiave_Impostazione`, `Valore_Impostazione`, `Descrizione`) VALUES
('percorso_video', '/percorsoVideo', 'Percorso assoluto alla cartella root dei video (mount Docker)'),
('default_Minutaggio_Copertina', '3', 'Minuto da cui estrarre copertina auto-generata (in minuti)'),
('default_Minutaggio_Anteprima', '8', 'Minuto da cui iniziare anteprima auto-generata (in minuti)'),
('durata_Anteprima', '10', 'Durata clip anteprima in secondi'),
('giorni_Durata_Cookies', '30', 'Durata validità cookie sessione in giorni'),
('logo_part_1', 'FRANZ', 'Prima parte del logo testuale nella Navbar'),
('logo_part_2', 'PLAY', 'Seconda parte evidenziata del logo testuale nella Navbar'),
('colore_tema_default', '#dc2626', 'Colore primario di default per schermata Login e utenti senza personalizzazione');


-- ============================================================================
-- TABELLA: Categorie
-- ============================================================================
--
-- SCOPO:
-- Organizzazione video in categorie basate sulla struttura filesystem.
-- Ogni cartella contenente video diventa automaticamente una categoria.
--
-- LOGICA:
-- - Cartella con video diretti → Categoria
-- - Cartella con solo sottocartelle → Ignorata (non è categoria)
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Categorie` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `Nome` VARCHAR(255) NOT NULL COMMENT 'Nome categoria visualizzato (es. "Azione")',
    `Percorso` VARCHAR(255) NOT NULL UNIQUE COMMENT 'Percorso relativo cartella (es. "Azione")',
    `Immagine_Sfondo` VARCHAR(255) DEFAULT NULL UNIQUE COMMENT 'Path immagine sfondo categoria (opzionale)',
    `Colore_Default` VARCHAR(50) DEFAULT NULL COMMENT 'Classe Tailwind css per gradiente colore fallback'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Categorie video (mappate da filesystem)';


-- ============================================================================
-- TABELLA: Video
-- ============================================================================
--
-- SCOPO:
-- Registro completo di tutti i video con metadati e riferimenti asset.
--
-- ASSET:
-- - percorso_file: File video originale
-- - percorso_copertina: Immagine thumbnail (JPG)
-- - percorso_anteprima: Clip preview (MP4 480p, 10s)
--
-- WORKFLOW:
-- 1. Watcher rileva file → insert in Video_Temp
-- 2. Worker_Metadata → estrae durata/formato, sposta in Video
-- 3. Worker_Assets → genera copertina e anteprima
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Video` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `percorso_file` VARCHAR(512) NOT NULL UNIQUE COMMENT 'Path relativo file video originale',
    `Titolo` VARCHAR(255) NOT NULL COMMENT 'Nome visualizzato (modificabile, default = nome file)',
    `id_Categoria` INT COMMENT 'FK a Categorie (NULL se non categorizzato)',
    `data_Pubblicazione` DATETIME NULL DEFAULT NULL COMMENT 'Data pubblicazione (gestita manualmente da admin)',
    `Likes` INT DEFAULT 0 COMMENT 'Contatore like (incrementato/decrementato da toggleLike.php)',
    `Durata` VARCHAR(5) NULL COMMENT 'Durata formato HH:MM (es. 01:38 = 1h 38min)',
    `Formato` VARCHAR(10) NULL COMMENT 'Estensione file (mp4, mkv, avi, webm)',
    `percorso_copertina` VARCHAR(512) DEFAULT NULL COMMENT 'Path thumbnail JPG (generato o caricato)',
    `percorso_anteprima` VARCHAR(512) DEFAULT NULL COMMENT 'Path preview MP4 (auto-generato a 480p)',
    
    FOREIGN KEY (`id_Categoria`) REFERENCES `Categorie`(`id`) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE,
    
    INDEX idx_video_categoria (`id_Categoria`),
    FULLTEXT INDEX idx_video_titolo (`Titolo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Catalogo completo video con metadati';


-- ============================================================================
-- TABELLA: Video_Temp
-- ============================================================================
--
-- SCOPO:
-- Coda di elaborazione per nuovi video rilevati dal Watcher.
-- I worker processano questi record e li spostano in Video.
--
-- WORKFLOW:
-- Watcher → Video_Temp → Worker_Metadata → Video → Worker_Assets
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Video_Temp` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `percorso_file` VARCHAR(512) NOT NULL UNIQUE COMMENT 'Path video da processare'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Coda elaborazione nuovi video';


-- ============================================================================
-- TABELLA: Utenti
-- ============================================================================
--
-- SCOPO:
-- Gestione account utenti con autenticazione e personalizzazione.
--
-- SICUREZZA:
-- - Password: Hash bcrypt (mai in chiaro)
-- - colore_Tema: Personalizzazione UI (HEX color)
--
-- CAMPI:
-- - Admin: Flag booleano per permessi amministrativi
-- - Immagine_Profilo: Filename avatar (salvato in /var/www/sessioni/immagini_utenti/)
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Utenti` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `Nome_Utente` VARCHAR(100) NOT NULL UNIQUE COMMENT 'Username univoco (login)',
    `Password` VARCHAR(255) NOT NULL COMMENT 'Hash bcrypt password',
    `Email` VARCHAR(255) NULL UNIQUE COMMENT 'Email per recupero password',
    `ResetToken` VARCHAR(255) DEFAULT NULL COMMENT 'Token temporaneo reset password',
    `ResetTokenExpiry` DATETIME DEFAULT NULL COMMENT 'Scadenza token reset',
    `Immagine_Profilo` VARCHAR(255) DEFAULT NULL COMMENT 'Filename avatar',
    `ultimo_Accesso` DATETIME NULL DEFAULT NULL,
    `colore_Tema` VARCHAR(7) DEFAULT '#dc2626',
    `preferenze_home` JSON DEFAULT NULL COMMENT 'JSON preferenze sezioni home (es. collapsed/expanded)',
    `Admin` BOOLEAN DEFAULT FALSE,
    
    INDEX idx_utenti_username (`Nome_Utente`),
    INDEX idx_utenti_email (`Email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Account utenti con profili personalizzati';

-- Utenti predefiniti (CAMBIARE PASSWORD IN PRODUZIONE!)
INSERT IGNORE INTO `Utenti` (`Nome_Utente`, `Password`, `Admin`) VALUES
('admin', '$2y$10$oH/wfvGqW71.yjD8ozrNzui/ooRODRtqbNJcERi2fYnpwz7RSG6Mi', TRUE),   -- Password: admin
('Franz', '$2y$10$YLP2fURaliF6IJsxRwyMzOoQ7hbabVEeXyMBhG9bhN5qSJwvZdABC', TRUE);  -- Password: franz

-- ============================================================================
-- TABELLA: Like
-- ============================================================================
--
-- SCOPO:
-- Traccia i "mi piace" degli utenti sui video.
--
-- LOGICA:
-- - Inserimento → Like attivo, incrementa Video.Likes
-- - Cancellazione → Unlike, decrementa Video.Likes
-- - Gestito da toggleLike.php
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Like` (
    `id_Utente` INT,
    `id_Video` INT,
    `data_ora_like` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp quando è stato messo il like',
    
    PRIMARY KEY (`id_Utente`, `id_Video`),
    
    FOREIGN KEY (`id_Utente`) REFERENCES `Utenti`(`id`) 
        ON DELETE CASCADE 
        ON UPDATE CASCADE,
    FOREIGN KEY (`id_Video`) REFERENCES `Video`(`id`) 
        ON DELETE CASCADE 
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Relazione utente-video per "mi piace"';


-- ============================================================================
-- TABELLA: Commenti
-- ============================================================================
--
-- SCOPO:
-- Sistema commenti video (feature completa con testo e timestamp).
--
-- PERMESSI:
-- - Ogni utente può commentare
-- - Solo autore può eliminare proprio commento
-- - Admin può eliminare qualsiasi commento
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Commenti` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `id_Utente` INT NOT NULL COMMENT 'Autore del commento',
    `id_Video` INT NOT NULL COMMENT 'Video commentato',
    `testo_commento` TEXT NOT NULL COMMENT 'Testo commento (max 65535 caratteri)',
    `data_ora_commento` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp pubblicazione',
    
    FOREIGN KEY (`id_Utente`) REFERENCES `Utenti`(`id`) 
        ON DELETE CASCADE 
        ON UPDATE CASCADE,
    FOREIGN KEY (`id_Video`) REFERENCES `Video`(`id`) 
        ON DELETE CASCADE 
        ON UPDATE CASCADE,
    
    INDEX idx_commenti_video (`id_Video`, `data_ora_commento`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Commenti utenti sui video';


-- ============================================================================
-- TABELLA: Salvati
-- ============================================================================
--
-- SCOPO:
-- Lista "Guarda più tardi" / "Preferiti" per ogni utente.
--
-- UI:
-- - Pulsante bookmark su ogni video
-- - Pagina dedicata con lista salvati
-- - Gestito da toggleSalvati.php
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Salvati` (
    `id_Utente` INT,
    `id_Video` INT,
    `data_ora_salvato` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Quando è stato salvato',
    
    PRIMARY KEY (`id_Utente`, `id_Video`),
    
    FOREIGN KEY (`id_Utente`) REFERENCES `Utenti`(`id`) 
        ON DELETE CASCADE 
        ON UPDATE CASCADE,
    FOREIGN KEY (`id_Video`) REFERENCES `Video`(`id`) 
        ON DELETE CASCADE 
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Video salvati/preferiti utente';


-- ============================================================================
-- TABELLA: Spammers (MODIFICATA)
-- ============================================================================
--
-- SCOPO:
-- Sistema anti-brute-force per login con ban temporanei.
--
-- ⚠️ MODIFICA IMPORTANTE (Compatibilità VPN/Reverse Proxy):
-- 
-- PROBLEMA VECCHIO SISTEMA (IP-based):
-- Con VPN/Reverse Proxy, tutti gli utenti condividono lo stesso IP pubblico.
-- Se bloccavamo per IP, 3 tentativi falliti di UN utente bloccavano TUTTI.
--
-- SOLUZIONE NUOVA (USERNAME-based):
-- Ogni username ha il proprio contatore di tentativi.
-- Solo l'username specifico viene bloccato, non l'intero IP.
--
-- LOGICA:
-- 1. Utente sbaglia password 3 volte in 30s → ban 30s PER QUEL USERNAME
-- 2. Altri utenti possono loggare normalmente (stesso IP, username diverso)
-- 3. IP salvato solo per audit/logging, NON usato per logica ban
--
-- ESEMPIO:
-- - Franz sbaglia 3 volte → Franz bloccato 30s
-- - Matteo può loggare normalmente (stesso IP, ma username diverso)
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Spammers` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `Nome_Utente` VARCHAR(100) NOT NULL UNIQUE COMMENT 'Username bloccato temporaneamente (chiave anti-spam)',
    `indirizzo_Ip` VARCHAR(45) NULL COMMENT 'IP per audit/logging (NON usato per ban, supporta IPv6)',
    `bloccato_fino_a` DATETIME NOT NULL COMMENT 'Timestamp scadenza ban (dopo questo momento, ban rimosso)',
    
    INDEX idx_spammers_user_time (`Nome_Utente`, `bloccato_fino_a`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 
COMMENT='Anti-spam: Ban temporanei per USERNAME (compatibile VPN/Reverse Proxy)';


-- ============================================================================
-- TABELLA: Cronologia
-- ============================================================================
--
-- SCOPO:
-- Traccia progresso visualizzazione video per ogni utente.
--
-- FEATURE:
-- - Smart Resume: Riprende da dove interrotto (-3s per contesto)
-- - Continua a guardare: Sezione home page
-- - Soft delete: continua_a_guardare = 0 nasconde senza cancellare
--
-- AGGIORNAMENTO:
-- - Ogni 10 secondi da VideoPlayer.jsx
-- - UPSERT via aggiornaMinutaggio.php (INSERT ... ON DUPLICATE KEY UPDATE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Cronologia` (
    `id_Utente` INT NOT NULL,
    `id_Video` INT NOT NULL,
    `progresso_secondi` INT DEFAULT 0 COMMENT 'Secondo dove si è fermato (es. 142 = 2min 22s)',
    `ultimo_aggiornamento` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Auto-aggiornato',
    `continua_a_guardare` BOOLEAN DEFAULT TRUE COMMENT 'Se false, nascosto in home (soft delete)',
    
    PRIMARY KEY (`id_Utente`, `id_Video`),
    
    FOREIGN KEY (`id_Utente`) REFERENCES `Utenti`(`id`) 
        ON DELETE CASCADE 
        ON UPDATE CASCADE,
    FOREIGN KEY (`id_Video`) REFERENCES `Video`(`id`) 
        ON DELETE CASCADE 
        ON UPDATE CASCADE,
    
    INDEX idx_cronologia_aggiornamento (`ultimo_aggiornamento`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Progresso visualizzazione video per utente';


-- ============================================================================
-- TABELLA: Accessi
-- ============================================================================
--
-- SCOPO:
-- Audit trail completo di tutti i tentativi di login (successo e falliti).
--
-- USO:
-- 1. Conteggio tentativi falliti per anti-spam (login.php)
-- 2. Statistiche accessi
-- 3. Investigazione attacchi brute-force
-- 4. Compliance / logging sicurezza
--
-- PULIZIA:
-- Eseguire periodicamente (cron) per evitare crescita infinita:
-- DELETE FROM Accessi WHERE data_ora_tentativo < DATE_SUB(NOW(), INTERVAL 30 DAY);
-- ============================================================================

CREATE TABLE IF NOT EXISTS `Accessi` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `indirizzo_Ip` VARCHAR(45) NOT NULL COMMENT 'IP tentativo login (IPv4/IPv6)',
    `data_ora_tentativo` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp tentativo',
    `successo` BOOLEAN NOT NULL COMMENT 'True = login OK, False = credenziali errate',
    `Nome_Utente` VARCHAR(100) COMMENT 'Username tentato (anche se non esiste)',
    
    INDEX idx_accessi_ip_tempo (`indirizzo_Ip`, `data_ora_tentativo`),
    INDEX idx_accessi_username (`Nome_Utente`, `data_ora_tentativo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Log completo tentativi login (audit trail)';