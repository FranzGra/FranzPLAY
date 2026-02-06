import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { Edit, Save, ImageIcon, Upload, Check, Folder, Film } from 'lucide-react';

export default function AdminCategories() {
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');

    const [uploadingId, setUploadingId] = useState(null);

    const [notification, setNotification] = useState(null);

    const showNotification = (message, type = 'success') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 3000);
    };

    const fetchCategories = async () => {
        setLoading(true);
        try {
            const res = await apiRequest('/admin.php', 'POST', { action: 'lista_categorie' });
            if (res.successo) setCategories(res.dati);
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

    const handleUploadBackground = async (id, file) => {
        if (!file) return;
        setUploadingId(id);

        const formData = new FormData();
        formData.append('action', 'upload_sfondo_categoria');
        formData.append('id_categoria', id);
        formData.append('file_sfondo', file);

        try {
            const res = await apiRequest('/admin.php', 'POST', formData);
            if (res.successo) {
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
                        <div key={cat.id} className="admin-card group !p-0 !rounded-[2rem] overflow-hidden flex flex-col h-full bg-zinc-900/20 hover:bg-zinc-900/40 transform transition-all hover:scale-[1.01]">
                            {/* Anteprima Sfondo con Glass Overlay */}
                            <div className="relative h-48 bg-zinc-950 overflow-hidden">
                                {cat.Immagine_Sfondo ? (
                                    <img
                                        src={`/api/percorsoVideo/${cat.Immagine_Sfondo}&t=${Date.now()}`}
                                        alt={cat.Nome}
                                        className="w-full h-full object-cover opacity-60 group-hover:opacity-80 group-hover:scale-110 transition-all duration-700"
                                        onError={(e) => e.target.style.display = 'none'}
                                    />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-800 bg-zinc-900/50">
                                        <Folder size={48} className="mb-2 opacity-50" />
                                        <span className="text-[10px] font-black uppercase tracking-widest italic opacity-50">Nessuno Sfondo</span>
                                    </div>
                                )}

                                {/* Overlay flottante per upload */}
                                <div className="absolute top-4 right-4 z-10 translate-y-[-120%] group-hover:translate-y-0 transition-transform duration-300">
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
                                </div>

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
                                                <button onClick={() => startEdit(cat)} className="opacity-0 group-hover:opacity-100 group-hover:translate-x-0 -translate-x-2 transition-all p-2 bg-white/10 backdrop-blur-md rounded-xl text-white hover:bg-white hover:text-black">
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


