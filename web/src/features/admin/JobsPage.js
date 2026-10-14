import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { onServerEvent } from "../../api/events";
import { fetchJobs, retryFailedJobs, retryJob, } from "../../api/jobs";
import { EmptyState } from "../../components/EmptyState";
import { formatSince } from "../../lib/format";
import styles from "./Admin.module.css";
// kindNames say what each kind of job does, in words for people.
export const kindNames = {
    probe: "Lettura del video",
    details: "Informazioni dal file accanto",
    online: "Informazioni da internet",
    cover: "Copertina",
    preview: "Anteprime sulla barra",
    clip: "Anteprima sulla copertina",
    tracks: "Lingue e sottotitoli",
    transcribe: "Sottotitoli automatici",
    convert: "Copia per i browser",
};
// missingTool says which program a kind of job needs.
const missingTool = {
    probe: "ffprobe",
    details: "", // needs no other program: it is always available
    online: "", // the same
    cover: "ffmpeg",
    preview: "ffmpeg",
    clip: "ffmpeg",
    tracks: "ffmpeg", // and ffprobe, which "probe" already names
    transcribe: "", // optional: the Sottotitoli page explains how to turn it on
    convert: "ffmpeg",
};
// JobsPage shows the heavy work FranzPLAY does by itself: what runs now,
// how much waits, and what failed, with a button to try again. It follows
// the queue as it moves.
export function JobsPage() {
    const [state, setState] = useState({ kind: "loading" });
    const load = useCallback((signal) => {
        fetchJobs(signal)
            .then((jobs) => setState({ kind: "ready", jobs }))
            .catch((error) => {
            if (signal?.aborted)
                return;
            console.error(error);
            // A page already shown stays as it was.
            setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
        });
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        const stop = onServerEvent("jobs", () => load(controller.signal));
        return () => {
            stop();
            controller.abort();
        };
    }, [load]);
    if (state.kind === "loading")
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    if (state.kind === "error") {
        return (_jsx(EmptyState, { title: "Lavori non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    const { jobs } = state;
    const missing = [
        ...new Set(jobs.kinds
            .filter((k) => !k.available)
            .map((k) => missingTool[k.kind])
            .filter((tool) => tool !== "")),
    ];
    return (_jsxs(_Fragment, { children: [_jsx("p", { className: styles.lead, children: "Qui FranzPLAY mostra il lavoro che fa da solo per ogni video: leggerne durata e formato, prepararne la copertina e le anteprime. Ne fa uno alla volta, per non rallentare chi guarda." }), missing.length > 0 && (_jsxs("p", { className: `${styles.warning}`, role: "alert", children: ["FranzPLAY non trova ", missing.join(" e "), " su questo computer: i lavori che ne hanno bisogno aspettano finch\u00E9 non lo installi e riavvii FranzPLAY."] })), _jsxs("dl", { className: styles.stats, children: [_jsxs("div", { className: `glass ${styles.stat}`, children: [_jsx("dt", { children: "Adesso" }), _jsx("dd", { children: jobs.running ? (_jsxs(_Fragment, { children: [kindNames[jobs.running.kind], " di", " ", _jsx(Link, { to: `/video/${jobs.running.videoId}`, children: jobs.running.title })] })) : ("Niente, riposa") })] }), _jsxs("div", { className: `glass ${styles.stat}`, children: [_jsx("dt", { children: "In attesa" }), _jsxs("dd", { children: [_jsx("span", { className: styles.number, children: jobs.waiting.toLocaleString("it-IT") }), jobs.retrying > 0 && (_jsxs("span", { className: styles.note, children: [" (", jobs.retrying, " da riprovare)"] }))] })] }), _jsxs("div", { className: `glass ${styles.stat}`, children: [_jsx("dt", { children: "Fatti" }), _jsx("dd", { children: _jsx("span", { className: styles.number, children: jobs.done.toLocaleString("it-IT") }) })] }), _jsxs("div", { className: `glass ${styles.stat}`, children: [_jsx("dt", { children: "Falliti" }), _jsx("dd", { children: _jsx("span", { className: styles.number, children: jobs.failedTotal.toLocaleString("it-IT") }) })] })] }), _jsx(Failed, { jobs: jobs, onRetried: () => load() })] }));
}
function Failed({ jobs, onRetried }) {
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const run = (work) => {
        setBusy(true);
        setProblem("");
        work()
            .then(onRetried)
            .catch((error) => {
            console.error(error);
            setProblem(error instanceof ApiError && error.status === 409
                ? "Questo lavoro è già ripartito."
                : "Non sono riuscito a rimetterlo in coda. Riprova tra poco.");
            if (error instanceof ApiError)
                onRetried();
        })
            .finally(() => setBusy(false));
    };
    return (_jsxs("section", { "aria-labelledby": "failed-heading", children: [_jsxs("div", { className: styles.top, children: [_jsx("h2", { id: "failed-heading", className: styles.subheading, children: "Lavori falliti" }), jobs.failedTotal > 1 && (_jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: busy, onClick: () => run(retryFailedJobs), children: "Riprova tutti" }))] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), jobs.failed.length === 0 ? (_jsx("p", { className: styles.lead, children: "Nessun lavoro fallito. Tutto bene." })) : (_jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Lavori falliti", children: jobs.failed.map((job) => (_jsx("li", { children: _jsx(FailedJob, { job: job, busy: busy, onRetry: () => run(() => retryJob(job.id)) }) }, job.id))) })), jobs.failedTotal > jobs.failed.length && (_jsxs("p", { className: styles.lead, children: ["Ne mostro ", jobs.failed.length, " su ", jobs.failedTotal.toLocaleString("it-IT"), ": con \u00ABRiprova tutti\u00BB ripartono tutti."] }))] }));
}
function FailedJob({ job, busy, onRetry }) {
    return (_jsxs("div", { className: `glass ${styles.person}`, children: [_jsxs("div", { className: styles.failed, children: [_jsx("p", { className: styles.name, children: _jsx(Link, { to: `/video/${job.videoId}`, children: job.title }) }), _jsxs("p", { className: styles.role, children: [kindNames[job.kind], " \u00B7 ", job.attempts === 1 ? "1 tentativo" : `${job.attempts} tentativi`, " ", "\u00B7 ", formatSince(job.at, new Date())] }), _jsx("p", { className: styles.error, children: job.error })] }), _jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: busy, onClick: onRetry, children: "Riprova" })] }));
}
