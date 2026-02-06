import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Lock, AlertCircle, Loader2, CheckCircle, ShieldCheck } from 'lucide-react';

export default function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const navigate = useNavigate();

  const validate = () => {
    if (username.trim().length < 3) return "L'username deve avere almeno 3 caratteri.";
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return "L'username può contenere solo lettere, numeri e underscore.";
    if (password.length < 4) return "La password deve essere lunga almeno 4 caratteri.";
    if (password !== confirmPassword) return "Le password non coincidono.";
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/registrazione.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.successo) {
        setSuccess(true);
        setTimeout(() => { navigate('/login'); }, 2000);
      } else {
        setError(data.messaggio || "Errore durante la registrazione.");
        setIsSubmitting(false);
      }
    } catch (err) {
      console.error("Register Error:", err);
      setError("Impossibile contattare il server.");
      setIsSubmitting(false);
    }
  };

  useEffect(() => { document.title = 'Registrati - FranzTube'; }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black px-4 py-12 relative overflow-hidden">
      
      {/* Definizione Animazione Locale */}
      <style>{`
        @keyframes scaleIn {
          0% { opacity: 0; transform: scale(0.90) translateY(10px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .anim-card {
          animation: scaleIn 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      {/* BAGLIORE DECORATIVO */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--primary-color)]/20 blur-[120px] rounded-full pointer-events-none opacity-60" />

      {/* CARD CENTRALE ANIMATA */}
      <div className="anim-card w-full max-w-md bg-zinc-900/60 backdrop-blur-md border border-white/10 p-8 rounded-2xl shadow-2xl relative z-10">
        
        <div className="flex flex-col items-center mb-8 select-none">
          <div className="flex items-center tracking-tighter text-4xl mb-6 scale-110 drop-shadow-lg">
              <span className="font-bold text-white mr-2">FRANZ</span>
              <div className="bg-[var(--primary-color)] text-white font-bold px-2 py-0.5 rounded-lg shadow-lg shadow-[var(--primary-color)]/20">
                TUBE
              </div>
          </div>
          
          <h1 className="text-xl font-semibold text-white">Crea un account</h1>
          <p className="text-zinc-400 text-sm mt-1">Unisciti subito alla community di Franz</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-950/40 border border-red-900/50 rounded-lg flex items-center gap-3 text-red-400 text-sm animate-in slide-in-from-top-2 backdrop-blur-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-3 bg-green-950/40 border border-green-900/50 rounded-lg flex items-center gap-3 text-green-400 text-sm animate-in slide-in-from-top-2 backdrop-blur-sm">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            Account creato! Reindirizzamento...
          </div>
        )}

        {!success && (
          <form onSubmit={handleSubmit} className="space-y-5">
            
            {/* USERNAME */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide ml-1">Username</label>
              <div className="relative group">
                <User className="absolute left-3 top-3 h-5 w-5 text-zinc-500 group-focus-within:text-[var(--primary-color)] transition-colors" />
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 text-white rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 focus:border-[var(--primary-color)] transition-all placeholder:text-zinc-600 disabled:opacity-50"
                  placeholder="Scegli un username"
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* PASSWORD */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide ml-1">Password</label>
              <div className="relative group">
                <Lock className="absolute left-3 top-3 h-5 w-5 text-zinc-500 group-focus-within:text-[var(--primary-color)] transition-colors" />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 text-white rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 focus:border-[var(--primary-color)] transition-all placeholder:text-zinc-600 disabled:opacity-50"
                  placeholder="Minimo 4 caratteri"
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>

             {/* CONFERMA PASSWORD */}
             <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide ml-1">Conferma Password</label>
              <div className="relative group">
                <ShieldCheck className="absolute left-3 top-3 h-5 w-5 text-zinc-500 group-focus-within:text-[var(--primary-color)] transition-colors" />
                <input 
                  type="password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 text-white rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 focus:border-[var(--primary-color)] transition-all placeholder:text-zinc-600 disabled:opacity-50"
                  placeholder="Ripeti la password"
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
                <> <Loader2 className="h-5 w-5 animate-spin" /> Registrazione... </>
              ) : ( "Registrati" )}
            </button>
          </form>
        )}

        <div className="mt-8 pt-6 border-t border-white/10 text-center text-sm text-zinc-500">
          Hai già un account?{' '}
          <Link to="/login" className="text-[var(--primary-color)] hover:underline font-medium transition-colors">
            Accedi ora
          </Link>
        </div>

      </div>
    </div>
  );
}