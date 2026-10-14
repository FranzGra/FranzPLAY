import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { askSubtitles, deleteMadeSubtitles, downloadModel, fetchSubtitledVideos, fetchSubtitlesSetup, languageName, takeBackSubtitles, } from "../../api/autosubs";
import { onServerEvent } from "../../api/events";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import styles from "./Admin.module.css";
const pageSize = 50;
const filters = [
    { have: "", label: "Tutti" },
    { have: "with", label: "Con sottotitoli" },
    { have: "without", label: "Senza sottotitoli" },
];
// SubtitlesPage shows which videos have subtitles, and lets the
// administrator have whisper write new ones from the sound, and have them
// translated, as the old FranzPLAY did.
export function SubtitlesPage() {
    const [query, setQuery] = useState("");
    const [q, setQ] = useState("");
    const [have, setHave] = useState("");
    const [lang, setLang] = useState("");
    const [state, setState] = useState({ kind: "loading" });
    const shown = useRef(pageSize);
    const load = useCallback((limit, signal) => {
        Promise.all([
            fetchSubtitlesSetup(signal),
            fetchSubtitledVideos({ q, have, lang, limit }, signal),
        ])
            .then(([setup, { videos, total }]) => setState({ kind: "ready", setup, videos, total }))
            .catch((error) => {
            if (signal?.aborted)
                return;
            console.error(error);
            setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
        });
    }, [q, have, lang]);
    useEffect(() => {
        const controller = new AbortController();
        shown.current = pageSize;
        setState({ kind: "loading" });
        load(pageSize, controller.signal);
        // The work moves on in the queue: follow it.
        const stop = onServerEvent("jobs", () => load(shown.current, controller.signal));
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
        shown.current = Math.min(shown.current + pageSize, 200);
        load(shown.current);
    };
    const reload = () => load(shown.current);
    return (_jsxs(_Fragment, { children: [_jsx("p", { className: styles.lead, children: "Qui vedi quali video hanno i sottotitoli. Per quelli che non li hanno, FranzPLAY pu\u00F2 scriverli da solo ascoltando l'audio con Whisper, e poi tradurli in altre lingue. Su un computer piccolo ci vuole tempo: un film pu\u00F2 richiedere ore. Il lavoro si fa un video alla volta, quando il computer non ha altro da fare." }), state.kind === "ready" && _jsx(Setup, { setup: state.setup, onChanged: reload }), _jsxs("div", { className: styles.tools, children: [_jsx("search", { className: styles.searchForm, children: _jsx("form", { onSubmit: search, children: _jsxs("label", { className: `glass ${styles.searchBox}`, children: [_jsx(Icon, { name: "search", size: 18 }), _jsx("span", { className: "visually-hidden", children: "Cerca tra i video" }), _jsx("input", { type: "search", placeholder: "Titolo del video", value: query, onChange: (e) => setQuery(e.target.value) })] }) }) }), _jsxs("fieldset", { className: `glass ${styles.segmented}`, children: [_jsx("legend", { className: "visually-hidden", children: "Quali video" }), filters.map((f) => (_jsx("button", { type: "button", className: styles.segment, "aria-pressed": have === f.have, onClick: () => setHave(f.have), children: f.label }, f.have)))] }), _jsx(Select, { "aria-label": "Lingua dei sottotitoli", value: lang, options: [
                            { value: "", label: "Tutte le lingue" },
                            ...(state.kind === "ready" ? state.setup.languages : []).map((l) => ({
                                value: l,
                                label: languageName(l),
                            })),
                        ], onChange: setLang })] }), state.kind === "loading" && _jsx("div", { className: styles.placeholder, "aria-busy": "true" }), state.kind === "error" && (_jsx(EmptyState, { title: "Sottotitoli non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." })), state.kind === "ready" && state.videos.length === 0 && (_jsx("p", { className: styles.lead, children: "Nessun video qui." })), state.kind === "ready" && state.videos.length > 0 && (_jsxs(_Fragment, { children: [_jsxs("p", { className: styles.count, children: [state.total.toLocaleString("it-IT"), " video"] }), _jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Video", children: state.videos.map((video) => (_jsx("li", { children: _jsx(VideoRow, { video: video, setup: state.setup, onChanged: reload }) }, video.id))) }), state.videos.length < state.total && state.videos.length < 200 && (_jsx("button", { type: "button", className: `glass ${styles.action} ${styles.more}`, onClick: more, children: "Mostra altri" })), state.videos.length >= 200 && state.videos.length < state.total && (_jsx("p", { className: styles.lead, children: "Per trovare gli altri, usa la ricerca." }))] }))] }));
}
// Setup says what is missing on this computer to make subtitles, and how
// to add it.
function Setup({ setup, onChanged }) {
    if (!setup.whisper) {
        return (_jsx("div", { className: `glass ${styles.panel}`, children: _jsxs("div", { children: [_jsx("p", { className: styles.name, children: "I sottotitoli automatici sono spenti" }), _jsxs("p", { className: styles.role, children: ["Per accenderli installa whisper.cpp su questo computer, cos\u00EC che il programma", " ", _jsx("code", { children: "whisper-cli" }), " si trovi (oppure indica dov'\u00E8 nell'impostazione", " ", _jsx("code", { children: "FRANZPLAY_WHISPER" }), "), e riavvia FranzPLAY. Intanto qui vedi lo stesso quali video hanno gi\u00E0 i sottotitoli."] })] }) }));
    }
    return (_jsx("div", { className: `glass ${styles.panel}`, children: _jsxs("div", { className: styles.failed, children: [setup.models.length === 0 ? (_jsx("p", { className: styles.name, children: "Manca il modello di Whisper" })) : (_jsxs("p", { className: styles.name, children: ["Whisper \u00E8 pronto. Modelli: ", setup.models.join(", ")] })), _jsxs("p", { className: styles.role, children: ["Il modello \u00E8 \"l'orecchio\" di Whisper. FranzPLAY pu\u00F2 scaricarlo da solo qui sotto, oppure puoi mettere tu i file come ", _jsx("code", { children: "ggml-small.bin" }), " nella cartella", " ", _jsx("code", { className: styles.path, children: setup.modelsFolder }), "."] }), _jsx(Downloads, { setup: setup, onChanged: onChanged }), !setup.translator && (_jsxs("p", { className: styles.role, children: ["Per tradurre i sottotitoli serve un server LibreTranslate: scrivi il suo indirizzo nell'impostazione ", _jsx("code", { children: "FRANZPLAY_TRANSLATE_URL" }), " e riavvia FranzPLAY."] })), setup.translatorError && (_jsx("p", { role: "alert", className: styles.problem, children: setup.translatorError }))] }) }));
}
// megabytes writes a size for people: "466 MB".
function megabytes(bytes) {
    return `${Math.round(bytes / (1 << 20)).toLocaleString("it-IT")} MB`;
}
// Downloads lists the models FranzPLAY can download, and how the
// download goes.
function Downloads({ setup, onChanged }) {
    const [problem, setProblem] = useState("");
    const d = setup.download;
    const going = d !== null && !d.ended;
    if (setup.downloadable.length === 0)
        return null;
    const start = (name) => {
        setProblem("");
        downloadModel(name)
            .then(onChanged)
            .catch((error) => {
            console.error(error);
            setProblem("Non posso scaricarlo adesso: forse un altro modello sta già scaricando.");
        });
    };
    return (_jsxs(_Fragment, { children: [_jsx("ul", { className: styles.models, "aria-label": "Modelli da scaricare", children: setup.downloadable.map((m) => {
                    const here = setup.models.includes(m.name);
                    return (_jsxs("li", { className: styles.model, children: [_jsxs("span", { children: [_jsx("strong", { children: m.name }), " \u00B7 ", megabytes(m.size), _jsxs("span", { className: styles.role, children: [" ", m.about] })] }), here ? (_jsx("span", { className: styles.role, children: "Gi\u00E0 qui" })) : (_jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: going, onClick: () => start(m.name), "aria-label": `Scarica ${m.name}`, children: "Scarica" }))] }, m.name));
                }) }), d && going && (_jsxs("p", { className: styles.role, role: "status", children: ["Scarico ", d.name, ": ", megabytes(d.done), d.total > 0 && ` di ${megabytes(d.total)}`, "\u2026"] })), d?.ended && d.error === "" && (_jsxs("p", { className: styles.done, role: "status", children: [d.name, " scaricato."] })), d?.ended && d.error !== "" && (_jsxs("p", { className: styles.problem, role: "alert", children: [d.name, ": ", d.error] })), problem && (_jsx("p", { className: styles.problem, role: "alert", children: problem }))] }));
}
// sourceNames say where a subtitle comes from.
const sourceNames = {
    file: "file accanto",
    inside: "nel video",
    auto: "automatici",
};
// requestText says how the work on a video goes.
function requestText(r) {
    if (r.state === "failed")
        return "Non riuscito";
    if (r.state === "done")
        return "Pronti";
    if (r.state === "pending")
        return "In coda";
    switch (r.stage) {
        case "audio":
            return "Prendo l'audio dal video";
        case "transcribe":
            return "Whisper sta ascoltando";
        case "translate":
            return "Traduco";
        default:
            return "Al lavoro";
    }
}
function VideoRow({ video, setup, onChanged, }) {
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const [asking, setAsking] = useState(false);
    const r = video.request;
    const canAsk = setup.whisper && setup.models.length > 0;
    const run = (work) => {
        setBusy(true);
        setProblem("");
        work()
            .then(onChanged)
            .catch((error) => {
            console.error(error);
            setProblem("Non ci sono riuscito. Riprova tra poco.");
        })
            .finally(() => setBusy(false));
    };
    return (_jsxs("div", { className: `glass ${styles.person}`, children: [_jsxs("div", { className: styles.videoInfo, children: [_jsx("span", { className: styles.thumb, children: video.cover ? (_jsx("img", { src: video.cover, alt: "", loading: "lazy", decoding: "async" })) : (_jsx(Icon, { name: "subtitles", size: 18 })) }), _jsxs("div", { className: styles.failed, children: [_jsx("p", { className: styles.name, children: _jsx(Link, { to: `/video/${video.id}`, children: video.title }) }), _jsxs("p", { className: styles.badges, children: [video.subtitles.length === 0 && (_jsx("span", { className: styles.role, children: "Nessun sottotitolo" })), video.subtitles.map((s) => (_jsxs("span", { className: styles.langBadge, children: [languageName(s.lang), " \u00B7 ", s.from ? "tradotti" : sourceNames[s.source], s.source === "auto" && (_jsx("button", { type: "button", className: styles.badgeButton, "aria-label": `Cancella i sottotitoli automatici in ${languageName(s.lang).toLowerCase()}`, disabled: busy, onClick: () => run(() => deleteMadeSubtitles(video.id, s.lang)), children: _jsx(Icon, { name: "close", size: 12 }) }))] }, `${s.source}-${s.lang}-${s.from}`)))] }), r && (_jsxs("p", { className: styles.role, role: "status", children: [requestText(r), ": modello ", r.model, r.translate.length > 0 &&
                                        `, tradotti in ${r.translate.map((l) => languageName(l).toLowerCase()).join(", ")}`, "."] })), r?.state === "failed" && r.error && _jsx("p", { className: styles.error, children: r.error }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] })] }), _jsxs("div", { className: styles.buttons, children: [r?.state === "failed" && (_jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: busy || !canAsk, onClick: () => run(() => askSubtitles(video.id, {
                            spoken: r.spoken,
                            model: r.model,
                            translate: r.translate,
                        })), children: "Riprova" })), r && r.state !== "done" && (_jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: busy, onClick: () => run(() => takeBackSubtitles(video.id)), children: "Annulla" })), canAsk && !asking && (_jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: busy, onClick: () => setAsking(true), children: "Crea sottotitoli" }))] }), asking && (_jsx(AskForm, { setup: setup, video: video, onDone: () => {
                    setAsking(false);
                    onChanged();
                }, onCancel: () => setAsking(false) }))] }));
}
// AskForm asks whisper for the subtitles of one video.
function AskForm({ setup, video, onDone, onCancel, }) {
    const [spoken, setSpoken] = useState(video.request?.spoken ?? "");
    const [model, setModel] = useState(video.request && setup.models.includes(video.request.model)
        ? video.request.model
        : setup.models.includes("small")
            ? "small"
            : (setup.models[0] ?? ""));
    const [translate, setTranslate] = useState(video.request?.translate ?? []);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const canTranslate = setup.translator && setup.translatorError === "";
    const targets = setup.languages.filter((l) => l !== spoken && setup.translatorLanguages.includes(l));
    const submit = (event) => {
        event.preventDefault();
        setBusy(true);
        setProblem("");
        askSubtitles(video.id, {
            spoken,
            model,
            translate: canTranslate ? translate.filter((l) => targets.includes(l)) : [],
        })
            .then(onDone)
            .catch((error) => {
            console.error(error);
            setProblem("Non ci sono riuscito. Riprova tra poco.");
            setBusy(false);
        });
    };
    return (_jsxs("form", { className: styles.inline, onSubmit: submit, "aria-label": `Sottotitoli di ${video.title}`, children: [_jsxs("label", { className: styles.field, children: ["Lingua parlata nel video", _jsx(Select, { "aria-label": "Lingua parlata nel video", value: spoken, options: [
                            { value: "", label: "La indovina Whisper" },
                            ...setup.languages.map((l) => ({ value: l, label: languageName(l) })),
                        ], onChange: setSpoken })] }), _jsxs("label", { className: styles.field, children: ["Modello", _jsx(Select, { "aria-label": "Modello", value: model, options: setup.models.map((m) => ({ value: m, label: m })), onChange: setModel })] }), canTranslate && targets.length > 0 && (_jsxs("fieldset", { className: styles.field, children: [_jsx("legend", { children: "Traduci anche in" }), _jsx("span", { className: styles.buttons, children: targets.map((l) => (_jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", checked: translate.includes(l), onChange: (e) => setTranslate((t) => (e.target.checked ? [...t, l] : t.filter((x) => x !== l))) }), languageName(l)] }, l))) })] })), _jsxs("span", { className: styles.buttons, children: [_jsx("button", { type: "submit", className: styles.primary, disabled: busy, children: "Crea" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onCancel, children: "Lascia stare" })] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
