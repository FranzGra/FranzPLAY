// src/services/api.js

/**
 * ============================================================================
 * SERVICES/API.JS
 * ============================================================================
 * 
 * Layer di astrazione per le chiamate HTTP al Backend PHP.
 * Gestisce l'invio dei cookie di sessione e la normalizzazione delle risposte.
 */

/**
 * Wrapper generico per fetch().
 * 
 * Gestisce:
 * 1. Credentials (invio automatico cookie PHPSESSID)
 * 2. Content-Type (JSON vs FormData)
 * 3. Error Handling unificato
 * 
 * @param {string} endpoint - URL relativo (es. "/videos.php")
 * @param {string} method   - HTTP Verb (GET, POST, etc.)
 * @param {object|FormData} body - Dati da inviare
 * @returns {Promise<any>} - Risposta JSON parsata
 * @throws {Error} - Se la richiesta fallisce o il server ritorna successo: false
 */
export const apiRequest = async (endpoint, method = 'GET', body = null) => {
    const options = {
        method,
        credentials: 'include', // OBBLIGATORIO: Mantiene la sessione tra le richieste
    };

    // Auto-detection Content-Type
    if (body) {
        if (body instanceof FormData) {
            options.body = body;
            // Nota: fetch aggiunge automaticamente il boundary header per FormData
        } else {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(body);
        }
    }

    try {
        const res = await fetch(`/api${endpoint}`, options);

        // 204 No Content (es. Logout success)
        if (res.status === 204) return null;

        const json = await res.json();

        // Standard Response Check: { success: false, message: "..." }
        if (!res.ok || (json && json.success === false)) {
            throw new Error(json.message || json.errore || "Errore generico dal server.");
        }

        return json;
    } catch (error) {
        console.error(`❌ API Error [${method} ${endpoint}]:`, error);
        throw error; // Propaga errore alla UI
    }
};



/**
 * Recupera la lista video (RESTful).
 * 
 * @param {object} params - Filtri opzionali
 * @param {string} params.type - 'all', 'liked', 'saved', 'history'
 * @param {number} params.category_id - ID categoria
 * @param {string} params.q - Query di ricerca
 * @param {number} params.limit - Default 12
 * @param {number} params.offset - Paginazione
 * @param {number} params.seed - Seed per random order stabile
 * @returns {Promise<any>} - Oggetto risposta { successo: true, dati: [...] }
 */
export const fetchVideosRest = async (params = {}) => {
    const searchParams = new URLSearchParams();

    // Clean params (rimuove null/undefined)
    Object.keys(params).forEach(key => {
        if (params[key] !== null && params[key] !== undefined) {
            searchParams.append(key, params[key]);
        }
    });

    const endpoint = `/videos.php?${searchParams.toString()}`;
    const res = await apiRequest(endpoint, 'GET');

    // FIX: Il backend ritorna { success: true, data/dati: [...] }
    if (res && res.success) {
        return res.data || res.dati || [];
    }

    // Fallback disperato legacy
    return Array.isArray(res) ? res : [];
};

/**
 * Recupera dettaglio singolo video.
 * @param {number} id - ID del video
 * @returns {Promise<object>} - { video: {...} }
 */
export const fetchVideoDetailsRest = async (id) => {
    return await apiRequest(`/videos.php?id=${id}`, 'GET');
};