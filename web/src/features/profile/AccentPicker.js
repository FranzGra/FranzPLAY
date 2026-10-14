import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
    const choose = (color) => {
        setSaving(true);
        setFailed(false);
        setAccentColor(color)
            .then(signedIn)
            .catch((error) => {
            console.error(error);
            setFailed(true);
        })
            .finally(() => setSaving(false));
    };
    const ready = current === "" || accentChoices.some((c) => c.value === current);
    return (_jsxs("section", { className: `glass ${styles.root}`, "aria-labelledby": "accent-title", children: [_jsx("h2", { id: "accent-title", className: styles.title, children: "Colore" }), _jsx("p", { className: styles.hint, children: "Il colore di pulsanti, link e barre, solo per te." }), _jsxs("div", { className: styles.swatches, children: [_jsx(Swatch, { name: "FranzPLAY", color: ownSwatch, chosen: current === "", disabled: saving, onChoose: () => choose("") }), accentChoices.map((c) => (_jsx(Swatch, { name: c.name, color: c.value, chosen: current === c.value, disabled: saving, onChoose: () => choose(c.value) }, c.value)))] }), _jsxs("div", { className: styles.custom, children: [_jsxs("label", { className: styles.customLabel, children: [_jsx("input", { type: "color", className: `${styles.customInput} ${!ready ? styles.customChosen : ""}`, value: custom, onChange: (e) => setCustom(e.target.value.toLowerCase()) }), "Un altro colore"] }), custom !== shown && !accentChoices.some((c) => c.value === custom) && (_jsx("button", { type: "button", className: styles.save, disabled: saving, onClick: () => choose(custom), children: "Usa questo colore" }))] }), failed && (_jsx("p", { role: "alert", className: styles.problem, children: "Colore non salvato: il server non risponde. Riprova." }))] }));
}
function Swatch({ name, color, chosen, disabled, onChoose, }) {
    return (_jsx("button", { type: "button", className: styles.swatch, style: { background: color }, "aria-pressed": chosen, "aria-label": name, title: name, disabled: disabled, onClick: onChoose }));
}
