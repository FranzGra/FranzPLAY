/**
 * Verifica se un path asset (copertina/anteprima) è valido.
 * NULL / undefined / stringa vuota / 'mancante' → no asset disponibile,
 * la UI mostrerà un placeholder elegante invece di un'immagine rotta.
 */
export const hasAsset = (path) => {
  return !!path && path !== "mancante";
};

export const getAssetUrl = (path) => {
  // Restituiamo stringa vuota per i casi "no asset": il componente che ci chiama
  // userà hasAsset() per decidere se mostrare il placeholder React invece di <img>.
  if (!hasAsset(path)) return "";
  // Se è già un URL completo (es. placeholder esterni)
  if (path.startsWith("http")) return path;

  // Rimuove slash iniziali doppi se presenti
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;

  // FIX SICUREZZA & PATH:
  // Non usiamo encodeURIComponent(cleanPath) qui, altrimenti encode-a gli slash / in %2F,
  // rompendo la logica di 'stream.php' che prova a sua volta a decifrarli / ri-encodarli
  // segmentato (rawurlencode). Passiamo il cleanPath così com'è, e lasciamo
  // l'assolvere dello spacchettamento al back-end.
  // Usiamo encodeURI() per gestire *solo* gli spazi o caratteri speciali base
  // mantenendo intatti gli slash direzionali.
  return `/api/stream.php?file=${encodeURI(cleanPath)}`;
};

/**
 * Genera l'URL per l'avatar utente in modo uniforme per tutto il frontend.
 */
export const getUserAvatarUrl = (path) => {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  // Se il path include già 'img_utenti', lo usiamo così com'è.
  // Altrimenti lo prepariamo al prefisso.
  if (cleanPath.startsWith("img_utenti/")) {
    return `/${cleanPath}`;
  }
  return `/img_utenti/${cleanPath}`;
};

export const formatDuration = (str) => {
  if (!str) return "00:00";
  return str.replace(":", "h ") + "m"; // Es. 01:30 -> 01h 30m
};
