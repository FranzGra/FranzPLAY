import React, { useEffect, useState } from 'react';
import { HardDrive, Cpu, Database, Server, BarChart3, Activity, Clock, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../../services/api';

export default function AdminDashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await apiRequest('/admin.php', 'POST', { action: 'stato_server' });
                if (res.successo) {
                    setStats(res.dati);
                }
            } catch (error) {
                console.error("Errore fetch stats:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

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
                    <p className="text-zinc-400 mt-2 font-medium">Monitoring in tempo reale di FranzTube.</p>
                </div>
                <div className="flex gap-4">
                    <div className="glass-card px-4 py-2 rounded-2xl flex items-center gap-2 border-white/5">
                        <Clock size={16} className="text-zinc-500" />
                        <span className="text-xs font-bold text-zinc-300">{new Date().toLocaleTimeString()}</span>
                    </div>
                </div>
            </div>

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

            {/* Quick Actions */}
            <div className="pt-4">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-[2px] bg-primary rounded-full"></div>
                    <h2 className="text-xl font-black text-white uppercase tracking-wider">Azioni Rapide</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <button
                        onClick={() => window.location.href = '/admin/users'}
                        className="admin-card !p-5 flex items-center gap-4 group active:scale-[0.98]"
                    >
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center group-hover:bg-primary transition-colors">
                            <BarChart3 size={20} className="text-primary group-hover:text-white transition-colors" />
                        </div>
                        <div className="text-left">
                            <span className="block font-bold text-white group-hover:text-primary transition-colors">Vedi Utenti</span>
                            <span className="text-xs text-zinc-500 font-medium tracking-tight">Gestione accessi e permessi</span>
                        </div>
                    </button>

                    <button className="admin-card !p-5 flex items-center gap-4 group cursor-not-allowed opacity-50 grayscale">
                        <div className="w-12 h-12 bg-zinc-800 rounded-2xl flex items-center justify-center">
                            <Cpu size={20} className="text-zinc-500" />
                        </div>
                        <div className="text-left">
                            <span className="block font-bold text-zinc-400">Restart Workers</span>
                            <span className="text-xs text-zinc-600 font-medium tracking-tight">Funzionalità server-side disabilitata</span>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}


