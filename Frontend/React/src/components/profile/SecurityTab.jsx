import React from 'react';
import { Save, Loader2 } from 'lucide-react';

export default function SecurityTab({ passwords, setPasswords, handleUpdatePassword, loading }) {
    return (
        <form onSubmit={handleUpdatePassword} className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
                <h2 className="text-xl font-bold text-white">Modifica Password</h2>
                <p className="text-sm text-zinc-500 mt-1">Aggiorna la password per mantenere il tuo account sicuro.</p>
            </div>
            <div className="space-y-4 pt-2">
                <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Password Attuale</label>
                    <input type="password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] transition-all placeholder:text-zinc-700" placeholder="••••••••" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Nuova Password</label>
                        <input type="password" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] transition-all placeholder:text-zinc-700" placeholder="••••••••" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Conferma Password</label>
                        <input type="password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] transition-all placeholder:text-zinc-700" placeholder="••••••••" />
                    </div>
                </div>
            </div>
            <div className="pt-2">
                <button type="submit" disabled={loading} className="bg-white text-black px-6 py-2.5 rounded-xl font-bold hover:bg-zinc-200 transition-colors flex items-center gap-2 shadow-lg shadow-white/5 disabled:opacity-50">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Aggiorna Password
                </button>
            </div>
        </form>
    );
}
