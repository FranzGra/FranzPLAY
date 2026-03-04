import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import VideoCard from './VideoCard';

/**
 * ============================================================================
 * Componente: HomeSection
 * ============================================================================
 * Rendering di una "striscia" di video (es. Continua a guardare).
 */
const HomeSection = React.memo(({ id, title, icon: Icon, videos, loading, linkAll, onRemoveVideo, isOpen, onToggle }) => {

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
                            {linkAll ? (
                                <div className="flex justify-end mb-2">
                                    <Link to={linkAll} className="text-sm text-zinc-400 hover:text-white font-medium hover:underline transition-colors flex items-center gap-1 p-2">
                                        Vedi tutti <ChevronDown className="h-3 w-3 -rotate-90" />
                                    </Link>
                                </div>
                            ) : null}

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
});

export default HomeSection;
