import React, { useState, useEffect } from 'react';
import { Loader2, Bookmark, History, ThumbsUp, Layers, Trash2, X } from 'lucide-react';
import VideoCard from '../components/VideoCard';
import { Link } from 'react-router-dom';
import { fetchVideosRest, apiRequest } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function Saved() {
  const [activeTab, setActiveTab] = useState('saved');
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  const TABS = {
    saved: {
      title: "Elementi Salvati",
      subtitle: "La tua collezione privata.",
      icon: Bookmark,
      type: "saved",
      emptyMsg: "Non hai ancora salvato nessun video."
    },
    liked: {
      title: "Video Piaciuti",
      subtitle: "I video a cui hai lasciato un Like.",
      icon: ThumbsUp,
      type: "liked",
      emptyMsg: "Non hai ancora messo Mi Piace a nessun video."
    },
    history: {
      title: "Cronologia",
      subtitle: "Tutto quello che hai guardato.",
      icon: History,
      type: "history",
      emptyMsg: "Nessun video nella cronologia."
    }
  };

  const currentTab = TABS[activeTab];
  useDocumentTitle('Libreria');

  useEffect(() => {
    const loadVideos = async () => {
      setLoading(true);
      setVideos([]);
      try {
        const data = await fetchVideosRest({ type: currentTab.type, limit: 50 });
        setVideos(data);
      } catch (error) {
        console.error("Errore fetch libreria:", error);
      } finally {
        setLoading(false);
      }
    };
    loadVideos();
  }, [activeTab]);

  // Gestione Rimozione Singola
  const handleRemove = async (videoId) => {
    // Aggiornamento ottimistico
    setVideos(prev => prev.filter(v => v.id !== videoId));

    try {
      if (activeTab === 'history') {
        // HARD DELETE per la cronologia
        await apiRequest('/rimuoviDaCronologia.php', 'POST', { videoId, action: 'hard' });
      } else if (activeTab === 'saved') {
        await apiRequest('/toggleSalvati.php', 'POST', { videoId });
      } else if (activeTab === 'liked') {
        await apiRequest('/toggleLike.php', 'POST', { videoId });
      }
    } catch (err) { console.error(err); }
  };

  // Gestione Svuota Tutto (Solo Cronologia)
  const handleClearHistory = async () => {
    if (!window.confirm("Sei sicuro di voler cancellare TUTTA la cronologia?")) return;

    setVideos([]); // Pulisce UI
    try {
      await apiRequest('/rimuoviDaCronologia.php', 'POST', { action: 'clear' });
    } catch (err) { console.error(err); }
  };

  return (
    <main className="pt-36 md:pt-36 pb-10 w-full px-4 md:px-0 md:max-w-[90%] xl:max-w-[85%] mx-auto min-h-screen">

      {/* HEADER */}
      <div className="mb-8 space-y-4 animate-in fade-in slide-in-from-top-4 duration-500 border-b border-zinc-800 pb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white flex items-center gap-3">
              <Layers className="h-8 w-8 text-[var(--primary-color)]" />
              La tua Libreria
            </h1>
            <p className="text-zinc-400 text-sm sm:text-base mt-1">Gestisci i tuoi contenuti e la tua cronologia.</p>
          </div>
        </div>

        {/* TAB NAVIGATION */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(TABS).map(([key, tab]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 border ${activeTab === key
                ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-white shadow-lg shadow-[var(--primary-color)]/20'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
            >
              <tab.icon size={16} />
              {key === 'saved' ? 'Salvati' : key === 'history' ? 'Cronologia' : 'Piaciuti'}
            </button>
          ))}
        </div>
      </div>

      {/* TITOLO SEZIONE ATTIVA + AZIONI */}
      <div className="mb-6 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <currentTab.icon className="text-[var(--primary-color)]" size={20} />
          <h2 className="text-xl font-bold">{currentTab.title}</h2>
        </div>

        {/* Bottone "Svuota Cronologia" visibile solo nel tab history e se ci sono video */}
        {activeTab === 'history' && videos.length > 0 && (
          <button
            onClick={handleClearHistory}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-950/30 text-red-400 hover:bg-red-900/50 border border-red-900/50 rounded-lg text-xs font-bold transition-all uppercase tracking-wide"
          >
            <Trash2 size={14} /> Svuota tutto
          </button>
        )}
      </div>

      {/* GRIGLIA VIDEO */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-zinc-500 h-8 w-8" /></div>
      ) : videos.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6 animate-in fade-in slide-in-from-bottom-4">
          {videos.map(video => (
            <VideoCard
              key={video.id}
              video={video}
              onRemove={handleRemove}
              // Se siamo in cronologia usa Icona Cestino, altrimenti X
              RemoveIcon={activeTab === 'history' ? Trash2 : X}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 bg-zinc-900/30 rounded-3xl border border-zinc-800 border-dashed text-zinc-500 mx-4">
          <currentTab.icon className="h-16 w-16 mb-4 opacity-20" />
          <p className="text-lg font-medium text-center">{currentTab.emptyMsg}</p>
          <Link to="/" className="mt-4 text-[var(--primary-color)] hover:underline">Esplora la Home</Link>
        </div>
      )}
    </main>
  );
}