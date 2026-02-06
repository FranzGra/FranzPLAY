import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, Search, Sparkles, History, Bookmark, ThumbsUp, Clock, ChevronDown } from 'lucide-react';
import VideoCard from '../components/VideoCard';
import { fetchVideosRest, apiRequest } from '../services/api';
import { useAuth } from '../context/AuthContext';

/**
 * ============================================================================
 * Componente: HomeSection
 * ============================================================================
 * Rendering di una "striscia" di video (es. Continua a guardare).
 */
const HomeSection = ({ id, title, icon: Icon, videos, loading, linkAll, onRemoveVideo, isOpen, onToggle }) => {

  // Nascondi sezioni vuote (tranne durante il caricamento)
  if (!loading && videos.length === 0) return null;

  return (
    <div className={`transition-all duration-500 ease-in-out border-b border-zinc-900/30 last:border-0 my-0 pt-2 ${isOpen ? 'pb-6' : 'pb-2'}`}>

      {/* HEADER SEZIONE CLICCABILE */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between cursor-pointer group select-none rounded-xl p-2 -mx-2 hover:bg-zinc-900/40 active:bg-zinc-900/60 transition-all duration-300 focus:outline-none focus:ring-1 focus:ring-white/10"
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <div className={`p-2 rounded-lg bg-zinc-900 transition-all duration-300 ${isOpen ? 'text-white scale-100' : 'text-zinc-600 scale-90 opacity-50'}`}>
            <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <h3 className={`font-bold text-left transition-all duration-300 ${isOpen ? 'text-xl sm:text-2xl text-white' : 'text-lg text-zinc-600'}`}>
            {title}
          </h3>
        </div>
        <ChevronDown className={`h-5 w-5 transition-transform ${isOpen ? 'rotate-180 text-zinc-400' : 'text-zinc-700'}`} />
      </button>

      {/* CONTENUTO COLLAPSIBLE */}
      <div className={`grid transition-all duration-500 ease-in-out overflow-hidden ${isOpen ? 'grid-rows-[1fr] opacity-100 mt-4' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
        <div className="min-h-0">
          {loading ? (
            // Skeleton Loading
            <div className="flex gap-4 overflow-hidden">
              {[1, 2, 3, 4].map(i => <div key={i} className="aspect-video w-64 bg-zinc-900 rounded-xl animate-pulse flex-shrink-0" />)}
            </div>
          ) : (
            <>
              {linkAll && (
                <div className="flex justify-end mb-2">
                  <Link to={linkAll} className="text-sm text-zinc-400 hover:text-white font-medium hover:underline transition-colors flex items-center gap-1 p-2">
                    Vedi tutti <ChevronDown className="h-3 w-3 -rotate-90" />
                  </Link>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
                {videos.map((video, index) => (
                  // Nascondi alcuni video su schermi piccoli per non intasare
                  <div key={`${id}-${video.id}`} className={index === 3 ? "hidden lg:block" : index === 4 ? "hidden xl:block" : "block"}>
                    <VideoCard video={video} onRemove={onRemoveVideo ? () => onRemoveVideo(video.id) : null} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * ============================================================================
 * Pagina: Home
 * ============================================================================
 */
export default function Home() {
  const { user, updateHomePreferences } = useAuth();
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get('q');

  // Stato Sezioni Orizzontali
  const [continueWatching, setContinueWatching] = useState([]);
  const [savedVideos, setSavedVideos] = useState([]);
  const [topLiked, setTopLiked] = useState([]);
  const [recentUploads, setRecentUploads] = useState([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);

  // Stato Feed Infinito (Tutti i video)
  const [allVideos, setAllVideos] = useState([]);
  const [allPage, setAllPage] = useState(0);
  const [allHasMore, setAllHasMore] = useState(true);
  const [allLoading, setAllLoading] = useState(false);

  // RANDOM SEED
  // Genera un numero casuale stabile per la sessione attuale.
  // Evita che scorrendo la pagina (paginazione) escano duplicati.
  const [randomSeed] = useState(() => Math.floor(Math.random() * 100000));

  // --- INFINITE SCROLL OBSERVER ---
  const observerRef = useRef();
  const lastVideoElementRef = useCallback(node => {
    if (allLoading) return;
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && allHasMore) {
        setAllPage(prev => prev + 1); // Carica pagina successiva
      }
    });

    if (node) observerRef.current.observe(node);
  }, [allLoading, allHasMore]);

  // RESET ricerca
  useEffect(() => {
    setAllPage(0);
    setAllVideos([]);
    setAllHasMore(true);

    if (searchQuery) {
      document.title = `Cerca: "${searchQuery}" - FranzTube`;
    } else {
      document.title = 'Home - FranzTube';
    }
  }, [searchQuery]);

  // CARICAMENTO SEZIONI (Solo se non si cerca)
  useEffect(() => {
    if (searchQuery) return; // In ricerca le sezioni non servono

    const loadSections = async () => {
      setSectionsLoading(true);
      try {
        // Caricamento parallelo per velocità
        const [resHistory, resSaved, resLiked, resRecent] = await Promise.all([
          fetchVideosRest({ type: 'history', limit: 5 }),
          fetchVideosRest({ type: 'saved', limit: 5 }),
          fetchVideosRest({ type: 'liked', limit: 5 }),
          fetchVideosRest({ type: 'all', limit: 5 })
        ]);

        setContinueWatching(resHistory);
        setSavedVideos(resSaved);
        setTopLiked(resLiked);
        setRecentUploads(resRecent);
      } catch (err) {
        console.error("Errore caricamento sezioni:", err);
      } finally {
        setSectionsLoading(false);
      }
    };
    loadSections();
  }, [searchQuery]);

  // CARICAMENTO FEED INFINITO
  useEffect(() => {
    const loadMainFeed = async () => {
      setAllLoading(true);
      try {
        let params = {
          type: 'all', // Sempre all, la ricerca filtra tramite 'q'
          limit: 12,
          offset: allPage * 12,
          q: searchQuery
        };

        // Inseriamo il seed solo se è il feed principale (no ricerca)
        if (!searchQuery) {
          params.seed = randomSeed;
        }

        const newVideos = await fetchVideosRest(params);

        setAllVideos(prev => allPage === 0 ? newVideos : [...prev, ...newVideos]);
        setAllHasMore(newVideos.length === 12); // Se ne sono arrivati meno, siamo alla fine
      } catch (err) {
        console.error("Errore feed:", err);
      } finally {
        setAllLoading(false);
      }
    };
    loadMainFeed();
  }, [allPage, searchQuery, randomSeed]);

  // Handler rimozione cronologia
  const handleRemoveFromHistory = async (videoId) => {
    // UI Optimistic Update (rimuove subito)
    setContinueWatching(prev => prev.filter(v => v.id !== videoId));
    try { await apiRequest('/rimuoviDaCronologia.php', 'POST', { videoId }); } catch (error) { }
  };

  // Gestione Toggle Sezioni (Persistenza DB)
  const handleToggleSection = (sectionId) => {
    const currentPrefs = user?.homePreferences || {};
    // Se non esiste, default è true (aperto), quindi se clicco diventa false
    // Se esiste, inverto
    const isCurrentlyOpen = currentPrefs[sectionId] !== false;

    updateHomePreferences({
      ...currentPrefs,
      [sectionId]: !isCurrentlyOpen
    });
  };

  // Helper per leggere lo stato (default: true)
  const isSectionOpen = (sectionId) => {
    return user?.homePreferences?.[sectionId] !== false;
  };

  return (
    <main className="pt-36 md:pt-28 pb-10 w-full px-4 md:px-0 md:max-w-[90%] xl:max-w-[85%] mx-auto min-h-screen">

      {/* HEADER PAGINA */}
      <div className="flex items-center gap-3 border-b border-zinc-800 pb-4 mb-3 animate-in fade-in slide-in-from-top-4 duration-500">
        {searchQuery ? (
          <>
            <Search className="text-white h-6 w-6 sm:h-8 sm:w-8" />
            <div className="overflow-hidden">
              <h2 className="text-xl sm:text-3xl font-bold text-white truncate">Risultati</h2>
              <p className="text-zinc-400 text-sm sm:text-base truncate">Per "{searchQuery}"</p>
            </div>
          </>
        ) : (
          <>
            <Sparkles className="text-yellow-500 fill-yellow-500/20 h-6 w-6 sm:h-8 sm:w-8" />
            <div>
              <h2 className="text-xl sm:text-3xl font-bold text-white">Esplora Libreria</h2>
              <p className="text-zinc-400 text-sm sm:text-base">Benvenuto su FranzTube</p>
            </div>
          </>
        )}
      </div>

      {/* SEZIONI ORIZZONTALI (Solo Home) */}
      {!searchQuery && (
        <div className="space-y-2 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <HomeSection
            id="history"
            title="Continua a guardare"
            icon={History}
            videos={continueWatching}
            loading={sectionsLoading}
            onRemoveVideo={handleRemoveFromHistory}
            isOpen={isSectionOpen('history')}
            onToggle={() => handleToggleSection('history')}
          />
          <HomeSection
            id="saved"
            title="I tuoi salvati"
            icon={Bookmark}
            videos={savedVideos}
            loading={sectionsLoading}
            linkAll="/saved"
            isOpen={isSectionOpen('saved')}
            onToggle={() => handleToggleSection('saved')}
          />
          <HomeSection
            id="liked"
            title="Più piaciuti"
            icon={ThumbsUp}
            videos={topLiked}
            loading={sectionsLoading}
            isOpen={isSectionOpen('liked')}
            onToggle={() => handleToggleSection('liked')}
          />
          <HomeSection
            id="recent"
            title="Caricati di recente"
            icon={Clock}
            videos={recentUploads}
            loading={sectionsLoading}
            isOpen={isSectionOpen('recent')}
            onToggle={() => handleToggleSection('recent')}
          />
        </div>
      )}

      {/* FEED PRINCIPALE */}
      <div className="pt-8">
        {!searchQuery && (
          <div className="mb-6 flex items-center gap-3">
            <h3 className="text-xl sm:text-2xl font-bold text-white pl-4 border-l-4 border-[var(--primary-color)]">
              Tutti i video
            </h3>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
          {allVideos.map((video, index) => (
            <div key={`${video.id}-all-${index}`} ref={allVideos.length === index + 1 ? lastVideoElementRef : null}>
              <VideoCard video={video} />
            </div>
          ))}
        </div>

        {/* LOADING STATE */}
        {allLoading && (
          <div className="py-12 flex justify-center w-full">
            <Loader2 className="animate-spin text-zinc-500 h-8 w-8" />
          </div>
        )}

        {/* EMPTY STATE */}
        {!allLoading && allVideos.length === 0 && (
          <div className="py-24 sm:py-32 flex flex-col items-center justify-center text-zinc-500 border-2 border-dashed border-zinc-800 rounded-3xl mx-4">
            <Search className="h-12 w-12 sm:h-16 sm:w-16 mb-4 opacity-20" />
            <p className="text-lg sm:text-xl font-medium">Nessun video trovato.</p>
          </div>
        )}
      </div>
    </main>
  );
}