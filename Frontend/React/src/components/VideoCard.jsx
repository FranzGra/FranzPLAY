import React, { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Eye, ThumbsUp, X } from 'lucide-react';
import { getAssetUrl } from '../services/helpers';

// Helper per calcolo durata
const parseDurationToSeconds = (durationStr) => {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
};

/**
 * Componente: VideoCard
 * Rappresenta un singolo riquadro video nelle griglie.
 * 
 * FEATURES:
 * - Anteprima video hover (MP4 preview)
 * - Barra di progresso (se iniziato)
 * - Bottone di rimozione (opzionale, per Cronologia)
 */
function VideoCard({ video, onRemove, RemoveIcon = X }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Stato animazione rimozione
  const [isRemoving, setIsRemoving] = useState(false);

  // Asset Paths
  const thumbnailSrc = getAssetUrl(video.percorso_copertina);
  const previewSrc = getAssetUrl(video.percorso_anteprima);

  // Calcolo % completamento per barra rossa
  let progressPercent = 0;
  if (video.progresso_secondi && video.Durata) {
    const totalSeconds = parseDurationToSeconds(video.Durata);
    if (totalSeconds > 0) {
      progressPercent = Math.min(Math.max((video.progresso_secondi / totalSeconds) * 100, 0), 100);
    }
  }

  // Gestione Riproduzione Anteprima
  useEffect(() => {
    const videoEl = videoRef.current;
    if (isPlaying && hasLoaded && videoEl) {
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => setIsPlaying(false)); // Autoplay bloccato dal browser
      }
    } else if (!isPlaying && videoEl) {
      videoEl.pause();
      videoEl.currentTime = 0;
    }
  }, [isPlaying, hasLoaded]);

  // Stop anteprime quando ne parte un'altra (su mobile)
  useEffect(() => {
    const handleStopOthers = (e) => {
      if (e.detail.id !== video.id) setIsPlaying(false);
    };
    window.addEventListener('stop-other-previews', handleStopOthers);
    return () => window.removeEventListener('stop-other-previews', handleStopOthers);
  }, [video.id]);

  // Event Handlers
  const handleMouseEnter = () => {
    setHasLoaded(true);
    setIsPlaying(true);
  };
  const handleMouseLeave = () => setIsPlaying(false);
  const handleTouchStart = () => {
    setHasLoaded(true);
    setIsPlaying(true);
    window.dispatchEvent(new CustomEvent('stop-other-previews', { detail: { id: video.id } }));
  };

  // Rimozione con delay per animazione
  const handleRemoveClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRemoving(true); // Trigger animazione CSS
    setTimeout(() => { if (onRemove) onRemove(video.id); }, 300);
  };

  return (
    <div className={`relative group block h-full transition-all duration-300 ease-out ${isRemoving ? 'opacity-0 scale-90 pointer-events-none' : 'opacity-100 scale-100'}`}>
      <Link
        to={`/watch/${video.id}`}
        className="block p-2 rounded-2xl transition-all duration-300 hover:bg-zinc-800/50 hover:shadow-xl hover:ring-1 hover:ring-white/10 cursor-pointer focus:outline-none h-full flex flex-col"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        aria-label={`Guarda ${video.Titolo}`}
      >
        {/* MEDIA CONTAINER */}
        <div className="relative aspect-video w-full rounded-xl bg-zinc-900 overflow-hidden shadow-lg ring-1 ring-white/10 group-hover:ring-zinc-500/50 transition-all mb-3 flex-shrink-0">

          {/* 1. Immagine Copertina */}
          <img
            src={thumbnailSrc}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isPlaying && hasLoaded ? 'opacity-0' : 'opacity-100'}`}
            loading="lazy"
          />

          {/* 2. Video Anteprima (Lazy loaded) */}
          {hasLoaded ? (
            <video
              ref={videoRef}
              src={previewSrc}
              muted loop playsInline preload="none"
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isPlaying ? 'opacity-100' : 'opacity-0'}`}
            />
          ) : null}

          {/* Badge Durata */}
          <div className={`absolute bottom-1.5 right-1.5 bg-black/80 px-1.5 py-1 rounded-md text-xs font-bold text-white tracking-wide transition-opacity duration-200 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}>
            {video.Durata || '00:00'}
          </div>

          {/* Progress Bar (se esiste) */}
          {progressPercent > 0 && (
            <div className="absolute bottom-0 left-0 w-full h-1 bg-zinc-700/60 z-10">
              <div className="h-full bg-red-600 rounded-r-full" style={{ width: `${progressPercent}%` }} />
            </div>
          )}

          {/* Bottone Rimuovi (opzionale) */}
          {onRemove ? (
            <button
              onClick={handleRemoveClick}
              className={`
                group/btn absolute z-30 flex items-center justify-center
                transition-all duration-300 ease-out shadow-lg backdrop-blur-sm border border-white/20
                bottom-3 left-1/2 -translate-x-1/2 bg-zinc-900/30 px-4 py-2 rounded-full
                md:bottom-auto md:left-auto md:translate-x-0 md:top-2 md:right-2 md:bg-black/50 md:p-2 md:rounded-full md:opacity-0 md:group-hover:opacity-100 md:hover:bg-red-600/60 md:hover:pr-4 md:hover:pl-3
              `}
              title="Rimuovi"
            >
              <RemoveIcon size={14} className="text-white flex-shrink-0 md:w-4 md:h-4" />
              <span className="text-xs font-bold text-white whitespace-nowrap overflow-hidden transition-all duration-300 ease-out ml-2 w-auto opacity-100 md:max-w-0 md:opacity-0 md:ml-0 md:group-hover/btn:max-w-[100px] md:group-hover/btn:opacity-100 md:group-hover/btn:ml-2">
                Rimuovi
              </span>
            </button>
          ) : null}
        </div>

        {/* METADATI */}
        <div className="flex flex-col gap-1 px-1 flex-1">
          <h3 className="text-md font-bold text-white leading-tight transition-colors line-clamp-2 mb-auto" title={video.Titolo}>
            {video.Titolo}
          </h3>

          <div className="flex items-center justify-between mt-2">
            <span className="bg-zinc-900/80 border border-zinc-700 text-zinc-400 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
              {video.Nome_Categoria || 'Generale'}
            </span>

            <div className="flex items-center gap-3 text-zinc-500 text-xs">
              <div className="flex items-center gap-1"><Eye className="h-3 w-3" /><span>{video.Views || 0}</span></div>
              <div className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" /><span>{video.Likes || 0}</span></div>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}

// OTTIMIZZAZIONE: React.memo
// Fondamentale per evitare scatti durante lo scroll
export default React.memo(VideoCard);