import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Children, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { useScrollEnds } from "../../lib/scrollEnds";
import { useSections } from "../home/look";
import styles from "./VideoRow.module.css";
// VideoRow is a big titled section of video cards, like the sections of
// the old FranzPLAY's Home. On a computer or tablet it shows one or two
// lines of cards, or one line that scrolls sideways, as the person chose;
// on a phone it is always a line that scrolls. children are the <li> of
// the cards. A closed section folds away softly.
export function VideoRow({ title, icon, more, fold, children }) {
    const id = useId();
    const open = fold?.open ?? true;
    const sections = useSections();
    const scroll = sections === "scroll";
    const list = useRef(null);
    const ends = useScrollEnds(list, open && scroll);
    const columns = useColumns(list, !scroll);
    const [all, setAll] = useState(false);
    const cards = Children.toArray(children);
    // Unknown columns (the grid not drawn yet) show every card.
    const fits = columns * (sections === "two" ? 2 : 1);
    const cut = !scroll && !all && fits > 0 && cards.length > fits;
    const extra = !scroll && fits > 0 && cards.length > fits;
    // One press moves by almost a screen of cards, keeping one in sight.
    const move = (direction) => {
        const el = list.current;
        el?.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
    };
    return (_jsxs("section", { className: styles.root, "aria-labelledby": id, "data-open": open, children: [_jsxs("div", { className: styles.top, children: [_jsx("h2", { id: id, className: styles.title, children: fold ? (_jsxs("button", { type: "button", className: styles.toggle, "aria-expanded": open, onClick: fold.onToggle, title: open ? "Chiudi questa sezione" : "Apri questa sezione", children: [icon && _jsx(TitleIcon, { name: icon }), _jsx("span", { className: styles.titleText, children: title }), _jsx("span", { className: styles.chevron, children: _jsx(Icon, { name: "chevronRight", size: 20 }) })] })) : (_jsxs("span", { className: styles.plain, children: [icon && _jsx(TitleIcon, { name: icon }), title] })) }), open && (_jsxs("div", { className: styles.side, children: [more && (_jsx(Link, { to: more, className: styles.more, "aria-label": `Vedi tutti: ${title}`, children: "Vedi tutti" })), scroll && (ends.left || ends.right) && (_jsxs("div", { className: styles.arrows, children: [_jsx("button", { type: "button", className: styles.arrow, disabled: !ends.left, onClick: () => move(-1), "aria-label": `Indietro: ${title}`, children: _jsx(Icon, { name: "chevronLeft", size: 18 }) }), _jsx("button", { type: "button", className: styles.arrow, disabled: !ends.right, onClick: () => move(1), "aria-label": `Avanti: ${title}`, children: _jsx(Icon, { name: "chevronRight", size: 18 }) })] }))] }))] }), _jsx("div", { className: styles.body, "aria-hidden": !open, inert: !open, children: _jsxs("div", { className: styles.inner, children: [_jsx("ul", { ref: list, className: `stagger ${styles.list}`, "data-sections": sections, children: cut ? cards.slice(0, fits) : cards }), extra && (_jsx("button", { type: "button", className: styles.all, "aria-expanded": all, onClick: () => setAll((a) => !a), children: all ? "Mostra meno" : `Mostra tutti (${cards.length})` }))] }) })] }));
}
function TitleIcon({ name }) {
    return (_jsx("span", { className: styles.icon, children: _jsx(Icon, { name: name, size: 20 }) }));
}
// useColumns counts the cards that fit in a line of the grid, and keeps
// counting while the window changes size. 0 means not known yet.
function useColumns(list, grid) {
    const [columns, setColumns] = useState(0);
    useEffect(() => {
        const el = list.current;
        if (!grid || !el) {
            setColumns(0);
            return;
        }
        const count = () => {
            const tracks = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean);
            // Without real measures (as in tests) the template is not a list
            // of widths in pixels: then every card shows.
            setColumns(tracks.every((t) => t.endsWith("px")) ? tracks.length : 0);
        };
        count();
        if (typeof ResizeObserver === "undefined")
            return;
        // A card changes width when another look changes the columns, even
        // if the line keeps its width.
        const watch = new ResizeObserver(count);
        watch.observe(el);
        if (el.firstElementChild)
            watch.observe(el.firstElementChild);
        return () => watch.disconnect();
    }, [list, grid]);
    return columns;
}
