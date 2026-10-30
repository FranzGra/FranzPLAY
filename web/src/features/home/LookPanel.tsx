import { type RefObject, useEffect, useId, useRef } from "react";
import { defaultHomeLook, type HomeLook, type HomeSections } from "../../api/home";
import { Icon } from "../../components/Icon";
import styles from "./LookPanel.module.css";

const columnChoices = [0, 2, 3, 4, 5, 6] as const;

const sectionChoices: { value: HomeSections; label: string }[] = [
  { value: "one", label: "Una riga" },
  { value: "two", label: "Due righe" },
  { value: "scroll", label: "Scorri di lato" },
];

const sizeNames = ["molto piccole", "piccole", "medie", "grandi", "molto grandi"];

type LookPanelProps = {
  id: string;
  look: HomeLook;
  onChange: (look: HomeLook) => void;
  open: boolean;
  onClose: () => void;
  // perLine is how many cards are in a line now, when the size decides.
  perLine: number | null;
  // opener is the Personalizza button: it gets the focus back on closing.
  opener: RefObject<HTMLButtonElement | null>;
};

// LookPanel lets the person choose how the cards of their Home look on a
// computer or tablet. It is a panel on the right, as wide as the side menu
// on the left: the Home stays in sight beside it and every change shows at
// once. On a wide computer the Home narrows to make room for it; on a
// smaller screen it lies over the Home, on a dark veil.
//
// One choice leads: how many cards in a line. "Auto" lets the size decide
// (the smallest width of a card, so more or fewer fit); a fixed number
// keeps that many in a line and the cards take the width they have, so
// the size has nothing to say and is put aside.
export function LookPanel({ id, look, onChange, open, onClose, perLine, opener }: LookPanelProps) {
  const sizeId = useId();
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const change = (part: Partial<HomeLook>) => onChange({ ...look, ...part });
  const auto = look.columns === 0;

  // Opening brings the focus into the panel; Esc closes it and gives the
  // focus back to Personalizza, if it was in the panel.
  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    const element = panel.current;
    if (element?.contains(document.activeElement)) opener.current?.focus({ preventScroll: true });
  }, [open, opener]);

  return (
    <>
      {/* The veil under the panel on a smaller screen: a click on it
          closes the panel, as the X and Esc do. */}
      <div className={styles.backdrop} hidden={!open} aria-hidden="true" onClick={onClose} />
      <section
        ref={panel}
        id={id}
        className={styles.panel}
        aria-labelledby={titleId}
        hidden={!open}
        tabIndex={-1}
        data-side-panel={open ? "open" : "closed"}
      >
        <header className={styles.top}>
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              Personalizza la Home
            </h2>
            <p className={styles.sub}>Le modifiche si vedono subito.</p>
          </div>
          <button type="button" className={styles.close} aria-label="Chiudi" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </header>

        <div className={styles.body}>
          <fieldset className={styles.group}>
            <legend className={styles.label}>Card per riga</legend>
            <div className={styles.columns}>
              {columnChoices.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={styles.choice}
                  aria-pressed={look.columns === n}
                  onClick={() => change({ columns: n })}
                >
                  {n === 0 ? "Auto" : n}
                </button>
              ))}
            </div>
            <p className={styles.hint}>
              {auto
                ? "Auto: decide la grandezza qui sotto."
                : `Sempre ${look.columns} per riga, larghe quanto c'è posto.`}
            </p>
          </fieldset>

          <div className={styles.group}>
            <div className={styles.labelRow}>
              {auto ? (
                <label className={styles.label} htmlFor={sizeId}>
                  Grandezza delle card
                </label>
              ) : (
                <span className={styles.label}>Grandezza delle card</span>
              )}
              {auto && perLine !== null && (
                <output className={styles.now} htmlFor={sizeId} aria-live="polite">
                  Ora: {perLine} per riga
                </output>
              )}
            </div>
            {auto ? (
              <>
                <input
                  id={sizeId}
                  className={styles.range}
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={look.size}
                  aria-valuetext={sizeNames[look.size - 1]}
                  onChange={(e) => change({ size: Number(e.target.value) })}
                />
                <div className={styles.ends} aria-hidden="true">
                  <span>Piccole</span>
                  <span>Grandi</span>
                </div>
              </>
            ) : (
              <p className={styles.note}>
                Con un numero fisso la grandezza si adatta da sola. Per sceglierla tu, scegli Auto.
              </p>
            )}
          </div>

          <fieldset className={styles.group}>
            <legend className={styles.label}>Video in ogni sezione</legend>
            <div className={styles.list}>
              {sectionChoices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={styles.option}
                  aria-pressed={look.sections === choice.value}
                  onClick={() => change({ sections: choice.value })}
                >
                  <span className={styles.dot} aria-hidden="true" />
                  {choice.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <footer className={styles.bottom}>
          <button type="button" className={styles.reset} onClick={() => onChange(defaultHomeLook)}>
            Torna come prima
          </button>
        </footer>
      </section>
    </>
  );
}
