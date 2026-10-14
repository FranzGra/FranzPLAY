import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { fetchAdminVideos, refreshVideo, setVideoHidden, } from "../../api/adminVideos";
import { onServerEvent } from "../../api/events";
import { fetchCategories } from "../../api/videos";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatDuration } from "../../lib/format";
import { loadSetting, saveSetting } from "../../lib/storage";
import styles from "./Admin.module.css";
import { ClipForm } from "./ClipForm";
import { CoverForm } from "./CoverForm";
import { DetailsForm } from "./DetailsForm";
import { compatibility, qualityLabel } from "./quality";
import { VideoTable } from "./VideoTable";
export const adminPageSize = 50;
const viewKey = "admin.videos.view";
const parseView = (data) => (data === "table" ? "table" : "cards");
const filters = [
    { show: "", label: "Tutti" },
    { show: "hidden", label: "Nascosti" },
    { show: "missing", label: "Non trovati" },
    { show: "short", label: "Troppo corti" },
];
// VideosPage lists every video, also the hidden ones and the ones whose
// file is not found. The administrator can hide a video from everybody,
// show it again, or have its cover and previews made again.
export function VideosPage() {
    const [query, setQuery] = useState("");
    const [q, setQ] = useState("");
    const [show, setShow] = useState("");
    const [state, setState] = useState({ kind: "loading" });
    const [categories, setCategories] = useState([]);
    const [view, setView] = useState(() => loadSetting(viewKey, parseView, "cards"));
    const changeView = (next) => {
        setView(next);
        saveSetting(viewKey, next);
    };
    const shown = useRef(adminPageSize);
    // The categories in use, offered while typing a new one.
    useEffect(() => {
        const controller = new AbortController();
        fetchCategories(controller.signal)
            .then((list) => setCategories(list.map((c) => c.name)))
            .catch((error) => {
            if (!controller.signal.aborted)
                console.error(error);
        });
        return () => controller.abort();
    }, []);
    const load = useCallback((limit, signal) => {
        fetchAdminVideos({ q, show, limit }, signal)
            .then(({ videos, total }) => setState({ kind: "ready", videos, total }))
            .catch((error) => {
            if (signal?.aborted)
                return;
            console.error(error);
            setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
        });
    }, [q, show]);
    useEffect(() => {
        const controller = new AbortController();
        shown.current = adminPageSize;
        setState({ kind: "loading" });
        load(adminPageSize, controller.signal);
        const stop = onServerEvent("library", () => load(shown.current, controller.signal));
        return () => {
            stop();
            controller.abort();
        };
    }, [load]);
    const search = (event) => {
        event.preventDefault();
        setQ(query.trim());
    };
    const more = () => {
        shown.current = Math.min(shown.current + adminPageSize, 200);
        load(shown.current);
    };
    const replace = (video) => setState((s) => s.kind === "ready"
        ? { ...s, videos: s.videos.map((v) => (v.id === video.id ? video : v)) }
        : s);
    return (_jsxs(_Fragment, { children: [_jsx("p", { className: styles.lead, children: "Qui vedi tutti i video, anche quelli nascosti e quelli il cui file non si trova pi\u00F9. Un video nascosto sparisce per tutti, ma tiene mi piace, commenti e posto nelle playlist: puoi mostrarlo di nuovo quando vuoi." }), _jsxs("div", { className: styles.tools, children: [_jsx("search", { className: styles.searchForm, children: _jsx("form", { onSubmit: search, children: _jsxs("label", { className: `glass ${styles.searchBox}`, children: [_jsx(Icon, { name: "search", size: 18 }), _jsx("span", { className: "visually-hidden", children: "Cerca tra i video" }), _jsx("input", { type: "search", placeholder: "Titolo, categoria o nome del file", value: query, onChange: (e) => setQuery(e.target.value) })] }) }) }), _jsxs("fieldset", { className: `glass ${styles.segmented}`, children: [_jsx("legend", { className: "visually-hidden", children: "Quali video" }), filters.map((f) => (_jsx("button", { type: "button", className: styles.segment, "aria-pressed": show === f.show, onClick: () => setShow(f.show), children: f.label }, f.show)))] }), _jsxs("fieldset", { className: `glass ${styles.segmented}`, children: [_jsx("legend", { className: "visually-hidden", children: "Come mostrarli" }), _jsx("button", { type: "button", className: styles.segment, "aria-pressed": view === "cards", onClick: () => changeView("cards"), children: "Schede" }), _jsx("button", { type: "button", className: styles.segment, "aria-pressed": view === "table", onClick: () => changeView("table"), children: "Tabella" })] })] }), state.kind === "loading" && _jsx("div", { className: styles.placeholder, "aria-busy": "true" }), state.kind === "error" && (_jsx(EmptyState, { title: "Video non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." })), state.kind === "ready" && state.videos.length === 0 && (_jsx("p", { className: styles.lead, children: "Nessun video qui." })), state.kind === "ready" && state.videos.length > 0 && (_jsxs(_Fragment, { children: [_jsxs("p", { className: styles.count, children: [state.total.toLocaleString("it-IT"), " video"] }), _jsx("datalist", { id: "admin-categories", children: categories.map((c) => (_jsx("option", { value: c }, c))) }), view === "table" ? (_jsx(VideoTable, { videos: state.videos })) : (_jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Video", children: state.videos.map((video) => (_jsx("li", { children: _jsx(VideoRow, { video: video, onChanged: replace }) }, video.id))) })), state.videos.length < state.total && state.videos.length < 200 && (_jsx("button", { type: "button", className: `glass ${styles.action} ${styles.more}`, onClick: more, children: "Mostra altri" })), state.videos.length >= 200 && state.videos.length < state.total && (_jsx("p", { className: styles.lead, children: "Per trovare gli altri, usa la ricerca." }))] }))] }));
}
function VideoRow({ video, onChanged, }) {
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const [choosingCover, setChoosingCover] = useState(false);
    const [choosingClip, setChoosingClip] = useState(false);
    const [problem, setProblem] = useState("");
    const [done, setDone] = useState("");
    const run = (work, ok) => {
        setBusy(true);
        setProblem("");
        setDone("");
        work()
            .then(() => setDone(ok))
            .catch((error) => {
            console.error(error);
            setProblem("Non ci sono riuscito. Riprova tra poco.");
        })
            .finally(() => setBusy(false));
    };
    const quality = qualityLabel(video.height);
    const compat = compatibility(video);
    const toggle = () => run(async () => {
        await setVideoHidden(video.id, !video.hidden);
        onChanged({ ...video, hidden: !video.hidden });
    }, video.hidden ? "Di nuovo visibile a tutti." : "Nascosto a tutti.");
    return (_jsxs("div", { className: `glass ${styles.person}`, children: [_jsxs("div", { className: styles.videoInfo, children: [_jsx("span", { className: styles.thumb, children: video.cover ? (_jsx("img", { src: video.cover, alt: "", loading: "lazy", decoding: "async" })) : (_jsx(Icon, { name: "play", size: 18 })) }), _jsxs("div", { className: styles.failed, children: [_jsx("p", { className: styles.name, children: video.hidden || video.missing || video.tooShort || video.private ? (video.title) : (_jsx(Link, { to: `/video/${video.id}`, children: video.title })) }), video.uploader ? (_jsxs("p", { className: styles.role, children: [video.category && `${video.category} · `, "Caricato da ", video.uploader.name] })) : (_jsxs("p", { className: `${styles.role} ${styles.path} ${styles.oneLine}`, title: `${video.folder}/${video.path}`, children: [video.category && `${video.category} · `, video.path] })), _jsxs("p", { className: styles.badges, children: [video.hidden && _jsx("span", { className: styles.badge, children: "Nascosto" }), video.missing && _jsx("span", { className: styles.badge, children: "Non trovato" }), video.tooShort && _jsx("span", { className: styles.badge, children: "Troppo corto" }), video.private && _jsx("span", { className: styles.badge, children: "Solo per chi l'ha caricato" }), video.duration === null ? (_jsx("span", { className: styles.badge, children: "Non ancora letto" })) : (_jsx("span", { className: styles.role, children: formatDuration(video.duration) })), quality && _jsx("span", { className: styles.badgeOk, children: quality }), compat && (_jsx("span", { className: compat.ok ? styles.badgeOk : styles.badge, children: compat.label })), video.duration !== null && !video.cover && (_jsx("span", { className: styles.badge, children: "Senza copertina" })), video.coverChoice !== "" && _jsx("span", { className: styles.badgeOk, children: "Copertina scelta" }), video.clipChoice === "video" && (_jsx("span", { className: styles.badgeOk, children: "Anteprima caricata" })), video.clipChoice === "none" && _jsx("span", { className: styles.badgeOk, children: "Senza anteprima" })] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), done && (_jsx("p", { role: "status", className: styles.done, children: done }))] })] }), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.action} ${styles.small}`, "aria-expanded": editing, onClick: () => {
                            setDone("");
                            setEditing(!editing);
                        }, children: "Modifica" }), _jsx("button", { type: "button", className: `glass ${styles.action} ${styles.small}`, "aria-expanded": choosingCover, disabled: video.missing, onClick: () => {
                            setDone("");
                            setChoosingCover(!choosingCover);
                        }, children: "Copertina" }), _jsx("button", { type: "button", className: `glass ${styles.action} ${styles.small}`, "aria-expanded": choosingClip, disabled: video.missing, onClick: () => {
                            setDone("");
                            setChoosingClip(!choosingClip);
                        }, children: "Anteprima" }), _jsx("button", { type: "button", className: `glass ${styles.action} ${styles.small}`, disabled: busy || video.missing, onClick: () => run(() => refreshVideo(video.id), "In coda: copertina e anteprime arrivano tra poco."), children: "Rifai copertina" }), _jsx("button", { type: "button", className: `glass ${styles.action} ${styles.small}`, disabled: busy, onClick: toggle, children: video.hidden ? "Mostra" : "Nascondi" })] }), editing && (_jsx(DetailsForm, { video: video, onSaved: (changed) => {
                    onChanged(changed);
                    setEditing(false);
                    setDone("Salvato. Tutti vedono titolo e categoria nuovi.");
                }, onCancel: () => setEditing(false) })), choosingCover && (_jsx(CoverForm, { video: video, onChosen: (changed) => {
                    onChanged(changed);
                    setChoosingCover(false);
                    setDone("In coda: la nuova copertina arriva tra poco.");
                }, onClose: () => setChoosingCover(false) })), choosingClip && (_jsx(ClipForm, { video: video, onChosen: (changed, message) => {
                    onChanged(changed);
                    setChoosingClip(false);
                    setDone(message);
                }, onClose: () => setChoosingClip(false) }))] }));
}
