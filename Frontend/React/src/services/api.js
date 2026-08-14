// src/services/api.js

import { Capacitor } from '@capacitor/core';

/**
 * ============================================================================
 * SERVICES/API.JS
 * ============================================================================
 *
 * Layer di astrazione per le chiamate HTTP al Backend PHP.
 * Gestisce l'invio dei cookie di sessione e la normalizzazione delle risposte.
 */

/**
 * Ottiene l'URL base del server.
 * Se gira come App Nativia (Capacitor), usa quello inserito in fase di Setup.
 * Se gira sul Web, usa stringa vuota (path relativi).
 */
export const getBaseUrl = () => {
  const url = localStorage.getItem("franzplay_server_url");
  return url ? url : "";
};

/**
 * Converte un path relativo in assoluto (es. per /img_utenti o /api/stream.php)
 * Necessario sull'App nativa affinché le immagini vengano prese dal server remoto.
 */
export const getServerMediaUrl = (path) => {
  if (!path) return path;
  if (path.startsWith("http")) return path;
  
  const baseUrl = getBaseUrl();
  if (!baseUrl) return path;

  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  let finalUrl = `${baseUrl}${cleanPath}`;
  
  const token = localStorage.getItem("stream_token");
  if (token) {
    finalUrl += finalUrl.includes("?") ? `&stream_token=${token}` : `?stream_token=${token}`;
  }
  
  return finalUrl;
};

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
export const apiRequest = async (endpoint, method = "GET", body = null) => {
  const options = {
    method,
    credentials: "include", // OBBLIGATORIO: Mantiene la sessione tra le richieste
    // Forza il browser (incluso Safari iOS che spesso ignora Cache-Control:
    // no-store dei response headers) a non cachare mai le risposte API.
    // Diventa critico quando i worker aggiornano i dati in background:
    // es. percorso_file passa da .mkv a .mp4 dopo il remux → iPhone deve
    // vedere subito il nuovo path, non quello vecchio cachato.
    cache: "no-store",
  };

  // Auto-detection Content-Type
  if (body) {
    if (body instanceof FormData) {
      options.body = body;
      // Nota: fetch aggiunge automaticamente il boundary header per FormData
    } else {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(body);
    }
  }

  try {
    const baseUrl = getBaseUrl();
    const fetchUrl = `${baseUrl}/api${endpoint}`;
    const res = await fetch(fetchUrl, options);

    // 204 No Content (es. Logout success)
    if (res.status === 204) return null;

    const json = await res.json();

    // Standard Response Check: { success: false, message: "..." }
    if (!res.ok || (json && json.success === false)) {
      throw new Error(
        json.message || json.errore || "Errore generico dal server.",
      );
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
  Object.keys(params).forEach((key) => {
    if (params[key] !== null && params[key] !== undefined) {
      searchParams.append(key, params[key]);
    }
  });

  const endpoint = `/videos.php?${searchParams.toString()}`;
  const res = await apiRequest(endpoint, "GET");

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
  return await apiRequest(`/videos.php?id=${id}`, "GET");
};
