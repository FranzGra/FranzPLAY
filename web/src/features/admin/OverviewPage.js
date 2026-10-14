import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchOverview } from "../../api/overview";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatBytes } from "../../lib/format";
import styles from "./Admin.module.css";
const n = (x) => x.toLocaleString("it-IT");
// OverviewPage is the administrator's summary: what needs attention, the
// numbers of the site and how much space is left on the disks.
export function OverviewPage() {
    const [state, setState] = useState({ kind: "loading" });
    useEffect(() => {
        const controller = new AbortController();
        fetchOverview(controller.signal)
            .then((overview) => setState({ kind: "ready", overview }))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setState({ kind: "error" });
        });
        return () => controller.abort();
    }, []);
    if (state.kind === "loading")
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    if (state.kind === "error") {
        return (_jsx(EmptyState, { title: "Riepilogo non disponibile", children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    const o = state.overview;
    const v = o.videos;
    return (_jsxs(_Fragment, { children: [_jsx("h2", { className: styles.groupTitle, children: "Da sistemare" }), o.problems.length === 0 ? (_jsxs("p", { className: `glass ${styles.person} ${styles.problemRow} ${styles.plain}`, children: [_jsx("span", { className: `${styles.problemMark} ${styles.allGood}`, "aria-hidden": "true", children: _jsx(Icon, { name: "check", size: 16 }) }), "Tutto a posto: non c'\u00E8 niente da sistemare."] })) : (_jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Da sistemare", children: o.problems.map((p) => (_jsxs("li", { className: `glass ${styles.person} ${styles.problemRow} ${p.severity === "critical" ? styles.critical : ""}`, children: [_jsx("span", { className: styles.problemMark, "aria-hidden": "true", children: "!" }), _jsx(ProblemText, { problem: p })] }, `${p.kind}-${p.folder}`))) })), _jsx("h2", { className: styles.groupTitle, children: "In numeri" }), _jsxs("dl", { className: styles.stats, children: [_jsxs(Stat, { label: "Video", to: "/admin/video", children: [_jsx("span", { className: styles.number, children: n(v.present) }), v.analysed > 0 && (_jsxs("span", { className: styles.note, children: [Math.round((100 * v.playable) / v.analysed), "% pronti per tutti i dispositivi"] })), v.hidden > 0 && _jsxs("span", { className: styles.note, children: [n(v.hidden), " nascosti"] })] }), _jsx(Stat, { label: "Categorie", to: "/categorie", children: _jsx("span", { className: styles.number, children: n(o.categories) }) }), _jsxs(Stat, { label: "Persone", to: "/admin/persone", children: [_jsx("span", { className: styles.number, children: n(o.people) }), _jsx("span", { className: styles.note, children: o.admins === 1 ? "1 amministratore" : `${n(o.admins)} amministratori` })] }), _jsx(Stat, { label: "Commenti", to: "/admin/commenti", children: _jsx("span", { className: styles.number, children: n(o.comments) }) }), _jsx(Stat, { label: "Lavori in attesa", to: "/admin/lavori", children: _jsx("span", { className: styles.number, children: n(o.jobs.waiting) }) })] }), _jsx("h2", { className: styles.groupTitle, children: "Spazio sui dischi" }), _jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Dischi", children: o.disks.map((d) => (_jsx("li", { className: `glass ${styles.person}`, children: _jsx(DiskRow, { disk: d }) }, d.folder))) }), _jsxs("p", { className: styles.version, children: ["FranzPLAY versione ", o.version] })] }));
}
function Stat({ label, to, children }) {
    return (_jsxs("div", { className: `glass ${styles.stat}`, children: [_jsx("dt", { children: _jsxs(Link, { to: to, className: styles.statLink, children: [label, _jsx(Icon, { name: "chevronRight", size: 14 })] }) }), _jsx("dd", { children: children })] }));
}
function DiskRow({ disk }) {
    const what = disk.data ? "Cartella dati di FranzPLAY" : "Cartella dei video";
    if (disk.error) {
        return (_jsxs("div", { children: [_jsx("p", { className: styles.name, children: what }), _jsxs("p", { className: styles.role, children: [_jsx("code", { children: disk.folder }), " \u00B7 non si riesce a leggere"] })] }));
    }
    const used = disk.total - disk.free;
    const percent = disk.total > 0 ? Math.round((100 * used) / disk.total) : 0;
    return (_jsxs("div", { className: styles.disk, children: [_jsx("p", { className: styles.name, children: what }), _jsxs("p", { className: styles.role, children: [_jsx("code", { children: disk.folder }), " \u00B7 liberi ", formatBytes(disk.free), " su ", formatBytes(disk.total)] }), _jsx("meter", { className: styles.meter, min: 0, max: 100, low: 75, high: 90, optimum: 0, value: percent, "aria-label": `${what}: ${percent}% usato` })] }));
}
// ProblemText says a problem in words, with a link to where it is fixed.
function ProblemText({ problem: p }) {
    switch (p.kind) {
        case "no_ffmpeg":
            return (_jsxs("p", { className: styles.plain, children: ["FranzPLAY non trova ffmpeg o ffprobe: i video restano senza durata, copertina e anteprime. Installali e riavvia FranzPLAY. ", _jsx(Link, { to: "/admin/lavori", children: "Vedi i lavori" })] }));
        case "disk_full":
            return (_jsxs("p", { className: styles.plain, children: ["Il disco di ", _jsx("code", { children: p.folder }), " \u00E8 quasi pieno: libera un po' di spazio."] }));
        case "disk_low":
            return (_jsxs("p", { className: styles.plain, children: ["Il disco di ", _jsx("code", { children: p.folder }), " si sta riempiendo."] }));
        case "disk_unread":
            return (_jsxs("p", { className: styles.plain, children: ["Non si riesce a leggere ", _jsx("code", { children: p.folder }), ": forse il disco non \u00E8 collegato.", " ", _jsx(Link, { to: "/admin/cartelle", children: "Vedi le cartelle" })] }));
        case "failed_jobs":
            return (_jsxs("p", { className: styles.plain, children: [p.count === 1 ? "1 lavoro non è riuscito." : `${n(p.count)} lavori non sono riusciti.`, " ", _jsx(Link, { to: "/admin/lavori", children: "Vedi i lavori" })] }));
        case "missing_videos":
            return (_jsxs("p", { className: styles.plain, children: [p.count === 1
                        ? "1 video non si trova più nelle cartelle."
                        : `${n(p.count)} video non si trovano più nelle cartelle.`, " ", "Se li hai solo spostati, FranzPLAY li ritrova da solo.", " ", _jsx(Link, { to: "/admin/cartelle", children: "Vedi le cartelle" })] }));
        case "no_covers":
            return (_jsxs("p", { className: styles.plain, children: [p.count === 1
                        ? "1 video è ancora senza copertina."
                        : `${n(p.count)} video sono ancora senza copertina.`, " ", _jsx(Link, { to: "/admin/lavori", children: "Vedi i lavori" })] }));
    }
}
