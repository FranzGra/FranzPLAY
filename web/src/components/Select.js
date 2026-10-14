import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../lib/presence";
import { Icon } from "./Icon";
import styles from "./Select.module.css";
// gap is the space between the button and its list, in pixels.
const gap = 6;
// tallest is the most the list grows before it scrolls.
const tallest = 320;
// typingPause ends a word typed to jump to a choice.
const typingPause = 600; // milliseconds
// Select lets a person pick one choice from a list. It replaces the browser's
// own <select>, whose open list is drawn by the system: on some computers it
// came out white with white words. This one is drawn by us, in the dark glass
// look, and works with mouse, finger and keyboard like the real one.
export function Select({ value, options, onChange, disabled = false, labelledBy, "aria-label": ariaLabel, compact = false, className = "", }) {
    const id = useId();
    const listId = `${id}-list`;
    const buttonRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const [place, setPlace] = useState(null);
    const typed = useRef({ text: "", at: 0 });
    const list = usePresence(open ? place : null);
    const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
    const selected = options[selectedIndex];
    const show = useCallback((index) => {
        if (disabled || options.length === 0)
            return;
        setActive(index);
        setOpen(true);
    }, [disabled, options.length]);
    const choose = (index) => {
        const option = options[index];
        setOpen(false);
        buttonRef.current?.focus();
        if (option && option.value !== value)
            onChange(option.value);
    };
    // The list sits under the button, or over it when there is more room above.
    // It lives at the end of the page (a portal), so no card can cut it.
    const measure = useCallback(() => {
        const button = buttonRef.current;
        if (!button)
            return;
        const box = button.getBoundingClientRect();
        const below = window.innerHeight - box.bottom - gap - 8;
        const above = box.top - gap - 8;
        const width = Math.max(box.width, 160);
        const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
        if (below >= Math.min(tallest, 200) || below >= above) {
            setPlace({ left, width, top: box.bottom + gap, maxHeight: Math.min(tallest, below) });
        }
        else {
            setPlace({
                left,
                width,
                bottom: window.innerHeight - box.top + gap,
                maxHeight: Math.min(tallest, above),
            });
        }
    }, []);
    useLayoutEffect(() => {
        if (!open)
            return;
        measure();
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [open, measure]);
    // A click or touch anywhere else closes the list, without choosing.
    useEffect(() => {
        if (!open)
            return;
        const outside = (event) => {
            const target = event.target;
            if (buttonRef.current?.contains(target) || list.ref.current?.contains(target))
                return;
            setOpen(false);
        };
        document.addEventListener("pointerdown", outside);
        return () => document.removeEventListener("pointerdown", outside);
    }, [open, list.ref]);
    // The highlighted choice stays in sight while the arrows move through a long list.
    useEffect(() => {
        if (!open)
            return;
        const item = list.ref.current?.children[active];
        item?.scrollIntoView?.({ block: "nearest" });
    }, [open, active, list.ref]);
    // jumpTo finds the next choice that starts with the letters just typed.
    const jumpTo = (key) => {
        const now = Date.now();
        const sameWord = now - typed.current.at < typingPause;
        typed.current = { text: (sameWord ? typed.current.text : "") + key.toLowerCase(), at: now };
        const text = typed.current.text;
        const start = open ? active : selectedIndex;
        for (let step = text.length > 1 ? 0 : 1; step <= options.length; step++) {
            const index = (start + step) % options.length;
            if (options[index]?.label.toLowerCase().startsWith(text))
                return index;
        }
        return -1;
    };
    const onKeyDown = (event) => {
        const last = options.length - 1;
        const key = event.key;
        if (!open) {
            if (["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) {
                event.preventDefault();
                show(selectedIndex);
            }
            else if (key === "Home" || key === "End") {
                event.preventDefault();
                show(key === "Home" ? 0 : last);
            }
            else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const index = jumpTo(key);
                if (index >= 0)
                    show(index);
            }
            return;
        }
        const moves = {
            ArrowDown: Math.min(active + 1, last),
            ArrowUp: Math.max(active - 1, 0),
            PageDown: Math.min(active + 10, last),
            PageUp: Math.max(active - 10, 0),
            Home: 0,
            End: last,
        };
        if (key in moves) {
            event.preventDefault();
            setActive(moves[key] ?? active);
        }
        else if (key === "Enter" || (key === " " && Date.now() - typed.current.at >= typingPause)) {
            // (A space typed in the middle of a word is part of the word, not a choice.)
            event.preventDefault();
            choose(active);
        }
        else if (key === "Escape") {
            // Only the list closes, not the window it may be in.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
        }
        else if (key === "Tab") {
            setOpen(false);
        }
        else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            const index = jumpTo(key);
            if (index >= 0)
                setActive(index);
        }
    };
    const shownPlace = list.shown;
    return (_jsxs(_Fragment, { children: [_jsxs("button", { ref: buttonRef, type: "button", role: "combobox", "aria-haspopup": "listbox", "aria-expanded": open, "aria-controls": listId, "aria-activedescendant": open ? `${id}-${active}` : undefined, "aria-labelledby": labelledBy, "aria-label": ariaLabel, disabled: disabled, className: `glass ${styles.button} ${compact ? styles.compact : ""} ${className}`, onClick: () => (open ? setOpen(false) : show(selectedIndex)), onKeyDown: onKeyDown, children: [_jsx("span", { className: styles.value, children: selected?.label ?? "" }), _jsx("span", { className: styles.chevron, "aria-hidden": "true", children: _jsx(Icon, { name: "chevronDown", size: 18 }) })] }), shownPlace &&
                createPortal(_jsx("div", { ref: list.ref, id: listId, role: "listbox", "aria-labelledby": labelledBy, "aria-label": ariaLabel, className: `${styles.list} ${"bottom" in shownPlace ? styles.above : ""}`, "data-leaving": list.leaving || undefined, style: {
                        left: shownPlace.left,
                        minWidth: shownPlace.width,
                        maxHeight: shownPlace.maxHeight,
                        ...("top" in shownPlace ? { top: shownPlace.top } : { bottom: shownPlace.bottom }),
                    }, children: options.map((option, index) => (_jsxs("div", { id: `${id}-${index}`, role: "option", tabIndex: -1, "aria-selected": index === selectedIndex, "data-active": index === active || undefined, className: styles.option, onPointerEnter: () => setActive(index), onPointerDown: (e) => e.preventDefault(), onClick: () => choose(index), children: [_jsx("span", { children: option.label }), index === selectedIndex && (_jsx("span", { className: styles.tick, "aria-hidden": "true", children: _jsx(Icon, { name: "check", size: 18 }) }))] }, String(option.value)))) }), document.body)] }));
}
