import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

// --- CONTESTI E COMPONENTI ---
import { AuthProvider, useAuth } from './context/AuthContext';
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
  );
}