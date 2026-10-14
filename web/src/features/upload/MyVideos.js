import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { changeMyVideo, deleteMyVideo, fetchMyVideos } from "../../api/myVideos";
import { formatBytes, formatDate } from "../../lib/format";
import { choiceOf, ready, seenBy, sharing } from "../sharing/audience";
import { WhoSees } from "../sharing/WhoSees";
import { videoHints } from "./hints";
import styles from "./MyVideos.module.css";
// MyVideos lists the videos I uploaded, with a new title, who sees it or a
// delete for each. version changes when a new one arrives, to read the list again.
export function MyVideos({ version, onChange }) {
    const [state, setState] = useState({ kind: "loading" });
    useEffect(() => {
        // version is only a signal to read the list again.
        void version;
        const controller = new AbortController();
        fetchMyVideos(controller.signal)
            .then((videos) => setState({ kind: "ready", videos }))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setState({ kind: "error" });
        });
        return () => controller.abort();
    }, [version]);
    if (state.kind === "loading")
        return null;
    if (state.kind === "error") {
        return (_jsx("p", { role: "alert", className: styles.problem, children: "L'elenco dei tuoi video non \u00E8 disponibile: ricarica la pagina tra poco." }));
    }
    const replace = (video) => setState((s) => s.kind === "ready"
        ? { kind: "ready", videos: s.videos.map((v) => (v.id === video.id ? video : v)) }
        : s);
    const remove = (id) => {
        setState((s) => s.kind === "ready" ? { kind: "ready", videos: s.videos.filter((v) => v.id !== id) } : s);
        onChange();
    };
    return (_jsxs("section", { className: styles.root, "aria-label": "I tuoi video", children: [_jsx("h2", { className: styles.heading, children: "I tuoi video" }), state.videos.length === 0 ? (_jsx("p", { className: styles.note, children: "Qui compariranno i video che carichi, con i tasti per cambiare titolo, decidere chi li vede o eliminarli." })) : (_jsx("ul", { className: `stagger ${styles.list}`, children: state.videos.map((video) => (_jsx("li", { children: _jsx(VideoRow, { video: video, onChanged: replace, onDeleted: () => remove(video.id) }) }, video.id))) }))] }));
}
function VideoRow({ video, onChanged, onDeleted, }) {
    const [asking, setAsking] = useState("nothing");
    const [who, setWho] = useState(() => choiceOf(video.private, video.sharedWith));
    const [title, setTitle] = useState(video.title);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const run = (work) => {
        setBusy(true);
        setProblem("");
        work()
            .catch((error) => {
            console.error(error);
            setProblem(explain(error));
        })
            .finally(() => setBusy(false));
    };
    const rename = (event) => {
        event.preventDefault();
        const clean = title.trim();
        if (clean === "") {
            setProblem("Il titolo non può essere vuoto.");
            return;
        }
        run(async () => {
            onChanged(await changeMyVideo(video.id, { title: clean }));
            setAsking("nothing");
        });
    };
    return (_jsxs("div", { className: `glass ${styles.row}`, children: [_jsx(Link, { to: `/video/${video.id}`, className: styles.cover, tabIndex: -1, "aria-hidden": "true", children: video.cover && _jsx("img", { src: video.cover, alt: "", loading: "lazy" }) }), _jsxs("div", { className: styles.text, children: [_jsx(Link, { to: `/video/${video.id}`, className: styles.title, children: video.title }), _jsxs("p", { className: styles.note, children: [formatDate(video.addedAt), " \u00B7 ", formatBytes(video.size), ` · ${seenBy(video.private, video.sharedWith)}`, video.hidden && " · nascosto dall'amministratore"] }), asking === "title" && (_jsxs("form", { className: styles.inline, onSubmit: rename, "aria-label": "Nuovo titolo", children: [_jsx("input", { value: title, maxLength: 200, "aria-label": "Titolo", 
                                // biome-ignore lint/a11y/noAutofocus: the person just asked to change it
                                autoFocus: true, onChange: (e) => setTitle(e.target.value) }), _jsx("button", { type: "submit", className: styles.primary, disabled: busy, children: "Salva" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => {
                                    setTitle(video.title);
                                    setAsking("nothing");
                                }, children: "Annulla" })] })), asking === "delete" && (_jsxs("div", { className: styles.confirm, children: [_jsxs("p", { children: ["Eliminare ", _jsx("strong", { children: video.title }), "? Spariscono il file, i mi piace e i commenti. Non si pu\u00F2 annullare."] }), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setAsking("nothing"), children: "Annulla" }), _jsx("button", { type: "button", className: `${styles.action} ${styles.danger}`, disabled: busy, onClick: () => run(async () => {
                                            await deleteMyVideo(video.id);
                                            onDeleted();
                                        }), children: "S\u00EC, elimina" })] })] })), asking === "nothing" && (_jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setAsking("title"), children: "Cambia titolo" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => {
                                    setWho(choiceOf(video.private, video.sharedWith));
                                    setAsking("who");
                                }, children: "Chi lo vede" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setAsking("delete"), children: "Elimina" })] })), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }), asking === "who" && (_jsxs("form", { className: styles.who, "aria-label": "Chi lo vede", onSubmit: (event) => {
                    event.preventDefault();
                    if (!ready(who)) {
                        setProblem("Scegli almeno una persona che potrà vederlo.");
                        return;
                    }
                    run(async () => {
                        onChanged(await changeMyVideo(video.id, sharing(who)));
                        setAsking("nothing");
                    });
                }, children: [_jsx(WhoSees, { choice: who, onChange: setWho, hints: videoHints }), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "submit", className: styles.primary, disabled: busy, children: "Salva" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => {
                                    setProblem("");
                                    setAsking("nothing");
                                }, children: "Annulla" })] })] }))] }));
}
function explain(error) {
    if (!(error instanceof ApiError))
        return "Il server non risponde. Riprova tra poco.";
    switch (error.status) {
        case 400:
            if (error.message.includes("people"))
                return "Qualcuna delle persone scelte non c'è più: ricarica la pagina e scegli di nuovo.";
            return "Il titolo può avere al massimo 200 caratteri, su una riga.";
        case 404:
            return "Questo video non c'è più: ricarica la pagina.";
        default:
            return "Qualcosa è andato storto sul server. Riprova tra poco.";
    }
}
