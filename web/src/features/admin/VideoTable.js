import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from "react-router";
import { formatDuration } from "../../lib/format";
import styles from "./Admin.module.css";
import { compatibility, qualityLabel } from "./quality";
// VideoTable shows the videos as a compact table, many at a glance: what
// the file is, how sharp, and whether every browser plays it. To change a
// video, the administrator switches back to the cards.
export function VideoTable({ videos }) {
    return (_jsx("div", { className: `glass ${styles.tableBox}`, children: _jsxs("table", { className: styles.table, "aria-label": "Video", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Titolo" }), _jsx("th", { scope: "col", children: "Categoria" }), _jsx("th", { scope: "col", children: "Durata" }), _jsx("th", { scope: "col", children: "Qualit\u00E0" }), _jsx("th", { scope: "col", children: "Formato" }), _jsx("th", { scope: "col", children: "Browser" }), _jsx("th", { scope: "col", children: "Stato" })] }) }), _jsx("tbody", { children: videos.map((video) => {
                        const compat = compatibility(video);
                        return (_jsxs("tr", { children: [_jsxs("th", { scope: "row", className: styles.tableTitle, children: [video.hidden || video.missing || video.tooShort ? (video.title) : (_jsx(Link, { to: `/video/${video.id}`, children: video.title })), _jsx("span", { className: `${styles.role} ${styles.path}`, children: video.path })] }), _jsx("td", { children: video.category || "—" }), _jsx("td", { children: video.duration === null ? "—" : formatDuration(video.duration) }), _jsx("td", { children: qualityLabel(video.height) || "—" }), _jsx("td", { children: formatText(video) }), _jsx("td", { className: compat && !compat.ok ? styles.tableBad : undefined, children: compat?.label ?? "—" }), _jsx("td", { children: stateText(video) })] }, video.id));
                    }) })] }) }));
}
// formatText is the kind of file and what is inside it: "MP4 · h264 · aac".
function formatText(video) {
    return ([video.format, video.videoCodec, video.audioCodec].filter((x) => x !== "").join(" · ") || "—");
}
function stateText(video) {
    if (video.missing)
        return "Non trovato";
    if (video.hidden)
        return "Nascosto";
    if (video.tooShort)
        return "Troppo corto";
    if (video.duration === null)
        return "Da leggere";
    return "Visibile";
}
