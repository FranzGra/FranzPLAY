import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState, } from "react";
import { clampOffset, cropRect, maxZoom, minZoom, scale } from "./crop";
import styles from "./PhotoCropper.module.css";
// The side of the round window, in screen pixels.
const view = 260;
// PhotoCropper shows the chosen picture in a round window: the person
// drags it and zooms until their face is in the middle, then saves. Arrow
// keys move it too.
export function PhotoCropper({ photo, saving, problem, onSave, onCancel, ref, leaving = false, }) {
    const [zoom, setZoom] = useState(minZoom);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const drag = useRef(null);
    const cancel = useRef(onCancel);
    cancel.current = onCancel;
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape")
                cancel.current();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    const move = (next, z = zoom) => setOffset(clampOffset(photo, view, z, next));
    const s = scale(photo, view, zoom);
    const onPointerDown = (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { start: { x: e.clientX, y: e.clientY }, from: offset };
    };
    const onPointerMove = (e) => {
        const d = drag.current;
        if (!d)
            return;
        move({ x: d.from.x + e.clientX - d.start.x, y: d.from.y + e.clientY - d.start.y });
    };
    const onPointerUp = () => {
        drag.current = null;
    };
    const onKeyDown = (e) => {
        const step = 10;
        const moves = {
            ArrowLeft: { x: step, y: 0 },
            ArrowRight: { x: -step, y: 0 },
            ArrowUp: { x: 0, y: step },
            ArrowDown: { x: 0, y: -step },
        };
        const m = moves[e.key];
        if (!m)
            return;
        e.preventDefault();
        move({ x: offset.x + m.x, y: offset.y + m.y });
    };
    return (_jsx("div", { ref: ref, className: styles.backdrop, "data-leaving": leaving || undefined, children: _jsxs("div", { className: `glass ${styles.dialog}`, role: "dialog", "aria-modal": "true", "aria-labelledby": "crop-title", children: [_jsx("h2", { id: "crop-title", className: styles.title, children: "Sistema la foto" }), _jsx("p", { className: styles.hint, children: "Trascina la foto e usa lo zoom finch\u00E9 ti piace." }), _jsx("div", { className: styles.window, style: { width: view, height: view }, 
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys move the photo
                    tabIndex: 0, "aria-label": "Foto da ritagliare: trascinala o usa le frecce", role: "img", onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerCancel: onPointerUp, onKeyDown: onKeyDown, children: _jsx("img", { src: photo.url, alt: "", draggable: false, className: styles.image, style: {
                            width: photo.width * s,
                            height: photo.height * s,
                            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                        } }) }), _jsxs("label", { className: styles.zoom, children: ["Zoom", _jsx("input", { type: "range", min: minZoom, max: maxZoom, step: 0.01, value: zoom, onChange: (e) => {
                                const z = Number(e.target.value);
                                setZoom(z);
                                move(offset, z);
                            } })] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.cancel}`, onClick: onCancel, children: "Annulla" }), _jsx("button", { type: "button", className: styles.save, disabled: saving, onClick: () => onSave(cropRect(photo, view, zoom, offset)), children: saving ? "Salvo…" : "Salva la foto" })] })] }) }));
}
