import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * ============================================================================
 * DESIGN SYSTEM — COMPONENTI DI IMPAGINAZIONE
 * ============================================================================
 *
 * PERCHE' ESISTONO:
 * Il progetto aveva i primitivi (Button, Card, Input) ma NON i compositi.
 * Risultato: ogni pagina si reinventava intestazione, sezioni, barre di
 * strumenti e stati vuoti, scegliendo ogni volta spaziature e dimensioni a
 * occhio. Da qui le 13 dimensioni di testo, i 12 raggi e i 111 valori px
 * arbitrari misurati prima del redesign.
 *
 * REGOLA D'USO:
 * Nelle pagine si compone con questi elementi. Se serve una variante che qui
 * non c'e', si aggiunge QUI (con un nome e una motivazione), non si scrive
 * una classe una tantum nella pagina.
 *
 * RITMO DI SPAZIATURA (unico ammesso):
 *   gap/padding interni ai controlli ....... 2  (8px)
 *   fra elementi correlati ................. 3  (12px)
 *   padding di riquadri e celle ............ 4  (16px)
 *   padding di pannelli .................... 5  (20px)
 *   fra sezioni di una pagina .............. 6  (24px)
 *   margini di pagina ...................... 6 / 8 su schermi larghi
 * ============================================================================
 */

/* --------------------------------------------------------------------------
 * PageShell — contenitore di pagina.
 * Centra il contenuto e impone gli stessi margini e lo stesso ritmo verticale
 * a tutte le schermate. Prima ogni pagina sceglieva i suoi (p-4, p-6, p-8...).
 * ------------------------------------------------------------------------ */
function PageShell({ className, children, width = "wide", ...props }) {
  const larghezze = {
    narrow: "max-w-3xl",
    default: "max-w-5xl",
    wide: "max-w-[1400px]",
    full: "max-w-none",
  };
  return (
    <div
      data-slot="page-shell"
      className={cn(
        "mx-auto w-full space-y-6 p-4 sm:p-6",
        larghezze[width],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * PageHeader — intestazione di pagina.
 * Titolo, sottotitolo, icona e azioni. Un solo livello tipografico per tutte
 * le pagine, cosi' i titoli non oscillano piu' fra text-2xl e text-4xl.
 * ------------------------------------------------------------------------ */
function PageHeader({ className, icon: Icon, title, description, actions, ...props }) {
  return (
    <header
      data-slot="page-header"
      className={cn("flex flex-wrap items-start justify-between gap-4", className)}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon size={20} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* --------------------------------------------------------------------------
 * Panel — pannello di primo livello, sostituisce l'uso diretto di <Card>
 * con classi ad hoc (bg-zinc-900/40 backdrop-blur-md border-white/5 ...).
 * ------------------------------------------------------------------------ */
function Panel({ className, children, ...props }) {
  return (
    <section
      data-slot="panel"
      className={cn(
        "rounded-2xl border border-hairline bg-surface-1 backdrop-blur-md",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

function PanelHeader({ className, title, description, actions, ...props }) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

function PanelBody({ className, children, ...props }) {
  return (
    <div data-slot="panel-body" className={cn("space-y-4 p-5", className)} {...props}>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Section — blocco interno a un pannello, con icona ed etichetta.
 * E' il livello che nelle pagine admin veniva ricreato ogni volta a mano.
 * ------------------------------------------------------------------------ */
function Section({ className, icon: Icon, title, description, actions, children, ...props }) {
  return (
    <div
      data-slot="section"
      className={cn("rounded-xl border border-hairline bg-surface-2 p-4", className)}
      {...props}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && (
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon size={14} />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-xs font-black uppercase text-foreground/80">{title}</h3>
            {description && (
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Toolbar — riga di filtri e azioni sopra una lista.
 * ------------------------------------------------------------------------ */
function Toolbar({ className, children, ...props }) {
  return (
    <div
      data-slot="toolbar"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * EmptyState — stato vuoto.
 * Prima ogni lista mostrava un <p> con dimensioni e colori diversi; qui
 * l'assenza di contenuto diventa un momento informativo con un'azione.
 * ------------------------------------------------------------------------ */
function EmptyState({ className, icon: Icon, title, description, action, tone = "neutral", ...props }) {
  const toni = {
    neutral: "bg-surface-3 text-muted-foreground",
    danger: "bg-destructive/10 text-destructive",
    success: "bg-emerald-500/10 text-emerald-400",
  };
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center gap-3 px-4 py-14 text-center", className)}
      {...props}
    >
      {Icon && (
        <span
          className={cn(
            "flex size-14 items-center justify-center rounded-2xl",
            toni[tone],
          )}
        >
          <Icon size={26} />
        </span>
      )}
      <p className="text-base font-bold text-foreground">{title}</p>
      {description && (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export {
  PageShell,
  PageHeader,
  Panel,
  PanelHeader,
  PanelBody,
  Section,
  Toolbar,
  EmptyState,
};
