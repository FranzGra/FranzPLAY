/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.11.14-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: FranzPLAY_DBMS
-- ------------------------------------------------------
-- Server version	10.11.14-MariaDB-0ubuntu0.24.04.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `Accessi`
--

DROP TABLE IF EXISTS `Accessi`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Accessi` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `indirizzo_Ip` varchar(45) NOT NULL COMMENT 'IP tentativo login (IPv4/IPv6)',
  `data_ora_tentativo` datetime DEFAULT current_timestamp() COMMENT 'Timestamp tentativo',
  `successo` tinyint(1) NOT NULL COMMENT 'True = login OK, False = credenziali errate',
  `Nome_Utente` varchar(100) DEFAULT NULL COMMENT 'Username tentato (anche se non esiste)',
  PRIMARY KEY (`id`),
  KEY `idx_accessi_ip_tempo` (`indirizzo_Ip`,`data_ora_tentativo`),
  KEY `idx_accessi_username` (`Nome_Utente`,`data_ora_tentativo`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Log completo tentativi login (audit trail)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Accessi`
--

LOCK TABLES `Accessi` WRITE;
/*!40000 ALTER TABLE `Accessi` DISABLE KEYS */;
INSERT INTO `Accessi` VALUES
(1,'192.168.1.5','2026-10-12 20:51:34',1,'Paolo'),
(2,'10.0.0.9','2026-10-12 20:51:34',0,'hacker');
/*!40000 ALTER TABLE `Accessi` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Categorie`
--

DROP TABLE IF EXISTS `Categorie`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Categorie` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `Nome` varchar(255) NOT NULL COMMENT 'Nome categoria visualizzato (es. "Azione")',
  `Percorso` varchar(255) NOT NULL COMMENT 'Percorso relativo cartella (es. "Azione")',
  `Immagine_Sfondo` varchar(255) DEFAULT NULL COMMENT 'Path immagine sfondo categoria (opzionale)',
  `Colore_Default` varchar(50) DEFAULT NULL COMMENT 'Classe Tailwind css per gradiente colore fallback',
  PRIMARY KEY (`id`),
  UNIQUE KEY `Percorso` (`Percorso`),
  UNIQUE KEY `Immagine_Sfondo` (`Immagine_Sfondo`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Categorie video (mappate da filesystem)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Categorie`
--

LOCK TABLES `Categorie` WRITE;
/*!40000 ALTER TABLE `Categorie` DISABLE KEYS */;
INSERT INTO `Categorie` VALUES
(1,'Vacanze','Vacanze',NULL,NULL),
(2,'Film belli','Film',NULL,NULL);
/*!40000 ALTER TABLE `Categorie` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Commenti`
--

DROP TABLE IF EXISTS `Commenti`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Commenti` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `id_Utente` int(11) NOT NULL COMMENT 'Autore del commento',
  `id_Video` int(11) NOT NULL COMMENT 'Video commentato',
  `testo_commento` text NOT NULL COMMENT 'Testo commento (max 65535 caratteri)',
  `data_ora_commento` datetime DEFAULT current_timestamp() COMMENT 'Timestamp pubblicazione',
  PRIMARY KEY (`id`),
  KEY `id_Utente` (`id_Utente`),
  KEY `idx_commenti_video` (`id_Video`,`data_ora_commento`),
  CONSTRAINT `Commenti_ibfk_1` FOREIGN KEY (`id_Utente`) REFERENCES `Utenti` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Commenti_ibfk_2` FOREIGN KEY (`id_Video`) REFERENCES `Video` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Commenti utenti sui video';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Commenti`
--

LOCK TABLES `Commenti` WRITE;
/*!40000 ALTER TABLE `Commenti` DISABLE KEYS */;
INSERT INTO `Commenti` VALUES
(1,2,1,'Che bello! L\'acqua era \"fredda\"\nVero 😄 \\ fine','2025-06-05 18:00:00'),
(2,1,1,'Sì, freddissima','2025-06-05 18:05:00'),
(3,1,3,'Questo video non c\'è più','2025-06-06 10:00:00'),
(4,2,2,'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx','2025-06-07 10:00:00'),
(5,3,4,'   ','2025-06-08 10:00:00');
/*!40000 ALTER TABLE `Commenti` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Cronologia`
--

DROP TABLE IF EXISTS `Cronologia`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Cronologia` (
  `id_Utente` int(11) NOT NULL,
  `id_Video` int(11) NOT NULL,
  `progresso_secondi` int(11) DEFAULT 0 COMMENT 'Secondo dove si è fermato (es. 142 = 2min 22s)',
  `ultimo_aggiornamento` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT 'Auto-aggiornato',
  `continua_a_guardare` tinyint(1) DEFAULT 1 COMMENT 'Se false, nascosto in home (soft delete)',
  PRIMARY KEY (`id_Utente`,`id_Video`),
  KEY `id_Video` (`id_Video`),
  KEY `idx_cronologia_aggiornamento` (`ultimo_aggiornamento`),
  CONSTRAINT `Cronologia_ibfk_1` FOREIGN KEY (`id_Utente`) REFERENCES `Utenti` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Cronologia_ibfk_2` FOREIGN KEY (`id_Video`) REFERENCES `Video` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Progresso visualizzazione video per utente';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Cronologia`
--

LOCK TABLES `Cronologia` WRITE;
/*!40000 ALTER TABLE `Cronologia` DISABLE KEYS */;
INSERT INTO `Cronologia` VALUES
(1,2,3000,'2025-08-01 20:00:00',1),
(1,4,50,'2025-08-03 20:00:00',1),
(2,1,185,'2025-08-02 20:00:00',0);
/*!40000 ALTER TABLE `Cronologia` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Impostazioni`
--

DROP TABLE IF EXISTS `Impostazioni`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Impostazioni` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `Chiave_Impostazione` varchar(255) NOT NULL COMMENT 'Nome parametro (es. percorso_video)',
  `Valore_Impostazione` text DEFAULT NULL COMMENT 'Valore attuale del parametro',
  `Descrizione` text DEFAULT NULL COMMENT 'Descrizione leggibile del parametro',
  PRIMARY KEY (`id`),
  UNIQUE KEY `Chiave_Impostazione` (`Chiave_Impostazione`)
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Configurazione dinamica server';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Impostazioni`
--

LOCK TABLES `Impostazioni` WRITE;
/*!40000 ALTER TABLE `Impostazioni` DISABLE KEYS */;
INSERT INTO `Impostazioni` VALUES
(1,'percorso_video','/percorsoVideo','Percorso assoluto alla cartella root dei video (mount Docker)'),
(2,'default_Minutaggio_Copertina','3','Minuto da cui estrarre copertina auto-generata (in minuti)'),
(3,'default_Minutaggio_Anteprima','8','Minuto da cui iniziare anteprima auto-generata (in minuti)'),
(4,'durata_Anteprima','10','Durata clip anteprima in secondi'),
(5,'giorni_Durata_Cookies','30','Durata validità cookie sessione in giorni'),
(6,'logo_part_1','NONNA','Prima parte del logo testuale nella Navbar'),
(7,'logo_part_2','TV','Seconda parte evidenziata del logo testuale nella Navbar'),
(8,'colore_tema_default','#00AA55','Colore primario di default per schermata Login e utenti senza personalizzazione'),
(9,'whisper_modello','small','Modello faster-whisper per i sottotitoli (tiny/base/small/medium)'),
(10,'registrazione_abilitata','1','Se 1 i guest possono registrarsi; se 0 la registrazione e disabilitata'),
(11,'copertine_online_abilitato','0','Master switch: se 0 nessuna chiamata di rete viene mai effettuata'),
(12,'copertine_online_provider','tpdb','Provider attivo per la ricerca copertine'),
(13,'tpdb_api_token','','Token API ThePornDB. Mai restituito al frontend, solo mascherato'),
(14,'copertine_online_modalita','manuale','manuale = solo job accodati dall admin; automatico = auto-discovery'),
(15,'copertine_online_ambito','senza_copertina','Cosa cercare in automatico: senza_copertina | solo_nuovi | tutti'),
(16,'copertine_online_sovrascrivi','0','Se 1 sostituisce anche le copertine gia generate da ffmpeg'),
(17,'copertine_online_soglia_auto','75','Score minimo 0-100 per applicare senza conferma dell admin'),
(18,'copertine_online_conferma_sempre','0','Se 1 nessun download automatico: ogni match passa da conferma manuale'),
(19,'copertine_online_categorie','[]','JSON array di id categoria su cui operare. Vuoto = tutte'),
(20,'copertine_online_finestra','','Finestra oraria HH:MM-HH:MM per l auto-discovery. Vuoto = sempre'),
(21,'copertine_online_max_giorno','200','Quota massima di chiamate al provider per giorno'),
(22,'copertine_online_pausa_richieste','2','Secondi minimi tra due chiamate al provider'),
(23,'copertine_online_max_tentativi','3','Tentativi prima di marcare il job come errore definitivo'),
(24,'copertine_online_priorita_ffmpeg','1','Se 1 ffmpeg genera subito il frame e l online lo sostituisce dopo'),
(25,'copertine_online_attesa_max','30','Minuti oltre i quali ffmpeg procede comunque se l online non risponde'),
(26,'copertine_provider_ordine','[\"tpdb\",\"tmdb\"]','Ordine di interrogazione dei database online (JSON)'),
(27,'copertine_provider_tpdb_attivo','1','ThePornDB attivo'),
(28,'copertine_provider_tpdb_token','','Token API ThePornDB. Mai restituito al frontend'),
(29,'copertine_provider_tmdb_attivo','0','The Movie Database attivo'),
(30,'copertine_provider_tmdb_token','','Token API The Movie Database. Mai restituito al frontend');
/*!40000 ALTER TABLE `Impostazioni` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Like`
--

DROP TABLE IF EXISTS `Like`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Like` (
  `id_Utente` int(11) NOT NULL,
  `id_Video` int(11) NOT NULL,
  `data_ora_like` datetime DEFAULT current_timestamp() COMMENT 'Timestamp quando è stato messo il like',
  PRIMARY KEY (`id_Utente`,`id_Video`),
  KEY `id_Video` (`id_Video`),
  CONSTRAINT `Like_ibfk_1` FOREIGN KEY (`id_Utente`) REFERENCES `Utenti` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Like_ibfk_2` FOREIGN KEY (`id_Video`) REFERENCES `Video` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Relazione utente-video per "mi piace"';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Like`
--

LOCK TABLES `Like` WRITE;
/*!40000 ALTER TABLE `Like` DISABLE KEYS */;
INSERT INTO `Like` VALUES
(1,1,'2025-06-01 10:00:00'),
(1,3,'2025-06-03 09:00:00'),
(2,1,'2025-06-02 11:30:00'),
(2,4,'2025-06-04 08:00:00');
/*!40000 ALTER TABLE `Like` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Metadati_Online`
--

DROP TABLE IF EXISTS `Metadati_Online`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Metadati_Online` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `id_Video` int(11) NOT NULL,
  `provider` varchar(16) NOT NULL DEFAULT 'tpdb',
  `stato` enum('in_coda','elaborazione','da_confermare','applicato','nessun_match','errore','ignorato') NOT NULL DEFAULT 'in_coda',
  `origine_job` enum('auto','manuale') NOT NULL DEFAULT 'auto' COMMENT 'I job manuali hanno priorita in coda',
  `query_usata` varchar(512) DEFAULT NULL COMMENT 'Stringa effettivamente inviata al provider',
  `match_id` varchar(64) DEFAULT NULL COMMENT 'ID della scena sul provider (uuid per TPDB)',
  `match_titolo` varchar(512) DEFAULT NULL,
  `match_sito` varchar(128) DEFAULT NULL,
  `match_data` date DEFAULT NULL,
  `match_score` tinyint(3) unsigned DEFAULT NULL COMMENT 'Confidenza 0-100 calcolata da noi, non dal provider',
  `url_immagine` varchar(1024) DEFAULT NULL,
  `candidati_json` text DEFAULT NULL COMMENT 'Top-N candidati per la conferma manuale in UI',
  `errore_msg` varchar(500) DEFAULT NULL,
  `tentativi` int(11) NOT NULL DEFAULT 0,
  `locked_at` datetime DEFAULT NULL,
  `applicato_at` datetime DEFAULT NULL,
  `creato_at` datetime NOT NULL DEFAULT current_timestamp(),
  `aggiornato_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `prossimo_tentativo_at` datetime DEFAULT NULL COMMENT 'Non ritentare prima di questo istante (backoff esponenziale)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meta_video_provider` (`id_Video`,`provider`),
  KEY `idx_meta_stato` (`stato`,`locked_at`),
  KEY `idx_meta_video` (`id_Video`),
  KEY `idx_meta_claim` (`stato`,`locked_at`,`prossimo_tentativo_at`),
  CONSTRAINT `fk_meta_video` FOREIGN KEY (`id_Video`) REFERENCES `Video` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Ricerca copertine/metadati su database esterni';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Metadati_Online`
--

LOCK TABLES `Metadati_Online` WRITE;
/*!40000 ALTER TABLE `Metadati_Online` DISABLE KEYS */;
/*!40000 ALTER TABLE `Metadati_Online` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Salvati`
--

DROP TABLE IF EXISTS `Salvati`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Salvati` (
  `id_Utente` int(11) NOT NULL,
  `id_Video` int(11) NOT NULL,
  `data_ora_salvato` datetime DEFAULT current_timestamp() COMMENT 'Quando è stato salvato',
  PRIMARY KEY (`id_Utente`,`id_Video`),
  KEY `id_Video` (`id_Video`),
  CONSTRAINT `Salvati_ibfk_1` FOREIGN KEY (`id_Utente`) REFERENCES `Utenti` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Salvati_ibfk_2` FOREIGN KEY (`id_Video`) REFERENCES `Video` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Video salvati/preferiti utente';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Salvati`
--

LOCK TABLES `Salvati` WRITE;
/*!40000 ALTER TABLE `Salvati` DISABLE KEYS */;
INSERT INTO `Salvati` VALUES
(1,4,'2025-07-02 12:00:00'),
(2,2,'2025-07-01 12:00:00');
/*!40000 ALTER TABLE `Salvati` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Sottotitoli`
--

DROP TABLE IF EXISTS `Sottotitoli`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Sottotitoli` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `id_Video` int(11) NOT NULL,
  `lingua` varchar(8) NOT NULL COMMENT 'Codice ISO lingua target (it/en/es...) o auto in attesa di detection',
  `lingua_origine` varchar(8) DEFAULT NULL COMMENT 'Lingua parlata nel video (codice ISO o "auto")',
  `tipo` enum('trascrizione','traduzione') NOT NULL DEFAULT 'trascrizione',
  `percorso_file` varchar(512) DEFAULT NULL COMMENT 'Path relativo del file .vtt generato',
  `stato` enum('in_coda','elaborazione','completato','errore') NOT NULL DEFAULT 'in_coda',
  `modello_richiesto` varchar(32) DEFAULT NULL COMMENT 'Modello Whisper scelto dall_admin per questo job (small/medium). NULL = usa default globale',
  `modello_usato` varchar(32) DEFAULT NULL COMMENT 'Modello Whisper effettivamente usato (es. small)',
  `errore_msg` varchar(500) DEFAULT NULL,
  `locked_at` datetime DEFAULT NULL,
  `generato_at` datetime DEFAULT NULL,
  `creato_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sottotitoli_video_lingua` (`id_Video`,`lingua`),
  KEY `idx_sottotitoli_stato` (`stato`,`locked_at`),
  KEY `idx_sottotitoli_video` (`id_Video`),
  CONSTRAINT `fk_sottotitoli_video` FOREIGN KEY (`id_Video`) REFERENCES `Video` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Sottotitoli generati on-demand (Whisper + traduzione)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Sottotitoli`
--

LOCK TABLES `Sottotitoli` WRITE;
/*!40000 ALTER TABLE `Sottotitoli` DISABLE KEYS */;
/*!40000 ALTER TABLE `Sottotitoli` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Spammers`
--

DROP TABLE IF EXISTS `Spammers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Spammers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `Nome_Utente` varchar(100) NOT NULL COMMENT 'Username bloccato temporaneamente (chiave anti-spam)',
  `indirizzo_Ip` varchar(45) DEFAULT NULL COMMENT 'IP per audit/logging (NON usato per ban, supporta IPv6)',
  `bloccato_fino_a` datetime NOT NULL COMMENT 'Timestamp scadenza ban (dopo questo momento, ban rimosso)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `Nome_Utente` (`Nome_Utente`),
  KEY `idx_spammers_user_time` (`Nome_Utente`,`bloccato_fino_a`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Anti-spam: Ban temporanei per USERNAME (compatibile VPN/Reverse Proxy)';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Spammers`
--

LOCK TABLES `Spammers` WRITE;
/*!40000 ALTER TABLE `Spammers` DISABLE KEYS */;
/*!40000 ALTER TABLE `Spammers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Utenti`
--

DROP TABLE IF EXISTS `Utenti`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Utenti` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `Nome_Utente` varchar(100) NOT NULL COMMENT 'Username univoco (login)',
  `Password` varchar(255) NOT NULL COMMENT 'Hash bcrypt password',
  `Email` varchar(255) DEFAULT NULL COMMENT 'Email per recupero password',
  `ResetToken` varchar(255) DEFAULT NULL COMMENT 'Token temporaneo reset password',
  `ResetTokenExpiry` datetime DEFAULT NULL COMMENT 'Scadenza token reset',
  `Immagine_Profilo` varchar(255) DEFAULT NULL COMMENT 'Filename avatar',
  `ultimo_Accesso` datetime DEFAULT NULL,
  `colore_Tema` varchar(7) DEFAULT NULL,
  `preferenze_home` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'JSON preferenze sezioni home (es. collapsed/expanded)' CHECK (json_valid(`preferenze_home`)),
  `Admin` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Nome_Utente` (`Nome_Utente`),
  UNIQUE KEY `Email` (`Email`),
  KEY `idx_utenti_username` (`Nome_Utente`),
  KEY `idx_utenti_email` (`Email`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Account utenti con profili personalizzati';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Utenti`
--

LOCK TABLES `Utenti` WRITE;
/*!40000 ALTER TABLE `Utenti` DISABLE KEYS */;
INSERT INTO `Utenti` VALUES
(1,'Paolo','$2y$10$FRx/ktSH1VVy7vVPqX7NIOQg2EGYNH/ntGZ1h8WtckxhdWnUDvzVy','f@example.com',NULL,NULL,'user_1_1700000000.jpg','2026-10-01 21:00:00','#DC2626','{\"saved\": false, \"recent\": true}',1),
(2,'nonna_pina','$2y$10$57J.H2UJ4iGdCGtqa6YL1uxKYDLEsl8QTybMVNkKsKyqlawfmSPUa',NULL,NULL,NULL,NULL,NULL,NULL,NULL,0),
(3,'Al','$2y$10$57J.H2UJ4iGdCGtqa6YL1uxKYDLEsl8QTybMVNkKsKyqlawfmSPUa',NULL,NULL,NULL,NULL,NULL,'rosso',NULL,0);
/*!40000 ALTER TABLE `Utenti` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Video`
--

DROP TABLE IF EXISTS `Video`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Video` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `percorso_file` varchar(512) NOT NULL COMMENT 'Path relativo file video originale',
  `Titolo` varchar(255) NOT NULL COMMENT 'Nome visualizzato (modificabile, default = nome file)',
  `id_Categoria` int(11) DEFAULT NULL COMMENT 'FK a Categorie (NULL se non categorizzato)',
  `data_Pubblicazione` datetime DEFAULT NULL COMMENT 'Data pubblicazione (gestita manualmente da admin)',
  `Likes` int(11) DEFAULT 0 COMMENT 'Contatore like (incrementato/decrementato da toggleLike.php)',
  `Durata` varchar(5) DEFAULT NULL COMMENT 'Durata formato HH:MM (es. 01:38 = 1h 38min)',
  `Formato` varchar(10) DEFAULT NULL COMMENT 'Estensione file (mp4, mkv, avi, webm)',
  `percorso_copertina` varchar(512) DEFAULT NULL COMMENT 'Path thumbnail JPG (generato o caricato)',
  `percorso_anteprima` varchar(512) DEFAULT NULL COMMENT 'Path preview MP4 (auto-generato a 480p)',
  `locked_at` datetime DEFAULT NULL,
  `ottimizzato` tinyint(4) DEFAULT NULL,
  `ottimizzato_at` datetime DEFAULT NULL,
  `codec_video` varchar(32) DEFAULT NULL,
  `codec_audio` varchar(32) DEFAULT NULL,
  `cleanup_path` varchar(500) DEFAULT NULL,
  `cleanup_at` datetime DEFAULT NULL,
  `copertina_origine` enum('ffmpeg','online','manuale') DEFAULT NULL COMMENT 'Provenienza di percorso_copertina: frame ffmpeg, download online o upload manuale',
  `altezza_video` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `percorso_file` (`percorso_file`),
  KEY `idx_video_categoria` (`id_Categoria`),
  KEY `idx_video_assets_missing` (`percorso_copertina`(20),`percorso_anteprima`(20)),
  KEY `idx_video_ottimizzato` (`ottimizzato`,`locked_at`),
  KEY `idx_video_cleanup` (`cleanup_at`),
  FULLTEXT KEY `idx_video_titolo` (`Titolo`),
  CONSTRAINT `Video_ibfk_1` FOREIGN KEY (`id_Categoria`) REFERENCES `Categorie` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Catalogo completo video con metadati';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Video`
--

LOCK TABLES `Video` WRITE;
/*!40000 ALTER TABLE `Video` DISABLE KEYS */;
INSERT INTO `Video` VALUES
(1,'Vacanze/Mare 2019.mp4','Mare 2019',1,NULL,2,'03:10','mp4',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(2,'Film/Il sorpasso (1962).mp4','Il sorpasso',2,NULL,0,'1:45','mp4',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(3,'Vecchio/sparito.mp4','Sparito',NULL,NULL,1,'00:30','mp4',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(4,'Tom & Jerry #2.mp4','Tom & Jerry',NULL,NULL,1,'07:00','mp4',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `Video` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Video_Temp`
--

DROP TABLE IF EXISTS `Video_Temp`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Video_Temp` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `percorso_file` varchar(512) NOT NULL COMMENT 'Path video da processare',
  `locked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `percorso_file` (`percorso_file`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Coda elaborazione nuovi video';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Video_Temp`
--

LOCK TABLES `Video_Temp` WRITE;
/*!40000 ALTER TABLE `Video_Temp` DISABLE KEYS */;
/*!40000 ALTER TABLE `Video_Temp` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-12 20:51:34
