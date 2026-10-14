import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, } from "react";
import { createPortal } from "react-dom";
import { createPlaylist, fetchPlaylists, maxNameLength, playlistName, putInPlaylist, } from "../../api/playlists";
import { Icon } from "../../components/Icon";
import { usePresence } from "../../lib/presence";
import { useWide } from "../home/look";
import styles from "./SaveButton.module.css";
// gap is the space between the button and the panel, in pixels.
const gap = 8;
// margin keeps the panel this far from the window's edges.
const margin = 8;
// panelWidth is the panel's width on a computer.
const panelWidth = 320;
// roomWanted is the height under the button that is enough to open there:
// a few lists, the rest scroll. Only with less room does it open above.
const roomWanted = 240;
// SaveButton opens a panel where I put the video in my lists, or make a
// new list for it. On a computer the panel grows out of the button and
// shrinks back into it; on a phone it covers the whole screen, rising from
// the bottom, with big rows for the thumb. Each time the video goes into a
// list, the button's icon bounces.
export function SaveButton({ videoId }) {
    const [open, setOpen] = useState(false);
    const panel = usePresence(open ? true : null);
    const sheet = !useWide();
    // saved counts the lists the video went into: each one bounces the icon.
    const [saved, setSaved] = useState(0);
    const root = useRef(null);
    const button = useRef(null);
    const [place, setPlace] = useState(null);
    // On a computer the panel hangs from the button, or rises above it when
    // there is more room there. It lives at the end of the page (a portal),
    // so no column next to it, like the videos on the right, can cover it.
    const measure = useCallback(() => {
        const box = button.current?.getBoundingClientRect();
        if (!box)
            return;
        const width = Math.min(panelWidth, window.innerWidth - 2 * margin);
        const left = Math.max(margin, Math.min(box.left, window.innerWidth - width - margin));
        const below = window.innerHeight - box.bottom - gap - margin;
        const above = box.top - gap - margin;
        setPlace(below >= roomWanted || below >= above
            ? { left, width, top: box.bottom + gap, maxHeight: below }
            : { left, width, bottom: window.innerHeight - box.top + gap, maxHeight: above });
    }, []);
    useLayoutEffect(() => {
        if (!open || sheet)
            return;
        measure();
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [open, sheet, measure]);
    // Closing gives the focus back to the button, for the keyboard.
    const close = useCallback(() => {
        setOpen(false);
        button.current?.focus();
    }, []);
    useEffect(() => {
        if (!open)
            return;
        const onKey = (e) => {
            if (e.key === "Escape")
                close();
        };
        // A touch outside closes the panel; the phone's sheet lives outside
        // the button's box, so a touch on it counts as inside.
        const onPointer = (e) => {
            if (!(e.target instanceof Node))
                return;
            if (root.current?.contains(e.target) || panel.ref.current?.contains(e.target))
                return;
            setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        document.addEventListener("pointerdown", onPointer);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("pointerdown", onPointer);
        };
    }, [open, close, panel.ref]);
    // Under the phone's sheet the page must not scroll with the finger.
    useEffect(() => {
        if (!open || !sheet)
            return;
        const before = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = before;
        };
    }, [open, sheet]);
    const content = panel.shown && (_jsx(Panel, { ref: panel.ref, leaving: panel.leaving, sheet: sheet, place: place, videoId: videoId, onSaved: () => setSaved((n) => n + 1), onClose: close }));
    return (_jsxs("div", { className: styles.root, ref: root, children: [_jsxs("button", { ref: button, type: "button", className: `glass ${styles.button}`, "aria-expanded": open, onClick: () => setOpen((o) => !o), children: [_jsx("span", { className: styles.icon, "data-bounce": saved > 0 || undefined, children: _jsx(Icon, { name: "save", size: 20 }) }, saved), "Salva"] }), content && createPortal(content, document.body)] }));
}
function Panel({ ref, leaving, sheet, place, videoId, onSaved, onClose, }) {
    const [state, setState] = useState({ kind: "loading" });
    const [problem, setProblem] = useState("");
    // The list just ticked or made here: only that one moves.
    const [touched, setTouched] = useState(null);
    const [made, setMade] = useState(null);
    const closeButton = useRef(null);
    // The panel lives at the end of the page, away from the button: the
    // keyboard and screen readers move into it as it opens.
    useEffect(() => {
        closeButton.current?.focus();
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        fetchPlaylists(videoId, controller.signal)
            .then((lists) => setState({ kind: "ready", lists }))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setState({ kind: "error" });
        });
        return () => controller.abort();
    }, [videoId]);
    const mark = (id, contains) => setState((s) => s.kind === "ready"
        ? { kind: "ready", lists: s.lists.map((l) => (l.id === id ? { ...l, contains } : l)) }
        : s);
    const toggle = (list) => {
        const contains = !list.contains;
        mark(list.id, contains);
        setTouched(list.id);
        if (contains)
            onSaved();
        setProblem("");
        putInPlaylist(list.id, videoId, contains).catch((error) => {
            console.error(error);
            mark(list.id, !contains);
            setProblem("Non sono riuscito a salvare. Riprova.");
        });
    };
    const created = (list) => {
        onSaved();
        setTouched(list.id);
        setMade(list.id);
        setState((s) => s.kind === "ready" ? { kind: "ready", lists: [...s.lists, { ...list, contains: true }] } : s);
    };
    const where = sheet || !place
        ? undefined
        : {
            left: place.left,
            width: place.width,
            maxHeight: place.maxHeight,
            ...("top" in place ? { top: place.top } : { bottom: place.bottom }),
        };
    return (_jsxs("div", { ref: ref, className: `glass ${sheet ? styles.sheet : styles.panel}`, style: where, "data-above": (place && "bottom" in place) || undefined, role: "dialog", "aria-label": "Salva in una playlist", "aria-modal": sheet || undefined, "data-leaving": leaving || undefined, children: [_jsxs("div", { className: styles.head, children: [_jsx("h2", { className: styles.title, children: sheet ? "Salva in una playlist" : "Salva in…" }), _jsx("button", { ref: closeButton, type: "button", className: styles.close, onClick: onClose, "aria-label": "Chiudi", children: _jsx(Icon, { name: "close", size: sheet ? 22 : 18 }) })] }), _jsxs("div", { className: styles.body, children: [state.kind === "loading" && _jsx("div", { className: styles.placeholder, "aria-busy": "true" }), state.kind === "error" && (_jsx("p", { className: styles.problem, children: "Non sono riuscito a caricare le playlist. Riprova." })), state.kind === "ready" && (_jsxs(_Fragment, { children: [_jsx("ul", { className: styles.lists, children: state.lists.map((list) => (_jsx("li", { "data-touched": list.id === touched || undefined, "data-new": list.id === made || undefined, children: _jsxs("label", { className: styles.option, children: [_jsx("input", { type: "checkbox", checked: list.contains ?? false, onChange: () => toggle(list) }), _jsx("span", { className: styles.check, "aria-hidden": "true", children: _jsx(Icon, { name: "check", size: 14 }) }), list.kind === "later" && _jsx(Icon, { name: "clock", size: 18 }), _jsx("span", { className: styles.name, children: playlistName(list) })] }) }, list.id))) }), _jsx(NewPlaylist, { videoId: videoId, onCreated: created })] }))] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), sheet && (_jsx("div", { className: styles.foot, children: _jsx("button", { type: "button", className: styles.done, onClick: onClose, children: "Fatto" }) }))] }));
}
// NewPlaylist makes a list with the video already in it.
function NewPlaylist({ videoId, onCreated, }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState("");
    if (!open) {
        return (_jsxs("button", { type: "button", className: styles.new, onClick: () => setOpen(true), children: [_jsx(Icon, { name: "plus", size: 18 }), "Nuova playlist"] }));
    }
    const create = async (event) => {
        event.preventDefault();
        if (name.trim() === "" || sending)
            return;
        setSending(true);
        setProblem("");
        try {
            const list = await createPlaylist(name);
            await putInPlaylist(list.id, videoId, true);
            onCreated({ ...list, videos: list.videos + 1 });
            setName("");
            setOpen(false);
        }
        catch (error) {
            console.error(error);
            setProblem("Non sono riuscito a creare la playlist. Riprova.");
        }
        finally {
            setSending(false);
        }
    };
    return (_jsxs("form", { className: styles.form, onSubmit: create, children: [_jsx("input", { className: styles.input, "aria-label": "Nome della nuova playlist", placeholder: "Nome della playlist", value: name, maxLength: maxNameLength, 
                // biome-ignore lint/a11y/noAutofocus: the person just asked for a new list
                autoFocus: true, onChange: (e) => setName(e.target.value) }), _jsx("button", { type: "submit", className: styles.create, disabled: name.trim() === "" || sending, children: "Crea" }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
