# 📂 Export Contenuti: services
> Percorso: `G:\Sincronizzazione\Onedrive Backup\OneDrive - Franz's Industries\File nei SERVER\Server Raspberry Pi 4\Progetti HTTP\FranzTube\FranzTube React\Frontend\React\src\services`
> File ignorati da ignore.txt: 3

## 📑 Indice dei file inclusi
- [api.js](#file-apijs)
- [helpers.js](#file-helpersjs)

---


## <a id="file-apijs"></a>📄 api.js
``` javascript
// src/services/api.js

/**
 * Wrapper generico per le chiamate Fetch verso il backend PHP.
 * Gestisce automaticamente:
 * - Credentials (Cookie di sessione)
 * - Header JSON vs FormData
 * - Errori HTTP e logici (successo: false)
 */
export const apiRequest = async (endpoint, method = 'GET', body = null) => {
    const options = {
        method,
        credentials: 'include', // FONDAMENTALE: Invia/Riceve il cookie PHPSESSID
    };

    // Gestione automatica del Body
    if (body) {
        if (body instanceof FormData) {
            // Se è FormData, il browser setta automaticamente Content-Type: multipart/form-data
            options.body = body;
        } else {
            // Altrimenti assumiamo sia un oggetto JSON
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(body);
        }
    }

    try {
        const res = await fetch(`/api${endpoint}`, options);

        // 204 No Content (Logout o azioni senza risposta)
        if (res.status === 204) return null;

        const json = await res.json();

        // Controllo logico del backend (es. { successo: false, errore: "..." })
        if (res.ok && json.successo === false) {
            throw new Error(json.errore || "Errore sconosciuto del server.");
        }

        return json;
    } catch (error) {
        console.error(`❌ API Error [${endpoint}]:`, error);
        throw error; // Rilancia l'errore per gestirlo nella UI
    }
};

/**
 * Funzione specifica per recuperare liste di video.
 * @param {string} action - L'azione da inviare al backend (es. 'video_recenti', 'cerca')
 * @param {object} extraParams - Parametri aggiuntivi (es. { query: 'test', limit: 20 })
 */
export const fetchVideos = async (action, extraParams = {}) => {
    const formData = new FormData();
    formData.append('action', action);
    
    // Aggiunge dinamicamente tutti i parametri extra al FormData
    Object.keys(extraParams).forEach(key => {
        if (extraParams[key] !== null && extraParams[key] !== undefined) {
            formData.append(key, extraParams[key]);
        }
    });
    
    // Chiama l'endpoint video.php
    const res = await apiRequest('/video.php', 'POST', formData);
    return res.dati || []; // Restituisce sempre un array (evita crash su map())
};
```
---


## <a id="file-helpersjs"></a>📄 helpers.js
``` javascript
export const getAssetUrl = (path) => {
    if (!path || path === 'mancante') return "https://via.placeholder.com/640x360?text=Anteprima+Non+Disponibile";
    // Se è già un URL completo (es. placeholder esterni)
    if (path.startsWith('http')) return path;
    
    // Rimuove slash iniziali doppi se presenti
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    
    // Nginx è configurato per servire /media su /video/ nel frontend
    // Assicuriamoci che il path del DB corrisponda
    return `/video/${cleanPath}`;
};

export const formatDuration = (str) => {
    if (!str) return "00:00";
    return str.replace(':', 'h ') + 'm'; // Es. 01:30 -> 01h 30m
};
```
---
