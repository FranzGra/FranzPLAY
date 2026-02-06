import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, Trash2, Camera, Loader2, Save, AlertCircle, CheckCircle, Pencil, X, Check, Shield, Palette, Check as CheckIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ImageCropper from '../components/ImageCropper';

// Palette predefinita per scelta rapida
const COLOR_PRESETS = [
    { name: 'Red', value: '#dc2626' },    // Default
    { name: 'Orange', value: '#ea580c' },
    { name: 'Purple', value: '#7c3aed' },
    { name: 'Blue', value: '#2563eb' },
    { name: 'Golden', value: '#ca8a04' },
    { name: 'Cyan', value: '#0891b2' },
    { name: 'Deep Teal', value: '#0d9488' },
    { name: 'Indigo', value: '#4f46e5' },
];

export default function Profile() {
    const { user, refreshUser, logout, updateLocalTheme } = useAuth();
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const [activeTab, setActiveTab] = useState('themes'); // Default su temi per testare subito
    const [loading, setLoading] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [message, setMessage] = useState(null);

    const [editUsername, setEditUsername] = useState(user?.username || '');
    const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });

    // Stato locale per il color picker (inizializzato con il colore attuale dell'utente)
    const [selectedColor, setSelectedColor] = useState(user?.themeColor || '#dc2626');
    const [cropImage, setCropImage] = useState(null);

    const showMessage = (type, text) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 4000);
    };

    // --- LOGICA CAMBIO TEMA ---
    const handleThemeChange = async (newColor) => {
        setSelectedColor(newColor);

        // Aggiorna IMMEDIATAMENTE la UI tramite AuthContext (senza aspettare il DB)
        // Questo rende l'app reattiva
        updateLocalTheme(newColor);

        // Salva nel DB
        try {
            const formData = new FormData();
            formData.append('action', 'cambia_tema');
            formData.append('colore_tema', newColor);

            // Chiamata API silenziosa (non blocchiamo l'UI con loading full screen)
            await fetch('/api/profilo.php', { method: 'POST', body: formData });

            // Non serve refreshUser() completo perché updateLocalTheme ha già sistemato lo stato locale
        } catch (err) {
            console.error("Errore salvataggio tema", err);
            showMessage('error', "Errore salvataggio tema");
        }
    };

    // --- LOGICA ESISTENTE (Avatar, Username, Password...) ---
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.addEventListener('load', () => {
            setCropImage(reader.result);
        });
        reader.readAsDataURL(file);
        e.target.value = null; // Reset input
    };

    const handleCropComplete = async (croppedBlob) => {
        setCropImage(null);
        setLoading(true);
        const formData = new FormData();
        formData.append('action', 'cambia_immagine_profilo');
        formData.append('immagine_profilo', croppedBlob, 'avatar.jpg');

        try {
            const res = await fetch('/api/profilo.php', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.successo) { showMessage('success', 'Immagine aggiornata!'); refreshUser(); }
            else showMessage('error', data.messaggio);
        } catch (err) { showMessage('error', "Errore upload"); }
        finally { setLoading(false); }
    };

    const handleUpdateUsername = async () => {
        if (!editUsername.trim()) return;
        setLoading(true);
        const formData = new FormData();
        formData.append('action', 'cambia_username');
        formData.append('nuovo_nome_utente', editUsername);
        try {
            const res = await fetch('/api/profilo.php', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.successo) { showMessage('success', 'Username aggiornato!'); refreshUser(); setIsEditingName(false); }
            else showMessage('error', data.messaggio);
        } catch (err) { showMessage('error', "Errore aggiornamento"); }
        finally { setLoading(false); }
    };

    const handleUpdatePassword = async (e) => {
        e.preventDefault();
        if (passwords.new !== passwords.confirm) return showMessage('error', "Le password non coincidono");
        setLoading(true);
        const formData = new FormData();
        formData.append('action', 'cambia_password');
        formData.append('password_attuale', passwords.current);
        formData.append('nuova_password', passwords.new);
        formData.append('conferma_password', passwords.confirm);
        try {
            const res = await fetch('/api/profilo.php', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.successo) { showMessage('success', 'Password modificata!'); setPasswords({ current: '', new: '', confirm: '' }); }
            else showMessage('error', data.messaggio);
        } catch (err) { showMessage('error', "Errore password"); }
        finally { setLoading(false); }
    };

    const handleDeleteAccount = async () => {
        if (!window.confirm("Sei sicuro? Questa azione è irreversibile!")) return;
        setLoading(true);
        const formData = new FormData();
        formData.append('action', 'elimina_profilo_utente');
        try {
            const res = await fetch('/api/profilo.php', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.successo) { logout(); navigate('/login'); }
            else { showMessage('error', data.messaggio); setLoading(false); }
        } catch (err) { showMessage('error', "Errore eliminazione"); setLoading(false); }
    };

    useEffect(() => { document.title = 'Il mio Profilo - FranzTube'; }, []);

    return (
        <main className="pt-24 md:pt-32 pb-10 w-full px-4 md:px-0 md:max-w-[90%] xl:max-w-[80%] mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 min-h-screen">

            {/* HEADER PROFILO */}
            {/* HEADER PROFILO */}
            <div className="flex flex-col md:flex-row items-center gap-6 border-b border-zinc-800 pb-8">
                {/* 1. SEZIONE AVATAR */}
                <div className="relative group flex-shrink-0">
                    <div className="h-24 w-24 md:h-32 md:w-32 rounded-full bg-zinc-800 overflow-hidden ring-4 ring-zinc-900 shadow-2xl">
                        {user?.avatar ? (
                            <img src={`${user.avatar}?t=${Date.now()}`} alt="Avatar" className="h-full w-full object-cover" />
                        ) : (
                            <div className="h-full w-full flex items-center justify-center text-3xl font-bold text-zinc-500">
                                {user?.username?.substring(0, 2).toUpperCase()}
                            </div>
                        )}
                    </div>
                    {/* Overlay Camera (Desktop: Hover, Mobile: Hidden) */}
                    <button onClick={() => fileInputRef.current.click()} className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center opacity-0 md:group-hover:opacity-100 transition-opacity cursor-pointer backdrop-blur-[2px]">
                        <Camera className="h-8 w-8 text-white" />
                    </button>
                    {/* Pulsante Camera Esplicito (Mobile Only) */}
                    <button
                        onClick={() => fileInputRef.current.click()}
                        className="absolute bottom-0 right-0 p-2.5 bg-[var(--primary-color)] rounded-full text-white shadow-xl md:hidden border-4 border-zinc-950 active:scale-90 transition-transform z-10"
                    >
                        <Camera className="h-5 w-5" />
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/png, image/jpeg, image/webp" />
                </div>

                {/* 2. SEZIONE INFO (Viene centrata verticalmente grazie a items-center sul parent) */}
                <div className="flex-1 flex flex-col md:flex-row md:items-center justify-between gap-4 w-full">
                    <div className="text-center md:text-left min-w-0">
                        {isEditingName ? (
                            <div className="flex flex-col sm:flex-row items-center gap-2">
                                <input
                                    type="text"
                                    value={editUsername}
                                    onChange={(e) => setEditUsername(e.target.value)}
                                    className="bg-zinc-950 border border-zinc-700 text-white text-xl md:text-2xl font-bold px-3 py-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] w-full max-w-[250px]"
                                    autoFocus
                                />
                                <div className="flex gap-2">
                                    <button onClick={handleUpdateUsername} disabled={loading} className="p-2 bg-green-600 rounded-lg text-white hover:bg-green-500 transition-colors"><Check className="h-5 w-5" /></button>
                                    <button onClick={() => setIsEditingName(false)} disabled={loading} className="p-2 bg-zinc-700 rounded-lg text-white hover:bg-zinc-600 transition-colors"><X className="h-5 w-5" /></button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center md:items-start gap-2">
                                <div className="flex items-center gap-3 group">
                                    <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight break-all">{user?.username}</h1>
                                    <button
                                        onClick={() => { setEditUsername(user?.username); setIsEditingName(true); }}
                                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-2 text-zinc-400 hover:text-white bg-zinc-800/50 md:bg-transparent rounded-full hover:bg-zinc-800"
                                        title="Modifica nome"
                                    >
                                        <Pencil className="h-5 w-5" />
                                    </button>
                                </div>
                                {/* Badge Admin (Solo se admin) */}
                                {user?.isAdmin && (
                                    <div className="inline-flex items-center gap-1.5 bg-[var(--primary-color)]/10 text-[var(--primary-color)] text-[10px] px-2.5 py-1 rounded-full border border-[var(--primary-color)]/20 font-black uppercase tracking-wider">
                                        <Shield className="h-3 w-3" /> Admin
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 3. TASTO ADMIN COORDINATO (Desktop: Lato, Mobile: Centralo in basso se non in edit) */}
                    {user?.isAdmin && !isEditingName && (
                        <div className="flex justify-center md:block">
                            <button
                                onClick={() => navigate('/admin')}
                                className="group flex items-center gap-3 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 hover:border-[var(--primary-color)]/30 text-white px-5 py-3 md:py-2.5 rounded-2xl transition-all duration-300 shadow-xl hover:shadow-[var(--primary-color)]/5 active:scale-95"
                            >
                                <div className="p-2 bg-[var(--primary-color)]/10 rounded-xl group-hover:bg-[var(--primary-color)]/20 transition-colors">
                                    <Shield className="h-5 w-5 md:h-4 md:w-4 text-[var(--primary-color)]" />
                                </div>
                                <div className="text-left md:text-center">
                                    <div className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 group-hover:text-[var(--primary-color)] transition-colors leading-none mb-1">Accesso</div>
                                    <div className="font-bold text-base md:text-sm">Pannello Admin</div>
                                </div>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {message && (
                <div className={`p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 shadow-lg ${message.type === 'success' ? 'bg-green-950/50 text-green-400 border border-green-800' : 'bg-red-950/50 text-red-400 border border-red-800'}`}>
                    {message.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                    <span className="font-medium">{message.text}</span>
                </div>
            )}

            {/* NAVIGATION TABS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-8">
                <div className="space-y-2">
                    {/* TAB: TEMI E STILI (NUOVO) */}
                    <button onClick={() => setActiveTab('themes')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${activeTab === 'themes' ? 'bg-zinc-800 text-white shadow-lg ring-1 ring-white/5' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'}`}>
                        <Palette className="h-5 w-5" /> Temi e Stili
                    </button>

                    <button onClick={() => setActiveTab('security')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${activeTab === 'security' ? 'bg-zinc-800 text-white shadow-lg ring-1 ring-white/5' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'}`}>
                        <Lock className="h-5 w-5" /> Sicurezza
                    </button>
                    <button onClick={() => setActiveTab('danger')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${activeTab === 'danger' ? 'bg-red-950/20 text-red-400 border border-red-900/30 shadow-lg' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'}`}>
                        <Trash2 className="h-5 w-5" /> Zona Pericolosa
                    </button>
                </div>

                {/* CONTENT AREA */}
                <div className="md:col-span-3 bg-zinc-900/30 border border-zinc-800/50 rounded-3xl p-6 md:p-8 backdrop-blur-sm">

                    {/* --- CONTENUTO TAB: TEMI --- */}
                    {activeTab === 'themes' && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Palette className="text-[var(--primary-color)]" /> Personalizza FranzTube
                                </h2>
                                <p className="text-sm text-zinc-500 mt-1">Scegli il colore principale dell'interfaccia. Le modifiche sono salvate automaticamente.</p>
                            </div>

                            {/* Palette Preset */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                {COLOR_PRESETS.map((preset) => (
                                    <button
                                        key={preset.value}
                                        onClick={() => handleThemeChange(preset.value)}
                                        className={`
                                    relative flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 group
                                    ${selectedColor === preset.value
                                                ? 'bg-zinc-800 border-[var(--primary-color)] ring-1 ring-[var(--primary-color)]'
                                                : 'bg-zinc-950 border-zinc-800 hover:bg-zinc-900 hover:border-zinc-700'}
                                `}
                                    >
                                        <div
                                            className="h-8 w-8 rounded-full shadow-lg border border-white/10 flex items-center justify-center"
                                            style={{ backgroundColor: preset.value }}
                                        >
                                            {selectedColor === preset.value && <CheckIcon className="h-5 w-5 text-white drop-shadow-md" />}
                                        </div>
                                        <span className="text-sm font-medium text-zinc-300">{preset.name}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Color Picker Custom */}
                            <div className="pt-4 border-t border-zinc-800/50">
                                <label className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3 block">Colore Personalizzato</label>
                                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                                    <div className="relative h-12 w-full max-w-[200px] rounded-xl overflow-hidden border border-zinc-700 ring-2 ring-transparent focus-within:ring-[var(--primary-color)] transition-all">
                                        <input
                                            type="color"
                                            value={selectedColor}
                                            onChange={(e) => handleThemeChange(e.target.value)}
                                            className="absolute -top-2 -left-2 w-[150%] h-[150%] cursor-pointer border-none p-0 m-0"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 w-full max-w-[200px]">
                                        <span className="text-zinc-500 font-mono text-lg font-bold">#</span>
                                        <input
                                            type="text"
                                            value={selectedColor.replace('#', '')}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                // Accetta solo caratteri hex validi
                                                if (/^[0-9A-F]{0,6}$/i.test(val)) {
                                                    if (val.length === 6) {
                                                        handleThemeChange('#' + val);
                                                    } else {
                                                        setSelectedColor('#' + val);
                                                    }
                                                }
                                            }}
                                            onBlur={(e) => {
                                                // Se il codice non è di 6 cifre, torna al colore precedente (prevenzione stati invalidi)
                                                if (selectedColor.length !== 7) {
                                                    setSelectedColor(user?.themeColor || '#dc2626');
                                                }
                                            }}
                                            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] transition-all w-full"
                                            placeholder="FFFFFF"
                                            maxLength={6}
                                        />
                                    </div>
                                    <div className="hidden sm:block text-zinc-600 font-mono text-xs uppercase">
                                        Inserisci codice hex manuale
                                    </div>
                                </div>
                            </div>

                            {/* Preview Live */}
                            <div className="mt-8 p-4 bg-zinc-950 rounded-xl border border-zinc-800">
                                <p className="text-xs text-zinc-500 mb-2 uppercase tracking-wider font-bold">Anteprima Live</p>
                                <div className="flex items-center gap-4">
                                    <button className="bg-[var(--primary-color)] text-white px-4 py-2 rounded-lg font-bold shadow-lg shadow-[var(--primary-color)]/20">
                                        Bottone Primario
                                    </button>
                                    <span className="text-[var(--primary-color)] font-semibold">Testo Colorato</span>
                                    <div className="h-6 w-6 rounded-full border-2 border-[var(--primary-color)]"></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- TAB SICUREZZA (Codice esistente) --- */}
                    {activeTab === 'security' && (
                        <form onSubmit={handleUpdatePassword} className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div>
                                <h2 className="text-xl font-bold text-white">Modifica Password</h2>
                                <p className="text-sm text-zinc-500 mt-1">Aggiorna la password per mantenere il tuo account sicuro.</p>
                            </div>
                            <div className="space-y-4 pt-2">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Password Attuale</label>
                                    <input type="password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] transition-all placeholder:text-zinc-700" placeholder="••••••••" />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Nuova Password</label>
                                        <input type="password" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] transition-all placeholder:text-zinc-700" placeholder="••••••••" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Conferma Password</label>
                                        <input type="password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] transition-all placeholder:text-zinc-700" placeholder="••••••••" />
                                    </div>
                                </div>
                            </div>
                            <div className="pt-2">
                                <button type="submit" disabled={loading} className="bg-white text-black px-6 py-2.5 rounded-xl font-bold hover:bg-zinc-200 transition-colors flex items-center gap-2 shadow-lg shadow-white/5 disabled:opacity-50">
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Aggiorna Password
                                </button>
                            </div>
                        </form>
                    )}

                    {/* --- TAB DANGER (Codice esistente) --- */}
                    {activeTab === 'danger' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div>
                                <h2 className="text-xl font-bold text-red-500">Eliminazione Account</h2>
                                <p className="text-sm text-zinc-400 mt-1">Attenzione: questa operazione rimuoverà permanentemente tutti i tuoi dati.</p>
                            </div>
                            <div className="bg-red-950/10 border border-red-900/30 p-4 rounded-xl">
                                <p className="text-zinc-300 text-sm leading-relaxed">Una volta eliminato l'account, non sarà possibile tornare indietro. Perderai l'accesso alla cronologia, ai video salvati e ai commenti pubblicati.</p>
                            </div>
                            <button onClick={handleDeleteAccount} disabled={loading} className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-700 transition-colors flex items-center gap-2 shadow-lg shadow-red-900/20 disabled:opacity-50">
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Elimina Definitivamente
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {cropImage && (
                <ImageCropper
                    imageSrc={cropImage}
                    onCropComplete={handleCropComplete}
                    onCancel={() => setCropImage(null)}
                />
            )}
        </main>
    );
}