import type { Look } from "../../api/site";
import { maxNamePart } from "../../api/site";
import styles from "./LookFields.module.css";

// presets are ready colors, the same as the old FranzPLAY plus its blue.
export const presets = [
  { name: "Blu FranzPLAY", value: "#2997ff" },
  { name: "Rosso", value: "#dc2626" },
  { name: "Arancione", value: "#ea580c" },
  { name: "Viola", value: "#7c3aed" },
  { name: "Blu", value: "#2563eb" },
  { name: "Oro", value: "#ca8a04" },
  { name: "Ciano", value: "#0891b2" },
  { name: "Verde acqua", value: "#0d9488" },
  { name: "Indaco", value: "#4f46e5" },
  { name: "Rosa", value: "#db2777" },
  { name: "Smeraldo", value: "#10b981" },
  { name: "Ardesia", value: "#64748b" },
] as const;

// LookFields are the fields for the name and color of the site, with a
// preview of the logo. Used in the administration and at the first setup.
export function LookFields({ look, onChange }: { look: Look; onChange: (look: Look) => void }) {
  const color = look.color.toLowerCase();
  return (
    <div className={styles.root}>
      <figure className={styles.figure}>
        <figcaption>Anteprima del nome</figcaption>
        <p className={styles.preview}>
          {look.nameFirst || "…"}
          <span style={{ color }}>{look.nameSecond}</span>
        </p>
      </figure>
      <div className={styles.names}>
        <label className={styles.field}>
          Prima parte del nome
          <input
            value={look.nameFirst}
            maxLength={maxNamePart}
            onChange={(e) => onChange({ ...look, nameFirst: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          Seconda parte (nel colore)
          <input
            value={look.nameSecond}
            maxLength={maxNamePart}
            onChange={(e) => onChange({ ...look, nameSecond: e.target.value })}
          />
        </label>
      </div>
      <fieldset className={styles.colors}>
        <legend>Colore del sito</legend>
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            className={styles.swatch}
            style={{ background: p.value }}
            aria-label={p.name}
            aria-pressed={color === p.value}
            title={p.name}
            onClick={() => onChange({ ...look, color: p.value })}
          />
        ))}
        <label className={styles.custom}>
          <input
            type="color"
            value={color}
            aria-label="Un altro colore"
            onChange={(e) => onChange({ ...look, color: e.target.value })}
          />
          Un altro
        </label>
      </fieldset>
    </div>
  );
}
