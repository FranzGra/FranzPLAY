import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { Activity, CheckCircle, XCircle, Search, Clock, ShieldAlert } from 'lucide-react';

export default function AdminAccessi() {
    const [accessi, setAccessi] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchAccessi = async () => {
        try {
            const formData = new FormData();
            formData.append('action', 'lista_accessi');
            const data = await apiRequest('/admin.php', 'POST', formData);
            if (data.success && data.dati) {
                setAccessi(data.dati);
            }
        } catch (error) {
            console.error("Errore caricamento accessi:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAccessi();
    }, []);

    const filteredAccessi = accessi.filter(a => {
        const searchRegex = new RegExp(searchTerm.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), 'i');
        return (
            searchRegex.test(a.Nome_Utente || '') ||
            searchRegex.test(a.indirizzo_Ip || '')
        );
    });

    const formatDate = (dateString) => {
        const d = new Date(dateString);
        return new Intl.DateTimeFormat('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(d);
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64 text-zinc-500">
                <div className="w-10 h-10 border-4 border-zinc-800 border-t-primary rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-2 flex items-center gap-4">
                        <Activity className="h-10 w-10 text-primary" />
                        Log Accessi
                    </h1>
                    <p className="text-zinc-400 text-lg">Storico dei tentativi di autenticazione al sistema.</p>
                </div>
                <div className="flex gap-4">
                    <div className="relative group flex-1 md:w-64">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-primary transition-colors" size={20} />
                        <input
                            type="text"
                            placeholder="Cerca utente o IP..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-zinc-900/50 border border-zinc-800 text-white rounded-2xl pl-12 pr-4 py-3 md:py-4 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all font-medium placeholder:text-zinc-600"
                        />
                    </div>
                </div>
            </div>

            {/* Tabella Accessi */}
            <div className="glass-card rounded-3xl border border-zinc-800/50 overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-zinc-800/50 bg-zinc-900/20 text-xs uppercase tracking-widest font-black text-zinc-500">
                                <th className="p-4 pl-6 whitespace-nowrap">Stato</th>
                                <th className="p-4 whitespace-nowrap">Data / Ora</th>
                                <th className="p-4 whitespace-nowrap">Utente Tentato</th>
                                <th className="p-4 pr-6 whitespace-nowrap">Indirizzo IP</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/50">
                            {filteredAccessi.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="p-8 text-center text-zinc-500">
                                        Nessun log trovato.
                                    </td>
                                </tr>
                            ) : (
                                filteredAccessi.map((accesso) => (
                                    <tr key={accesso.id} className="hover:bg-zinc-800/20 transition-colors group">
                                        <td className="p-4 pl-6 w-1">
                                            {Number(accesso.successo) === 1 ? (
                                                <div className="flex justify-center">
                                                    <div className="w-10 h-10 rounded-xl bg-green-500/10 text-green-500 flex items-center justify-center border border-green-500/20">
                                                        <CheckCircle size={20} />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex justify-center">
                                                    <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20">
                                                        <XCircle size={20} />
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-4 whitespace-nowrap">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-zinc-800 text-zinc-500 flex items-center justify-center">
                                                    <Clock size={16} />
                                                </div>
                                                <div>
                                                    <div className="text-sm font-bold text-white">{formatDate(accesso.data_ora_tentativo).split(',')[1]}</div>
                                                    <div className="text-xs text-zinc-500 font-medium">{formatDate(accesso.data_ora_tentativo).split(',')[0]}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 min-w-[200px]">
                                            <div className="flex items-center gap-3">
                                                <div className="font-bold text-base text-zinc-300">
                                                    {accesso.Nome_Utente || <span className="text-zinc-600 italic">Sconosciuto</span>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 pr-6">
                                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800/50 text-xs font-mono text-zinc-400">
                                                {accesso.indirizzo_Ip}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="text-center">
                <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-zinc-600 bg-zinc-900/50 px-4 py-2 rounded-full border border-zinc-800">
                    <ShieldAlert size={14} /> Ultimi 500 Log registrati
                </p>
            </div>
        </div>
    );
}
