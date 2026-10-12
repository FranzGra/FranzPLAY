import { useState } from "react";
import { setAccentColor } from "../../api/auth";
import { accentChoices } from "../../app/accent";
import { useAccount, useAuth } from "../../app/auth";
import styles from "./AccentPicker.module.css";

// The color FranzPLAY's own accent is drawn with, for its swatch.
const ownSwatch = "var(--color-accent-own)";
const ownColor = "#2997ff";

// AccentPicker lets me choose the color of buttons, links and bars: one of
// the ready ones, any other, or FranzPLAY's own. A ready one is saved at
// once; another one after I press Save, so dragging in the color window
// does not send a request at every step.
export function AccentPicker() {
  const account = useAccount();
  const { signedIn } = useAuth();
  const current = account.accentColor;
  // The color window needs a real color to start from: the chosen one, or
  // FranzPLAY's own (--color-accent-own in styles/global.css).
  const shown = current || ownColor;
  const [custom, setCustom] = useState(shown);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const choose = (color: string) => {
    setSaving(true);
    setFailed(false);
    setAccentColor(color)
      .then(signedIn)
      .catch((error: unknown) => {
        console.error(error);
        setFailed(true);
      })
      .finally(() => setSaving(false));
  };

  const ready = current === "" || accentChoices.some((c) => c.value === current);

  return (
    <section className={`glass ${styles.root}`} aria-labelledby="accent-title">
      <h2 id="accent-title" className={styles.title}>
        Colore
      </h2>
      <p className={styles.hint}>Il colore di pulsanti, link e barre, solo per te.</p>
      <div className={styles.swatches}>
        <Swatch
          name="FranzPLAY"
          color={ownSwatch}
          chosen={current === ""}
          disabled={saving}
          onChoose={() => choose("")}
        />
        {accentChoices.map((c) => (
          <Swatch
            key={c.value}
            name={c.name}
            color={c.value}
            chosen={current === c.value}
            disabled={saving}
            onChoose={() => choose(c.value)}
          />
        ))}
      </div>
      <div className={styles.custom}>
        <label className={styles.customLabel}>
          <input
            type="color"
            className={`${styles.customInput} ${!ready ? styles.customChosen : ""}`}
            value={custom}
            onChange={(e) => setCustom(e.target.value.toLowerCase())}
          />
          Un altro colore
        </label>
        {custom !== shown && !accentChoices.some((c) => c.value === custom) && (
          <button
            type="button"
            className={styles.save}
            disabled={saving}
            onClick={() => choose(custom)}
          >
            Usa questo colore
          </button>
        )}
      </div>
      {failed && (
        <p role="alert" className={styles.problem}>
          Colore non salvato: il server non risponde. Riprova.
        </p>
      )}
    </section>
  );
}

function Swatch({
  name,
  color,
  chosen,
  disabled,
  onChoose,
}: {
  name: string;
  color: string;
  chosen: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.swatch}
      style={{ background: color }}
      aria-pressed={chosen}
      aria-label={name}
      title={name}
      disabled={disabled}
      onClick={onChoose}
    />
  );
}
