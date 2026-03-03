import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, Search, Sparkles, History, Bookmark, ThumbsUp, Clock, ChevronDown } from 'lucide-react';
import VideoCard from '../components/VideoCard';
import { fetchVideosRest, apiRequest } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

import HomeSection from '../components/HomeSection';

export default function Home() {
  const { user, updateHomePreferences } = useAuth();
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get('q');

  useDocumentTitle(searchQuery ? `Cerca: "${searchQuery}"` : 'Home');

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
              <p className="text-zinc-400 text-sm sm:text-base">Benvenuto su FranzPLAY</p>
            </div>
          </>
        )}
      </div>

      {/* SEZIONI ORIZZONTALI (Solo Home) */}
      {!searchQuery ? (
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
      ) : null}

      {/* FEED PRINCIPALE */}
      <div className="pt-8">
        {!searchQuery ? (
          <div className="mb-6 flex items-center gap-3">
            <h3 className="text-xl sm:text-2xl font-bold text-white pl-4 border-l-4 border-[var(--primary-color)]">
              Tutti i video
            </h3>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
          {allVideos.map((video, index) => (
            <div key={`${video.id}-all-${index}`} ref={allVideos.length === index + 1 ? lastVideoElementRef : null}>
              <VideoCard video={video} />
            </div>
          ))}
        </div>

        {/* LOADING STATE */}
        {allLoading ? (
          <div className="py-12 flex justify-center w-full">
            <Loader2 className="animate-spin text-zinc-500 h-8 w-8" />
          </div>
        ) : null}

        {/* EMPTY STATE */}
        {!allLoading && allVideos.length === 0 ? (
          <div className="py-24 sm:py-32 flex flex-col items-center justify-center text-zinc-500 border-2 border-dashed border-zinc-800 rounded-3xl mx-4">
            <Search className="h-12 w-12 sm:h-16 sm:w-16 mb-4 opacity-20" />
            <p className="text-lg sm:text-xl font-medium">Nessun video trovato.</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}