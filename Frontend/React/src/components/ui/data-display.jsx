import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ============================================================================
 * DESIGN SYSTEM — CONTROLLI E VISUALIZZAZIONE DATI
 * ============================================================================
 * Compagni di layout.jsx. Stesse regole: qui si aggiunge, nelle pagine si
 * compone soltanto.
 *
 * Nota sui colori: si usano SOLO token semantici (foreground, muted-foreground,
 * primary, destructive, surface-*, hairline). I colori di stato (emerald,
 * amber, sky, violet) passano dalla mappa TONI di questo file, cosi' "successo"
 * ha lo stesso verde ovunque invece di essere scelto pagina per pagina.
 * ============================================================================
 */

/** Palette di stato condivisa. Unico posto dove vivono questi colori. */
const TONI = {
  neutral: {
    testo: "text-muted-foreground",
    sfondo: "bg-surface-3",
    bordo: "border-hairline",
    pieno: "bg-muted text-foreground",
  },
  primary: {
    testo: "text-primary",
    sfondo: "bg-primary/10",
    bordo: "border-primary/30",
    pieno: "bg-primary text-primary-foreground",
  },
  success: {
    testo: "text-emerald-400",
    sfondo: "bg-emerald-500/10",
    bordo: "border-emerald-500/25",
    pieno: "bg-emerald-500 text-white",
  },
  warning: {
    testo: "text-amber-400",
    sfondo: "bg-amber-500/10",
    bordo: "border-amber-500/25",
    pieno: "bg-amber-500 text-white",
  },
  danger: {
    testo: "text-destructive",
    sfondo: "bg-destructive/10",
    bordo: "border-destructive/25",
    pieno: "bg-destructive text-white",
  },
  info: {
    testo: "text-sky-400",
    sfondo: "bg-sky-500/10",
    bordo: "border-sky-500/25",
    pieno: "bg-sky-500 text-white",
  },
  accent: {
    testo: "text-violet-400",
    sfondo: "bg-violet-500/10",
    bordo: "border-violet-500/25",
    pieno: "bg-violet-500 text-white",
  },
};

/* --------------------------------------------------------------------------
 * StatusChip — pastiglia di stato.
 * Sostituisce i Badge ri-colorati a mano sparsi nelle pagine admin.
 * ------------------------------------------------------------------------ */
function StatusChip({ className, icon: Icon, label, tone = "neutral", spin, ...props }) {
  const t = TONI[tone] || TONI.neutral;
  return (
    <span
      data-slot="status-chip"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-black uppercase",
        t.sfondo,
        t.bordo,
        t.testo,
        className,
      )}
      {...props}
    >
      {Icon && <Icon size={12} className={spin ? "animate-spin" : undefined} />}
      {label}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * StatTile — riquadro con un numero e un'etichetta.
 * ------------------------------------------------------------------------ */
function StatTile({ className, icon: Icon, label, value, unit, hint, tone = "neutral", ...props }) {
  const t = TONI[tone] || TONI.neutral;
  return (
    <div
      data-slot="stat-tile"
      className={cn(
        "rounded-xl border border-hairline bg-surface-2 p-4 transition-colors hover:border-hairline-strong",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        {Icon && (
          <span className={cn("flex size-7 items-center justify-center rounded-lg", t.sfondo, t.testo)}>
            <Icon size={14} />
          </span>
        )}
        <span className="text-xs font-black uppercase text-muted-foreground">{label}</span>
      </div>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-black tracking-tight text-foreground">{value}</span>
        {unit && <span className="text-sm font-bold text-muted-foreground">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * OptionCard / OptionCardGroup — scelta fra poche alternative.
 *
 * Sostituisce i <Select> per 2-4 opzioni: mostra tutte le alternative con la
 * loro spiegazione, senza click e senza il troncamento del popup (che e'
 * largo quanto il trigger e non manda a capo il testo).
 * ------------------------------------------------------------------------ */
function OptionCardGroup({ className, value, onChange, options, columns = 2, disabled, ...props }) {
  const colonne = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  };
  return (
    <div
      data-slot="option-card-group"
      role="radiogroup"
      className={cn("grid gap-2.5", colonne[columns], className)}
      {...props}
    >
      {options.map((o) => (
        <OptionCard
          key={o.value}
          selected={String(value) === String(o.value)}
          disabled={disabled || o.disabled}
          icon={o.icon}
          title={o.title}
          description={o.description}
          tone={o.tone}
          onClick={() => onChange(String(o.value))}
        />
      ))}
    </div>
  );
}

function OptionCard({ className, selected, disabled, icon: Icon, title, description, tone = "primary", onClick, ...props }) {
  const t = TONI[tone] || TONI.primary;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      data-slot="option-card"
      className={cn(
        "group relative rounded-xl border p-4 text-left transition-all",
        "disabled:cursor-not-allowed disabled:opacity-40",
        selected
          ? cn(t.bordo, t.sfondo, "ring-1 ring-inset", "ring-current/20")
          : "border-hairline bg-surface-2 hover:border-hairline-strong hover:bg-surface-3",
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
            selected ? cn(t.pieno, "border-transparent") : "border-muted-foreground/40",
          )}
        >
          {selected && <Check size={11} strokeWidth={3.5} />}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            {Icon && <Icon size={14} className={selected ? t.testo : "text-muted-foreground"} />}
            <span className="text-sm font-bold text-foreground">{title}</span>
          </span>
          {description && (
            <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
              {description}
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

/* --------------------------------------------------------------------------
 * FieldRow — riga impostazione con titolo, nota e controllo a destra.
 * ------------------------------------------------------------------------ */
function FieldRow({ className, title, description, control, disabled, ...props }) {
  return (
    <div
      data-slot="field-row"
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl border border-hairline bg-surface-2 p-4",
        disabled && "opacity-40",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground">{title}</p>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Field — etichetta + controllo impilati, per moduli.
 * ------------------------------------------------------------------------ */
function Field({ className, label, hint, children, ...props }) {
  return (
    <div data-slot="field" className={cn("space-y-2", className)} {...props}>
      {label && (
        <span className="block text-xs font-black uppercase text-muted-foreground">
          {label}
        </span>
      )}
      {children}
      {hint && <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Callout — messaggio informativo o di avviso.
 * ------------------------------------------------------------------------ */
function Callout({ className, icon: Icon, title, tone = "primary", children, ...props }) {
  const t = TONI[tone] || TONI.primary;
  return (
    <div
      data-slot="callout"
      className={cn("flex items-start gap-3 rounded-xl border p-4", t.bordo, t.sfondo, className)}
      {...props}
    >
      {Icon && <Icon size={16} className={cn("mt-0.5 shrink-0", t.testo)} />}
      <div className="min-w-0">
        {title && (
          <p className={cn("text-xs font-black uppercase", t.testo)}>{title}</p>
        )}
        <div className="mt-1 text-sm leading-relaxed text-foreground/90">{children}</div>
      </div>
    </div>
  );
}

export { StatusChip, StatTile, OptionCard, OptionCardGroup, FieldRow, Field, Callout, TONI };
