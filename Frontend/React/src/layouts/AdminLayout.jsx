import React from 'react';
import { Outlet, Navigate, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Film, Users, FolderOpen, LogOut, ShieldAlert, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AdminLayout() {
    const { user, loading, logout } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="h-screen w-full bg-zinc-950 flex items-center justify-center text-white">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-zinc-800 border-t-white rounded-full animate-spin"></div>
                    <p className="text-zinc-500 font-medium">Inizializzazione Dashboard...</p>
                </div>
            </div>
        );
    }

    if (!user || !user.isAdmin) {
        return <Navigate to="/" replace />;
    }

    const navItems = [
        { path: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
        { path: '/admin/videos', icon: Film, label: 'Video' },
        { path: '/admin/users', icon: Users, label: 'Utenti' },
        { path: '/admin/categories', icon: FolderOpen, label: 'Categorie' },
    ];

    return (
        <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans selection:bg-primary/30">

            {/* BACKGROUND DECORATION */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-blue-500/5 blur-[100px] rounded-full"></div>
            </div>

            {/* SIDEBAR */}
            <aside className="w-72 glass-sidebar flex flex-col hidden md:flex relative z-10">
                <div className="p-8 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
                        <ShieldAlert size={24} className="text-white" />
                    </div>
                    <div>
                        <span className="font-bold text-xl tracking-tight text-white block leading-tight">Admin</span>
                        <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">FranzTube Control</span>
                    </div>
                </div>

                <nav className="flex-1 px-4 py-2 space-y-2 overflow-y-auto">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-bold px-4 mb-4">Principale</div>
                    {navItems.map((item) => {
                        const active = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 group ${active
                                    ? 'nav-item-active'
                                    : 'text-zinc-400 nav-item-hover active:scale-95'
                                    }`}
                            >
                                <item.icon size={20} className={`transition-transform duration-300 ${active ? 'scale-110' : 'group-hover:scale-110 opacity-70 group-hover:opacity-100'}`} />
                                <span className="font-semibold text-sm">{item.label}</span>
                            </Link>
                        );
                    })}

                    <div className="pt-8 text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-bold px-4 mb-4">Sito</div>
                    <Link
                        to="/"
                        className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 text-zinc-400 nav-item-hover active:scale-95 group"
                    >
                        <ArrowLeft size={20} className="opacity-70 group-hover:opacity-100 group-hover:-translate-x-1 transition-transform" />
                        <span className="font-semibold text-sm">Torna al Sito</span>
                    </Link>
                </nav>

                <div className="p-6">
                    <div className="glass-card rounded-3xl p-4 mb-4 border-white/5 bg-zinc-900/40">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-zinc-800">
                                <img
                                    src={user.avatar ? `${user.avatar}?t=${Date.now()}` : 'https://via.placeholder.com/40'}
                                    alt="Admin"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold truncate text-white">{user.username}</p>
                                <p className="text-[10px] text-zinc-500 uppercase font-bold">Amministratore</p>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={logout}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl transition-all duration-300 text-sm font-bold active:scale-95"
                    >
                        <LogOut size={16} />
                        Esci Sessione
                    </button>
                </div>
            </aside>

            {/* MAIN CONTENT AREA */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">

                {/* Mobile Header */}
                <header className="md:hidden glass-card border-x-0 border-t-0 rounded-none p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                            <ShieldAlert size={18} className="text-white" />
                        </div>
                        <span className="font-bold text-lg">Admin</span>
                    </div>
                    <Link to="/" className="text-xs bg-zinc-800 px-4 py-2 rounded-full font-bold active:scale-95">Sito</Link>
                </header>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-10 scroll-smooth">
                    <div className="max-w-6xl mx-auto page-enter">
                        <Outlet />
                    </div>
                </div>
            </main>
        </div>
    );
}

