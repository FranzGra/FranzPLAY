<?php
/**
 * ============================================================================
 * Backend/api/cache.php
 * ============================================================================
 * 
 * SCOPO:
 * Wrapper per il caching tramite Redis.
 * Fornisce un'interfaccia semplificata (GET/SET) per ottimizzare le query 
 * pesanti o i dati letti con alta frequenza.
 * 
 * RESILIENZA:
 * Progettato per "fallire silenziosamente". Se Redis è down o l'estensione 
 * manca, i metodi restituiscono null/false, permettendo al sistema di 
 * ripiegare automaticamente sul database senza interrompere il servizio.
 * ============================================================================
 */


// ============================================================================
// SEZIONE 1: DEFINIZIONE CLASSE CACHE
// ============================================================================

class Cache
{
    private $redis;
    private $enabled = false;
    private $ttl = 300; // Tempo di vita predefinito: 5 minuti

    /**
     * Costruttore: Tenta la connessione al container Redis.
     */
    public function __construct()
    {
        // 1. Verifica presenza estensione PHP-Redis
        if (!class_exists('Redis')) {
            error_log("⚠️ [CACHE] Estensione Redis non trovata nel sistema PHP.");
            return;
        }

        try {
            $this->redis = new Redis();

            // 2. Tentativo di connessione (host 'redis' definito nel docker-compose)
            // Timeout di 0.5s per evitare colli di bottiglia in caso di disservizio cache
            if ($this->redis->connect('redis', 6379, 0.5)) {
                $this->enabled = true;
            } else {
                error_log("⚠️ [CACHE] Connessione a Redis fallita (timeout o host non raggiungibile).");
            }
        } catch (Exception $e) {
            error_log("⚠️ [CACHE ERROR] Eccezione durante l'inizializzazione: " . $e->getMessage());
            $this->enabled = false;
        }
    }


    // ============================================================================
    // SEZIONE 2: METODI DI ACCESSO AI DATI
    // ============================================================================

    /**
     * Recupera un valore dalla cache.
     * 
     * @param string $key Chiave univoca dell'elemento.
     * @return mixed|null Dati decodificati (array) o null se non trovati.
     */
    public function get($key)
    {
        if (!$this->enabled)
            return null;

        try {
            $data = $this->redis->get($key);
            return $data ? json_decode($data, true) : null;
        } catch (Exception $e) {
            return null;
        }
    }

    /**
     * Salva un valore in cache con scadenza.
     * 
     * @param string $key Chiave univoca.
     * @param mixed $data Dati da salvare (vengono convertiti in JSON).
     * @param int|null $ttl Tempo di vita in secondi (usa default se null).
     * @return bool True se salvato con successo.
     */
    public function set($key, $data, $ttl = null)
    {
        if (!$this->enabled)
            return false;

        try {
            $json = json_encode($data, JSON_UNESCAPED_UNICODE);
            return $this->redis->setex($key, $ttl ?? $this->ttl, $json);
        } catch (Exception $e) {
            return false;
        }
    }

    /**
     * Rimuove forzatamente un elemento dalla cache (Invalidazione).
     * 
     * @param string $key Chiave da eliminare.
     * @return int Numero di chiavi rimosse.
     */
    public function delete($key)
    {
        if (!$this->enabled)
            return false;
        return $this->redis->del($key);
    }

    /**
     * Svuota completamente l'intero database Redis della cache (Invalidazione globale).
     * 
     * @return bool True se svuotato con successo.
     */
    public function flush()
    {
        if (!$this->enabled)
            return false;
        return $this->redis->flushDB();
    }
}


// ============================================================================
// SEZIONE 3: INIZIALIZZAZIONE ISTANZA GLOBALE
// ============================================================================

/**
 * L'istanza viene esportata come variabile globale $Cache per essere 
 * utilizzata in tutti gli endpoint che ne hanno bisogno.
 */
global $Cache;
$Cache = new Cache();
?>