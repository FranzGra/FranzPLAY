import React, { useEffect, useState } from 'react';
import { HardDrive, Database, Server, Activity, Clock, ShieldCheck, Palette, Check as CheckIcon, AlertCircle, CheckCircle } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { COLOR_PRESETS } from '../../components/profile/ThemeTab';

export default function AdminDashboard() {
    useDocumentTitle('Dashboard Admin');
    const { logoParts, defaultTheme, fetchSettings } = useSettings();

    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    const [logo1, setLogo1] = useState(logoParts?.part1 || 'FRANZ');
    const [logo2, setLogo2] = useState(logoParts?.part2 || 'PLAY');
    const [isLogoSaving, setIsLogoSaving] = useState(false);

    const [globalTheme, setGlobalTheme] = useState(defaultTheme || '#dc2626');
    const [isThemeSaving, setIsThemeSaving] = useState(false);

    const [message, setMessage] = useState(null);

    const showMessage = (type, text) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 4000);
    };

    useEffect(() => {
        setLogo1(logoParts?.part1 || 'FRANZ');
        setLogo2(logoParts?.part2 || 'PLAY');
    }, [logoParts]);

    useEffect(() => {
        setGlobalTheme(defaultTheme || '#dc2626');
    }, [defaultTheme]);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await apiRequest('/admin.php', 'POST', { action: 'stato_server' });
                if (res.success) {
                    setStats(res.data || res.dati);
                }
            } catch (error) {
                console.error("Errore fetch stats:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    const handleLogoSubmit = async (e) => {
        e.preventDefault();
        setIsLogoSaving(true);
        try {
            const formData = new FormData();
            formData.append('action', 'salva_logo');
            formData.append('logo_part_1', logo1);
            formData.append('logo_part_2', logo2);

            const res = await apiRequest('/admin.php', 'POST', formData);
            if (res.success) {
                showMessage('success', 'Logo aggiornato con successo');
                fetchSettings(); // ricarica il logo globalmente nel context
            }
        } catch (error) {
            showMessage('error', 'Errore salvataggio logo');
        } finally {
            setIsLogoSaving(false);
        }
    };

    const handleThemeSubmit = async (e) => {
        e.preventDefault();
        setIsThemeSaving(true);
        try {
            const formData = new FormData();
            formData.append('action', 'salva_impostazioni_globali');
            formData.append('tema_default', globalTheme);

            const res = await apiRequest('/admin.php', 'POST', formData);
            if (res.success) {
                showMessage('success', 'Tema predefinito aggiornato con successo');
                fetchSettings(); // Forza reload e re-render globale
            }
        } catch (error) {
            showMessage('error', 'Errore salvataggio tema');
        } finally {
            setIsThemeSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-40 bg-zinc-900/50 rounded-3xl animate-pulse"></div>
                ))}
            </div>
        );
    }

    if (!stats) return (
        <div className="admin-card border-red-500/20 bg-red-500/5 flex flex-col items-center py-12">
            <ShieldCheck size={48} className="text-red-500 mb-4 opacity-50" />
            <p className="text-red-500 font-bold">Errore caricamento dati server.</p>
            <button onClick={() => window.location.reload()} className="mt-4 px-6 py-2 bg-red-500 text-white rounded-full font-bold text-sm">Riprova</button>
        </div>
    );

    const diskColor = stats.disco_percentuale > 90 ? 'bg-red-500' : stats.disco_percentuale > 70 ? 'bg-yellow-500' : 'bg-primary';

    return (
        <div className="space-y-10">

            {/* Header con Badge */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Sistema Operativo</span>
                    </div>
                    <h1 className="text-4xl font-extrabold text-white tracking-tight">Dashboard</h1>
                    <p className="text-zinc-400 mt-2 font-medium">Monitoring in tempo reale di FranzPLAY.</p>
                </div>
                <div className="flex gap-4">
                    <div className="glass-card px-4 py-2 rounded-2xl flex items-center gap-2 border-white/5">
                        <Clock size={16} className="text-zinc-500" />
                        <span className="text-xs font-bold text-zinc-300">{new Date().toLocaleTimeString()}</span>
                    </div>
                </div>
            </div>

            {message ? (
                <div className={`p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 shadow-lg ${message.type === 'success' ? 'bg-green-950/50 text-green-400 border border-green-800' : 'bg-red-950/50 text-red-400 border border-red-800'}`}>
                    {message.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                    <span className="font-medium">{message.text}</span>
                </div>
            ) : null}

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

                {/* DISCO */}
                <div className="admin-card group">
                    <div className="flex items-start justify-between mb-6">
                        <div className="p-3 bg-blue-500/10 rounded-2xl group-hover:scale-110 transition-transform duration-500">
                            <HardDrive size={24} className="text-blue-400" />
                        </div>
                        <div className="text-right">
                            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider">Archiviazione</p>
                            <h3 className="text-2xl font-black text-white mt-1">{stats.disco_usato_gb} <span className="text-xs text-zinc-500 font-bold">GB</span></h3>
                        </div>
                    </div>

                    <div className="w-full bg-zinc-800/50 h-2 rounded-full overflow-hidden mb-3">
                        <div className={`h-full ${diskColor} shadow-[0_0_10px_rgba(var(--primary-rgb),0.5)] transition-all duration-1000 ease-out`} style={{ width: `${stats.disco_percentuale}%` }}></div>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">{stats.disco_percentuale}% Usato</span>
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">Libero: {stats.disco_libero_gb} GB</span>
                    </div>
                </div>

                {/* PHP LIMITS */}
                <div className="admin-card group">
                    <div className="flex items-start justify-between mb-6">
                        <div className="p-3 bg-purple-500/10 rounded-2xl group-hover:scale-110 transition-transform duration-500">
                            <Server size={24} className="text-purple-400" />
                        </div>
                        <div className="text-right">
                            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider">PHP Upload</p>
                            <h3 className="text-2xl font-black text-white mt-1">{stats.php_upload_max}</h3>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 bg-zinc-950/40 p-2 rounded-xl border border-white/5">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                        Post Max: {stats.php_post_max}
                    </div>
                </div>

                {/* DB VERSION */}
                <div className="admin-card group">
                    <div className="flex items-start justify-between mb-6">
                        <div className="p-3 bg-yellow-500/10 rounded-2xl group-hover:scale-110 transition-transform duration-500">
                            <Database size={24} className="text-yellow-400" />
                        </div>
                        <div className="text-right">
                            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider">Database</p>
                            <h3 className="text-xl font-black text-white mt-1 truncate">MariaDB</h3>
                        </div>
                    </div>
                    <p className="text-[10px] text-zinc-500 font-bold truncate bg-zinc-950/40 p-2 rounded-xl border border-white/5" title={stats.db_version}>
                        {stats.db_version.split('-')[0]}
                    </p>
                </div>

                {/* SERVER LOAD */}
                <div className="admin-card group border-green-500/10 hover:border-green-500/30">
                    <div className="flex items-start justify-between mb-6">
                        <div className="p-3 bg-green-500/10 rounded-2xl group-hover:scale-110 transition-transform duration-500">
                            <Activity size={24} className="text-green-400" />
                        </div>
                        <div className="text-right">
                            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider">API Status</p>
                            <h3 className="text-2xl font-black text-green-400 mt-1">Online</h3>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-500">
                        <ShieldCheck size={14} className="text-green-500" />
                        Protezione attiva
                    </div>
                </div>

            </div>

            {/* SETTINGS AREA */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pt-4 pb-8">

                {/* Logo Settings */}
                <div className="xl:col-span-1">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-8 h-[2px] bg-primary rounded-full"></div>
                        <h2 className="text-xl font-black text-white uppercase tracking-wider">Impostazioni Logo</h2>
                    </div>
                    <div className="admin-card">
                        <form onSubmit={handleLogoSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 mb-1">Parte 1 (Testo Normale)</label>
                                <input
                                    type="text"
                                    value={logo1}
                                    onChange={e => setLogo1(e.target.value)}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-primary focus:outline-none"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 mb-1">Parte 2 (Testo Evidenziato)</label>
                                <input
                                    type="text"
                                    value={logo2}
                                    onChange={e => setLogo2(e.target.value)}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-primary focus:outline-none"
                                    required
                                />
                            </div>
                            <div className="flex justify-end pt-2">
                                <button
                                    type="submit"
                                    disabled={isLogoSaving}
                                    className="px-6 py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center disabled:opacity-50 hover:bg-primary-hover shadow-lg shadow-primary/20 transition-all active:scale-95"
                                >
                                    {isLogoSaving ? 'Salvataggio...' : 'Salva Logo'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Theme Settings */}
                <div className="xl:col-span-2">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-8 h-[2px] bg-blue-500 rounded-full"></div>
                        <h2 className="text-xl font-black text-white uppercase tracking-wider flex items-center gap-2">
                            <Palette size={20} className="text-blue-500" /> Tema Globale
                        </h2>
                    </div>
                    <div className="admin-card">
                        <form onSubmit={handleThemeSubmit} className="space-y-4 flex flex-col">
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-zinc-500 mb-2">Colore Predefinito Accesso/App</label>
                                <p className="text-sm font-medium text-zinc-400 mb-6">
                                    Questo è il colore base che apparirà nella pagina di Login e verrà applicato agli utenti che non scelgono un colore personalizzato.
                                </p>

                                <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 mb-8">
                                    {COLOR_PRESETS.map((preset) => (
                                        <button
                                            key={preset.value}
                                            type="button"
                                            onClick={() => setGlobalTheme(preset.value)}
                                            className={`
                                                relative flex items-center justify-center p-3 rounded-xl border transition-all duration-200 group
                                                ${globalTheme === preset.value
                                                    ? 'bg-zinc-800 border-blue-500 ring-1 ring-blue-500'
                                                    : 'bg-zinc-950 border-zinc-800 hover:bg-zinc-900 hover:border-zinc-700'}
                                            `}
                                            title={preset.name}
                                        >
                                            <div
                                                className="h-8 w-8 rounded-full shadow-lg border border-white/10 flex items-center justify-center"
                                                style={{ backgroundColor: preset.value }}
                                            >
                                                {globalTheme === preset.value ? <CheckIcon className="h-5 w-5 text-white drop-shadow-md" /> : null}
                                            </div>
                                        </button>
                                    ))}
                                </div>

                                <label className="block text-xs font-bold text-zinc-500 mb-2">Oppure usa un Colore Personalizzato</label>
                                <div className="flex flex-col sm:flex-row items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                                    <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 shadow-lg" style={{ backgroundColor: globalTheme, boxShadow: `0 0 20px ${globalTheme}40` }}>
                                        <input
                                            type="color"
                                            value={globalTheme}
                                            onChange={(e) => setGlobalTheme(e.target.value)}
                                            className="absolute inset-0 w-[200%] h-[200%] -top-1/2 -left-1/2 cursor-pointer opacity-0"
                                        />
                                    </div>
                                    <div className="flex-1 w-full text-center sm:text-left">
                                        <span className="block text-xs font-black uppercase text-zinc-500 tracking-wider mb-1">Codice Esadecimale</span>
                                        <input
                                            type="text"
                                            value={globalTheme.toUpperCase()}
                                            onChange={(e) => setGlobalTheme(e.target.value)}
                                            className="bg-transparent text-2xl font-black text-white uppercase focus:outline-none w-full tracking-wider text-center sm:text-left"
                                            placeholder="#DC2626"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-end pt-2">
                                <button
                                    type="submit"
                                    disabled={isThemeSaving}
                                    className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center disabled:opacity-50 hover:bg-blue-500 shadow-lg shadow-blue-500/20 transition-all active:scale-95"
                                >
                                    {isThemeSaving ? 'Salvataggio...' : 'Salva Tema Globale'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

            </div>
        </div>
    );
}


