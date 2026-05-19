import React from 'react';
import { Film, Loader2 } from 'lucide-react';

/**
 * Placeholder elegante per i video in attesa di copertina/anteprima.
 *
 * Mostra un gradient ispirato al tema, un'icona Film, e (opzionale) uno
 * spinner discreto che indica "elaborazione in corso".
 *
 * Pensato per essere usato dentro un contenitore aspect-video già stilato.
 * Stesse dimensioni di un'<img> di copertina → drop-in replacement.
 *
 * Props:
 *   - title: titolo del video (mostrato sotto l'icona, opzionale)
 *   - processing: se true mostra spinner + label "In elaborazione…"
 */
export default function ThumbnailPlaceholder({ title, processing = false }) {
    // Hash semplice del titolo per dare una nuance leggermente diversa
    // tra placeholder, così la griglia non risulta monotona.
    const hue = title
        ? (title.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 60) - 30
        : 0;

    return (
        <div
            className="absolute inset-0 h-full w-full flex flex-col items-center justify-center select-none overflow-hidden"
            style={{
                background: `
                    radial-gradient(circle at 30% 20%, rgba(220, 38, 38, 0.15) 0%, transparent 50%),
                    radial-gradient(circle at 70% 80%, rgba(99, 102, 241, 0.10) 0%, transparent 50%),
                    linear-gradient(135deg, hsl(${220 + hue}, 25%, 14%) 0%, hsl(${240 + hue}, 30%, 8%) 100%)
                `,
            }}
            aria-hidden="true"
        >
            {/* Pattern decorativo sottile */}
            <div
                className="absolute inset-0 opacity-[0.04]"
                style={{
                    backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)',
                    backgroundSize: '18px 18px',
                }}
            />

            {/* Icona principale */}
            <div className="relative z-10 flex flex-col items-center gap-2.5">
                <div
                    className="rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm p-3.5 shadow-lg"
                >
                    <Film
                        className="w-7 h-7 sm:w-8 sm:h-8 text-white/40"
                        strokeWidth={1.5}
                    />
                </div>

                {processing ? (
                    <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-white/40 font-medium tracking-wide">
                        <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />
                        <span>In elaborazione…</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
