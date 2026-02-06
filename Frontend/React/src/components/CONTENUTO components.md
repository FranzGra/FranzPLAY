# 📂 Export Contenuti: components
> Percorso: `G:\Sincronizzazione\Onedrive Backup\OneDrive - Franz's Industries\File nei SERVER\Server Raspberry Pi 4\Progetti HTTP\FranzTube\FranzTube React\Frontend\React\src\components`
> File ignorati da ignore.txt: 3

## 📑 Indice dei file inclusi
- [Comments.jsx](#file-commentsjsx)
- [Navbar.jsx](#file-navbarjsx)
- [PageTransition.jsx](#file-pagetransitionjsx)
- [VideoCard.jsx](#file-videocardjsx)
- [VideoPlayer.jsx](#file-videoplayerjsx)

---


## <a id="file-commentsjsx"></a>📄 Comments.jsx
``` javascript
import React, { useState, useEffect, useRef } from 'react';
import { Send, Trash2, User, Loader2 } from 'lucide-react';
import { apiRequest } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function Comments({ videoId }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(null); // ID commento in fase di eliminazione
  const commentsEndRef = useRef(null);

  // Carica commenti
  const fetchComments = async () => {
    try {
      const formData = new FormData();
      formData.append('action', 'leggi');
      formData.append('id_video', videoId);
      
      const res = await apiRequest('/commenti.php', 'POST', formData);
      if (res.successo) setComments(res.dati);
    } catch (error) {
      console.error("Errore commenti:", error);
    }
  };

  useEffect(() => {
    if (videoId) fetchComments();
  }, [videoId]);

  // Invia commento
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('action', 'scrivi');
      formData.append('id_video', videoId);
      formData.append('testo', newComment);

      const res = await apiRequest('/commenti.php', 'POST', formData);
      if (res.successo) {
        setNewComment('');
        await fetchComments();
        // Scroll all'ultimo commento
        setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    } catch (error) {
      alert("Errore invio commento: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Elimina commento
  const handleDelete = async (commentId) => {
    if (!window.confirm("Eliminare questo commento?")) return;
    
    setIsDeleting(commentId);
    try {
      const formData = new FormData();
      formData.append('action', 'elimina');
      formData.append('id_commento', commentId);
      
      const res = await apiRequest('/commenti.php', 'POST', formData);
      if (res.successo) {
        setComments(prev => prev.filter(c => c.id !== commentId));
      }
    } catch (error) {
      alert("Impossibile eliminare");
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <div className="glass-box p-4 md:p-6 h-full flex flex-col rounded-xl border border-white/5 bg-black/20">
      <h3 className="text-xl font-bold text-white mb-4 border-b border-white/10 pb-2 flex justify-between items-baseline">
        Commenti 
        <span className="text-sm font-normal text-zinc-400">({comments.length})</span>
      </h3>

      {/* Lista Commenti */}
      <div 
        className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar min-h-[300px] max-h-[500px]"
        role="log" 
        aria-live="polite"
      >
        {comments.length > 0 ? (
          comments.map((c) => (
            <div key={c.id} className="flex gap-3 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex-shrink-0 h-8 w-8 md:h-10 md:w-10 rounded-full bg-zinc-700 overflow-hidden">
                 {c.Immagine_Profilo ? (
                   <img src={`/img_utenti/${c.Immagine_Profilo}`} alt="" className="h-full w-full object-cover"/>
                 ) : (
                   <div className="h-full w-full flex items-center justify-center text-zinc-400"><User size={20}/></div>
                 )}
              </div>
              
              <div className="flex-1 bg-zinc-800/50 p-3 rounded-2xl rounded-tl-none border border-white/5">
                <div className="flex justify-between items-start">
                    <span className="font-bold text-sm text-zinc-200">{c.Nome_Utente}</span>
                    <span className="text-[10px] text-zinc-500">{new Date(c.data_ora_commento).toLocaleDateString()}</span>
                </div>
                <p className="text-zinc-300 text-sm mt-1 whitespace-pre-wrap">{c.testo_commento}</p>
                
                {c.is_mio && (
                    <button 
                        onClick={() => handleDelete(c.id)} 
                        disabled={isDeleting === c.id}
                        // TEMA: Hover colorato sul tasto elimina
                        className="text-zinc-600 hover:text-[var(--primary-color)] text-xs mt-2 flex items-center gap-1 transition-colors disabled:opacity-50"
                        aria-label="Elimina il tuo commento"
                    >
                        {isDeleting === c.id ? <Loader2 size={12} className="animate-spin"/> : <Trash2 size={12}/>} 
                        {isDeleting === c.id ? 'Eliminazione...' : 'Elimina'}
                    </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 py-10">
              <User size={40} className="mb-2 opacity-20"/>
              <p>Nessun commento. Sii il primo!</p>
          </div>
        )}
        <div ref={commentsEndRef} />
      </div>

      {/* Input Commento */}
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2 pt-4 border-t border-white/10 relative">
        <label htmlFor="commentInput" className="sr-only">Scrivi un commento</label>
        <input 
          id="commentInput"
          type="text" 
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Scrivi un commento..." 
          // TEMA: Focus border e ring con colore dinamico
          className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-[var(--primary-color)] focus:ring-1 focus:ring-[var(--primary-color)] transition-colors disabled:opacity-50"
          disabled={loading}
        />
        <button 
          type="submit" 
          disabled={loading || !newComment.trim()}
          // TEMA: Background dinamico
          className="bg-[var(--primary-color)] hover:opacity-90 text-white p-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center min-w-[50px] shadow-lg shadow-[var(--primary-color)]/20"
          aria-label="Invia commento"
        >
          {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
        </button>
      </form>
    </div>
  );
}
```
---


## <a id="file-navbarjsx"></a>📄 Navbar.jsx
``` javascript
import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Search, LayoutGrid, Bookmark, LogOut, Settings, ChevronDown, X } from 'lucide-react';

export default function Navbar() {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  
  const profileRef = useRef(null);
  const inputRef = useRef(null); 
  const [searchQuery, setSearchQuery] = useState('');

  const showSearch = location.pathname === '/' || location.pathname === '/saved';

  // --- SYNC URL -> INPUT ---
  // Se cambio URL (es. clicco indietro), aggiorno l'input
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    // Aggiorniamo lo stato locale solo se siamo sulla home e c'è discrepanza
    if (location.pathname === '/' && urlQuery !== searchQuery) {
       setSearchQuery(urlQuery);
    }
  }, [location.pathname, searchParams]);

  // --- SYNC INPUT -> URL (Debounce) ---
  useEffect(() => {
    const currentUrlQuery = searchParams.get('q') || '';
    
    // Se lo stato coincide con l'URL, non fare nulla (siamo sincronizzati)
    if (searchQuery === currentUrlQuery) return;

    // 🛠️ FIX CRITICO PER IL PLAYER 🛠️
    // Se siamo finiti in una pagina diversa dalla Home (es. /watch/123) 
    // e l'input di ricerca NON ha il focus, significa che l'utente ha navigato via.
    // In questo caso, blocchiamo il redirect automatico alla ricerca.
    if (location.pathname !== '/' && document.activeElement !== inputRef.current) {
        return; 
    }

    const delayDebounceFn = setTimeout(() => {
      if (searchQuery.trim()) {
        navigate(`/?q=${searchQuery}`);
      } else if (location.pathname === '/' && currentUrlQuery) {
        // Se cancello tutto mentre sono in home, pulisco l'URL
        navigate('/');
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, navigate, location.pathname, searchParams]);

  // --- HANDLERS ---
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      navigate(`/?q=${searchQuery}`);
      inputRef.current?.blur();
      setIsSearchOpen(false);
    }
    if (e.key === 'Escape') {
      setIsSearchOpen(false);
      setIsProfileOpen(false);
      inputRef.current?.blur();
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    if (location.pathname === '/' && searchParams.get('q')) navigate('/');
    setIsSearchOpen(false); 
  };

  const handleLogout = async () => {
    await logout();
    setIsProfileOpen(false);
    navigate('/login');
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isActive = (route) => {
    if (route === '/') return location.pathname === '/';
    return location.pathname.startsWith(route);
  };

  // --- STILI BOTTONI ---
  const navBtnBase = "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-all duration-200 h-9 px-3 sm:px-4 py-2 text-sm focus:outline-none active:scale-95";
  
  // STATO ACTIVE: Usa var(--primary-color) per il background con opacità bassa e per il testo
  const getBtnClass = (route) => isActive(route) 
    ? "bg-zinc-800 text-white shadow-sm ring-1 ring-white/10" 
    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-white"; 

  const glassStyle = "bg-zinc-900/80 backdrop-blur-xl border border-white/10 shadow-lg shadow-black/30";

  return (
    <>
      <div className="fixed top-2 sm:top-4 left-0 right-0 z-50 flex flex-col items-center px-2 sm:px-4 pointer-events-none">

        {/* --- NAVBAR --- */}
        <nav 
          className="relative pointer-events-auto flex w-full max-w-7xl items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/95 backdrop-blur p-2 shadow-2xl z-20"
          aria-label="Navigazione principale"
        >

          {/* LOGO STILE "FRANZ TUBE" */}
          <Link 
            to="/" 
            className="ml-2 mr-1 flex-shrink-0 group flex items-center gap-2 focus:outline-none rounded-lg p-1 active:scale-95 transition-transform" 
            onClick={() => setSearchQuery('')} // Resetta ricerca al click su logo
            aria-label="FranzTube Home"
          >
            <div className="flex items-center tracking-tighter text-sm md:text-xl select-none">
              <span className="font-bold text-white mr-1">FRANZ</span>
              <div className="bg-[var(--primary-color)] text-white font-bold px-1.5 py-0.5 rounded-[6px] shadow-lg shadow-[var(--primary-color)]/20 leading-none pb-1 pt-1">
                TUBE
              </div>
            </div>
          </Link>

          {/* SEARCH DESKTOP */}
          {showSearch ? (
            <div className="hidden md:flex flex-1 max-w-xl mx-auto px-4 relative" role="search">
              <div className="relative w-full group">
                <Search className="absolute left-4 top-3 h-5 w-5 text-zinc-500 group-focus-within:text-[var(--primary-color)] transition-colors" aria-hidden="true" />
                <input
                  ref={inputRef} // Aggiunto ref per controllo focus
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Cerca video..."
                  aria-label="Cerca video"
                  className="w-full h-11 rounded-full border border-zinc-800 bg-zinc-900 px-4 pl-12 pr-10 text-sm text-zinc-100 focus:outline-none focus:bg-zinc-950 focus:border-[var(--primary-color)] focus:ring-1 focus:ring-[var(--primary-color)] transition-all placeholder:text-zinc-600"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')} 
                    className="absolute right-3 top-3 text-zinc-500 hover:text-white transition-colors focus:outline-none"
                    aria-label="Cancella ricerca"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="hidden md:flex flex-1" />
          )}

          {/* MENU AZIONI */}
          <div className="flex items-center gap-1 flex-shrink-0">
            
            <Link to="/categories" className={`${navBtnBase} ${getBtnClass('/categories')}`}>
              <LayoutGrid className="mr-0 sm:mr-2 h-5 w-5 sm:h-4 sm:w-4" aria-hidden="true" /> 
              <span className="hidden sm:inline">Categorie</span>
            </Link>
            
            {user && (
              <Link to="/saved" className={`${navBtnBase} ${getBtnClass('/saved')}`}>
                <Bookmark className="mr-0 sm:mr-2 h-5 w-5 sm:h-4 sm:w-4" aria-hidden="true" /> 
                <span className="hidden sm:inline">Salvati</span>
              </Link>
            )}

            <div className="h-5 w-[1px] bg-zinc-800 mx-1 hidden sm:block" aria-hidden="true"></div>
            
            {user && (
              <div className="relative" ref={profileRef}>
                <button 
                  onClick={() => setIsProfileOpen(!isProfileOpen)} 
                  className={`flex items-center gap-2 px-1 sm:px-2 py-1.5 rounded-md transition-all duration-200 focus:outline-none ${isActive('/profile') ? 'bg-zinc-800 text-white ring-1 ring-white/10' : 'hover:bg-zinc-800/50 text-zinc-400 hover:text-white'}`}
                  aria-expanded={isProfileOpen}
                  aria-haspopup="true"
                  aria-label="Menu utente"
                >
                  <div className="h-8 w-8 rounded-full bg-zinc-800 overflow-hidden ring-2 ring-zinc-900 flex items-center justify-center">
                    {user?.avatar ? <img src={`${user.avatar}?t=${Date.now()}`} alt="" className="h-full w-full object-cover" /> : <span className="text-xs font-bold text-white">{user?.username?.substring(0, 2).toUpperCase()}</span>}
                  </div>
                  <span className={`hidden lg:inline text-sm font-semibold max-w-[100px] truncate ${isActive('/profile') ? 'text-white' : 'text-zinc-200'}`}>{user.username}</span>
                  <ChevronDown className={`hidden lg:block h-3 w-3 transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>

                {isProfileOpen && (
                  <div className="absolute right-0 top-15 w-48 origin-top-right rounded-xl border border-zinc-800 bg-zinc-950 p-1.5 shadow-xl ring-1 ring-white/5 animate-in fade-in zoom-in-95 duration-200 z-50" role="menu">
                    <Link 
                        to="/profile" 
                        role="menuitem" 
                        className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white" 
                        onClick={() => setIsProfileOpen(false)}
                    >
                        <Settings className="mr-2 h-4 w-4" /> Impostazioni
                    </Link>
                    
                    <button 
                        role="menuitem" 
                        className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-950/30 hover:text-red-400 transition-colors" 
                        onClick={handleLogout}
                    >
                        <LogOut className="mr-2 h-4 w-4" /> Esci
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </nav>

        {/* --- MOBILE SEARCH --- */}
        {showSearch && (
          <div className="md:hidden w-full max-w-md mt-4 relative z-10 pointer-events-auto flex items-center justify-center gap-3">
            <div 
              onClick={() => !isSearchOpen && setIsSearchOpen(true)}
              className={`
                  ${glassStyle} flex items-center overflow-hidden transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1)
                  ${isSearchOpen ? 'flex-1 h-12 rounded-2xl px-3 justify-start' : 'w-32 h-12 rounded-full justify-center cursor-pointer active:scale-95'}
              `}
              aria-expanded={isSearchOpen}
              role="search"
            >
              <Search className="h-5 w-5 text-zinc-400 flex-shrink-0" aria-hidden="true" />
              
              <span className={`font-medium text-zinc-300 text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${isSearchOpen ? 'w-0 opacity-0 ml-0' : 'w-auto opacity-100 ml-2'}`}>
                  Cerca
              </span>

              <input 
                  // Usiamo lo stesso ref anche per mobile, oppure ne servirebbe uno dedicato se coesistono
                  // Ma qui va bene perché su mobile il desktop search è nascosto
                  ref={inputRef} 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Cerca..." 
                  aria-label="Cerca video nella libreria"
                  className={`bg-transparent border-none text-white placeholder:text-zinc-500 focus:ring-0 text-base h-full focus:outline-none transition-all duration-300 ${isSearchOpen ? 'flex-1 opacity-100 ml-3 pointer-events-auto' : 'w-0 opacity-0 ml-0 pointer-events-none'}`}
              />
              
              {isSearchOpen && searchQuery && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setSearchQuery(''); inputRef.current.focus(); }} 
                    className="p-1 text-zinc-500 hover:text-white flex-shrink-0"
                    aria-label="Cancella testo"
                  >
                      <X className="h-4 w-4 bg-zinc-800 rounded-full p-0.5" />
                  </button>
              )}
            </div>

            <div className={`transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1) overflow-hidden ${isSearchOpen ? 'w-12 opacity-100 scale-100' : 'w-0 opacity-0 scale-0'}`}>
               <button 
                  onClick={handleClearSearch}
                  className={`${glassStyle} h-12 w-12 rounded-full flex items-center justify-center text-zinc-300 hover:text-white active:scale-90`}
                  aria-label="Chiudi ricerca"
               >
                  <X className="h-6 w-6" />
               </button>
            </div>
          </div>
        )}

      </div>
    </>
  );
}
```
---


## <a id="file-pagetransitionjsx"></a>📄 PageTransition.jsx
``` javascript
import React from 'react';
import { useLocation } from 'react-router-dom';

export default function PageTransition({ children }) {
  const location = useLocation();
  const path = location.pathname;

  const styles = `
    /* --- ANIMAZIONI STANDARD --- */
    @keyframes softZoomIn { 0% { opacity: 0; transform: scale(0.98) translateY(20px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
    @keyframes softZoomOut { 0% { opacity: 0; transform: scale(1.1) translateY(100px); } 100% { opacity: 1; transform: scale(1) translateY(0px); } }
    @keyframes softSlide { 0% { opacity: 0; transform: scale(0.95) translateY(15px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
    @keyframes softLift { 0% { opacity: 0; transform: translateY(30px); } 100% { opacity: 1; transform: translateY(0); } }
    @keyframes enterFromRight { 0% { opacity: 0; transform: translateX(50px); } 100% { opacity: 1; transform: translateX(0); } }

    /* Classi */
    .anim-player { animation: softZoomIn 0.8s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
    .anim-home   { animation: softZoomOut 1s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
    .anim-button { animation: softSlide 0.6s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
    .slide-up    { animation: softLift 1.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
    .anim-slide-right { animation: enterFromRight 1s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
    .anim-default { animation: softSlide 0.6s ease-out forwards; }

    /* --- ACCESSIBILITÀ: RIDUZIONE MOVIMENTO --- */
    /* Se l'utente ha richiesto "Reduced Motion" nel sistema operativo, disabilita le animazioni */
    @media (prefers-reduced-motion: reduce) {
      .will-change-transform {
        animation: none !important;
        transform: none !important;
        transition: none !important;
      }
    }
  `;

  const getAnimationClass = () => {
    if (path.startsWith('/category/')) return 'anim-slide-right';
    if (path === '/categories') return 'anim-button';
    if (path.startsWith('/watch')) return 'anim-player';
    if (path === '/') return 'anim-home';
    if (path === '/saved') return 'anim-button';
    if (path === '/profile') return 'slide-up';
    return 'anim-default';
  };

  return (
    <>
      <style>{styles}</style>
      <div 
        key={path} 
        className={`w-full h-full overflow-hidden will-change-transform ${getAnimationClass()}`}
      >
        {children}
      </div>
    </>
  );
}
```
---


## <a id="file-videocardjsx"></a>📄 VideoCard.jsx
``` javascript
import React, { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Eye, ThumbsUp } from 'lucide-react';
import { getAssetUrl } from '../services/helpers';

const parseDurationToSeconds = (durationStr) => {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
};

export default function VideoCard({ video }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const thumbnailSrc = getAssetUrl(video.percorso_copertina);
  const previewSrc = getAssetUrl(video.percorso_anteprima);

  // --- CALCOLO PROGRESSO ---
  let progressPercent = 0;
  if (video.progresso_secondi && video.Durata) {
    const totalSeconds = parseDurationToSeconds(video.Durata);
    if (totalSeconds > 0) {
      progressPercent = Math.min(Math.max((video.progresso_secondi / totalSeconds) * 100, 0), 100);
    }
  }

  // --- GESTIONE VIDEOPREVIEW (Desktop & Mobile) ---
  useEffect(() => {
    const videoEl = videoRef.current;
    
    // Logica Play/Pause
    if (isPlaying && hasLoaded && videoEl) {
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Gestione errore autoplay (es. risparmio energetico attivo)
          setIsPlaying(false);
        });
      }
    } else if (!isPlaying && videoEl) {
      videoEl.pause();
      videoEl.currentTime = 0;
    }
  }, [isPlaying, hasLoaded]);

  // --- LISTENER PER LOGICA "SOLO UNO ALLA VOLTA" SU MOBILE ---
  useEffect(() => {
    const handleStopOthers = (e) => {
      // Se l'evento non proviene da questa card (ID diverso), ferma la riproduzione
      if (e.detail.id !== video.id) {
        setIsPlaying(false);
      }
    };

    window.addEventListener('stop-other-previews', handleStopOthers);
    return () => window.removeEventListener('stop-other-previews', handleStopOthers);
  }, [video.id]);

  // --- HANDLERS ---
  
  // Desktop: Hover classico
  const handleMouseEnter = () => {
    // Su desktop non vogliamo fermare necessariamente gli altri, ma carichiamo il video
    setHasLoaded(true);
    setIsPlaying(true);
  };

  const handleMouseLeave = () => {
    setIsPlaying(false);
  };

  // Mobile: Touch start
  const handleTouchStart = () => {
    setHasLoaded(true);
    setIsPlaying(true);
    
    // Lancia evento globale per fermare le altre card
    const event = new CustomEvent('stop-other-previews', { detail: { id: video.id } });
    window.dispatchEvent(event);
  };

  return (
    <Link 
      to={`/watch/${video.id}`} 
      className="group block p-2 rounded-2xl transition-all duration-300 hover:bg-zinc-800/50 hover:shadow-xl hover:ring-1 hover:ring-white/10 cursor-pointer focus:outline-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart} // Attiva preview su tocco
      aria-label={`Guarda ${video.Titolo}, durata ${video.Durata || 'sconosciuta'}`}
    >
      {/* WRAPPER MEDIA */}
      <div className="relative aspect-video w-full rounded-xl bg-zinc-900 overflow-hidden shadow-lg ring-1 ring-white/10 group-hover:ring-zinc-500/50 transition-all mb-3">
        
        {/* Copertina (Immagine statica) */}
        <img 
          src={thumbnailSrc} 
          alt="" // Alt vuoto perché l'immagine è descritta dal link wrapper o decorativa
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isPlaying && hasLoaded ? 'opacity-0' : 'opacity-100'}`}
          loading="lazy"
        />

        {/* Anteprima (Video) */}
        {hasLoaded && (
          <video
            ref={videoRef}
            src={previewSrc}
            muted
            loop
            playsInline // Essenziale per iOS
            preload="none"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isPlaying ? 'opacity-100' : 'opacity-0'}`}
            aria-hidden="true" // Decorativo per Screen Reader
          />
        )}

        {/* Badge Durata */}
        <div 
          className={`absolute bottom-1.5 right-1.5 bg-black/80 px-1.5 py-1 rounded-md text-xs font-bold text-white tracking-wide transition-opacity duration-200 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}
          aria-hidden="true"
        >
          {video.Durata || '00:00'}
        </div>

        {/* Barra Progresso */}
        {progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 w-full h-1 bg-zinc-700/60 z-10" role="progressbar" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100">
            <div 
              className="h-full bg-red-600 rounded-r-full" 
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* INFO */}
      <div className="flex flex-col gap-1 px-1">
        <h3 className="text-md font-bold text-white leading-tight transition-colors line-clamp-2" title={video.Titolo}>
          {video.Titolo}
        </h3>

        <div className="flex items-center justify-between mt-1">
            <span className="bg-zinc-900/80 border border-zinc-700 text-zinc-400 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                {video.Nome_Categoria || 'Generale'}
            </span>

            <div className="flex items-center gap-3 text-zinc-500 text-xs" aria-label={`${video.Views || 0} visualizzazioni, ${video.Likes || 0} mi piace`}>
                <div className="flex items-center gap-1">
                    <Eye className="h-3 w-3" aria-hidden="true" />
                    <span>{video.Views || 0}</span>
                </div>
                <div className="flex items-center gap-1">
                    <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                    <span>{video.Likes || 0}</span>
                </div>
            </div>
        </div>
      </div>
    </Link>
  );
}
```
---


## <a id="file-videoplayerjsx"></a>📄 VideoPlayer.jsx
``` javascript
import React, { useEffect, useRef, useState } from 'react';
import Plyr from 'plyr';
import { apiRequest } from '../services/api';
import { Loader2 } from 'lucide-react'; // Icona per il loading interno
import 'plyr/dist/plyr.css'; 
import '../styles/Player.css';

export default function VideoPlayer({ src, poster, videoId, startTime = 0 }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  
  // Ref per memorizzare il punto dove saltare al cambio video
  const seekTargetRef = useRef(0);
  
  // Stato per gestire un overlay di caricamento fluido durante il cambio video
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

  // --- 1. INIZIALIZZAZIONE (Eseguito una sola volta) ---
  useEffect(() => {
    if (!videoRef.current) return;

    const options = {
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'],
      autoplay: true, 
      muted: false, // Importante: Autoplay con audio spesso viene bloccato dai browser se non c'è interazione
      hideControls: true,
      resetOnEnd: true,
      clickToPlay: true,
      iphone: { playsinline: true }, 
      fullscreen: { enabled: true, fallback: true, iosNative: true },
      storage: { enabled: false }, 
    };

    // Creiamo l'istanza
    const player = new Plyr(videoRef.current, options);
    playerRef.current = player;

    // EVENTI GLOBALI PLAYER
    
    // Quando i metadati (durata, dimensioni) sono pronti...
    player.on('loadedmetadata', () => {
        const target = seekTargetRef.current;
        
        // Se c'è un punto di ripristino salvato
        if (target > 5) {
            const safeTime = Math.max(0, target - 3); // Smart resume (-3 secondi)
            console.log(`[Player] Seeking to ${safeTime}s`);
            player.currentTime = safeTime;
        }
        
        // Rimuoviamo il loader interno
        setIsInternalLoading(false);
        
        // Tentativo di autoplay
        const playPromise = player.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => console.log("Autoplay bloccato (interazione richiesta)"));
        }
    });

    // Quando inizia a riprodurre davvero, assicuriamoci che il loader sia spento
    player.on('playing', () => setIsInternalLoading(false));
    
    // Se sta buffering (es. rete lenta), mostriamo loader
    player.on('waiting', () => setIsInternalLoading(true));
    player.on('canplay', () => setIsInternalLoading(false));

    // Save events
    player.on('timeupdate', (event) => {
        const time = event.detail.plyr.currentTime;
        if (Math.floor(time) > 0 && Math.floor(time) % 10 === 0) {
            saveProgress(time);
        }
    });

    player.on('pause', () => saveProgress(player.currentTime));
    player.on('enterfullscreen', () => document.body.classList.add('video-fullscreen-active'));
    player.on('exitfullscreen', () => document.body.classList.remove('video-fullscreen-active'));

    // Pulizia finale
    return () => {
      if (playerRef.current) {
        saveProgress(playerRef.current.currentTime);
        playerRef.current.destroy();
      }
    };
  }, []); // Array vuoto: Plyr si inizializza solo al primo mount


  // --- 2. GESTIONE CAMBIO VIDEO (Reattiva) ---
  // Questo effect scatta quando cambiano le props, SENZA smontare il componente
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !src) return;

    // 1. Mostriamo il loader per nascondere il cambio
    setIsInternalLoading(true);

    // 2. Aggiorniamo il target per il seek (sarà letto dall'evento 'loadedmetadata' definito sopra)
    seekTargetRef.current = Number(startTime);

    // 3. Aggiorniamo la sorgente di Plyr programmaticamente
    player.source = {
        type: 'video',
        title: 'Video Player',
        sources: [{ src: src, type: 'video/mp4' }],
        poster: poster,
    };

    // Aggiorna colore tema
    setTimeout(() => {
        const plyrContainer = videoRef.current?.closest('.plyr');
        if (plyrContainer) {
            const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim();
            plyrContainer.style.setProperty('--plyr-color-main', themeColor || '#dc2626');
        }
    }, 100);

  }, [src, videoId, startTime]); // Scatta quando cambiano i dati video


  return (
    <div className="w-full bg-black rounded-xl shadow-2xl relative z-0 aspect-video group overflow-hidden">
      
      {/* OVERLAY DI CARICAMENTO INTERNO (Maschera il cambio video) */}
      <div 
        className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-500 pointer-events-none ${isInternalLoading ? 'opacity-100' : 'opacity-0'}`}
      >
         <Loader2 className="h-10 w-10 animate-spin text-[var(--primary-color)]" />
      </div>

      <style>{`
        .plyr__control--overlaid {
            transition: transform .3s ease, background .3s ease !important;
            transform: translate(-50%, -50%) !important;
            top: 50% !important;
            left: 50% !important;
        }
        .plyr__control--overlaid:hover {
            background: var(--primary-color, #dc2626) !important;
            transform: translate(-50%, -50%) scale(1.1) !important;
        }
        .plyr--fullscreen-active {
            z-index: 9999 !important;
            position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; background: black !important;
        }
        .plyr--fullscreen-active video { object-fit: contain !important; height: 100% !important; width: 100% !important; }
      `}</style>
      
      <video ref={videoRef} className="plyr" playsInline controls crossOrigin="anonymous" preload="metadata"></video>
    </div>
  );
}
```
---
