import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Plyr from "plyr";
import { apiRequest } from "../services/api";
import { getAssetUrl } from "../services/helpers";
import { Loader2, AlertCircle, Type, X } from "lucide-react";
import "plyr/dist/plyr.css";

// Etichette leggibili per le tracce sottotitoli (codici ISO -> nome lingua).
const SUB_LANG_LABEL = {
  it: "Italiano",
  en: "Inglese",
  es: "Spagnolo",
  fr: "Francese",
  de: "Tedesco",
  pt: "Portoghese",
};

// ---- Personalizzazione aspetto sottotitoli (pannello "Aa" nel player) ----
// Le preferenze sono salvate in localStorage e applicate via variabili CSS
// all'elemento .plyr__caption. Niente persistenza server (scelta voluta).
const SUB_STORAGE_KEY = "franzplay_sub_style";
const DEFAULT_SUB_STYLE = { size: "m", bg: "black", opacity: 50, font: "sans", outline: "shadow" };

const SUB_SIZES = [
  { key: "s", label: "Piccolo", value: "clamp(11px, 1.7vw, 17px)" },
  { key: "m", label: "Medio", value: "clamp(14px, 2.2vw, 22px)" },
  { key: "l", label: "Grande", value: "clamp(16px, 2.9vw, 30px)" },
  { key: "xl", label: "Molto grande", value: "clamp(20px, 3.7vw, 42px)" },
];
const SUB_FONTS = [
  { key: "sans", label: "Sans", value: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { key: "verdana", label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { key: "trebuchet", label: "Trebuchet", value: "'Trebuchet MS', Verdana, sans-serif" },
];
const SUB_OUTLINES = [
  { key: "none", label: "Nessuno", value: "none" },
  { key: "shadow", label: "Ombra", value: "0 2px 4px rgba(0,0,0,.95)" },
  {
    key: "outline",
    label: "Contorno",
    value:
      "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px rgba(0,0,0,.9)",
  },
];
const SUB_BG_COLORS = [
  { key: "black", label: "Nero", rgb: "0,0,0" },
  { key: "gray", label: "Grigio", rgb: "45,45,45" },
  { key: "none", label: "Nessuno", rgb: null },
];

// MIME dei container video supportati: serve passare il tipo corretto a Plyr/HTML5
// altrimenti Safari/Chrome possono rifiutare il source o sbagliare il demuxer.
const VIDEO_MIME_MAP = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
};

export default function VideoPlayer({ src, poster, videoId, startTime = 0, subtitles = [] }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const seekTargetRef = useRef(0);
  const srcRef = useRef(src);
  const lastSavedRef = useRef(0);
  const [isInternalLoading, setIsInternalLoading] = useState(true);
  const [formatError, setFormatError] = useState(false);
  const loadingTimeoutRef = useRef(null);

  // --- Aspetto sottotitoli (persistito in localStorage) ---
  const [subStyle, setSubStyle] = useState(() => {
    try {
      const raw = localStorage.getItem(SUB_STORAGE_KEY);
      return raw ? { ...DEFAULT_SUB_STYLE, ...JSON.parse(raw) } : DEFAULT_SUB_STYLE;
    } catch {
      return DEFAULT_SUB_STYLE;
    }
  });
  const [subPanelOpen, setSubPanelOpen] = useState(false);
  // I sottotitoli sono attualmente visibili? Il pulsante "Aa" appare solo allora.
  const [captionsActive, setCaptionsActive] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(subStyle));
    } catch {
      /* storage non disponibile: ignora */
    }
  }, [subStyle]);

  const setSub = (patch) => setSubStyle((prev) => ({ ...prev, ...patch }));

  // Quando il bottom-sheet mobile è aperto, alza i sottotitoli reali del player
  // così restano visibili sopra al pannello (l'utente vede l'effetto live).
  useEffect(() => {
    const coarse =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (subPanelOpen && coarse) document.body.classList.add("fp-sub-sheet-open");
    else document.body.classList.remove("fp-sub-sheet-open");
    return () => document.body.classList.remove("fp-sub-sheet-open");
  }, [subPanelOpen]);

  // --- CHECK FORMATO SUPPORTATO ---
  const checkVideoSupport = (path) => {
    if (!path) return true;

    // 1. Estrai estensione
    let ext = "";
    try {
      const urlObj = new URL(path, window.location.origin);
      const params = new URLSearchParams(urlObj.search);
      const fileParam = params.get("file");
      ext = (fileParam || urlObj.pathname).split(".").pop().toLowerCase();
    } catch (e) {
      ext = path.split(".").pop().toLowerCase();
    }

    const mime = VIDEO_MIME_MAP[ext];

    // Se non conosciamo il MIME, assumiamo sia supportato (o lasciamo fare al browser)
    if (!mime) return true;

    // 3. Usa HTML5 Video API per controllare il supporto
    const tempVideo = document.createElement("video");
    const canPlay = tempVideo.canPlayType(mime);

    // "" -> Non supportato
    // "maybe" / "probably" -> Supportato
    return canPlay !== "";
  };

  const getExtension = (path) => {
    if (!path) return "";
    try {
      const urlObj = new URL(path, window.location.origin);
      const params = new URLSearchParams(urlObj.search);
      const fileParam = params.get("file");
      return (fileParam || urlObj.pathname).split(".").pop().toLowerCase();
    } catch (e) {
      return path.split(".").pop().toLowerCase();
    }
  };

  useEffect(() => {
    setFormatError(false);

    srcRef.current = src;
    // CONTROLLO PROATTIVO: Se il browser ci dice già "NO", mostriamo errore subito.
    const isSupported = checkVideoSupport(src);
    if (!isSupported) {
      setFormatError(true);
      setIsInternalLoading(false);
    }
  }, [src]);

  // --- SAVE PROGRESS (debounce reale: max 1 chiamata ogni 10s) ---
  const saveProgress = async (currentTime, force = false) => {
    if (!videoId || currentTime < 5) return;
    const sec = Math.floor(currentTime);
    if (!force && Math.abs(sec - lastSavedRef.current) < 10) return;
    lastSavedRef.current = sec;
    try {
      const formData = new FormData();
      formData.append("id_video", videoId);
      formData.append("progresso", sec);
      await apiRequest("/aggiornaMinutaggio.php", "POST", formData, false);
    } catch (e) {
      console.warn("Save progress failed", e);
    }
  };

  // --- 1. GESTIONE SHORTCUTS TASTIERA ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      // A. Protezione Input: Se l'utente scrive, ignora le shortcut
      const tagName = document.activeElement.tagName.toLowerCase();
      const isInput =
        tagName === "input" ||
        tagName === "textarea" ||
        document.activeElement.isContentEditable;
      if (isInput) return;

      const player = playerRef.current;
      if (!player) return;

      // B. Mappatura Tasti
      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault(); // Evita lo scroll della pagina con spazio
          player.togglePlay();
          break;

        case "f":
          e.preventDefault();
          player.fullscreen.toggle();
          break;

        case "arrowright":
        case "l":
          e.preventDefault();
          player.forward(10); // Salta avanti 10s
          break;

        case "arrowleft":
        case "j":
          e.preventDefault();
          player.rewind(10); // Salta indietro 10s
          break;

        case "m":
          player.muted = !player.muted;
          break;
      }
    };

    // Aggiungi listener globale
    document.addEventListener("keydown", handleKeyDown);

    // Rimuovi listener quando il componente viene smontato
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []); // Dipendenze vuote: la ref è stabile

  // --- 2. INIZIALIZZAZIONE PLYR (Eseguito una sola volta) ---
  useEffect(() => {
    if (!videoRef.current) return;

    // Set di controlli differenziato per dispositivo. Su mobile (puntatore
    // "coarse" = touch) togliamo volume/mute: si usano i tasti fisici del device
    // e si evita di affollare la barra su schermi stretti.
    const isCoarsePointer =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    const desktopControls = [
      "play-large",
      "rewind",
      "play",
      "fast-forward",
      "progress",
      "current-time",
      "duration",
      "mute",
      "volume",
      "captions",
      "settings",
      "fullscreen",
    ];

    // Mobile = desktop senza volume e mute, e senza il toggle CC dedicato:
    // su mobile i sottotitoli si gestiscono solo dal menu Impostazioni (⚙).
    const mobileControls = desktopControls.filter(
      (c) => c !== "volume" && c !== "mute" && c !== "captions",
    );

    const options = {
      controls: isCoarsePointer ? mobileControls : desktopControls,
      settings: ["captions", "speed", "loop"],
      // current-time mostra il tempo RIMANENTE; click per alternare con il trascorso.
      invertTime: true,
      toggleInvert: true,
      // Velocità disponibili nel menu impostazioni.
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
      // I sottotitoli partono spenti: l'utente li attiva dal menu CC.
      captions: { active: false, language: "auto", update: true },
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
      seekTime: 10, // Default seek time per rewind/fast-forward e click UI
      // Localizzazione italiana delle etichette dei controlli e dei menu.
      i18n: {
        restart: "Riavvia",
        rewind: "Indietro di {seektime}s",
        play: "Riproduci",
        pause: "Pausa",
        fastForward: "Avanti di {seektime}s",
        seek: "Cerca",
        seekLabel: "{currentTime} di {duration}",
        played: "Riprodotto",
        buffered: "Caricato",
        currentTime: "Tempo attuale",
        duration: "Durata",
        volume: "Volume",
        mute: "Disattiva audio",
        unmute: "Attiva audio",
        enableCaptions: "Attiva sottotitoli",
        disableCaptions: "Disattiva sottotitoli",
        download: "Scarica",
        enterFullscreen: "Schermo intero",
        exitFullscreen: "Esci da schermo intero",
        frameTitle: "Player per {title}",
        captions: "Sottotitoli",
        settings: "Impostazioni",
        pip: "PIP",
        menuBack: "Indietro",
        speed: "Velocità",
        normal: "Normale",
        quality: "Qualità",
        loop: "Ripeti",
        start: "Inizio",
        end: "Fine",
        all: "Tutti",
        reset: "Reimposta",
        disabled: "Disattivati",
        enabled: "Attivati",
        advertisement: "Pubblicità",
        qualityBadge: {
          2160: "4K",
          1440: "2K",
          1080: "FHD",
          720: "HD",
          576: "SD",
          480: "SD",
        },
      },
    };

    const player = new Plyr(videoRef.current, options);
    playerRef.current = player;

    // EVENTI
    player.on("loadedmetadata", () => {
      // FIX SAFARI: Riconvalida il supporto. Se è false, NON resettare l'errore.
      const isSupported = checkVideoSupport(srcRef.current);
      // Su iOS siamo severi. Su Desktop/Android, se è arrivato qui, lasciamolo andare.
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

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

    player.on("error", () => {
      const ext = getExtension(srcRef.current);
      const suspicious = ["avi", "mkv", "flv", "wmv", "divx", "xvid"];

      // Mostriamo l'errore personalizzato solo se l'estensione è "sospetta"
      // e il player ha effettivamente fallito il caricamento.
      if (suspicious.includes(ext)) {
        setFormatError(true);
        setIsInternalLoading(false);
      }
    });

    player.on("playing", () => {
      // Stessa logica: su iOS blocchiamo, altrove ci fidiamo del fatto che sta suonando
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (isIOS && !checkVideoSupport(srcRef.current)) return;

      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
      setFormatError(false);
      setIsInternalLoading(false);
    });
    player.on("waiting", () => setIsInternalLoading(true));
    player.on("canplay", () => {
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (isIOS && !checkVideoSupport(srcRef.current)) return;

      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
      setFormatError(false);
      setIsInternalLoading(false);
    });

    // Listener diretto sull'elemento video per errori che Plyr potrebbe perdere (Safari Fix)
    const videoEl = videoRef.current;
    if (videoEl) {
      videoEl.onerror = () => {
        const ext = getExtension(srcRef.current);
        if (["avi", "mkv", "flv", "wmv", "divx", "xvid"].includes(ext)) {
          setFormatError(true);
          setIsInternalLoading(false);
        }
      };
    }

    player.on("timeupdate", (event) => {
      const time = event.detail.plyr.currentTime;
      saveProgress(time);
    });

    player.on("pause", () => saveProgress(player.currentTime, true));
    player.on("enterfullscreen", () =>
      document.body.classList.add("video-fullscreen-active"),
    );
    player.on("exitfullscreen", () =>
      document.body.classList.remove("video-fullscreen-active"),
    );

    // Stato sottotitoli: il pulsante "Aa" deve comparire solo quando i
    // sottotitoli sono effettivamente attivi (l'utente li ha accesi dal menu CC).
    player.on("captionsenabled", () => setCaptionsActive(true));
    player.on("captionsdisabled", () => {
      setCaptionsActive(false);
      setSubPanelOpen(false); // chiudi il pannello se i sottotitoli vengono spenti
    });

    return () => {
      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
      if (playerRef.current) {
        saveProgress(playerRef.current.currentTime, true);
        playerRef.current.destroy();
      }
    };
  }, []);

  // --- 3. GESTIONE CAMBIO VIDEO (Reattiva) ---
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !src || formatError) return;

    srcRef.current = src;
    lastSavedRef.current = 0;
    setIsInternalLoading(true);
    setFormatError(false);
    // Nuovo video: i sottotitoli ripartono spenti, quindi nascondi il pulsante "Aa".
    setCaptionsActive(false);
    setSubPanelOpen(false);
    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);

    const ext = getExtension(src);

    // Safety timeout per container "a rischio" sul demuxer del browser.
    const riskyExt = { mkv: 1, avi: 1, flv: 1, wmv: 1, divx: 1, xvid: 1 };
    if (riskyExt[ext]) {
      loadingTimeoutRef.current = setTimeout(() => {
        if (isInternalLoading && !player.playing) {
          console.warn("Playback timeout: suspicious format not loading.");
          setFormatError(true);
          setIsInternalLoading(false);
        }
      }, 4000);
    }

    seekTargetRef.current = Number(startTime);

    // Preload adattivo: se ripartiamo da metà video meglio "auto" per evitare
    // un secondo round Range subito dopo i metadati. Altrimenti "metadata"
    // per non sprecare banda su un video che potrebbe non venire avviato.
    if (videoRef.current) {
      videoRef.current.preload = Number(startTime) > 0 ? "auto" : "metadata";
    }

    // Tracce sottotitoli WebVTT (servite via stream.php autenticato). Plyr le
    // espone nel menu CC. La prima trascrizione disponibile è marcata default
    // ma resta spenta (captions.active=false), così non si attiva da sola.
    const tracks = (subtitles || [])
      .filter((s) => s && s.percorso_file)
      .map((s, idx) => ({
        kind: "captions",
        label:
          (SUB_LANG_LABEL[s.lingua] || (s.lingua || "").toUpperCase()) +
          (s.tipo === "traduzione" ? " (traduzione)" : ""),
        srclang: s.lingua,
        src: getAssetUrl(s.percorso_file),
        default: idx === 0,
      }));

    player.source = {
      type: "video",
      title: "Video Player",
      sources: [{ src, type: VIDEO_MIME_MAP[ext] || "video/mp4" }],
      poster,
      tracks,
    };
  }, [src, videoId, startTime, subtitles]);

  // Calcolo delle variabili CSS dei sottotitoli dalle preferenze.
  const hasSubs =
    Array.isArray(subtitles) && subtitles.filter((s) => s && s.percorso_file).length > 0;
  // Touch: niente hover → il pulsante "Aa" deve restare sempre visibile.
  const isCoarse =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const sizeVal = (SUB_SIZES.find((s) => s.key === subStyle.size) || SUB_SIZES[1]).value;
  const fontVal = (SUB_FONTS.find((f) => f.key === subStyle.font) || SUB_FONTS[0]).value;
  const outlineVal = (SUB_OUTLINES.find((o) => o.key === subStyle.outline) || SUB_OUTLINES[1]).value;
  const bgDef = SUB_BG_COLORS.find((b) => b.key === subStyle.bg) || SUB_BG_COLORS[0];
  const bgVal = bgDef.rgb ? `rgba(${bgDef.rgb}, ${subStyle.opacity / 100})` : "transparent";

  const subVars = {
    "--fp-sub-size": sizeVal,
    "--fp-sub-font": fontVal,
    "--fp-sub-shadow": outlineVal,
    "--fp-sub-bg": bgVal,
  };

  // Contenuto del pannello aspetto sottotitoli (riusato in popover desktop e
  // bottom-sheet mobile).
  const panelInner = (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-black uppercase tracking-widest text-zinc-400">Aspetto sottotitoli</span>
        <button
          type="button"
          onClick={() => setSubPanelOpen(false)}
          className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10"
        >
          <X size={16} />
        </button>
      </div>

      {/* Dimensione */}
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">Dimensione</p>
        <div className="grid grid-cols-4 gap-1">
          {SUB_SIZES.map((s) => (
            <button
              key={s.key}
              onClick={() => setSub({ size: s.key })}
              title={s.label}
              className={`py-1.5 rounded-lg text-xs font-bold transition-all ${subStyle.size === s.key ? "bg-[var(--primary-color)] text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`}
            >
              {s.key.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Sfondo + opacità */}
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">Sfondo</p>
        <div className="grid grid-cols-3 gap-1 mb-2">
          {SUB_BG_COLORS.map((b) => (
            <button
              key={b.key}
              onClick={() => setSub({ bg: b.key })}
              className={`py-1.5 rounded-lg text-xs font-bold transition-all ${subStyle.bg === b.key ? "bg-[var(--primary-color)] text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className={`flex items-center gap-2 ${subStyle.bg === "none" ? "opacity-40 pointer-events-none" : ""}`}>
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 w-12">Opacità</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={subStyle.opacity}
            onChange={(e) => setSub({ opacity: Number(e.target.value) })}
            className="flex-1 accent-[var(--primary-color)]"
          />
          <span className="text-[10px] font-bold text-zinc-400 w-8 text-right">{subStyle.opacity}%</span>
        </div>
      </div>

      {/* Font */}
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">Font</p>
        <div className="grid grid-cols-3 gap-1">
          {SUB_FONTS.map((f) => (
            <button
              key={f.key}
              onClick={() => setSub({ font: f.key })}
              className={`py-1.5 rounded-lg text-xs font-bold transition-all ${subStyle.font === f.key ? "bg-[var(--primary-color)] text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contorno */}
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">Contorno</p>
        <div className="grid grid-cols-3 gap-1">
          {SUB_OUTLINES.map((o) => (
            <button
              key={o.key}
              onClick={() => setSub({ outline: o.key })}
              className={`py-1.5 rounded-lg text-xs font-bold transition-all ${subStyle.outline === o.key ? "bg-[var(--primary-color)] text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Anteprima */}
      <div className="rounded-xl bg-black/60 border border-white/5 py-3 px-2 flex items-end justify-center min-h-[52px]">
        <span
          style={{
            fontFamily: fontVal,
            fontSize: "clamp(13px, 3.5vw, 18px)",
            background: bgVal,
            textShadow: outlineVal,
            color: "#fff",
            padding: "0.1em 0.4em",
            borderRadius: "3px",
            lineHeight: 1.3,
          }}
        >
          Anteprima sottotitolo
        </span>
      </div>

      <button
        onClick={() => setSubStyle(DEFAULT_SUB_STYLE)}
        className="w-full mt-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold transition-all"
      >
        Ripristina predefiniti
      </button>
    </>
  );

  return (
    <div
      className="w-full bg-black rounded-xl shadow-2xl relative z-0 aspect-video group overflow-hidden"
      style={subVars}
    >
      {/* OVERLAY DI CARICAMENTO */}
      {isInternalLoading && !formatError ? (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-500 pointer-events-none opacity-100">
          <Loader2 className="h-10 w-10 animate-spin text-[var(--primary-color)]" />
        </div>
      ) : null}

      {/* ERROR UI PER FORMATI NON SUPPORTATI */}
      {formatError ? (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-zinc-900/95 backdrop-blur-md p-4 sm:p-6 text-center">
          <div className="bg-red-500/20 p-2 sm:p-3 rounded-full mb-2 sm:mb-4">
            <AlertCircle className="h-6 w-6 sm:h-10 sm:w-10 text-red-500" />
          </div>
          <h3 className="text-base sm:text-xl font-bold text-white mb-1 sm:mb-2 leading-tight">
            Formato Non Supportato
          </h3>
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

      {/* PULSANTE + PANNELLO ASPETTO SOTTOTITOLI (solo se i sottotitoli sono ATTIVI) */}
      {hasSubs && captionsActive && !formatError ? (
        <>
          <button
            type="button"
            onClick={() => setSubPanelOpen((o) => !o)}
            title="Aspetto sottotitoli"
            className={`absolute top-3 right-3 z-[57] flex items-center gap-1 px-2.5 py-1.5 rounded-lg backdrop-blur-md border border-white/15 text-white text-xs font-bold transition-all active:scale-95 ${
              subPanelOpen
                ? "bg-[var(--primary-color)]"
                : isCoarse
                  ? "bg-black/55 hover:bg-black/70" // touch: sempre visibile (niente hover)
                  : "bg-black/45 hover:bg-black/70 opacity-0 group-hover:opacity-100 focus:opacity-100"
            }`}
          >
            <Type size={15} /> Aa
          </button>

          {subPanelOpen
            ? isCoarse
              ? // MOBILE/TOUCH: bottom-sheet in portale (non viene tagliato dall'overflow del player).
                createPortal(
                  <div className="fixed inset-0 z-[9999] flex items-end justify-center pointer-events-none">
                    {/* Catcher TRASPARENTE: chiude al tap fuori ma lascia VEDERE il video dietro. */}
                    <div
                      className="absolute inset-0 pointer-events-auto"
                      onClick={() => setSubPanelOpen(false)}
                    />
                    {/* Sheet compatto e semi-trasparente: il video resta visibile sopra. */}
                    <div className="relative pointer-events-auto w-full max-w-md max-h-[58vh] overflow-y-auto bg-zinc-900/85 backdrop-blur-md border-t border-white/10 rounded-t-3xl shadow-2xl p-4 pb-8 text-white animate-in slide-in-from-bottom duration-300">
                      <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/20" />
                      {panelInner}
                    </div>
                  </div>,
                  document.body,
                )
              : // DESKTOP: popover ancorato al pulsante dentro al player.
                (
                  <div className="absolute top-12 right-3 z-[58] w-[280px] max-w-[calc(100%-1.5rem)] bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 text-white">
                    {panelInner}
                  </div>
                )
            : null}
        </>
      ) : null}

      {/* STILI INTEGRATI E DINAMICI */}
      <style>{`
        /* Configurazione Variabili Plyr mappate al tema globale */
        .plyr {
        }

        /* Aspetto sottotitoli personalizzato (variabili ereditate dal container).
           Stilizziamo lo span .plyr__caption: dimensione, font, sfondo, contorno. */
        .plyr__captions {
            font-size: var(--fp-sub-size, clamp(16px, 2.9vw, 30px)) !important;
        }
        .plyr__caption {
            font-family: var(--fp-sub-font, sans-serif) !important;
            background: var(--fp-sub-bg, rgba(0,0,0,.75)) !important;
            text-shadow: var(--fp-sub-shadow, 0 2px 4px rgba(0,0,0,.95)) !important;
            color: #fff !important;
            border-radius: 4px;
            line-height: 1.35;
            padding: 0.1em 0.45em;
            box-decoration-break: clone;
            -webkit-box-decoration-break: clone;
        }

        /* Mentre il pannello mobile è aperto, solleviamo i sottotitoli verso l'alto
           così restano visibili sopra al bottom-sheet (anteprima live sul video). */
        .plyr__captions { transition: bottom .25s ease; }
        body.fp-sub-sheet-open .plyr__captions {
            bottom: 35% !important;
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

      <video
        ref={videoRef}
        className="plyr"
        playsInline
        preload="metadata"
      ></video>
    </div>
  );
}
