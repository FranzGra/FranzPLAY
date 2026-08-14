import React, { useState } from "react";
import { Server, ArrowRight, Loader2, AlertCircle } from "lucide-react";

export default function ServerSelection({ onServerSelected }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url) return;

    // Rimuove l'ultimo slash se presente
    let cleanUrl = url.trim().replace(/\/$/, "");
    
    // Aggiunge http:// se l'utente digita solo un IP
    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      cleanUrl = `http://${cleanUrl}`;
    }

    setLoading(true);
    setError(null);

    try {
      // Testiamo la connessione al server contattando l'endpoint di stato
      const response = await fetch(`${cleanUrl}/api/status.php`);
      
      if (!response.ok) {
        throw new Error("Il server non ha risposto correttamente. Verifica l'indirizzo.");
      }
      
      const data = await response.json();
      
      if (data.success || data.needsSetup !== undefined) {
        // Il server è valido e ha risposto con il formato FranzPLAY previsto
        localStorage.setItem("franzplay_server_url", cleanUrl);
        onServerSelected(cleanUrl);
      } else {
        throw new Error("L'indirizzo inserito non sembra essere un server FranzPLAY valido.");
      }
    } catch (err) {
      console.error("Errore di connessione:", err);
      setError("Impossibile connettersi al server. Verifica che l'indirizzo sia corretto e che il server sia acceso.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="min-h-dvh w-full bg-zinc-950 flex flex-col items-center justify-center p-6 text-zinc-100 font-sans">
        <div className="w-full max-w-md">
          {/* Logo / Header */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-lg shadow-blue-900/20 mb-6">
              <Server className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Connetti a FranzPLAY</h1>
            <p className="text-zinc-400">Inserisci l'indirizzo del tuo server locale per accedere alla tua libreria multimediale.</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="serverUrl" className="block text-sm font-medium text-zinc-300 mb-2">
                Indirizzo Server
              </label>
              <div className="relative">
                <input
                  id="serverUrl"
                  type="text"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Es. 192.168.1.50 oppure http://franzplay.local"
                  className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-lg rounded-xl px-4 py-4 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-zinc-600 shadow-inner"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
            </div>

            {error && (
              <div className="p-4 rounded-xl bg-red-950/50 border border-red-900/50 flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-200 leading-relaxed">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !url}
              className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium text-lg py-4 px-6 rounded-xl transition-all active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Connessione...</span>
                </>
              ) : (
                <>
                  <span>Connetti al Server</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
          
          <div className="mt-8 text-center text-sm text-zinc-500">
            Assicurati di essere connesso alla stessa rete Wi-Fi del server.
          </div>
        </div>
      </div>
    </>
  );
}
