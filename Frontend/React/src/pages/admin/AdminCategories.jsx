import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { getAssetUrl } from '../../services/helpers';
import { Edit, Save, ImageIcon, Upload, Check, Folder, Film, Trash2, Palette, X, AlertCircle } from 'lucide-react';

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

export default function AdminCategories() {
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');

    const [uploadingId, setUploadingId] = useState(null);
    const [colorPickerOpen, setColorPickerOpen] = useState(null);

    const [notification, setNotification] = useState(null);

    const showNotification = (message, type = 'success') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 3000);
    };

    const fetchCategories = async () => {
        setLoading(true);
        try {
            const res = await apiRequest('/admin.php', 'POST', { action: 'lista_categorie' });
            if (res.success) setCategories(res.data || res.dati);
        } catch (error) {
            console.error(error);
            showNotification('Errore caricamento categorie', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCategories();
    }, []);

    const startEdit = (cat) => {
        setEditingId(cat.id);
        setEditName(cat.Nome);
    };

    const saveEdit = async () => {
        try {
            await apiRequest('/admin.php', 'POST', {
                action: 'aggiorna_categoria',
                id: editingId,
                nome: editName
            });
            setCategories(prev => prev.map(c => c.id === editingId ? { ...c, Nome: editName } : c));
            setEditingId(null);
            showNotification('Categoria aggiornata');
        } catch (error) {
            showNotification("Errore: " + error.message, 'error');
        }
    };

    const handleSaveColor = async (id, colore) => {
        try {
            await apiRequest('/admin.php', 'POST', {
                action: 'salva_colore_categoria',
                id_categoria: id,
                colore: colore
            });
            showNotification('Colore aggiornato');
            setCategories(prev => prev.map(c => c.id === id ? { ...c, Colore_Default: colore } : c));
            setColorPickerOpen(null);
        } catch (error) {
            showNotification("Errore: " + error.message, 'error');
        }
    };

    const handleUploadBackground = async (id, file) => {
        if (!file) return;
        setUploadingId(id);

        const formData = new FormData();
        formData.append('action', 'upload_sfondo_categoria');
        formData.append('id_categoria', id);
        formData.append('file_sfondo', file);

        try {
            const res = await apiRequest('/admin.php', 'POST', formData);
            if (res.success) {
                setCategories(prev => prev.map(c =>
                    c.id === id ? { ...c, Immagine_Sfondo: res.nuovo_path } : c
                ));
                showNotification('Sfondo aggiornato');
            }
        } catch (error) {
            showNotification("Errore upload: " + error.message, 'error');
        } finally {
            setUploadingId(null);
        }
    };

    const handleRemoveBackground = async (id) => {
        if (!window.confirm("Rimuovere lo sfondo della categoria?")) return;

        try {
            const formData = new FormData();
            formData.append('action', 'rimuovi_sfondo_categoria');
            formData.append('id_categoria', id);

            const res = await apiRequest('/admin.php', 'POST', formData);
            if (res.success) {
                setCategories(prev => prev.map(c =>
                    c.id === id ? { ...c, Immagine_Sfondo: null } : c
                ));
                showNotification('Sfondo rimosso');
            }
        } catch (error) {
            showNotification("Errore rimozione: " + error.message, 'error');
        }
    };

    return (
        <div className="space-y-8 page-enter relative">
            {/* Toast Notification */}
            {notification && (
                <div className={`fixed top-6 right-6 z-[150] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 toast-enter ${notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-zinc-900 text-white border border-white/10'}`}>
                    {notification.type === 'error' ? <AlertCircle size={20} /> : <Check size={20} className="text-green-400" />}
                    <span className="font-bold text-sm">{notification.message}</span>
                </div>
            )}

            <div>
                <h1 className="text-4xl font-black text-white tracking-tight">Categorie</h1>
                <p className="text-zinc-500 font-medium mt-1">Organizza i contenuti e gestisci le copertine dei cataloghi.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {loading ? (
                    [1, 2, 3].map(i => <div key={i} className="h-64 bg-zinc-900/50 rounded-[2rem] animate-pulse"></div>)
                ) : (
                    categories.map(cat => (
                        <div key={cat.id} className="admin-card group !p-0 !rounded-[2rem] overflow-hidden flex flex-col h-full bg-zinc-900/20 hover:bg-zinc-900/40">
                            {/* Anteprima Sfondo con Glass Overlay */}
                            <div className="relative h-48 bg-zinc-950 overflow-hidden">
                                {cat.Immagine_Sfondo ? (
                                    <img
                                        src={`${getAssetUrl(cat.Immagine_Sfondo)}&t=${Date.now()}`}
                                        alt={cat.Nome}
                                        className="w-full h-full object-cover opacity-60 group-hover:opacity-80 group-hover:scale-110 transition-all duration-700"
                                        onError={(e) => e.target.style.display = 'none'}
                                    />
                                ) : (
                                    <>
                                        {cat.Colore_Default ? (
                                            <>
                                                <div className={`absolute inset-0 bg-gradient-to-br ${cat.Colore_Default} opacity-100 transition-colors duration-500`} />
                                                <div className="absolute inset-0 opacity-50 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />
                                                <Folder className="absolute -right-4 -bottom-8 h-32 w-32 sm:h-45 sm:w-45 text-white/5 -rotate-12 group-hover:-bottom-0 group-hover:-right-0 group-hover:h-40 group-hover:w-40 group-hover:rotate-0 transition-all duration-500" />
                                            </>
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center text-zinc-800 bg-zinc-900/50">
                                                <Folder size={48} className="mb-2 opacity-50" />
                                                <span className="text-[10px] font-black uppercase tracking-widest italic opacity-50">Nessuno Sfondo</span>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Overlay flottante per upload e rimozione */}
                                <div className={`absolute top-4 right-4 z-20 md:-translate-y-[150%] md:opacity-0 md:pointer-events-none translate-y-0 opacity-100 pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-300 flex gap-2 ${colorPickerOpen === cat.id ? '!translate-y-0 !opacity-100 !pointer-events-auto' : ''}`}>
                                    {cat.Immagine_Sfondo && (
                                        <button
                                            onClick={() => handleRemoveBackground(cat.id)}
                                            className="w-10 h-10 flex items-center justify-center rounded-2xl bg-zinc-950/80 backdrop-blur-md border border-white/10 text-zinc-400 hover:text-red-500 cursor-pointer transition-all active:scale-90 overflow-hidden shadow-lg hover:bg-red-500/10 hover:border-red-500/50"
                                            title="Rimuovi Sfondo"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}

                                    <label className="w-10 h-10 flex items-center justify-center rounded-2xl bg-zinc-950/80 backdrop-blur-md border border-white/10 text-zinc-400 hover:text-white cursor-pointer transition-all active:scale-90 overflow-hidden shadow-lg hover:bg-primary hover:border-primary">
                                        {uploadingId === cat.id ? (
                                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        ) : (
                                            <Upload size={18} />
                                        )}
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept="image/*"
                                            onChange={(e) => handleUploadBackground(cat.id, e.target.files[0])}
                                            disabled={uploadingId === cat.id}
                                        />
                                    </label>

                                    {!cat.Immagine_Sfondo && (
                                        <button
                                            onClick={() => setColorPickerOpen(colorPickerOpen === cat.id ? null : cat.id)}
                                            className="w-10 h-10 flex items-center justify-center rounded-2xl bg-zinc-950/80 backdrop-blur-md border border-white/10 text-zinc-400 hover:text-white cursor-pointer transition-all active:scale-90 overflow-hidden shadow-lg hover:bg-emerald-500 hover:border-emerald-500"
                                            title="Scegli Colore"
                                        >
                                            <Palette size={18} />
                                        </button>
                                    )}
                                </div>

                                {/* Selezione Colore in Overlay (Se aperto) */}
                                {colorPickerOpen === cat.id && !cat.Immagine_Sfondo && (
                                    <div className="absolute inset-0 bg-zinc-950/90 backdrop-blur-sm z-30 flex flex-col p-3 animate-in fade-in duration-200">
                                        <div className="flex justify-between items-center mb-2 border-b border-white/10 pb-2">
                                            <span className="text-xs font-black uppercase tracking-widest text-zinc-400">Tinta Unita</span>
                                            <button onClick={() => setColorPickerOpen(null)} className="text-zinc-500 hover:text-white">
                                                <X size={16} />
                                            </button>
                                        </div>
                                        <div
                                            className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar"
                                            style={{
                                                scrollbarWidth: 'none',
                                                msOverflowStyle: 'none',
                                                WebkitOverflowScrolling: 'touch'
                                            }}
                                        >
                                            <style>{`
                                                .no-scrollbar::-webkit-scrollbar { display: none !important; }
                                            `}</style>
                                            <div className="grid grid-cols-5 gap-4 px-6 py-4 content-start">
                                                <button
                                                    onClick={() => handleSaveColor(cat.id, '')}
                                                    className={`w-11 h-11 rounded-xl bg-zinc-800 transition-all flex items-center justify-center outline-none shrink-0 relative ${!cat.Colore_Default ? 'ring-2 ring-primary ring-offset-2 ring-offset-zinc-950' : 'hover:scale-105'}`}
                                                    title="Predefinito / Nessuno"
                                                >
                                                    {!cat.Colore_Default && <Check size={20} className="text-primary" />}
                                                </button>

                                                {CARD_GRADIENTS.map((grad, i) => (
                                                    <button
                                                        key={i}
                                                        onClick={() => handleSaveColor(cat.id, grad)}
                                                        className={`w-11 h-11 rounded-xl bg-gradient-to-br ${grad} transition-all flex items-center justify-center outline-none shrink-0 relative ${cat.Colore_Default === grad ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950 scale-105 z-10' : 'hover:scale-105'}`}
                                                    >
                                                        {cat.Colore_Default === grad && <Check size={22} className="text-white drop-shadow-md" />}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Titolo in overlay */}
                                <div className="absolute inset-0 p-6 flex items-end bg-gradient-to-t from-zinc-950/90 to-transparent">
                                    <div className="w-full">
                                        {editingId === cat.id ? (
                                            <div className="flex items-center gap-2 animate-in slide-in-from-bottom-2 duration-300">
                                                <input
                                                    type="text"
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    className="bg-zinc-950/80 backdrop-blur-xl border-2 border-primary/50 rounded-2xl px-4 py-2 text-white font-bold text-lg w-full outline-none focus:bg-zinc-900"
                                                    autoFocus
                                                    onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                                                />
                                                <button onClick={saveEdit} className="w-10 h-10 flex items-center justify-center rounded-2xl bg-primary text-white shadow-lg active:scale-90 transition-transform flex-shrink-0">
                                                    <Check size={20} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between group/title">
                                                <h3 className="font-black text-2xl text-white tracking-tight drop-shadow-2xl">{cat.Nome}</h3>
                                                <button onClick={() => startEdit(cat)} className="opacity-100 translate-x-0 md:opacity-0 group-hover:opacity-100 md:translate-x-2 group-hover:translate-x-0 transition-all duration-300 p-2 bg-white/10 backdrop-blur-md rounded-xl text-white hover:bg-white hover:text-black">
                                                    <Edit size={16} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Info Footer */}
                            <div className="p-6 bg-zinc-900/30 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="p-2 bg-zinc-800 rounded-lg text-zinc-500">
                                        <Film size={14} />
                                    </div>
                                    <span className="text-xs font-black text-zinc-500 uppercase tracking-widest">{cat.num_video} Contenuti</span>
                                </div>
                                <div className="px-3 py-1 bg-zinc-950/50 rounded-full border border-white/5 text-[10px] font-black text-zinc-600 tracking-tighter tabular-nums">
                                    ID #{cat.id}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}


