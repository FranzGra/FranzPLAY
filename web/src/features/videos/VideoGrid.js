import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { VideoCard } from "./VideoCard";
import styles from "./VideoGrid.module.css";
// VideoGrid shows a list of videos as a grid of cards, with a button to
// see more when there are more.
export function VideoGrid({ state, onMore, label, empty }) {
    // The same "now" for every card, so they all agree on what "today" is.
    const [now] = useState(() => new Date());
    switch (state.kind) {
        case "loading":
            return (_jsxs("div", { className: styles.grid, "aria-busy": "true", children: [_jsx("p", { className: "visually-hidden", children: "Carico i video\u2026" }), Array.from({ length: 8 }, (_, i) => (_jsx("div", { className: styles.placeholder }, i)))] }));
        case "error":
            return (_jsx(EmptyState, { title: "Video non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
        case "ready":
            if (state.videos.length === 0) {
                return _jsx(EmptyState, { title: empty.title, children: empty.text });
            }
            return (_jsxs(_Fragment, { children: [_jsx("ul", { className: `stagger ${styles.grid}`, "aria-label": label, children: state.videos.map((video) => (_jsx("li", { children: _jsx(VideoCard, { video: video, now: now }) }, video.id))) }), state.videos.length < state.total && (_jsxs("div", { className: styles.more, children: [_jsx("button", { type: "button", className: `glass ${styles.moreButton}`, onClick: onMore, disabled: state.more === "loading", children: state.more === "loading" ? "Carico…" : "Mostra altri video" }), state.more === "error" && (_jsx("p", { role: "alert", className: styles.moreError, children: "Non sono riuscito a caricare altri video. Riprova." }))] }))] }));
    }
}
