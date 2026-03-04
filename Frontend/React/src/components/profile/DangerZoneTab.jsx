import React from 'react';
import { Trash2, Loader2 } from 'lucide-react';

export default function DangerZoneTab({ handleDeleteAccount, loading }) {
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
                <h2 className="text-xl font-bold text-red-500">Eliminazione Account</h2>
                <p className="text-sm text-zinc-400 mt-1">Attenzione: questa operazione rimuoverà permanentemente tutti i tuoi dati.</p>
            </div>
            <div className="bg-red-950/10 border border-red-900/30 p-4 rounded-xl">
                <p className="text-zinc-300 text-sm leading-relaxed">Una volta eliminato l'account, non sarà possibile tornare indietro. Perderai l'accesso alla cronologia, ai video salvati e ai commenti pubblicati.</p>
            </div>
            <button onClick={handleDeleteAccount} disabled={loading} className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-700 transition-colors flex items-center gap-2 shadow-lg shadow-red-900/20 disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Elimina Definitivamente
            </button>
        </div>
    );
}
