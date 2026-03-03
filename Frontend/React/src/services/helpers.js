export const getAssetUrl = (path) => {
    if (!path || path === 'mancante') return "https://via.placeholder.com/640x360?text=Anteprima+Non+Disponibile";
    // Se è già un URL completo (es. placeholder esterni)
    if (path.startsWith('http')) return path;

    // Rimuove slash iniziali doppi se presenti
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;

    // FIX SICUREZZA & PATH:
    // Non usiamo encodeURIComponent(cleanPath) qui, altrimenti encode-a gli slash / in %2F,
    // rompendo la logica di 'stream.php' che prova a sua volta a decifrarli / ri-encodarli 
    // segmentato (rawurlencode). Passiamo il cleanPath così com'è, e lasciamo 
    // l'assolvere dello spacchettamento al back-end.
    // Usiamo encodeURI() per gestire *solo* gli spazi o caratteri speciali base
    // mantenendo intatti gli slash direzionali.
    return `/api/stream.php?file=${encodeURI(cleanPath)}`;
};

export const formatDuration = (str) => {
    if (!str) return "00:00";
    return str.replace(':', 'h ') + 'm'; // Es. 01:30 -> 01h 30m
};