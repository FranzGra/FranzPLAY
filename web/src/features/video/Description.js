import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import styles from "./Description.module.css";
// shortLength is how much of a description shows before "Mostra altro".
const shortLength = 200;
// Description shows what the file next to the video says about it. A
// long one shows its beginning, and opens with "Mostra altro". The text
// is shown as it is, never as a page: links in it are only words.
export function Description({ text }) {
    const [open, setOpen] = useState(false);
    const lines = text.split("\n");
    const long = text.length > shortLength || lines.length > 3;
    const shown = open || !long ? text : `${lines.slice(0, 3).join("\n").slice(0, shortLength).trimEnd()}…`;
    return (_jsxs("section", { className: `glass ${styles.root}`, "aria-label": "Descrizione", children: [_jsx("p", { className: styles.text, children: shown }), long && (_jsx("button", { type: "button", className: styles.more, "aria-expanded": open, onClick: () => setOpen(!open), children: open ? "Mostra meno" : "Mostra altro" }))] }));
}
