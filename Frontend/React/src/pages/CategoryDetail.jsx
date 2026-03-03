import React, { useState, useEffect } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import { fetchVideosRest } from '../services/api';
import { Loader2, Folder, ChevronLeft, LayoutGrid } from 'lucide-react';
import VideoCard from '../components/VideoCard';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function CategoryDetail() {
    const { id } = useParams();
    const location = useLocation();
    const navigate = useNavigate();

    const [videos, setVideos] = useState([]);
    const [loading, setLoading] = useState(true);

    const categoryName = location.state?.nomeCategoria || "Categoria";
    // Se il percorso è troppo lungo, visivamente lo tronchiamo o lo mostriamo in piccolo
    const categoryPath = location.state?.percorsoFake || `/videos/cat_${id}`;

    useEffect(() => {
        window.scrollTo(0, 0);
        const fetchVideos = async () => {
            setLoading(true);
            try {
                // USIAMO LA NUOVA API REST
                const data = await fetchVideosRest({
                    category_id: id,
                    limit: 50
                });

                // fetchVideosRest restituisce già l'array dei dati
                setVideos(data);
            } catch (err) {
                console.error("Errore video:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchVideos();
    }, [id]);

    useDocumentTitle(categoryName);

    return (
        // FIX PADDING LATERALE:
        // px-4 su mobile
        // pt-32 per scendere sotto la navbar mobile
        <main className="pt-32 md:pt-36 pb-10 w-full px-4 md:px-0 md:max-w-9/10 xl:max-w-8/10 mx-auto min-h-screen overflow-x-hidden">

            {/* HEADER */}
            <div className="flex flex-col gap-4 mb-8">

                {/* RIGA 1: Pulsante Indietro (Stile "Return") */}
                <div className="flex items-center">
                    <Link
                        to="/categories"
                        className="inline-flex items-center gap-2 px-4 py-2 border border-white/20 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all active:scale-95 text-sm font-medium ring-1 ring-white/10"
                    >
                        <ChevronLeft className="h-4 w-4" />
                        Indietro
                    </Link>
                </div>

                {/* RIGA 2: Titolo e Info */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-zinc-800 pb-4">
                    <div className="flex-1 min-w-0">
                        {/* Titolo Grande che va a capo se necessario */}
                        <h1 className="text-2xl sm:text-4xl font-bold text-white leading-tight break-words">
                            {categoryName}
                        </h1>

                        {/* Breadcrumb piccolo sopra il titolo */}
                        <div className="flex items-center gap-2 text-sm sm:text-md text-zinc-500 mt-2 font-mono">
                            <span className="flex items-center gap-1"><LayoutGrid className="h-3 w-3" /> Categorie</span>
                            <span>/</span>
                            <span className="truncate max-w-[200px]">{categoryPath.replace('/videos/', '')}</span>
                        </div>
                    </div>

                    {/* Badge Numero Video */}
                    <div className="self-start md:self-end flex-shrink-0">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-white">
                            <span className="text-sm font-bold">{videos.length} Video</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* GRIGLIA VIDEO */}
            {loading ? (
                <div className="flex justify-center py-20 text-zinc-500 gap-2"><Loader2 className="animate-spin" /> Caricamento contenuto...</div>
            ) : videos.length > 0 ? (
                // Uniformata alla griglia della Home: 1 col mobile, 2 tablet, etc.
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6 animate-in fade-in slide-in-from-bottom-4">
                    {videos.map(video => (
                        <VideoCard
                            key={video.id}
                            video={{
                                ...video,
                                Nome_Categoria: categoryName // Passiamo il nome per la card
                            }}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-20 bg-zinc-900/30 rounded-3xl border border-zinc-800 border-dashed mx-2">
                    <Folder className="h-16 w-16 text-zinc-700 mb-4 opacity-50" />
                    <p className="text-zinc-400 text-lg font-medium">Questa cartella è vuota.</p>
                    <Link to="/categories" className="mt-4 text-[var(--primary-color)] hover:underline text-sm">
                        Torna all'elenco categorie
                    </Link>
                </div>
            )}
        </main>
    );
}