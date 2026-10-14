import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatDay } from "../../lib/format";
import { removeAllSmoothly, removeSmoothly } from "../../lib/motion";
import { RemovableCard } from "../videos/RemovableCard";
import { VideoCard } from "../videos/VideoCard";
import styles from "./HistoryPage.module.css";
import { useHistory } from "./useHistory";
// HistoryPage lists the videos the person watched, most recent first,
// grouped by day. Each can be removed, or the whole history emptied: what
// goes fades away and what stays glides into its place.
export function HistoryPage() {
    usePageTitle("Cronologia");
    const { state, loadMore, forget, drop, clear, empty } = useHistory();
    const [now] = useState(() => new Date());
    const [problem, setProblem] = useState("");
    const run = (action, failure) => {
        setProblem("");
        action().catch((error) => {
            console.error(error);
            setProblem(failure);
        });
    };
    return (_jsxs("div", { className: styles.page, children: [_jsxs("div", { className: styles.top, children: [_jsxs("h1", { className: styles.heading, children: [_jsx(Icon, { name: "history", size: 26 }), "Cronologia"] }), state.kind === "ready" && state.items.length > 0 && (_jsx(ClearButton, { onClear: () => run(() => removeAllSmoothly(document.querySelectorAll("[data-history-item]"), clear, empty), "Non sono riuscito a cancellare la cronologia. Riprova.") }))] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), state.kind === "loading" && _jsx("div", { className: styles.placeholder, "aria-busy": "true" }), state.kind === "error" && (_jsx(EmptyState, { title: "Cronologia non disponibile", children: "Il server non ha risposto. Ricarica la pagina tra poco." })), state.kind === "ready" && state.items.length === 0 && (_jsx(EmptyState, { title: "Nessun video visto", children: "I video che guardi compariranno qui, dal pi\u00F9 recente, cos\u00EC ritrovi facilmente quello che hai visto." })), state.kind === "ready" &&
                byDay(state.items, now).map(({ day, items }) => (_jsxs("section", { className: styles.day, "aria-label": day, children: [_jsx("h2", { className: styles.dayTitle, "data-flip": true, children: day }), _jsx("ul", { className: `stagger ${styles.list}`, children: items.map((w) => (_jsx("li", { "data-flip": true, "data-history-item": true, children: _jsx(RemovableCard, { card: _jsx(VideoCard, { video: w.video, now: now, layout: "row", position: w.finished ? (w.video.duration ?? undefined) : w.position }), label: `Togli «${w.video.title}» dalla cronologia`, title: "Togli dalla cronologia", onRemove: (event) => {
                                        const item = event.currentTarget.closest("li");
                                        run(() => removeSmoothly(item, () => forget(w.video.id), () => drop(w.video.id)), "Non sono riuscito a togliere il video dalla cronologia. Riprova.");
                                    } }) }, w.video.id))) })] }, day))), state.kind === "ready" && state.items.length < state.total && (_jsxs("div", { className: styles.more, "data-flip": true, children: [_jsx("button", { type: "button", className: `glass ${styles.moreButton}`, onClick: loadMore, disabled: state.more === "loading", children: state.more === "loading" ? "Carico…" : "Mostra altri video" }), state.more === "error" && (_jsx("p", { role: "alert", className: styles.problem, children: "Non sono riuscito a caricare altri video. Riprova." }))] }))] }));
}
// ClearButton asks once more before emptying the whole history.
function ClearButton({ onClear }) {
    const [asking, setAsking] = useState(false);
    if (!asking) {
        return (_jsxs("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setAsking(true), children: [_jsx(Icon, { name: "trash", size: 18 }), "Cancella cronologia"] }));
    }
    return (_jsxs("div", { className: styles.confirm, children: [_jsx("span", { children: "Cancellare tutta la cronologia?" }), _jsx("button", { type: "button", className: `${styles.action} ${styles.danger}`, onClick: () => {
                    setAsking(false);
                    onClear();
                }, children: "S\u00EC, cancella" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setAsking(false), children: "Annulla" })] }));
}
// byDay groups the history by the day each video was watched, keeping
// the order.
export function byDay(items, now) {
    const groups = [];
    for (const w of items) {
        const day = formatDay(w.watchedAt, now);
        const last = groups.at(-1);
        if (last?.day === day) {
            last.items.push(w);
        }
        else {
            groups.push({ day, items: [w] });
        }
    }
    return groups;
}
