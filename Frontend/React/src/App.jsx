import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

// --- CONTESTI E COMPONENTI ---
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import Navbar from './components/Navbar';
import PageTransition from './components/PageTransition';

// --- PAGINE (Lazy Loaded) ---
const Home = lazy(() => import('./pages/Home'));
const Player = lazy(() => import('./pages/Player'));
const Profile = lazy(() => import('./pages/Profile'));
const Categories = lazy(() => import('./pages/Categories'));
const CategoryDetail = lazy(() => import('./pages/CategoryDetail'));
const Saved = lazy(() => import('./pages/Saved'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));

// --- ADMIN (Lazy Loaded) ---
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminVideos = lazy(() => import('./pages/admin/AdminVideos'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminCategories = lazy(() => import('./pages/admin/AdminCategories'));
const AdminAccessi = lazy(() => import('./pages/admin/AdminAccessi'));

// --- WIZARD (Lazy Loaded) ---
const SetupWizard = lazy(() => import('./pages/SetupWizard'));

/**
 * COMPONENTE: ScrollToTop
 * Descrizione: Resetta lo scroll a (0,0) al cambio rotta.
 */
const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
};

/**
 * COMPONENTE: ProtectedRoute
 * Descrizione: Protegge le rotte che richiedono autenticazione.
 */
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-dvh bg-zinc-950 flex items-center justify-center text-zinc-500">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

/**
 * COMPONENTE: Layout
 * Descrizione: Wrapper principale dell'UI.
 */
const Layout = ({ children }) => {
  const location = useLocation();

  // Rotte "Full Screen" senza Navbar
  const noNavbarRoutes = ['/login', '/register'];
  const hideNavbar = noNavbarRoutes.includes(location.pathname);

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 font-sans antialiased selection:bg-blue-600/30 overflow-x-hidden [scrollbar-gutter:stable]">

      {!hideNavbar && <Navbar />}

      <div className="relative w-full isolation-auto">
        <PageTransition>
          {children}
        </PageTransition>
      </div>
    </div>
  );
};

export default function App() {
  const LayoutOutlet = () => (
    <Layout>
      <Outlet />
    </Layout>
  );

  return (
    <SettingsProvider>
      <SettingsGuard>
        <AuthProvider>
          <Router>
            <ScrollToTop />
            <Suspense fallback={<div className="h-screen w-full flex items-center justify-center bg-zinc-950"><Loader2 className="h-10 w-10 animate-spin text-blue-600" /></div>}>
              <Routes>
                {/* 1. ADMIN ROUTES - Independent Layout */}
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="videos" element={<AdminVideos />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="categories" element={<AdminCategories />} />
                  <Route path="accessi" element={<AdminAccessi />} />
                </Route>

                {/* 2. USER ROUTES - Wrapped in Main Layout */}
                <Route element={<LayoutOutlet />}>
                  {/* PUBLIC */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />

                  {/* PROTECTED */}
                  <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
                  <Route path="/categories" element={<ProtectedRoute><Categories /></ProtectedRoute>} />
                  <Route path="/category/:id" element={<ProtectedRoute><CategoryDetail /></ProtectedRoute>} />
                  <Route path="/watch/:id" element={<ProtectedRoute><Player /></ProtectedRoute>} />
                  <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                  <Route path="/saved" element={<ProtectedRoute><Saved /></ProtectedRoute>} />

                  {/* FALLBACK */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Suspense>
          </Router>
        </AuthProvider>
      </SettingsGuard>
    </SettingsProvider>
  );
}

/**
 * COMPONENTE: SettingsGuard
 * Descrizione: Blocca il rendering dell'app se il backend segnala
 * che il setup iniziale (Wizard) non è ancora stato completato.
 */
import { useSettings } from './context/SettingsContext';

const SettingsGuard = ({ children }) => {
  const { needsSetup, loading, dbOffline } = useSettings();

  if (loading) {
    return (
      <div className="min-h-dvh bg-zinc-950 flex items-center justify-center text-zinc-500">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      </div>
    );
  }

  // Seleziona la lingua o mostra un messaggio bilingue forte, dato che è critico.
  if (dbOffline) {
    return (
      <div className="min-h-dvh w-full bg-zinc-950 flex flex-col items-center justify-center text-center p-6 text-zinc-100">
        <div className="bg-red-900/20 border border-red-500/50 rounded-2xl p-8 max-w-lg shadow-2xl backdrop-blur-sm">
          <h1 className="text-3xl font-bold text-red-500 mb-4 tracking-tight">Database Offline</h1>
          <p className="text-lg text-zinc-300 mb-6 leading-relaxed">
            FranzPLAY non riesce a connettersi al Database oppure quest'ultimo non è stato inizializzato correttamente.
          </p>
          <div className="bg-zinc-900/50 rounded-xl p-6 text-left border border-zinc-800 space-y-4">
            <h3 className="font-semibold text-zinc-100">Come risolvere il problema:</h3>
            <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-2">
              <li>Assicurati di aver creato il file <code className="bg-zinc-800 text-red-400 px-1.5 py-0.5 rounded">.env</code> nella directory principale (puoi duplicare <code className="text-red-400">.env.example</code>).</li>
              <li>Chiudi i container e pulisci i volumi sporchi lanciando lo script <code className="bg-zinc-800 text-blue-400 px-1.5 py-0.5 rounded">resetta_ambiente_docker.bat</code> (su Windows) o cancellando manualmente la cartella <code className="text-blue-400">App_Data/Database_Data</code>.</li>
              <li>Riavvia i container con <code className="text-blue-400">docker-compose up -d</code>.</li>
            </ol>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-8 bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-8 rounded-full transition-all active:scale-95"
          >
            Riprova Connessione
          </button>
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return (
      <Suspense fallback={
        <div className="h-screen w-full flex items-center justify-center bg-zinc-950">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
        </div>
      }>
        <SetupWizard />
      </Suspense>
    );
  }

  return children;
};