import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
];
// LookFields are the fields for the name and color of the site, with a
// preview of the logo. Used in the administration and at the first setup.
export function LookFields({ look, onChange }) {
    const color = look.color.toLowerCase();
    return (_jsxs("div", { className: styles.root, children: [_jsxs("figure", { className: styles.figure, children: [_jsx("figcaption", { children: "Anteprima del nome" }), _jsxs("p", { className: styles.preview, children: [look.nameFirst || "…", _jsx("span", { style: { color }, children: look.nameSecond })] })] }), _jsxs("div", { className: styles.names, children: [_jsxs("label", { className: styles.field, children: ["Prima parte del nome", _jsx("input", { value: look.nameFirst, maxLength: maxNamePart, onChange: (e) => onChange({ ...look, nameFirst: e.target.value }) })] }), _jsxs("label", { className: styles.field, children: ["Seconda parte (nel colore)", _jsx("input", { value: look.nameSecond, maxLength: maxNamePart, onChange: (e) => onChange({ ...look, nameSecond: e.target.value }) })] })] }), _jsxs("fieldset", { className: styles.colors, children: [_jsx("legend", { children: "Colore del sito" }), presets.map((p) => (_jsx("button", { type: "button", className: styles.swatch, style: { background: p.value }, "aria-label": p.name, "aria-pressed": color === p.value, title: p.name, onClick: () => onChange({ ...look, color: p.value }) }, p.value))), _jsxs("label", { className: styles.custom, children: [_jsx("input", { type: "color", value: color, "aria-label": "Un altro colore", onChange: (e) => onChange({ ...look, color: e.target.value }) }), "Un altro"] })] })] }));
}
