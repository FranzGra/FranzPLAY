import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { Trash2, Shield, ShieldOff, User, MoreVertical, Calendar } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function AdminUsers() {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    const [notification, setNotification] = useState(null);

    const showNotification = (message, type = 'success') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 3000);
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await apiRequest('/admin.php', 'POST', { action: 'lista_utenti' });
            if (res.successo) {
                setUsers(res.dati);
            }
        } catch (error) {
            console.error(error);
            showNotification('Errore caricamento utenti', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleToggleAdmin = async (id, currentStatus) => {
        if (id === currentUser.id) {
            showNotification("Non puoi modificare i tuoi permessi da qui.", 'error');
            return;
        }

        const actionName = currentStatus === '1' ? 'rimuovere' : 'concedere';
        if (!window.confirm(`Sei sicuro di voler ${actionName} i privilegi di Admin?`)) return;

        try {
            await apiRequest('/admin.php', 'POST', { action: 'toggle_admin', id_utente: id });
            setUsers(prev => prev.map(u =>
                u.id === id ? { ...u, Admin: u.Admin == '1' ? '0' : '1' } : u
            ));
            showNotification(`Permessi ${actionName === 'rimuovere' ? 'rimossi' : 'concessi'} con successo`);
        } catch (error) {
            showNotification("Errore: " + error.message, 'error');
        }
    };

    const handleDeleteUser = async (id) => {
        if (id === currentUser.id) return;
        if (!window.confirm("Attenzione: Questa azione eliminerà permanentemente l'utente e tutti i suoi dati. Continuare?")) return;

        try {
            await apiRequest('/admin.php', 'POST', { action: 'elimina_utente', id_utente: id });
            setUsers(prev => prev.filter(u => u.id !== id));
            showNotification('Utente eliminato definitivamente');
        } catch (error) {
            showNotification("Errore: " + error.message, 'error');
        }
    };

    return (
        <div className="space-y-8 page-enter relative">
            {/* Toast Notification */}
            {notification && (
                <div className={`fixed top-6 right-6 z-[150] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 toast-enter ${notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-zinc-900 text-white border border-white/10'}`}>
                    {notification.type === 'error' ? <ShieldOff size={20} /> : <Check size={20} className="text-green-400" />}
                    <span className="font-bold text-sm">{notification.message}</span>
                </div>
            )}

            <div>
                <h1 className="text-4xl font-black text-white tracking-tight">Gestione Utenti</h1>
                <p className="text-zinc-500 font-medium mt-1">Amministra i permessi e gli accessi alla piattaforma.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {loading ? (
                    [1, 2, 3].map(i => <div key={i} className="h-48 bg-zinc-900/50 rounded-3xl animate-pulse"></div>)
                ) : users.length === 0 ? (
                    <div className="col-span-full py-20 admin-card border-dashed flex flex-col items-center">
                        <User size={48} className="text-zinc-700 mb-4" />
                        <p className="text-zinc-500 font-bold">Nessun utente trovato.</p>
                    </div>
                ) : (
                    users.map(u => {
                        const isAdmin = u.Admin == '1';
                        const isMe = u.id === currentUser?.id;

                        return (
                            <div key={u.id} className="admin-card group relative overflow-hidden flex flex-col justify-between hover:bg-zinc-900/60 transition-colors">
                                {/* Decorazione Admin */}
                                {isAdmin && <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-3xl rounded-full translate-x-10 -translate-y-10 pointer-events-none"></div>}

                                <div>
                                    <div className="flex items-start justify-between mb-6 relative z-10">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-500 ${isAdmin ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-zinc-800 text-zinc-500 group-hover:bg-zinc-700'}`}>
                                                <User size={28} />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-lg text-white truncate max-w-[120px]">{u.Nome_Utente}</h3>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">ID #{u.id}</p>
                                            </div>
                                        </div>

                                        {isAdmin ? (
                                            <span className="flex items-center gap-1.5 text-[10px] font-black text-primary bg-primary/10 px-2.5 py-1.5 rounded-full border border-primary/20 tracking-widest shadow-sm shadow-primary/10">
                                                <Shield size={12} /> PRO
                                            </span>
                                        ) : (
                                            <span className="text-[10px] font-black text-zinc-500 bg-zinc-950/50 px-2.5 py-1.5 rounded-full border border-white/5 tracking-widest">
                                                UTENTE
                                            </span>
                                        )}
                                    </div>

                                    <div className="space-y-3 mb-6 relative z-10">
                                        <div className="flex items-center gap-2 text-xs font-bold text-zinc-500">
                                            <Calendar size={14} className="opacity-50" />
                                            Ultimo Accesso: <span className="text-zinc-300">{u.ultimo_Accesso || 'Mai'}</span>
                                        </div>
                                    </div>
                                </div>

                                {!isMe && (
                                    <div className="flex items-center gap-2 pt-4 border-t border-white/5 relative z-10">
                                        <button
                                            onClick={() => handleToggleAdmin(u.id, u.Admin)}
                                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-[0.98] ${isAdmin ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-primary/10 text-primary hover:bg-primary hover:text-white'}`}
                                        >
                                            {isAdmin ? <ShieldOff size={14} /> : <Shield size={14} />}
                                            {isAdmin ? "Rimuovi Admin" : "Fai Admin"}
                                        </button>
                                        <button
                                            onClick={() => handleDeleteUser(u.id)}
                                            className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all active:scale-90"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                )}
                                {isMe && (
                                    <div className="pt-4 border-t border-white/5 flex items-center justify-center relative z-10">
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-700 tabular-nums italic">Il tuo Profilo</span>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

