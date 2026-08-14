import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * ============================================================================
 * DESIGN SYSTEM — GUSCIO DEI MODALI
 * ============================================================================
 *
 * PERCHE' ESISTE:
 * 1. TRAPPOLA DELLA LARGHEZZA — `DialogContent` porta un `sm:max-w-sm`. Una
 *    classe di larghezza SENZA breakpoint (es. `max-w-4xl`) perde da 640px in
 *    su, e il modale resta minuscolo. E' un errore silenzioso: il codice
 *    sembra corretto e il risultato no. Qui la larghezza si sceglie con la
 *    prop `size`, che emette sempre le varianti `sm:`/`lg:` giuste.
 *
 * 2. STRUTTURA — testata fissa, corpo scorrevole, piede fisso. Senza uno
 *    schema condiviso ogni modale reinventava padding e gerarchia, e i
 *    contenuti lunghi facevano scorrere l'intera finestra invece del solo
 *    corpo.
 *
 * USO:
 *   <ModalShell open={x} onOpenChange={setX} size="lg"
 *               icon={Globe} title="Titolo" description="sottotitolo"
 *               footer={<>...</>}>
 *     ...contenuto scorrevole...
 *   </ModalShell>
 * ============================================================================
 */

const DIMENSIONI = {
  // Ogni voce DEVE dichiarare i breakpoint, altrimenti vince sm:max-w-sm.
  sm: "sm:max-w-md",
  md: "sm:max-w-xl lg:max-w-2xl",
  lg: "sm:max-w-3xl lg:max-w-5xl",
  xl: "sm:max-w-[1000px] lg:max-w-[1200px]",
};

function ModalShell({
  open,
  onOpenChange,
  size = "md",
  icon: Icon,
  iconTone = "primary",
  title,
  description,
  footer,
  children,
  className,
  bodyClassName,
  ...props
}) {
  const toniIcona = {
    primary: "bg-primary/10 text-primary",
    info: "bg-sky-500/10 text-sky-400",
    success: "bg-emerald-500/10 text-emerald-400",
    danger: "bg-destructive/10 text-destructive",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "w-[95vw] overflow-hidden border-hairline bg-background p-0 shadow-2xl",
          DIMENSIONI[size],
          className,
        )}
        {...props}
      >
        <div className="flex max-h-[90vh] flex-col">
          {/* ---- Testata (fissa) ---- */}
          <DialogHeader className="shrink-0 space-y-0 border-b border-hairline px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                {Icon && (
                  <span
                    className={cn(
                      "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl",
                      toniIcona[iconTone],
                    )}
                  >
                    <Icon size={20} />
                  </span>
                )}
                <div className="min-w-0">
                  <DialogTitle className="text-xl font-black tracking-tight text-foreground">
                    {title}
                  </DialogTitle>
                  {description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {description}
                    </p>
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-lg"
                onClick={() => onOpenChange?.(false)}
                aria-label="Chiudi"
              >
                <X size={18} />
              </Button>
            </div>
          </DialogHeader>

          {/* ---- Corpo (scorre solo questo) ---- */}
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", bodyClassName)}>
            {children}
          </div>

          {/* ---- Piede (fisso) ---- */}
          {footer && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-hairline bg-surface-2 px-6 py-4">
              {footer}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { ModalShell, DIMENSIONI };
