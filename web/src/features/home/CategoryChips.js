import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { useScrollEnds } from "../../lib/scrollEnds";
import { tileColor } from "../categories/color";
import styles from "./CategoryChips.module.css";
// CategoryChips is the line of categories on the Home: "Tutti", then one
// chip for each category, with a dot in the category's own color, as on
// its card in the Categorie page. However many there are, they stay on one
// line that slides sideways: the edges fade where more chips hide, and
// with a mouse two arrows move the line. The last chip opens the page
// with all the categories.
export function CategoryChips({ categories, chosen, onChoose }) {
    const list = useRef(null);
    const ends = useScrollEnds(list, true);
    const move = (direction) => {
        const el = list.current;
        el?.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: "smooth" });
    };
    return (_jsxs("div", { className: styles.root, children: [_jsxs("span", { className: styles.label, "aria-hidden": "true", children: [_jsx(Icon, { name: "categories", size: 18 }), _jsx("span", { className: styles.labelText, children: "Categorie" })] }), _jsxs("div", { className: styles.track, "data-left": ends.left || undefined, "data-right": ends.right || undefined, children: [_jsxs("ul", { ref: list, className: styles.chips, "aria-label": "Categorie", children: [["", ...categories.map((c) => c.name)].map((name) => {
                                const category = categories.find((c) => c.name === name);
                                return (_jsx("li", { children: _jsxs("button", { type: "button", className: styles.chip, "aria-pressed": name === chosen, onClick: () => onChoose(name), children: [category && (_jsx("span", { className: styles.dot, style: { "--dot": tileColor(category) } })), name || "Tutti"] }) }, name));
                            }), _jsx("li", { children: _jsxs(Link, { to: "/categorie", className: `${styles.chip} ${styles.all}`, children: ["Tutte le categorie", _jsx(Icon, { name: "chevronRight", size: 16 })] }) })] }), ends.left && (_jsx("button", { type: "button", className: `${styles.arrow} ${styles.left}`, "aria-label": "Categorie precedenti", onClick: () => move(-1), children: _jsx(Icon, { name: "chevronLeft", size: 18 }) })), ends.right && (_jsx("button", { type: "button", className: `${styles.arrow} ${styles.right}`, "aria-label": "Altre categorie", onClick: () => move(1), children: _jsx(Icon, { name: "chevronRight", size: 18 }) }))] })] }));
}
