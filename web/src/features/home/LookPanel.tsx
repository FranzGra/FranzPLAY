import { useId } from "react";
import { defaultHomeLook, type HomeLook, type HomeSections } from "../../api/home";
import styles from "./LookPanel.module.css";

const columnChoices = [0, 2, 3, 4, 5, 6] as const;

const sectionChoices: { value: HomeSections; label: string }[] = [
  { value: "one", label: "Una riga" },
  { value: "two", label: "Due righe" },
  { value: "scroll", label: "Scorri di lato" },
];

type LookPanelProps = {
  look: HomeLook;
  onChange: (look: HomeLook) => void;
};

// LookPanel lets the person choose how the cards of their Home look on a
// computer or tablet: how many in a line, how big, and how much of each
// section to show. Every change shows at once.
export function LookPanel({ look, onChange }: LookPanelProps) {
  const sizeId = useId();
  const change = (part: Partial<HomeLook>) => onChange({ ...look, ...part });
  return (
    <section className={`glass ${styles.root}`} aria-label="Personalizza la Home">
      <fieldset className={styles.group}>
        <legend className={styles.label}>Card per riga</legend>
        <div className={styles.segments}>
          {columnChoices.map((n) => (
            <button
              key={n}
              type="button"
              className={styles.segment}
              aria-pressed={look.columns === n}
              onClick={() => change({ columns: n })}
            >
              {n === 0 ? "Auto" : n}
            </button>
          ))}
        </div>
      </fieldset>

      <div className={styles.group}>
        <label className={styles.label} htmlFor={sizeId}>
          Grandezza delle card
        </label>
        <div className={styles.slider}>
          <span aria-hidden="true">Piccole</span>
          <input
            id={sizeId}
            type="range"
            min={1}
            max={5}
            step={1}
            value={look.size}
            aria-valuetext={sizeNames[look.size - 1]}
            // Choosing a size lets the size decide how many cards fit.
            onChange={(e) => change({ size: Number(e.target.value), columns: 0 })}
          />
          <span aria-hidden="true">Grandi</span>
        </div>
        <p className={styles.hint}>
          {look.columns === 0
            ? "La grandezza decide quante card stanno in riga."
            : `Ora sono ${look.columns} per riga: muovi la barra per scegliere la grandezza.`}
        </p>
      </div>

      <fieldset className={styles.group}>
        <legend className={styles.label}>Video in ogni sezione</legend>
        <div className={styles.segments}>
          {sectionChoices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={styles.segment}
              aria-pressed={look.sections === choice.value}
              onClick={() => change({ sections: choice.value })}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </fieldset>

      <button type="button" className={styles.reset} onClick={() => onChange(defaultHomeLook)}>
        Torna come prima
      </button>
    </section>
  );
}

const sizeNames = ["molto piccole", "piccole", "medie", "grandi", "molto grandi"];
