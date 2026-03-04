import React, { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { User, Lock, ExternalLink, Play, Palette, Server, Loader2, CheckCircle2 } from 'lucide-react';

export default function SetupWizard() {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Data State
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        logo_part_1: 'FRANZ',
        logo_part_2: 'PLAY',
        colore_tema_default: '#dc2626'
    });

    const handleChange = (e) => {
        setFormData(prev => ({
            ...prev,
            [e.target.name]: e.target.value
        }));
    };

    const nextStep = () => {
        if (step === 2) {
            if (!formData.username || !formData.password) {
                setError("Username e password sono obbligatori.");
                return;
            }
            if (formData.password.length < 4) {
                setError("La password deve contenere almeno 4 caratteri.");
                return;
            }
        }
        setError('');
        setStep(prev => prev + 1);
    };

    const prevStep = () => {
        setError('');
        setStep(prev => prev - 1);
    };

    const handleSubmit = async () => {
        setLoading(true);
        setError('');
        try {
            const response = await apiRequest('/setup.php', 'POST', formData);
            if (response?.success) {
                setStep(4); // Completato
            } else {
                throw new Error(response?.avviso || "Errore sconosciuto durante il setup.");
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const finishSetup = () => {
        // Forza il ricaricamento globale della pagina web
        window.location.href = '/';
    };

    return (
        <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 text-zinc-100 font-sans selection:bg-blue-600/30">

            {/* Background Decorativo */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 blur-[120px]" />
                <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-red-600/10 blur-[120px]" />
            </div>

            <div className="w-full max-w-2xl bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 rounded-2xl shadow-2xl overflow-hidden relative z-10">

                {/* Header / ProgressBar */}
                <div className="bg-zinc-800/30 border-b border-zinc-800 p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">FranzPLAY Setup Wizard</h1>
                            <p className="text-zinc-400 text-sm mt-1">Configurazione d'avvio server self-hosted</p>
                        </div>
                        <Server className="w-8 h-8 text-blue-500 opacity-80" />
                    </div>

                    {/* Progress Indicator */}
                    <div className="flex items-center gap-2 mt-6">
                        {[1, 2, 3, 4].map((i) => (
                            <div
                                key={i}
                                className={`h-2 flex-1 rounded-full transition-colors duration-500 ease-in-out ${step >= i ? 'bg-blue-600' : 'bg-zinc-800'
                                    }`}
                            />
                        ))}
                    </div>
                </div>

                {/* Content Area */}
                <div className="p-6 sm:p-10 min-h-[350px] flex flex-col justify-center">

                    {error && (
                        <div className="mb-6 bg-red-500/10 border border-red-500/50 text-red-500 p-4 rounded-xl flex items-start gap-3">
                            <ExternalLink className="w-5 h-5 shrink-0 mt-0.5" />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}

                    {/* STEP 1: WELCOME */}
                    {step === 1 && (
                        <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="w-20 h-20 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
                                <Play className="w-10 h-10 text-blue-500 ml-1" />
                            </div>
                            <h2 className="text-3xl font-bold mb-4">Benvenuto!</h2>
                            <p className="text-zinc-400 max-w-md mx-auto leading-relaxed">
                                Sembra che sia la prima volta che avvii FranzPLAY. Per iniziare, configureremo il tuo account Amministratore e le preferenze grafiche di base del server.
                            </p>
                        </div>
                    )}

                    {/* STEP 2: CREAZIONE ADMIN */}
                    {step === 2 && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                            <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                                <User className="w-6 h-6 text-blue-500" />
                                Account Amministratore
                            </h2>
                            <div className="space-y-5">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-2">Username</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                                            <User className="h-5 w-5" />
                                        </div>
                                        <input
                                            type="text"
                                            name="username"
                                            value={formData.username}
                                            onChange={handleChange}
                                            className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                            placeholder="Es: admin"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-2">Password Super Segreta</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                                            <Lock className="h-5 w-5" />
                                        </div>
                                        <input
                                            type="password"
                                            name="password"
                                            value={formData.password}
                                            onChange={handleChange}
                                            className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                            placeholder="Minimo 4 caratteri"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: GRAFICA & TEMA */}
                    {step === 3 && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                            <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                                <Palette className="w-6 h-6 text-blue-500" />
                                Stile Piattaforma
                            </h2>
                            <div className="space-y-6">

                                {/* Live Preview Logo */}
                                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 text-center flex flex-col items-center justify-center">
                                    <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-4">Anteprima Logo</p>
                                    <div className="flex items-center tracking-tighter text-4xl select-none">
                                        <span className="font-bold text-white mr-2">{formData.logo_part_1}</span>
                                        <div
                                            className="text-white font-bold px-3 py-1 rounded-[12px] shadow-xl leading-none pb-2 pt-2"
                                            style={{
                                                backgroundColor: formData.colore_tema_default,
                                                boxShadow: `0 10px 15px -3px ${formData.colore_tema_default}33, 0 4px 6px -4px ${formData.colore_tema_default}33`
                                            }}
                                        >
                                            {formData.logo_part_2}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-2">Logo: Base</label>
                                        <input
                                            type="text"
                                            name="logo_part_1"
                                            value={formData.logo_part_1}
                                            onChange={handleChange}
                                            className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-2">Logo: Evidenziato</label>
                                        <input
                                            type="text"
                                            name="logo_part_2"
                                            value={formData.logo_part_2}
                                            onChange={handleChange}
                                            className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-2">Colore Tema Principale (HEX)</label>
                                    <div className="flex gap-4">
                                        <input
                                            type="color"
                                            name="colore_tema_default"
                                            value={formData.colore_tema_default}
                                            onChange={handleChange}
                                            className="h-12 w-20 rounded-lg cursor-pointer bg-zinc-950 border border-zinc-800"
                                        />
                                        <input
                                            type="text"
                                            name="colore_tema_default"
                                            value={formData.colore_tema_default}
                                            onChange={handleChange}
                                            className="flex-1 bg-zinc-950/50 border border-zinc-800 rounded-xl py-3 px-4 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono uppercase"
                                        />
                                    </div>
                                </div>

                            </div>
                        </div>
                    )}

                    {/* STEP 4: COMPLETATO */}
                    {step === 4 && (
                        <div className="text-center animate-in zoom-in-95 duration-500">
                            <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle2 className="w-12 h-12 text-green-500" />
                            </div>
                            <h2 className="text-3xl font-bold mb-4">Installazione Completata!</h2>
                            <p className="text-zinc-400 max-w-md mx-auto leading-relaxed mb-8">
                                Il tuo ambiente FranzPLAY è stato configurato con successo. L'utente amministratore è pronto per effettuare il login.
                            </p>
                            <button
                                onClick={finishSetup}
                                className="bg-green-600 hover:bg-green-500 text-white font-medium py-3 px-8 rounded-xl transition-all shadow-lg shadow-green-600/20 inline-flex items-center gap-2"
                            >
                                <Play className="w-5 h-5 fill-current" />
                                Avvia Piattaforma
                            </button>
                        </div>
                    )}

                </div>

                {/* Footer / Controls */}
                {step < 4 && (
                    <div className="bg-zinc-800/30 border-t border-zinc-800 p-6 flex justify-between items-center">
                        {step > 1 ? (
                            <button
                                onClick={prevStep}
                                disabled={loading}
                                className="px-6 py-2.5 rounded-xl font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                            >
                                Indietro
                            </button>
                        ) : <div></div>}

                        {step < 3 ? (
                            <button
                                onClick={nextStep}
                                className="bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 px-8 rounded-xl transition-all shadow-lg shadow-blue-600/20"
                            >
                                Continua
                            </button>
                        ) : (
                            <button
                                onClick={handleSubmit}
                                disabled={loading}
                                className="bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 px-8 rounded-xl transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Completa Setup'}
                            </button>
                        )}
                    </div>
                )}

            </div>
        </div>
    );
}
