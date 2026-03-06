import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ThumbsUp, Bookmark, Calendar, Share2, Loader2, FileVideo, Check } from 'lucide-react';

import VideoPlayer from '../components/VideoPlayer';
import Comments from '../components/Comments';

import { apiRequest, fetchVideoDetailsRest } from '../services/api';
import { getAssetUrl } from '../services/helpers';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * ============================================================================
 * Pagina: Player
 * ============================================================================
 * Gestisce la riproduzione video, i metadati, like/save e i commenti.
 */
export default function Player() {
    const { id } = useParams();
    const navigate = useNavigate();

    // Stato Video & UI
    const [video, setVideo] = useState(null);
    const [loading, setLoading] = useState(true);

    // Stato Interazioni (Ottimistico)
    const [likes, setLikes] = useState(0);
    const [isLiked, setIsLiked] = useState(false);
    const [isSaved, setIsSaved] = useState(false);
    const [isCopied, setIsCopied] = useState(false);

    useDocumentTitle(video ? video.Titolo : 'Player');

    // FETCH DATI VIDEO
    useEffect(() => {
        const fetchVideoDetails = async () => {
            setLoading(true);
            try {
                // Recupera dettagli completi (inclusi stati utente like/save)
                const response = await fetchVideoDetailsRest(id);

                if (response.success && response.video) {
                    const v = response.video;
                    setVideo(v);

                    // Inizializza stati
                    setLikes(parseInt(v.Likes || 0));
                    setIsLiked(v.is_liked);
                    setIsSaved(v.is_saved);
                } else {
                    // Stop Redirect: Mostra UI errore
                    console.error("Video response invalid or missing:", response);
                }
            } catch (e) {
                console.error("Errore caricamento player:", e);
            } finally {
                setLoading(false);
            }
        };

        if (id) fetchVideoDetails();
    }, [id, navigate]);

    // --- HANDLERS INTERAZIONI (Optimistic UI Updates) ---

    const handleLike = async () => {
        const newLikedState = !isLiked;
        setIsLiked(newLikedState);
        setLikes(prev => newLikedState ? prev + 1 : prev - 1);

        try { await apiRequest('/toggleLike.php', 'POST', { videoId: id }, false); }
        catch (e) {
            // Rollback in caso di errore
            setIsLiked(!newLikedState);
            setLikes(prev => !newLikedState ? prev + 1 : prev - 1);
        }
    };

    const handleSave = async () => {
        const newSavedState = !isSaved;
        setIsSaved(newSavedState);

        try { await apiRequest('/toggleSalvati.php', 'POST', { videoId: id }, false); }
        catch (e) { setIsSaved(!newSavedState); }
    };

    const handleShare = async () => {
        const url = window.location.href;
        const title = video?.Titolo || 'Guarda video';
        const text = `Guarda "${video?.Titolo}" su FranzPLAY`;

        // Usa Native Share API se disponibile (Mobile)
        if (navigator.share) {
            try { await navigator.share({ title, text, url }); return; } catch (err) { }
        }

        // Fallback: Copia link
        try {
            await navigator.clipboard.writeText(url);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (e) { }
    };

    // --- RENDER ---

    if (loading) {
        return (
            <div className="h-screen w-full bg-zinc-950 flex flex-col items-center justify-center text-zinc-500 gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-[var(--primary-color)]" />
                <p className="animate-pulse">Caricamento...</p>
            </div>
        );
    }

    if (!video) {
        return (
            <div className="h-screen w-full bg-zinc-950 flex flex-col items-center justify-center text-zinc-500 gap-3">
                <FileVideo className="h-16 w-16 opacity-20" />
                <p className="text-xl">Video non trovato o errore nel caricamento.</p>
                <button onClick={() => navigate('/')} className="mt-4 px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 text-white transition">
                    Torna alla Home
                </button>
            </div>
        );
    }

    return (
        <div className="pt-24 pb-10 px-4 md:px-8 w-full max-w-[1800px] mx-auto min-h-screen">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* COLONNA SINISTRA: Video + Metadati */}
                <div className="lg:col-span-2 space-y-6">

                    {/* VIDEO CONTAINER */}
                    <div className="w-full bg-black rounded-2xl overflow-hidden shadow-2xl shadow-black/50 ring-1 ring-white/10 aspect-video relative z-20">
                        <VideoPlayer
                            src={getAssetUrl(video.percorso_file)}
                            poster={getAssetUrl(video.percorso_copertina)}
                            videoId={video.id}
                            startTime={Number(video.progresso_secondi || 0)}
                        />
                    </div>

                    {/* TITOLO E TAG */}
                    <div className="space-y-4">
                        <h1 className="text-2xl md:text-3xl font-bold text-white leading-tight">{video.Titolo}</h1>
                        <div className="flex flex-wrap items-center gap-4 text-zinc-400 text-sm font-medium">
                            <span className="bg-zinc-800 text-zinc-200 px-3 py-1 rounded-lg border border-zinc-700 uppercase text-xs tracking-wider">
                                {video.Nome_Categoria || 'Generale'}
                            </span>
                            <span className="flex items-center gap-1.5"><Calendar size={16} /> {new Date(video.data_Pubblicazione).toLocaleDateString()}</span>
                            {/* Format Badge */}
                            {video.Formato && (
                                <span className="flex items-center gap-1.5 uppercase">
                                    <FileVideo size={16} /> {video.Formato}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* AZIONI (Like, Save, Share) */}
                    <div className="flex flex-wrap items-center gap-3 pb-2">
                        <button onClick={handleLike} className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-full font-medium transition-all active:scale-95 whitespace-nowrap ${isLiked ? 'bg-[var(--primary-color)] text-white shadow-lg shadow-[var(--primary-color)]/20' : 'bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700/50'}`}>
                            <ThumbsUp size={20} className={isLiked ? 'fill-white' : ''} />
                            <span>Mi piace</span>
                            <span className={`text-xs ml-1 py-0.5 px-1.5 rounded-md ${isLiked ? 'bg-black/20' : 'bg-white/10'}`}>{likes}</span>
                        </button>

                        <button onClick={handleSave} className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-full font-medium transition-all active:scale-95 border whitespace-nowrap ${isSaved ? 'bg-zinc-800 border-[var(--primary-color)]/50 text-[var(--primary-color)]' : 'bg-zinc-800 border-zinc-700/50 text-white hover:bg-zinc-700'}`}>
                            <Bookmark size={20} className={isSaved ? 'fill-[var(--primary-color)]' : ''} />
                            <span>{isSaved ? 'Salvato' : 'Salva'}</span>
                        </button>

                        <button onClick={handleShare} className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-full font-medium transition-all active:scale-95 border whitespace-nowrap ${isCopied ? 'bg-green-600 border-green-500 text-white' : 'bg-zinc-800 border-zinc-700/50 text-white hover:bg-zinc-700'}`}>
                            {isCopied ? <Check size={20} /> : <Share2 size={20} />}
                            <span>{isCopied ? 'Copiato!' : 'Condividi'}</span>
                        </button>
                    </div>

                    <div className="h-px w-full bg-zinc-800/50 my-6"></div>
                </div>

                {/* COLONNA DESTRA: Commenti */}
                <div className="lg:col-span-1">
                    <div className="lg:sticky lg:top-24">
                        <Comments videoId={video.id} />
                    </div>
                </div>
            </div>
        </div>
    );
}