import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type AdminCategory, fetchAdminCategories } from "../../api/adminCategories";
import { type AdminFilters, noFilters } from "../../api/adminVideos";
import { Icon } from "../../components/Icon";
import { placeStyle, useAnchored } from "../../lib/anchored";
import { usePresence } from "../../lib/presence";
import { useWide } from "../home/look";
import { n, ui } from "./ui";
import styles from "./VideoFilters.module.css";

// The administrator's own filters on the videos page: a "Filtri" button
// beside the choice of view opens a panel (on a phone, a sheet over the
// whole screen); the filters on show as chips under the search, each with
// its X, and "Azzera" takes them all away. They live in the address, like
// the pills and the search, so the back button and a link keep them.

type OneOfKey = Exclude<keyof AdminFilters, "categories">;

// The filters with one choice each: what the panel offers and what the chip
// of the one chosen says. The first option, "", is no filter.
const groups: {
  key: OneOfKey;
  legend: string;
  options: { value: string; label: string; chip: string }[];
  note?: string;
}[] = [
  {
    key: "source",
    legend: "Origine",
    options: [
      { value: "", label: "Tutti", chip: "" },
      { value: "folder", label: "Dalle cartelle", chip: "Dalle cartelle" },
      { value: "upload", label: "Caricati", chip: "Caricati dal sito" },
    ],
  },
  {
    key: "subtitles",
    legend: "Sottotitoli",
    options: [
      { value: "", label: "Tutti", chip: "" },
      { value: "with", label: "Con sottotitoli", chip: "Con sottotitoli" },
      { value: "without", label: "Senza", chip: "Senza sottotitoli" },
    ],
    note: "Contano quelli dentro il file e quelli fatti da FranzPLAY, non i file .srt accanto al video.",
  },
  {
    key: "missing",
    legend: "Immagini",
    options: [
      { value: "", label: "Tutti", chip: "" },
      { value: "cover", label: "Senza copertina", chip: "Senza copertina" },
      { value: "preview", label: "Senza anteprime", chip: "Senza anteprime" },
    ],
  },
  {
    key: "length",
    legend: "Durata",
    options: [
      { value: "", label: "Tutte", chip: "" },
      { value: "short", label: "Meno di 5 min", chip: "Durata: meno di 5 min" },
      { value: "medium", label: "Da 5 a 30 min", chip: "Durata: da 5 a 30 min" },
      { value: "long", label: "Più di 30 min", chip: "Durata: più di 30 min" },
    ],
  },
  {
    key: "added",
    legend: "Aggiunti",
    options: [
      { value: "", label: "Sempre", chip: "" },
      { value: "7", label: "Ultimi 7 giorni", chip: "Aggiunti negli ultimi 7 giorni" },
      { value: "30", label: "Ultimi 30 giorni", chip: "Aggiunti negli ultimi 30 giorni" },
    ],
  },
];

// readFilters reads the filters from the address; anything unknown is no
// filter, as the server would refuse it.
export function readFilters(params: URLSearchParams): AdminFilters {
  const out: AdminFilters = { ...noFilters, categories: [...new Set(params.getAll("category"))] };
  for (const g of groups) {
    const value = params.get(g.key) ?? "";
    if (g.options.some((o) => o.value === value)) {
      (out as Record<OneOfKey, string>)[g.key] = value;
    }
  }
  return out;
}

// writeFilters puts the filters in a copy of the address.
export function writeFilters(params: URLSearchParams, f: AdminFilters): URLSearchParams {
  const p = new URLSearchParams(params);
  p.delete("category");
  for (const c of f.categories) p.append("category", c);
  for (const g of groups) {
    if (f[g.key]) p.set(g.key, f[g.key]);
    else p.delete(g.key);
  }
  return p;
}

// activeFilters counts the filters on: all the categories chosen are one.
export function activeFilters(f: AdminFilters): number {
  return (f.categories.length > 0 ? 1 : 0) + groups.filter((g) => f[g.key] !== "").length;
}

type Categories =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; list: AdminCategory[] };

// useCategories reads the categories once they are wanted: when the panel
// opens, or when the address already names some, for their chips.
export function useCategories(wanted: boolean): [Categories, () => void] {
  const [state, setState] = useState<Categories>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  // Once wanted, always: closing the panel does not stop the reading.
  const [asked, setAsked] = useState(wanted);
  if (wanted && !asked) setAsked(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt asks again
  useEffect(() => {
    if (!asked) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchAdminCategories(controller.signal)
      .then((list) => setState({ kind: "ready", list }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [asked, attempt]);
  return [state, () => setAttempt((a) => a + 1)];
}

// shownName is the name people see of a category.
const shownName = (c: AdminCategory) => c.label || c.found;

// categoryName is what the chip of a category says: its name as people see
// it, or the last folder of its path while the list is not there.
function categoryName(name: string, categories: Categories): string {
  if (name === "") return "Senza categoria";
  const found = categories.kind === "ready" ? categories.list.find((c) => c.name === name) : null;
  return found ? shownName(found) : (name.split("/").pop() ?? name);
}

// FilterChips are the filters on, each with an X to take it away, and
// "Azzera" for all of them.
export function FilterChips({
  filters,
  categories,
  onChange,
}: {
  filters: AdminFilters;
  categories: Categories;
  onChange: (next: AdminFilters) => void;
}) {
  if (activeFilters(filters) === 0) return null;
  const chip = (key: string, label: string, next: AdminFilters) => (
    <li key={key}>
      <button
        type="button"
        className={`${ui.chip} ${styles.chip}`}
        aria-label={`Togli il filtro ${label}`}
        onClick={() => onChange(next)}
      >
        <span className={styles.chipText}>{label}</span>
        <Icon name="close" size={14} />
      </button>
    </li>
  );
  return (
    <div className={styles.chips}>
      <ul aria-label="Filtri attivi">
        {filters.categories.map((c) =>
          chip(`category-${c}`, categoryName(c, categories), {
            ...filters,
            categories: filters.categories.filter((x) => x !== c),
          }),
        )}
        {groups.map((g) => {
          const o = g.options.find((x) => x.value === filters[g.key]);
          return o && o.value !== "" ? chip(g.key, o.chip, { ...filters, [g.key]: "" }) : null;
        })}
      </ul>
      <button type="button" className={ui.link} onClick={() => onChange(noFilters)}>
        Azzera
      </button>
    </div>
  );
}

// panelWidth is the panel's width on a computer; roomWanted the height
// under the button enough to open there.
const panelWidth = 400;
const roomWanted = 360;

// FiltersButton is the "Filtri" button, with how many are on, and its panel.
export function FiltersButton({
  filters,
  categories,
  onRetry,
  open,
  onOpen,
  onChange,
}: {
  filters: AdminFilters;
  categories: Categories;
  onRetry: () => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  onChange: (next: AdminFilters) => void;
}) {
  const panel = usePresence(open ? true : null);
  const sheet = !useWide();
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const place = useAnchored(button, open && !sheet, panelWidth, roomWanted);
  const active = activeFilters(filters);

  // Closing gives the focus back to the button, for the keyboard.
  const close = useCallback(() => {
    onOpen(false);
    button.current?.focus();
  }, [onOpen]);

  useEffect(() => {
    if (!open) return;
    panel.ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (button.current?.contains(e.target) || panel.ref.current?.contains(e.target)) return;
      onOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close, onOpen, panel.ref]);

  // Under the phone's sheet the page must not scroll with the finger.
  useEffect(() => {
    if (!open || !sheet) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open, sheet]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`${ui.btn} ${styles.button}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={active > 0 ? `Filtri, ${active} attivi` : "Filtri"}
        onClick={() => onOpen(!open)}
      >
        <Icon name="sliders" size={18} />
        Filtri
        {active > 0 && (
          <span className={styles.count} aria-hidden="true">
            {active}
          </span>
        )}
      </button>
      {panel.shown &&
        createPortal(
          <div
            ref={panel.ref}
            id={panelId}
            tabIndex={-1}
            className={sheet ? styles.sheet : styles.panel}
            style={sheet || !place ? undefined : placeStyle(place)}
            data-above={(place && "bottom" in place) || undefined}
            data-right={place?.fromRight || undefined}
            data-leaving={panel.leaving || undefined}
            role="dialog"
            aria-modal={sheet || undefined}
            aria-labelledby={`${panelId}-title`}
          >
            <div className={styles.head}>
              <h2 id={`${panelId}-title`} className={styles.title}>
                Filtri
              </h2>
              <button
                type="button"
                className={`${ui.btn} ${ui.ghost} ${ui.iconBtn}`}
                aria-label="Chiudi i filtri"
                onClick={close}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className={styles.body}>
              <CategoryChoice
                chosen={filters.categories}
                categories={categories}
                onRetry={onRetry}
                onChange={(next) => onChange({ ...filters, categories: next })}
              />
              {groups.map((g) => (
                <fieldset key={g.key} className={styles.group}>
                  <legend className={styles.legend}>{g.legend}</legend>
                  <div className={styles.options}>
                    {g.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        className={`${ui.filter} ${styles.option}`}
                        aria-pressed={filters[g.key] === o.value}
                        onClick={() => onChange({ ...filters, [g.key]: o.value })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {g.note && <p className={styles.note}>{g.note}</p>}
                </fieldset>
              ))}
            </div>
            <div className={styles.foot}>
              <button
                type="button"
                className={`${ui.btn} ${ui.ghost}`}
                disabled={active === 0}
                onClick={() => onChange(noFilters)}
              >
                Azzera
              </button>
              <button type="button" className={`${ui.btn} ${ui.primary}`} onClick={close}>
                Fatto
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// manyCategories is from how many on the list gets a field to find one.
const manyCategories = 8;

// CategoryChoice is the list of the categories with a box each, and "Senza
// categoria" first; with many of them, a field finds one by name or folder.
function CategoryChoice({
  chosen,
  categories,
  onRetry,
  onChange,
}: {
  chosen: string[];
  categories: Categories;
  onRetry: () => void;
  onChange: (next: string[]) => void;
}) {
  const [find, setFind] = useState("");
  const list = categories.kind === "ready" ? categories.list : [];
  const shown = useMemo(() => {
    const words = find.trim().toLowerCase();
    if (!words) return list;
    return list.filter(
      (c) => shownName(c).toLowerCase().includes(words) || c.name.toLowerCase().includes(words),
    );
  }, [list, find]);
  const toggle = (name: string) =>
    onChange(chosen.includes(name) ? chosen.filter((c) => c !== name) : [...chosen, name]);

  const box = (name: string, label: string, path: string | null, videos: number | null) => (
    <li key={`c-${name}`}>
      <label className={styles.check}>
        <input type="checkbox" checked={chosen.includes(name)} onChange={() => toggle(name)} />
        <span className={styles.box} aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
        <span className={styles.checkText}>
          <span className={styles.checkName}>{label}</span>
          {path && <span className={styles.checkPath}>{path}</span>}
        </span>
        {videos !== null && <span className={styles.checkCount}>{n(videos)}</span>}
      </label>
    </li>
  );

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>
        Categoria
        {chosen.length > 0 && (
          <span className={styles.legendCount}>
            {" · "}
            {chosen.length === 1 ? "1 scelta" : `${chosen.length} scelte`}
          </span>
        )}
      </legend>
      {categories.kind === "loading" && (
        <p className={styles.note} role="status">
          Carico le categorie…
        </p>
      )}
      {categories.kind === "error" && (
        <p className={styles.note} role="alert">
          Non riesco a caricare le categorie.{" "}
          <button type="button" className={ui.link} onClick={onRetry}>
            Riprova
          </button>
        </p>
      )}
      {categories.kind === "ready" && (
        <>
          {list.length > manyCategories && (
            <label className={styles.find}>
              <Icon name="search" size={16} />
              <span className="visually-hidden">Cerca una categoria</span>
              <input
                type="search"
                placeholder="Cerca una categoria…"
                autoComplete="off"
                spellCheck={false}
                value={find}
                onChange={(e) => setFind(e.target.value)}
              />
            </label>
          )}
          <ul className={styles.categories} aria-label="Categorie">
            {!find.trim() && box("", "Senza categoria", null, null)}
            {shown.map((c) => {
              const label = shownName(c);
              const path = c.name.split("/").join(" › ");
              return box(c.name, label, path !== label ? path : null, c.videos);
            })}
            {shown.length === 0 && find.trim() && (
              <li className={styles.note}>Nessuna categoria con queste lettere.</li>
            )}
          </ul>
        </>
      )}
    </fieldset>
  );
}
