import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { defaultHomeLook } from "../../api/home";
import styles from "./LookPanel.module.css";
const columnChoices = [0, 2, 3, 4, 5, 6];
const sectionChoices = [
    { value: "one", label: "Una riga" },
    { value: "two", label: "Due righe" },
    { value: "scroll", label: "Scorri di lato" },
];
// LookPanel lets the person choose how the cards of their Home look on a
// computer or tablet: how many in a line, how big, and how much of each
// section to show. Every change shows at once.
export function LookPanel({ look, onChange }) {
    const sizeId = useId();
    const change = (part) => onChange({ ...look, ...part });
    return (_jsxs("section", { className: `glass ${styles.root}`, "aria-label": "Personalizza la Home", children: [_jsxs("fieldset", { className: styles.group, children: [_jsx("legend", { className: styles.label, children: "Card per riga" }), _jsx("div", { className: styles.segments, children: columnChoices.map((n) => (_jsx("button", { type: "button", className: styles.segment, "aria-pressed": look.columns === n, onClick: () => change({ columns: n }), children: n === 0 ? "Auto" : n }, n))) })] }), _jsxs("div", { className: styles.group, children: [_jsx("label", { className: styles.label, htmlFor: sizeId, children: "Grandezza delle card" }), _jsxs("div", { className: styles.slider, children: [_jsx("span", { "aria-hidden": "true", children: "Piccole" }), _jsx("input", { id: sizeId, type: "range", min: 1, max: 5, step: 1, value: look.size, "aria-valuetext": sizeNames[look.size - 1], 
                                // Choosing a size lets the size decide how many cards fit.
                                onChange: (e) => change({ size: Number(e.target.value), columns: 0 }) }), _jsx("span", { "aria-hidden": "true", children: "Grandi" })] }), _jsx("p", { className: styles.hint, children: look.columns === 0
                            ? "La grandezza decide quante card stanno in riga."
                            : `Ora sono ${look.columns} per riga: muovi la barra per scegliere la grandezza.` })] }), _jsxs("fieldset", { className: styles.group, children: [_jsx("legend", { className: styles.label, children: "Video in ogni sezione" }), _jsx("div", { className: styles.segments, children: sectionChoices.map((choice) => (_jsx("button", { type: "button", className: styles.segment, "aria-pressed": look.sections === choice.value, onClick: () => change({ sections: choice.value }), children: choice.label }, choice.value))) })] }), _jsx("button", { type: "button", className: styles.reset, onClick: () => onChange(defaultHomeLook), children: "Torna come prima" })] }));
}
const sizeNames = ["molto piccole", "piccole", "medie", "grandi", "molto grandi"];
