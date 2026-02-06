export const getAssetUrl = (path) => {
    if (!path || path === 'mancante') return "https://via.placeholder.com/640x360?text=Anteprima+Non+Disponibile";
    // Se è già un URL completo (es. placeholder esterni)
    if (path.startsWith('http')) return path;
    
    // Rimuove slash iniziali doppi se presenti
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    
    // FIX SICUREZZA:
    // Passiamo sempre da stream.php per validare la sessione PHP
    // prima di servire il file (sia video che immagini).
    return `/api/stream.php?file=${encodeURIComponent(cleanPath)}`;
};

export const formatDuration = (str) => {
    if (!str) return "00:00";
    return str.replace(':', 'h ') + 'm'; // Es. 01:30 -> 01h 30m
};