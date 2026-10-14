import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { cancelUpload, fetchMyUploads, startUpload, } from "../../api/uploads";
import { useAccount } from "../../app/auth";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatBytes } from "../../lib/format";
import { ready, sharing } from "../sharing/audience";
import { WhoSees } from "../sharing/WhoSees";
import { videoHints } from "./hints";
import { MyVideos } from "./MyVideos";
import { alreadyThere, sendFile, UploadGone } from "./sendFile";
import styles from "./UploadPage.module.css";
// The files the server takes, as the file chooser should offer them. On a
// phone "video/*" opens the gallery.
const accept = "video/*,.3g2,.3gp,.asf,.avi,.divx,.dv,.f4v,.flv,.m2ts,.m4v,.mkv,.mov,.mp4,.mpeg,.mpg,.mts,.mxf,.ogm,.ogv,.rm,.rmvb,.ts,.webm,.wmv";
const titleOf = (name) => name.replace(/\.[^.]+$/, "").trim();
// UploadPage lets a person the administrator chose put a video of theirs
// on FranzPLAY. The file goes in pieces: a dropped connection costs at
// most one piece, and an upload left half way can go on later.
export function UploadPage() {
    usePageTitle("Carica un video");
    const account = useAccount();
    const [loaded, setLoaded] = useState({ kind: "loading" });
    const [sending, setSending] = useState(null);
    // Changes when the list of my videos must be read again.
    const [version, setVersion] = useState(0);
    const stop = useRef(null);
    const reload = useCallback((signal) => {
        fetchMyUploads(signal)
            .then((mine) => setLoaded({ kind: "ready", mine }))
            .catch((error) => {
            if (signal?.aborted)
                return;
            console.error(error);
            setLoaded({ kind: "error" });
        });
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        reload(controller.signal);
        return () => controller.abort();
    }, [reload]);
    // Leaving the page stops the upload; the browser asks first.
    const busy = sending?.phase === "sending";
    useEffect(() => {
        if (!busy)
            return;
        const warn = (event) => event.preventDefault();
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [busy]);
    useEffect(() => () => stop.current?.abort(), []);
    const send = (file, upload) => {
        const controller = new AbortController();
        stop.current = controller;
        setSending({ file, upload, received: upload.received, phase: "sending", problem: "" });
        sendFile(file, upload, {
            signal: controller.signal,
            onProgress: (received) => setSending((s) => s && { ...s, received }),
        })
            .then((done) => {
            setSending((s) => s && { ...s, upload: done, received: done.size, phase: "done" });
            reload();
            setVersion((v) => v + 1);
        })
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setSending((s) => s && { ...s, phase: "failed", problem: explain(error) });
            reload();
        });
    };
    const cancel = (id) => {
        stop.current?.abort();
        setSending(null);
        cancelUpload(id)
            .catch((error) => console.error(error))
            .finally(() => reload());
    };
    if (!account.canUpload) {
        return (_jsx(EmptyState, { title: "Caricare video", headingLevel: 1, children: "Qui potrai mettere su FranzPLAY i tuoi video. Per farlo serve il permesso dell'amministratore: chiedilo a chi gestisce questo FranzPLAY." }));
    }
    if (loaded.kind === "loading")
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    if (loaded.kind === "error") {
        return (_jsx(EmptyState, { title: "Caricamento non disponibile", headingLevel: 1, children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    const { space, uploads } = loaded.mine;
    const waiting = uploads.filter((u) => u.id !== sending?.upload.id);
    return (_jsxs("div", { className: styles.root, children: [_jsxs("h1", { className: styles.heading, children: [_jsx(Icon, { name: "upload", size: 26 }), "Carica un video"] }), _jsx(SpaceBar, { used: space.used + space.reserved, quota: space.quota }), sending ? (_jsx(Progress, { sending: sending, onRetry: () => send(sending.file, sending.upload), onCancel: () => cancel(sending.upload.id), onAnother: () => setSending(null) })) : (_jsx(NewUpload, { free: Math.max(0, space.quota - space.used - space.reserved), waiting: waiting, onReady: send })), waiting.length > 0 && (_jsxs("section", { className: styles.waiting, "aria-label": "Caricamenti a met\u00E0", children: [_jsx("h2", { className: styles.subheading, children: "Caricamenti a met\u00E0" }), _jsx("p", { className: styles.note, children: "Scegli di nuovo lo stesso file per continuare da dove si era fermato. Dopo 7 giorni senza novit\u00E0 vengono cancellati." }), _jsx("ul", { className: `stagger ${styles.list}`, children: waiting.map((u) => (_jsx("li", { children: _jsx(WaitingRow, { upload: u, disabled: busy, onFile: (file) => send(file, u), onCancel: () => cancel(u.id) }) }, u.id))) })] })), _jsx(MyVideos, { version: version, onChange: () => reload() })] }));
}
function SpaceBar({ used, quota }) {
    const share = quota > 0 ? Math.min(1, used / quota) : 1;
    return (_jsxs("div", { className: styles.space, children: [_jsxs("p", { className: styles.note, children: ["Hai usato ", formatBytes(used), " di ", formatBytes(quota), "."] }), _jsx("div", { className: styles.bar, "aria-hidden": "true", children: _jsx("div", { className: styles.fill, style: { width: `${share * 100}%` } }) })] }));
}
function NewUpload({ free, waiting, onReady, }) {
    const [file, setFile] = useState(null);
    const [title, setTitle] = useState("");
    const [who, setWho] = useState({ audience: "everyone", people: [] });
    const [starting, setStarting] = useState(false);
    const [problem, setProblem] = useState("");
    const choose = (chosen) => {
        setProblem("");
        setFile(chosen ?? null);
        setTitle(chosen ? titleOf(chosen.name) : "");
    };
    const submit = (event) => {
        event.preventDefault();
        if (!file)
            return;
        if (file.size === 0) {
            setProblem("Questo file è vuoto.");
            return;
        }
        if (!ready(who)) {
            setProblem("Scegli almeno una persona che potrà vederlo.");
            return;
        }
        // The same file, already half way: it goes on from there.
        const half = waiting.find((u) => u.name === file.name && u.size === file.size);
        if (half) {
            onReady(file, half);
            return;
        }
        if (file.size > free) {
            setProblem(`Questo video è di ${formatBytes(file.size)}, ma ti restano ${formatBytes(free)}.`);
            return;
        }
        setStarting(true);
        setProblem("");
        startUpload(file, title.trim(), sharing(who))
            .then((upload) => onReady(file, upload))
            .catch((error) => {
            console.error(error);
            setProblem(explain(error));
            setStarting(false);
        });
    };
    return (_jsxs("form", { className: `glass ${styles.panel}`, onSubmit: submit, "aria-label": "Nuovo video", children: [_jsxs("label", { className: styles.picker, children: [_jsx(Icon, { name: "upload", size: 22 }), _jsx("span", { children: file ? file.name : "Scegli un video" }), file && _jsx("span", { className: styles.note, children: formatBytes(file.size) }), _jsx("input", { type: "file", accept: accept, className: styles.hiddenInput, onChange: (e) => choose(e.target.files?.[0]) })] }), file && (_jsxs("label", { className: styles.field, children: ["Titolo", _jsx("input", { value: title, maxLength: 200, onChange: (e) => setTitle(e.target.value) })] })), file && _jsx(WhoSees, { choice: who, onChange: setWho, hints: videoHints }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), _jsx("button", { type: "submit", className: styles.primary, disabled: !file || starting, children: "Carica" })] }));
}
function Progress({ sending, onRetry, onCancel, onAnother, }) {
    const { upload, received, phase, problem } = sending;
    const percent = Math.floor((received / upload.size) * 100);
    // Nothing more will arrive: the bar would only confuse.
    const over = problem === goneText || problem === alreadyText;
    return (_jsxs("section", { className: `glass ${styles.panel}`, "aria-label": upload.title, children: [_jsx("p", { className: styles.title, children: upload.title }), !over && (_jsxs(_Fragment, { children: [_jsx("progress", { className: styles.progress, max: upload.size, value: received }), _jsx("p", { className: styles.note, children: phase === "done"
                            ? `Caricato: ${formatBytes(upload.size)}.`
                            : `${percent}% · ${formatBytes(received)} di ${formatBytes(upload.size)}` })] })), phase === "sending" && (_jsx("p", { className: styles.note, children: "Tieni aperta questa pagina finch\u00E9 il caricamento non finisce." })), phase === "failed" && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), phase === "done" && upload.video !== undefined && (_jsxs("p", { role: "status", className: styles.done, children: ["Fatto! FranzPLAY prepara ora copertina e anteprime.", " ", _jsx(Link, { to: `/video/${upload.video}`, children: "Guarda il video" })] })), _jsxs("div", { className: styles.buttons, children: [phase === "failed" && !over && (_jsx("button", { type: "button", className: styles.primary, onClick: onRetry, children: "Riprova" })), phase === "done" || over ? (_jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onAnother, children: "Carica un altro video" })) : (_jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onCancel, children: "Annulla" }))] })] }));
}
function WaitingRow({ upload, disabled, onFile, onCancel, }) {
    const [problem, setProblem] = useState("");
    const percent = Math.floor((upload.received / upload.size) * 100);
    const choose = (file) => {
        if (!file)
            return;
        if (file.name !== upload.name || file.size !== upload.size) {
            setProblem(`Non è lo stesso file: scegli «${upload.name}».`);
            return;
        }
        setProblem("");
        onFile(file);
    };
    return (_jsxs("div", { className: `glass ${styles.row}`, children: [_jsxs("div", { className: styles.rowText, children: [_jsx("p", { className: styles.title, children: upload.title }), _jsxs("p", { className: styles.note, children: [upload.name, " \u00B7 fermo al ", percent, "% di ", formatBytes(upload.size)] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }), _jsxs("div", { className: styles.buttons, children: [_jsxs("label", { className: `${styles.primary} ${disabled ? styles.off : ""}`, children: ["Continua", _jsx("input", { type: "file", accept: accept, disabled: disabled, className: styles.hiddenInput, onChange: (e) => choose(e.target.files?.[0]) })] }), _jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: disabled, onClick: onCancel, children: "Annulla" })] })] }));
}
const goneText = "Questo caricamento non c'è più sul server. Se era quasi finito guarda nel tuo canale, altrimenti ricomincia.";
const alreadyText = "Questo video c'è già su FranzPLAY.";
// explain turns what went wrong into a sentence for people.
function explain(error) {
    if (error instanceof UploadGone)
        return goneText;
    if (!(error instanceof ApiError)) {
        return "La connessione si è interrotta. Quando torna, premi Riprova: si riparte da dove eri.";
    }
    switch (error.status) {
        case 403:
            return "Non puoi caricare video: lo decide l'amministratore.";
        case 400:
            if (error.message.includes("people"))
                return "Qualcuna delle persone scelte non c'è più: ricarica la pagina e scegli di nuovo.";
            if (error.message.includes("title"))
                return "Il titolo può avere al massimo 200 caratteri.";
            if (error.message.includes("name"))
                return "Il nome del file non va bene: rinominalo e riprova.";
            return "Questo file non è un video che FranzPLAY sa mostrare.";
        case 404:
            return goneText;
        case 409:
            if (error.message === alreadyThere)
                return alreadyText;
            if (error.message.includes("other uploads")) {
                return "Hai già 5 caricamenti a metà: continuane o annullane qualcuno.";
            }
            return "Il caricamento si è inceppato. Premi Riprova: si riparte da dove eri.";
        case 413:
            return "Non c'è abbastanza spazio per questo video.";
        default:
            return "Il server ha avuto un problema. Premi Riprova tra poco: si riparte da dove eri.";
    }
}
