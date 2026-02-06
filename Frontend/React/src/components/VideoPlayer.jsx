import React, { useEffect, useRef, useState } from 'react';
import Plyr from 'plyr';
import { apiRequest } from '../services/api';
import { Loader2 } from 'lucide-react'; 
import 'plyr/dist/plyr.css'; 

export default function VideoPlayer({ src, poster, videoId, startTime = 0 }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const seekTargetRef = useRef(0);
  const [isInternalLoading, setIsInternalLoading] = useState(true);

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
        switch(e.key.toLowerCase()) {
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

    player.on('playing', () => setIsInternalLoading(false));
    player.on('waiting', () => setIsInternalLoading(true));
    player.on('canplay', () => setIsInternalLoading(false));

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
      if (playerRef.current) {
        saveProgress(playerRef.current.currentTime);
        playerRef.current.destroy();
      }
    };
  }, []); 

  // --- 3. GESTIONE CAMBIO VIDEO (Reattiva) ---
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !src) return;

    setIsInternalLoading(true);
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
      <div 
        className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-500 pointer-events-none ${isInternalLoading ? 'opacity-100' : 'opacity-0'}`}
      >
         <Loader2 className="h-10 w-10 animate-spin text-[var(--primary-color)]" />
      </div>

      {/* STILI INTEGRATI E DINAMICI */}
      <style>{`
        /* Configurazione Variabili Plyr mappate al tema globale */
        .plyr {
            --plyr-color-main: var(--primary-color, #dc2626);
            --plyr-video-control-color: #ffffff;
            --plyr-range-track-height: 6px;
            --plyr-range-thumb-height: 14px;
            --plyr-range-thumb-active-scale: 1.2;
            
            border-radius: 1rem;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
            font-family: inherit;
        }

        /* Pulsante Play Centrale */
        .plyr--video .plyr__control--overlaid {
            background: var(--plyr-color-main);
            opacity: 0.9;
            transition: transform 0.3s ease, background 0.3s ease, filter 0.3s ease;
        }

        .plyr--video .plyr__control--overlaid:hover {
            background: var(--plyr-color-main) !important;
            filter: brightness(0.8);
            transform: translate(-50%, -50%) scale(1.1) !important;
        }

        /* Colore Barra Progresso e Volume */
        .plyr--full-ui input[type=range] {
            color: var(--plyr-color-main);
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