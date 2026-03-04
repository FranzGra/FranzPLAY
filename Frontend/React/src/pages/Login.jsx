import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { User, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { apiRequest } from '../services/api';

export default function Login() {
  useDocumentTitle('Accedi');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { logoParts } = useSettings();
  const { login, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await login(username, password);
      if (!result.success) {
        setError(result.message || "Credenziali non valide.");
        setIsSubmitting(false);
      }
    } catch (err) {
      console.error("Login Error:", err);
      setError("Errore di connessione al server.");
      setIsSubmitting(false);
    }
  };

  if (user) return null;

  return (
    // SFONDO FISSO (Nessuna animazione qui per evitare bordi neri)
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black px-4 py-12 relative overflow-hidden">

      {/* Animazione CSS delegata globalmente a index.css (classe anim-card) */}

      {/* BAGLIORE DECORATIVO */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--primary-color)]/20 blur-[120px] rounded-full pointer-events-none opacity-60" />

      {/* CARD CENTRALE ANIMATA (Classe 'anim-card' aggiunta qui) */}
      <div className="anim-card w-full max-w-md bg-zinc-900/60 backdrop-blur-md border border-white/10 p-8 rounded-2xl shadow-2xl relative z-10">

        <div className="flex flex-col items-center mb-8 select-none">
          <div className="flex items-center tracking-tighter text-4xl mb-6 scale-110 drop-shadow-lg">
            <span className="font-bold text-white mr-2">{logoParts.part1}</span>
            <div className="bg-[var(--primary-color)] text-white font-bold px-2 py-0.5 rounded-lg shadow-lg shadow-[var(--primary-color)]/20">
              {logoParts.part2}
            </div>
          </div>

          <h1 className="text-xl font-semibold text-white">Benvenuto</h1>
          <p className="text-zinc-400 text-sm mt-1">Accedi alla libreria di Franz</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-950/40 border border-red-900/50 rounded-lg flex items-center gap-3 text-red-400 text-sm animate-in slide-in-from-top-2 backdrop-blur-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide ml-1">Username</label>
            <div className="relative group">
              <User className="absolute left-3 top-3 h-5 w-5 text-zinc-500 group-focus-within:text-[var(--primary-color)] transition-colors" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-black/50 border border-white/10 text-white rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 focus:border-[var(--primary-color)] transition-all placeholder:text-zinc-600 disabled:opacity-50"
                placeholder="Inserisci username"
                required
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide ml-1">Password</label>
            <div className="relative group">
              <Lock className="absolute left-3 top-3 h-5 w-5 text-zinc-500 group-focus-within:text-[var(--primary-color)] transition-colors" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/50 border border-white/10 text-white rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 focus:border-[var(--primary-color)] transition-all placeholder:text-zinc-600 disabled:opacity-50"
                placeholder="Inserisci password"
                required
                disabled={isSubmitting}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[var(--primary-color)] hover:opacity-90 text-white font-bold py-3 rounded-xl transition-all hover:shadow-lg hover:shadow-[var(--primary-color)]/20 disabled:opacity-50 disabled:cursor-not-allowed mt-6 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Accesso in corso...
              </>
            ) : (
              "Accedi"
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-white/10 text-center text-sm text-zinc-500">
          Non hai un account?{' '}
          <Link to="/register" className="text-[var(--primary-color)] hover:underline font-medium transition-colors">
            Registrati
          </Link>
        </div>

      </div>
    </div>
  );
}