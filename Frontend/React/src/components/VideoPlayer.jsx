import React, { useEffect, useRef, useState } from 'react';
import Plyr from 'plyr';
import { apiRequest } from '../services/api';
import { Loader2, AlertCircle } from 'lucide-react';
import 'plyr/dist/plyr.css';

export default function VideoPlayer({ src, poster, videoId, startTime = 0 }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const seekTargetRef = useRef(0);
  const [isInternalLoading, setIsInternalLoading] = useState(true);
  const [formatError, setFormatError] = useState(false);
  const loadingTimeoutRef = useRef(null);

  // --- CHECK FORMATO SUPPORTATO ---
  const checkVideoSupport = (path) => {
    if (!path) return true;

    // 1. Estrai estensione
    let ext = '';
    try {
      const urlObj = new URL(path, window.location.origin);
      const params = new URLSearchParams(urlObj.search);
      const fileParam = params.get('file');
      ext = (fileParam || urlObj.pathname).split('.').pop().toLowerCase();
    } catch (e) {
      ext = path.split('.').pop().toLowerCase();
    }

    // 2. Mappa MIME Types dei formati "a rischio"
    const mimeMap = {
      'mkv': 'video/x-matroska',
      'avi': 'video/x-msvideo',
      'wmv': 'video/x-ms-wmv',
      'flv': 'video/x-flv',
      'mov': 'video/quicktime', // Safari ok, altri forse no
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'ogv': 'video/ogg'
    };

    const mime = mimeMap[ext];

    // Se non conosciamo il MIME, assumiamo sia supportato (o lasciamo fare al browser)
    if (!mime) return true;

    // 3. Usa HTML5 Video API per controllare il supporto
    const tempVideo = document.createElement('video');
    const canPlay = tempVideo.canPlayType(mime);

    // "" -> Non supportato
    // "maybe" / "probably" -> Supportato
    return canPlay !== "";
  };

  const getExtension = (path) => {
    if (!path) return '';
    try {
      const urlObj = new URL(path, window.location.origin);
      const params = new URLSearchParams(urlObj.search);
      const fileParam = params.get('file');
      return (fileParam || urlObj.pathname).split('.').pop().toLowerCase();
    } catch (e) {
      return path.split('.').pop().toLowerCase();
    }
  };

  useEffect(() => {
    setFormatError(false);

    // CONTROLLO PROATTIVO: Se il browser ci dice già "NO", mostriamo errore subito.
    const isSupported = checkVideoSupport(src);
    if (!isSupported) {
      setFormatError(true);
      setIsInternalLoading(false);
    }
  }, [src]);

  // --- SAVE PROGRESS ---
  const saveProgress = async (currentTime) => {
    if (!videoId || currentTime < 5) return;
    try {
      const formData = new FormData();
      formData.append('id_video', videoId);
      formData.append('progresso', Math.floor(currentTime));
      await apiRequest('/aggiornaMinutaggio.php', 'POST', formData, false);
    } catch (e) {
      console.warn("Save progress failed", e);
    }
  };

  // --- 1. GESTIONE SHORTCUTS TASTIERA ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      // A. Protezione Input: Se l'utente scrive, ignora le shortcut
      const tagName = document.activeElement.tagName.toLowerCase();
      const isInput = tagName === 'input' || tagName === 'textarea' || document.activeElement.isContentEditable;
      if (isInput) return;

      const player = playerRef.current;
      if (!player) return;

      // B. Mappatura Tasti
      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault(); // Evita lo scroll della pagina con spazio
          player.togglePlay();
          break;

        case 'f':
          e.preventDefault();
          player.fullscreen.toggle();
          break;

        case 'arrowright':
        case 'l':
          e.preventDefault();
          player.forward(10); // Salta avanti 10s
          break;

        case 'arrowleft':
        case 'j':
          e.preventDefault();
          player.rewind(10); // Salta indietro 10s
          break;

        case 'm':
          player.muted = !player.muted;
          break;
      }
    };

    // Aggiungi listener globale
    document.addEventListener('keydown', handleKeyDown);

    // Rimuovi listener quando il componente viene smontato
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // Dipendenze vuote: la ref è stabile

  // --- 2. INIZIALIZZAZIONE PLYR (Eseguito una sola volta) ---
  useEffect(() => {
    if (!videoRef.current) return;

    const options = {
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'],
      autoplay: true,
      muted: false,
      hideControls: true,
      resetOnEnd: true,
      clickToPlay: true,
      iphone: { playsinline: true },
      fullscreen: { enabled: true, fallback: true, iosNative: true },
      storage: { enabled: false },
      // Disabilitiamo le shortcut native di Plyr per usare le nostre globali (evita conflitti)
      keyboard: { focused: false, global: false },
      seekTime: 10, // Default seek time per i click UI
    };

    const player = new Plyr(videoRef.current, options);
    playerRef.current = player;

    // EVENTI
    player.on('loadedmetadata', () => {
      // FIX SAFARI: Riconvalida il supporto. Se è false, NON resettare l'errore.
      const isSupported = checkVideoSupport(src);
      // Su iOS siamo severi. Su Desktop/Android, se è arrivato qui, lasciamolo andare.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      if (isIOS && !isSupported) {
        setFormatError(true);
        return;
      }

      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
      setFormatError(false);
      const target = seekTargetRef.current;
      if (target > 5) {
        const safeTime = Math.max(0, target - 3);
        player.currentTime = safeTime;
      }
      setIsInternalLoading(false);
      const playPromise = player.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => console.log("Autoplay bloccato"));
      }
    });

    player.on('error', () => {
      const ext = getExtension(src);
      const suspicious = ['avi', 'mkv', 'flv', 'wmv', 'divx', 'xvid'];

      // Mostriamo l'errore personalizzato solo se l'estensione è "sospetta"
      // e il player ha effettivamente fallito il caricamento.
      if (suspicious.includes(ext)) {
        setFormatError(true);
        setIsInternalLoading(false);
      }
    });

    player.on('playing', () => {
      // Stessa logica: su iOS blocchiamo, altrove ci fidiamo del fatto che sta suonando
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS && !checkVideoSupport(src)) return;

      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
      setFormatError(false);
      setIsInternalLoading(false);
    });
    player.on('waiting', () => setIsInternalLoading(true));
    player.on('canplay', () => {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS && !checkVideoSupport(src)) return;

      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
      setFormatError(false);
      setIsInternalLoading(false);
    });

    // Listener diretto sull'elemento video per errori che Plyr potrebbe perdere (Safari Fix)
    const videoEl = videoRef.current;
    if (videoEl) {
      videoEl.onerror = () => {
        const ext = getExtension(src);
        if (['avi', 'mkv', 'flv', 'wmv', 'divx', 'xvid'].includes(ext)) {
          setFormatError(true);
          setIsInternalLoading(false);
        }
      };
    }

    player.on('timeupdate', (event) => {
      const time = event.detail.plyr.currentTime;
      if (Math.floor(time) > 0 && Math.floor(time) % 10 === 0) {
        saveProgress(time);
      }
    });

    player.on('pause', () => saveProgress(player.currentTime));
    player.on('enterfullscreen', () => document.body.classList.add('video-fullscreen-active'));
    player.on('exitfullscreen', () => document.body.classList.remove('video-fullscreen-active'));

    return () => {
      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
      if (playerRef.current) {
        saveProgress(playerRef.current.currentTime);
        playerRef.current.destroy();
      }
    };
  }, []);

  // --- 3. GESTIONE CAMBIO VIDEO (Reattiva) ---
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !src || formatError) return;

    setIsInternalLoading(true);
    setFormatError(false);
    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);

    // SAFETY TIMEOUT per Safari/iOS:
    // Se è un formato "sospetto" e non carica nulla dopo 6 secondi, mostriamo l'errore.
    const ext = getExtension(src);
    const mimeMap = { 'mkv': 1, 'avi': 1, 'flv': 1, 'wmv': 1, 'divx': 1, 'xvid': 1 };

    if (mimeMap[ext]) {
      loadingTimeoutRef.current = setTimeout(() => {
        if (isInternalLoading && !player.playing) {
          console.warn("Playback timeout: suspicious format not loading.");
          setFormatError(true);
          setIsInternalLoading(false);
        }
      }, 4000); // Ridotto a 4s per feedback più rapido
    }

    seekTargetRef.current = Number(startTime);

    player.source = {
      type: 'video',
      title: 'Video Player',
      sources: [{ src: src, type: 'video/mp4' }],
      poster: poster,
    };
  }, [src, videoId, startTime]);

  return (
    <div className="w-full bg-black rounded-xl shadow-2xl relative z-0 aspect-video group overflow-hidden">

      {/* OVERLAY DI CARICAMENTO */}
      {isInternalLoading && !formatError ? (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-500 pointer-events-none opacity-100"
        >
          <Loader2 className="h-10 w-10 animate-spin text-[var(--primary-color)]" />
        </div>
      ) : null}

      {/* ERROR UI PER FORMATI NON SUPPORTATI */}
      {formatError ? (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-zinc-900/95 backdrop-blur-md p-4 sm:p-6 text-center">
          <div className="bg-red-500/20 p-2 sm:p-3 rounded-full mb-2 sm:mb-4">
            <AlertCircle className="h-6 w-6 sm:h-10 sm:w-10 text-red-500" />
          </div>
          <h3 className="text-base sm:text-xl font-bold text-white mb-1 sm:mb-2 leading-tight">Formato Non Supportato</h3>
          <p className="text-zinc-400 text-[10px] sm:text-sm max-w-[280px] sm:max-w-md mb-3 sm:mb-6 leading-relaxed">
            Il browser non supporta la riproduzione diretta di questo file.
            Prova a convertirlo in MP4.
          </p>
          <a
            href="/"
            className="px-4 py-2 sm:px-6 sm:py-3 bg-[var(--primary-color)] text-white text-xs sm:text-sm font-bold rounded-xl hover:brightness-110 transition-all active:scale-95"
          >
            Torna alla Home
          </a>
        </div>
      ) : null}

      {/* STILI INTEGRATI E DINAMICI */}
      <style>{`
        /* Configurazione Variabili Plyr mappate al tema globale */
        .plyr {
        }

        /* Fix Fullscreen */
        .plyr--fullscreen-active {
            z-index: 9999 !important;
            position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; background: black !important;
            border-radius: 0 !important;
        }
        .plyr--fullscreen-active video { 
            object-fit: contain !important; height: 100% !important; width: 100% !important; 
        }
      `}</style>

      <video ref={videoRef} className="plyr" playsInline controls crossOrigin="anonymous" preload="metadata"></video>
    </div>
  );
}