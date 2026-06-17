import React from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bottone non invasivo che compare in hover sopra la copertina di un video
 * (nelle griglie/tabelle admin) e apre il video nel player in una NUOVA scheda.
 *
 * Richiede che un antenato abbia la classe `group` (la card o il contenitore
 * della copertina) per l'effetto opacity-0 -> group-hover:opacity-100.
 *
 * Usa un <a> reale (non onClick+navigate) così il browser apre davvero una
 * nuova tab e si puo' anche aprire in background con cmd/ctrl-click.
 */
export default function OpenInPlayerButton({ videoId, className = "" }) {
  if (!videoId && videoId !== 0) return null;
  return (
    <a
      href={`/watch/${videoId}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Apri nel player (nuova scheda)"
      aria-label="Apri nel player in una nuova scheda"
      className={cn(
        "absolute top-2 right-2 z-20 inline-flex items-center justify-center w-9 h-9 rounded-xl",
        "bg-black/70 backdrop-blur-sm text-white border border-white/15 shadow-lg",
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        "hover:bg-primary hover:border-primary transition-all",
        className
      )}
    >
      <Play size={16} className="ml-0.5 fill-current" />
    </a>
  );
}
