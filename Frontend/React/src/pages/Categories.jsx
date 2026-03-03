import React, { useState, useEffect } from 'react';
import { Loader2, Folder, LayoutGrid } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getAssetUrl } from '../services/helpers';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const CARD_GRADIENTS = [
  "from-red-600 to-red-950",
  "from-blue-600 to-blue-950",
  "from-emerald-600 to-emerald-950",
  "from-violet-600 to-violet-950",
  "from-amber-600 to-amber-950",
  "from-pink-600 to-pink-950",
  "from-cyan-600 to-cyan-950",
  "from-indigo-600 to-indigo-950",
];

export default function Categories() {
  useDocumentTitle('Categorie');
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch('/api/categorie.php');
        const json = await res.json();
        if (json.success) setCategories(json.data || json.dati);
      } catch (err) {
        console.error("Errore categorie:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCategories();
  }, []);

  const getGradient = (index) => CARD_GRADIENTS[index % CARD_GRADIENTS.length];
  const getPath = (nome) => `/videos/${nome.toLowerCase().replace(/\s/g, '_')}`;

  const handleCategoryClick = (cat) => {
    navigate(`/category/${cat.id}`, {
      state: {
        nomeCategoria: cat.Nome,
        percorsoFake: getPath(cat.Nome)
      }
    });
  };

  return (
    // PADDING AUMENTATO: pt-32 (Mobile) -> pt-36 (Desktop)
    <main className="pt-32 md:pt-36 pb-10 w-full px-4 md:px-0 md:max-w-[90%] xl:max-w-[85%] mx-auto space-y-8 min-h-screen">

      {/* HEADER */}
      <div className="space-y-2 animate-in fade-in slide-in-from-top-4">
        <h1 className="text-3xl sm:text-4xl font-bold flex items-center gap-3 text-white">
          <LayoutGrid className="h-6 w-6 sm:h-8 sm:w-8 text-[var(--primary-color)]" />
          Categorie
        </h1>
        <p className="text-zinc-400 text-sm sm:text-base">Sfoglia le cartelle disponibili sul server • {categories.length} Categorie</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-zinc-500 h-8 w-8" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-8">
          {categories.map((cat, index) => {
            const gradientClass = getGradient(index);
            const hasImage = Boolean(cat.Immagine_Sfondo);

            return (
              <button
                key={cat.id}
                onClick={() => handleCategoryClick(cat)}
                className="group relative h-48 sm:h-64 w-full rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 hover:shadow-zinc-900/50 ring-1 ring-zinc-800 text-left active:scale-95 focus:outline-none focus:ring-2"
              >
                {hasImage ? (
                  <>
                    <img src={getAssetUrl(cat.Immagine_Sfondo)} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" loading="lazy" />
                    <div className="absolute inset-0 bg-black/50 group-hover:bg-transparent transition-colors duration-500" />
                  </>
                ) : (
                  <>
                    <div className={`absolute inset-0 bg-gradient-to-br ${cat.Colore_Default || gradientClass} opacity-100 transition-colors duration-500`} />
                    <div className="absolute inset-0 opacity-50 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />
                    <Folder className="absolute -right-4 -bottom-8 h-32 w-32 sm:h-45 sm:w-45 text-white/10 -rotate-12 group-hover:-bottom-0 group-hover:-right-0 group-hover:h-40 group-hover:w-40 group-hover:rotate-0 transition-all duration-500" />
                  </>
                )}

                <div className="absolute inset-0 p-4 sm:p-6 flex flex-col justify-end items-start z-10">
                  {/* MODIFICA APPLICATA QUI: 
                              - line-clamp-2: Permette fino a 2 righe di testo
                              - leading-tight: Migliora la leggibilità quando va su due righe
                          */}
                  <h3 className="text-2xl sm:text-3xl font-bold text-white mb-2 drop-shadow-md tracking-tight leading-tight line-clamp-2">
                    {cat.Nome}
                  </h3>

                  <div className="inline-flex items-center gap-2 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 max-w-full group-hover:bg-black/60 transition-colors">
                    <span className="text-[10px] sm:text-xs font-mono text-zinc-300 truncate opacity-90">{cat.Percorso || getPath(cat.Nome)}</span>
                  </div>
                </div>

                <div className="absolute inset-0 border-2 border-transparent group-hover:border-white/20 rounded-2xl transition-colors pointer-events-none" />
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}