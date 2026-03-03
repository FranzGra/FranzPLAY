import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { getAssetUrl } from '../../services/helpers';
import { Trash2, Shield, ShieldOff, User, MoreVertical, Calendar, Check, Key, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { createPortal } from 'react-dom';

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
            if (res.success) {
                setUsers(res.data || res.dati);
            }
        } catch (error) {
            console.error(error);
            showNotification('Errore caricamento utenti', 'error');
        } finally {
            setLoading(false);
        }
    };

    const [showAddUserModal, setShowAddUserModal] = useState(false);
    const [newUser, setNewUser] = useState({ username: '', password: '', isAdmin: false });

    // Modale Reset Password
    const [resetPasswordUserId, setResetPasswordUserId] = useState(null);
    const [resetPasswordField, setResetPasswordField] = useState('');
    const [isResetting, setIsResetting] = useState(false);
    const [showResetPassword, setShowResetPassword] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleAddUser = async (e) => {
        e.preventDefault();
        try {
            const res = await apiRequest('/admin.php', 'POST', {
                action: 'aggiungi_utente',
                username: newUser.username,
                password: newUser.password,
                is_admin: newUser.isAdmin
            });
            showNotification('Utente creato con successo');
            setShowAddUserModal(false);
            setNewUser({ username: '', password: '', isAdmin: false });
            fetchUsers();
        } catch (error) {
            showNotification("Errore: " + error.message, 'error');
        }
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();
        if (!resetPasswordField || resetPasswordField.length < 4) {
            showNotification("La password deve avere almeno 4 caratteri.", 'error');
            return;
        }

        setIsResetting(true);
        try {
            const formData = new FormData();
            formData.append('action', 'reset_password_utente');
            formData.append('id_utente', resetPasswordUserId);
            formData.append('nuova_password', resetPasswordField);

            const res = await apiRequest('/admin.php', 'POST', formData);
            if (res.success) {
                showNotification("Password reimpostata con successo.");
                setResetPasswordUserId(null);
                setResetPasswordField('');
                setShowResetPassword(false);
            } else {
                showNotification(res.message || "Impossibile ripristinare la password.", 'error');
            }
        } catch (error) {
            console.error("Errore reset password:", error);
            showNotification("Si è verificato un errore critico durante l'operazione.", 'error');
        } finally {
            setIsResetting(false);
        }
    };

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
        <>
            {/* Toast Notification - Portal */}
            {notification && createPortal(
                <div className={`fixed top-6 right-6 z-[9999] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 toast-enter ${notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-zinc-900 text-white border border-white/10'}`}>
                    {notification.type === 'error' ? <ShieldOff size={20} /> : <Check size={20} className="text-green-400" />}
                    <span className="font-bold text-sm">{notification.message}</span>
                </div>,
                document.body
            )}

            {/* Add User Modal - Portal */}
            {showAddUserModal && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-300">
                    <div className="bg-zinc-900/95 border border-white/10 rounded-3xl p-8 w-full max-w-md shadow-2xl scale-100 animate-in zoom-in-95 duration-300">
                        <h2 className="text-2xl font-bold text-white mb-6">Aggiungi Nuovo Utente</h2>
                        <form onSubmit={handleAddUser} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Username</label>
                                <input
                                    type="text"
                                    required
                                    value={newUser.username}
                                    onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                                    placeholder="Nome utente"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Password</label>
                                <input
                                    type="password"
                                    required
                                    value={newUser.password}
                                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                                    placeholder="Password"
                                />
                            </div>
                            <div className="flex items-center gap-3 py-2">
                                <input
                                    type="checkbox"
                                    id="isAdmin"
                                    checked={newUser.isAdmin}
                                    onChange={e => setNewUser({ ...newUser, isAdmin: e.target.checked })}
                                    className="w-5 h-5 rounded border-white/10 bg-zinc-950 text-primary focus:ring-primary/20"
                                />
                                <label htmlFor="isAdmin" className="text-sm font-medium text-zinc-300 select-none cursor-pointer">
                                    Concedi privilegi di Amministratore
                                </label>
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowAddUserModal(false)}
                                    className="flex-1 py-3 rounded-xl font-bold text-zinc-400 hover:bg-zinc-800 transition-colors"
                                >
                                    Annulla
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary-hover shadow-lg shadow-primary/20 transition-all active:scale-95"
                                >
                                    Crea Utente
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* MODALE RESET PASSWORD (PORTAL) */}
            {resetPasswordUserId && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => !isResetting && setResetPasswordUserId(null)}></div>
                    <div className="relative w-full max-w-md bg-zinc-950 border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl anim-card">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center">
                                <Key size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl font-black text-white">Reset Password</h2>
                                <p className="text-sm font-medium text-zinc-500">Imposta una nuova password per l'utente.</p>
                            </div>
                        </div>

                        <form onSubmit={handleResetPassword} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 mb-1.5 uppercase tracking-wider ml-1">Nuova Password</label>
                                <div className="relative">
                                    <input
                                        type={showResetPassword ? "text" : "password"}
                                        required
                                        minLength={4}
                                        value={resetPasswordField}
                                        onChange={(e) => setResetPasswordField(e.target.value)}
                                        className="w-full bg-zinc-900/50 border border-zinc-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all font-medium"
                                        placeholder="Digita la nuova password..."
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowResetPassword(!showResetPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                                    >
                                        {showResetPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setResetPasswordUserId(null)}
                                    disabled={isResetting}
                                    className="flex-1 py-3 rounded-xl font-bold text-zinc-400 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                                >
                                    Annulla
                                </button>
                                <button
                                    type="submit"
                                    disabled={isResetting}
                                    className="flex-1 py-3 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-50"
                                >
                                    {isResetting ? 'Salvataggio...' : 'Conferma Reset'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* MODALE RESET PASSWORD (PORTAL) */}
            {resetPasswordUserId && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => !isResetting && setResetPasswordUserId(null)}></div>
                    <div className="relative w-full max-w-md bg-zinc-950 border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl anim-card">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center">
                                <Key size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl font-black text-white">Reset Password</h2>
                                <p className="text-sm font-medium text-zinc-500">Imposta una nuova password per l'utente.</p>
                            </div>
                        </div>

                        <form onSubmit={handleResetPassword} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 mb-1.5 uppercase tracking-wider ml-1">Nuova Password</label>
                                <div className="relative">
                                    <input
                                        type={showResetPassword ? "text" : "password"}
                                        required
                                        minLength={4}
                                        value={resetPasswordField}
                                        onChange={(e) => setResetPasswordField(e.target.value)}
                                        className="w-full bg-zinc-900/50 border border-zinc-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all font-medium"
                                        placeholder="Digita la nuova password..."
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowResetPassword(!showResetPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                                    >
                                        {showResetPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setResetPasswordUserId(null)}
                                    disabled={isResetting}
                                    className="flex-1 py-3 rounded-xl font-bold text-zinc-400 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                                >
                                    Annulla
                                </button>
                                <button
                                    type="submit"
                                    disabled={isResetting}
                                    className="flex-1 py-3 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-50"
                                >
                                    {isResetting ? 'Salvataggio...' : 'Conferma Reset'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            <div className="space-y-8 page-enter relative">

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-4xl font-black text-white tracking-tight">Gestione Utenti</h1>
                        <p className="text-zinc-500 font-medium mt-1">Amministra i permessi e gli accessi alla piattaforma.</p>
                    </div>
                    <button
                        onClick={() => setShowAddUserModal(true)}
                        className="flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl font-bold hover:bg-zinc-200 transition-colors shadow-lg shadow-white/10 active:scale-95"
                    >
                        <User size={20} />
                        Aggiungi Utente
                    </button>
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
                                <div key={u.id} className="admin-card group relative overflow-hidden flex flex-col justify-between hover:bg-zinc-900/60">
                                    {/* Decorazione Admin rimossa per pulizia */}

                                    <div>
                                        <div className="flex items-start justify-between mb-6 relative z-10">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden transition-all duration-300 ${isAdmin ? 'bg-primary text-white' : 'bg-zinc-800 text-zinc-500 group-hover:bg-zinc-700'}`}>
                                                    {u.Immagine_Profilo ? (
                                                        <img
                                                            src={u.Immagine_Profilo.startsWith('http') ? u.Immagine_Profilo : `/img_utenti/${u.Immagine_Profilo}?t=${Date.now()}`}
                                                            alt={u.Nome_Utente}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <span className="text-xl font-black uppercase opacity-40">
                                                            {u.Nome_Utente?.substring(0, 2)}
                                                        </span>
                                                    )}
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-lg text-white truncate max-w-[120px]">{u.Nome_Utente}</h3>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">ID #{u.id}</p>
                                                </div>
                                            </div>

                                            {isAdmin ? (
                                                <span className="flex items-center gap-1.5 text-[10px] font-black text-primary bg-primary/10 px-2.5 py-1.5 rounded-full border border-primary/20 tracking-widest">
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
                                                className={`flex-1 flex items-center justify-center gap-2 py-3 md:py-2.5 rounded-xl font-bold text-xs md:text-[10px] transition-all active:scale-[0.98] ${isAdmin ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-primary/10 text-primary hover:bg-primary hover:text-white'}`}
                                            >
                                                {isAdmin ? <ShieldOff size={18} className="md:w-3.5 md:h-3.5" /> : <Shield size={18} className="md:w-3.5 md:h-3.5" />}
                                                {isAdmin ? "Rimuovi Admin" : "Fai Admin"}
                                            </button>
                                            <button
                                                onClick={() => setResetPasswordUserId(u.id)}
                                                className="w-12 h-12 md:w-10 md:h-10 shrink-0 flex items-center justify-center rounded-xl bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white transition-all active:scale-90"
                                                title="Reset Password"
                                            >
                                                <Key size={20} className="md:w-4 md:h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteUser(u.id)}
                                                className="w-12 h-12 md:w-10 md:h-10 shrink-0 flex items-center justify-center rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all active:scale-90"
                                            >
                                                <Trash2 size={20} className="md:w-4 md:h-4" />
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
        </>
    );
}

