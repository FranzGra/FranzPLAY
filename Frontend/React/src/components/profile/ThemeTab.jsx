import React from 'react';
import { Palette, Check as CheckIcon } from 'lucide-react';

export const COLOR_PRESETS = [
    { name: 'Red', value: '#dc2626' },    // Default
    { name: 'Orange', value: '#ea580c' },
    { name: 'Purple', value: '#7c3aed' },
    { name: 'Blue', value: '#2563eb' },
    { name: 'Golden', value: '#ca8a04' },
    { name: 'Cyan', value: '#0891b2' },
    { name: 'Deep Teal', value: '#0d9488' },
    { name: 'Indigo', value: '#4f46e5' },
    { name: 'Pink', value: '#db2777' },
    { name: 'Emerald', value: '#10b981' },
    { name: 'Slate', value: '#64748b' },
];

export default function ThemeTab({ user, selectedColor, setSelectedColor, handleThemeChange }) {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Palette className="text-[var(--primary-color)]" /> Personalizza FranzPLAY
                </h2>
                <p className="text-sm text-zinc-500 mt-1">Scegli il colore principale dell'interfaccia. Le modifiche sono salvate automaticamente.</p>
            </div>

            {/* Palette Preset */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <button
                    onClick={() => handleThemeChange('')}
                    className={`
                    relative flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 group
                    ${!selectedColor
                            ? 'bg-zinc-800 border-zinc-500 ring-1 ring-zinc-500'
                            : 'bg-zinc-950 border-zinc-800 hover:bg-zinc-900 hover:border-zinc-700'}
                `}
                >
                    <div className="h-8 w-8 rounded-full shadow-lg border border-white/10 flex items-center justify-center bg-zinc-800">
                        {!selectedColor ? <CheckIcon className="h-5 w-5 text-white drop-shadow-md" /> : <Palette className="h-4 w-4 text-zinc-400" />}
                    </div>
                    <span className="text-sm font-medium text-zinc-300">Predefinito App</span>
                </button>
                {COLOR_PRESETS.map((preset) => (
                    <button
                        key={preset.value}
                        onClick={() => handleThemeChange(preset.value)}
                        className={`
                    relative flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 group
                    ${selectedColor === preset.value
                                ? 'bg-zinc-800 border-[var(--primary-color)] ring-1 ring-[var(--primary-color)]'
                                : 'bg-zinc-950 border-zinc-800 hover:bg-zinc-900 hover:border-zinc-700'}
                `}
                    >
                        <div
                            className="h-8 w-8 rounded-full shadow-lg border border-white/10 flex items-center justify-center"
                            style={{ backgroundColor: preset.value }}
                        >
                            {selectedColor === preset.value ? <CheckIcon className="h-5 w-5 text-white drop-shadow-md" /> : null}
                        </div>
                        <span className="text-sm font-medium text-zinc-300">{preset.name}</span>
                    </button>
                ))}
            </div>

            {/* Color Picker Custom */}
            <div className="pt-4 border-t border-zinc-800/50">
                <label className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3 block">Colore Personalizzato</label>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="relative h-12 w-full max-w-[200px] rounded-xl overflow-hidden border border-zinc-700 ring-2 ring-transparent focus-within:ring-[var(--primary-color)] transition-all">
                        <input
                            type="color"
                            value={selectedColor}
                            onChange={(e) => handleThemeChange(e.target.value)}
                            className="absolute -top-2 -left-2 w-[150%] h-[150%] cursor-pointer border-none p-0 m-0"
                        />
                    </div>
                    <div className="flex items-center gap-2 w-full max-w-[200px]">
                        <span className="text-zinc-500 font-mono text-lg font-bold">#</span>
                        <input
                            type="text"
                            value={selectedColor.replace('#', '')}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (/^[0-9A-F]{0,6}$/i.test(val)) {
                                    if (val.length === 6) {
                                        handleThemeChange('#' + val);
                                    } else {
                                        setSelectedColor('#' + val);
                                    }
                                }
                            }}
                            onBlur={(e) => {
                                if (selectedColor && selectedColor.length !== 7) {
                                    setSelectedColor(user?.themeColor || '');
                                }
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] transition-all w-full"
                            placeholder="FFFFFF"
                            maxLength={6}
                        />
                    </div>
                    <div className="hidden sm:block text-zinc-600 font-mono text-xs uppercase">
                        Inserisci codice hex manuale
                    </div>
                </div>
            </div>

            {/* Preview Live */}
            <div className="mt-8 p-4 bg-zinc-950 rounded-xl border border-zinc-800">
                <p className="text-xs text-zinc-500 mb-2 uppercase tracking-wider font-bold">Anteprima Live</p>
                <div className="flex items-center gap-4">
                    <button className="bg-[var(--primary-color)] text-white px-4 py-2 rounded-lg font-bold shadow-lg shadow-[var(--primary-color)]/20">
                        Bottone Primario
                    </button>
                    <span className="text-[var(--primary-color)] font-semibold">Testo Colorato</span>
                    <div className="h-6 w-6 rounded-full border-2 border-[var(--primary-color)]"></div>
                </div>
            </div>
        </div>
    );
}
