import React, { useState, useEffect, useRef } from 'react';
import { Send, Trash2, User, Loader2 } from 'lucide-react';
import { apiRequest } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function Comments({ videoId }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(null); // ID commento in fase di eliminazione
  const commentsEndRef = useRef(null);

  // Carica commenti
  const fetchComments = async () => {
    try {
      const formData = new FormData();
      formData.append('action', 'leggi');
      formData.append('id_video', videoId);

      const res = await apiRequest('/commenti.php', 'POST', formData);
      if (res.success) setComments(res.data || res.dati);
    } catch (error) {
      console.error("Errore commenti:", error);
    }
  };

  useEffect(() => {
    if (videoId) fetchComments();
  }, [videoId]);

  // Invia commento
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('action', 'scrivi');
      formData.append('id_video', videoId);
      formData.append('testo', newComment);

      const res = await apiRequest('/commenti.php', 'POST', formData);
      if (res.success) {
        setNewComment('');
        await fetchComments();
        // Scroll all'ultimo commento
        setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      } else {
        // Fallback: Se l'API non lancia errore ma successo è false (non dovrebbe accadere col fix, ma legacy safety)
        alert(res.message || res.messaggio || "Errore sconosciuto durante l'invio.");
      }
    } catch (error) {
      alert("Errore invio commento: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Elimina commento
  const handleDelete = async (commentId) => {
    if (!window.confirm("Eliminare questo commento?")) return;

    setIsDeleting(commentId);
    try {
      const formData = new FormData();
      formData.append('action', 'elimina');
      formData.append('id_commento', commentId);

      const res = await apiRequest('/commenti.php', 'POST', formData);
      if (res.success) {
        setComments(prev => prev.filter(c => c.id !== commentId));
      }
    } catch (error) {
      alert("Impossibile eliminare");
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <div className="bg-zinc-900 backdrop-blur-xl border border-white/10 shadow-xl rounded-xl p-4 md:p-6 h-full flex flex-col">
      <h3 className="text-xl font-bold text-white mb-4 border-b border-white/10 pb-2 flex justify-between items-baseline">
        Commenti
        <span className="text-sm font-normal text-zinc-400">({comments.length})</span>
      </h3>

      {/* Lista Commenti */}
      <div
        className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar min-h-[300px] max-h-[500px]"
        role="log"
        aria-live="polite"
      >
        {comments.length > 0 ? (
          comments.map((c) => (
            <div key={c.id} className="flex gap-3 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex-shrink-0 h-8 w-8 md:h-10 md:w-10 rounded-full bg-zinc-800 border border-white/10 overflow-hidden">
                {c.Immagine_Profilo ? (
                  <img src={`/img_utenti/${c.Immagine_Profilo}`} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-zinc-400"><User size={20} /></div>
                )}
              </div>

              <div className="flex-1 bg-zinc-800 p-3 rounded-2xl rounded-tl-none border border-white/10">
                <div className="flex justify-between items-start">
                  <span className="font-bold text-sm text-zinc-200">{c.Nome_Utente}</span>
                  <span className="text-[10px] text-zinc-500">{new Date(c.data_ora_commento).toLocaleDateString()}</span>
                </div>
                <p className="text-zinc-100 text-sm mt-1 whitespace-pre-wrap">{c.testo_commento}</p>

                {c.is_mio ? (
                  <button
                    onClick={() => handleDelete(c.id)}
                    disabled={isDeleting === c.id}
                    // TEMA: Hover colorato sul tasto elimina
                    className="text-zinc-600 hover:text-[var(--primary-color)] text-xs mt-2 flex items-center gap-1 transition-colors disabled:opacity-50"
                    aria-label="Elimina il tuo commento"
                  >
                    {isDeleting === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    {isDeleting === c.id ? 'Eliminazione...' : 'Elimina'}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 py-10">
            <User size={40} className="mb-2 opacity-20" />
            <p>Nessun commento. Sii il primo!</p>
          </div>
        )}
        <div ref={commentsEndRef} />
      </div>

      {/* Input Commento */}
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2 pt-4 border-t border-white/10 relative">
        <label htmlFor="commentInput" className="sr-only">Scrivi un commento</label>
        <input
          id="commentInput"
          type="text"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Scrivi un commento..."
          // TEMA: Focus border e ring con colore dinamico
          className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-[var(--primary-color)] focus:ring-1 focus:ring-[var(--primary-color)] transition-colors disabled:opacity-50"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !newComment.trim()}
          // TEMA: Background dinamico
          className="bg-[var(--primary-color)] hover:opacity-90 text-white p-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center min-w-[50px] shadow-lg shadow-[var(--primary-color)]/20"
          aria-label="Invia commento"
        >
          {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
        </button>
      </form>
    </div>
  );
}