import React, { useState } from "react";
import { Outlet, Navigate, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Film,
  Users,
  FolderOpen,
  LogOut,
  ShieldAlert,
  ArrowLeft,
  Github,
  Activity,
  Captions,
  ImageDown,
  Settings2,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function AdminLayout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();

  // Stato per la sidebar mobile
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  if (loading) {
    return (
      <div className="h-screen w-full bg-background flex items-center justify-center text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-surface-3 border-t-foreground rounded-full animate-spin"></div>
          <p className="text-muted-foreground font-medium">
            Inizializzazione Dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (!user || !user.isAdmin) {
    return <Navigate to="/" replace />;
  }

  const navItems = [
    { path: "/admin", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/admin/videos", icon: Film, label: "Video" },
    { path: "/admin/users", icon: Users, label: "Utenti" },
    { path: "/admin/categories", icon: FolderOpen, label: "Categorie" },
    { path: "/admin/subtitles", icon: Captions, label: "Sottotitoli" },
    { path: "/admin/covers", icon: ImageDown, label: "Copertine" },
    { path: "/admin/accessi", icon: Activity, label: "Accessi" },
    // Impostazioni generali (logo, colore del sito, registrazioni): erano in
    // fondo alla Dashboard, che è invece una pagina di sola lettura.
    { path: "/admin/impostazioni", icon: Settings2, label: "Impostazioni" },
  ];

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans selection:bg-primary/30">
      {/* BACKGROUND DECORATION */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-blue-500/5 blur-[100px] rounded-full"></div>
      </div>

      {/* MOBILE MENU BACKDROP */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside
        className={`
                    w-72 glass-sidebar flex flex-col fixed inset-y-0 left-0 z-50 
                    transform transition-transform duration-300 ease-in-out
                    ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
                    md:relative md:translate-x-0
                `}
      >
        {/* Chiudi Menu Mobile */}
        <button
          className="absolute top-6 right-6 p-2 bg-surface-3 rounded-lg text-muted-foreground hover:text-foreground md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <X size={20} />
        </button>

        <div className="p-8 flex items-center gap-3 pr-16 md:pr-8">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <ShieldAlert size={24} className="text-white" />
          </div>
          <div>
            <span className="font-bold text-xl tracking-tight text-foreground block leading-tight">
              Admin
            </span>
            <span className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
              FranzPLAY Control
            </span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-2 space-y-2 overflow-y-auto">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-bold px-4 mb-4">
            Principale
          </div>
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 group ${
                  active
                    ? "nav-item-active"
                    : "text-muted-foreground nav-item-hover active:scale-95"
                }`}
              >
                <item.icon
                  size={20}
                  className={`transition-transform duration-300 ${active ? "scale-110" : "group-hover:scale-110 opacity-70 group-hover:opacity-100"}`}
                />
                <span className="font-semibold text-sm">{item.label}</span>
              </Link>
            );
          })}

          <div className="pt-8 text-xs uppercase tracking-[0.2em] text-muted-foreground font-bold px-4 mb-4">
            Sito & Source
          </div>
          <Link
            to="/"
            onClick={() => setIsMobileMenuOpen(false)}
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 text-muted-foreground nav-item-hover active:scale-95 group"
          >
            <ArrowLeft
              size={20}
              className="opacity-70 group-hover:opacity-100 group-hover:-translate-x-1 transition-transform"
            />
            <span className="font-semibold text-sm">Torna al Sito</span>
          </Link>

          <a
            href="https://github.com/FranzGra/FranzPLAY"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 text-muted-foreground nav-item-hover active:scale-95 group"
          >
            <Github
              size={20}
              className="opacity-70 group-hover:opacity-100 group-hover:scale-110 transition-transform"
            />
            <span className="font-semibold text-sm">Source Code</span>
          </a>
        </nav>

        <div className="p-6">
          <div className="glass-card rounded-2xl p-4 mb-4 border-hairline bg-surface-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-hairline-strong bg-surface-3 flex items-center justify-center">
                {user.avatar ? (
                  <img
                    src={`${user.avatar}?t=${Date.now()}`}
                    alt="Admin"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-bold text-muted-foreground uppercase">
                    {user.username?.substring(0, 2)}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate text-foreground">
                  {user.username}
                </p>
                <p className="text-xs text-muted-foreground uppercase font-bold">
                  Amministratore
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-2xl transition-all duration-300 text-sm font-bold active:scale-95"
          >
            <LogOut size={16} />
            Esci Sessione
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        {/* Mobile Header */}
        <header className="md:hidden glass-card border-x-0 border-t-0 rounded-none p-4 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              className="p-2 -ml-2 text-foreground bg-surface-3 rounded-xl hover:bg-surface-3 transition-colors"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu size={24} />
            </button>
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <ShieldAlert size={18} className="text-white" />
            </div>
            <span className="font-bold text-lg">Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/FranzGra/FranzPLAY"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Github size={20} />
            </a>
            <Link
              to="/"
              className="text-xs bg-surface-3 px-4 py-2 rounded-full font-bold active:scale-95"
            >
              Sito
            </Link>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 lg:px-10 scroll-smooth">
          <div className="max-w-[1400px] w-full mx-auto page-enter">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
