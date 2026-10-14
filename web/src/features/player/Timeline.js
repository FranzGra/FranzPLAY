import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { formatDuration } from "../../lib/format";
import { previewFrame, timeAt } from "./controls";
import styles from "./Player.module.css";
// Timeline is the big bar under the video: it shows how far the video is
// and how much is downloaded. Drag or click it to jump; it grows under the
// pointer and shows the time it points at, with a small frame of the
// video there when the previews are ready.
export function Timeline({ time, duration, buffered, onSeek, preview }) {
    const bar = useRef(null);
    const [hover, setHover] = useState(null);
    const [dragging, setDragging] = useState(false);
    function pointTime(event) {
        const rect = bar.current?.getBoundingClientRect();
        return rect ? timeAt(event.clientX, rect.left, rect.width, duration) : 0;
    }
    function onPointerDown(event) {
        if (event.button !== 0)
            return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
        onSeek(pointTime(event));
    }
    function onPointerMove(event) {
        const t = pointTime(event);
        setHover(t);
        if (dragging)
            onSeek(t);
    }
    function onPointerUp(event) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        setDragging(false);
    }
    const known = Number.isFinite(duration) && duration > 0;
    const percent = (t) => (known ? `${Math.min((t / duration) * 100, 100)}%` : "0%");
    return (_jsxs("div", { ref: bar, className: styles.timeline, "data-active": dragging || hover !== null ? "" : undefined, role: "slider", tabIndex: 0, "aria-label": "Posizione nel video", "aria-valuemin": 0, "aria-valuemax": known ? Math.floor(duration) : 0, "aria-valuenow": Math.floor(time), "aria-valuetext": `${formatDuration(time)} di ${known ? formatDuration(duration) : "durata sconosciuta"}`, onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerCancel: onPointerUp, onPointerLeave: () => setHover(null), children: [_jsxs("div", { className: styles.track, children: [_jsx("div", { className: styles.buffered, style: { width: percent(buffered) } }), hover !== null && _jsx("div", { className: styles.hovered, style: { width: percent(hover) } }), _jsx("div", { className: styles.played, style: { width: percent(time) } })] }), _jsx("div", { className: styles.thumb, style: { left: percent(time) } }), hover !== null && known && !preview && (_jsx("div", { className: styles.tooltip, style: { left: percent(hover) }, "aria-hidden": "true", children: formatDuration(hover) })), hover !== null && known && preview && (_jsx(PreviewFrame, { preview: preview, time: hover, left: percent(hover) }))] }));
}
// PreviewFrame is the small frame of the video above the timeline, kept
// inside the player at both ends. Its width comes from the style sheet
// (smaller on phones); the image is made with sharper frames than that,
// so it looks crisp on screens with more pixels per point.
function PreviewFrame({ preview, time, left }) {
    const { position, size } = previewFrame(preview, time);
    return (_jsxs("div", { className: styles.frame, style: { left: `clamp(var(--preview-half), ${left}, calc(100% - var(--preview-half)))` }, "aria-hidden": "true", "data-testid": "preview", children: [_jsx("div", { className: styles.frameImage, style: {
                    aspectRatio: `${preview.width} / ${preview.height}`,
                    backgroundImage: `url("${preview.src}")`,
                    backgroundPosition: position,
                    backgroundSize: size,
                } }), _jsx("span", { className: styles.frameTime, children: formatDuration(time) })] }));
}
