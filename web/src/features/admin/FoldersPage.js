import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { onServerEvent } from "../../api/events";
import { fetchLibrary, scanLibrary, } from "../../api/library";
import { EmptyState } from "../../components/EmptyState";
import { formatSince } from "../../lib/format";
import styles from "./Admin.module.css";
import { ShortVideosForm } from "./ShortVideosForm";
// FoldersPage shows the video folders FranzPLAY reads, how many videos
// each has, whether something is wrong with them, and how the last check
// went. The administrator can ask for a check right away, and leave out
// the videos too short to be worth showing.
export function FoldersPage() {
    const [state, setState] = useState({ kind: "loading" });
    const [asked, setAsked] = useState(false);
    const [problem, setProblem] = useState("");
    const load = useCallback((signal) => {
        fetchLibrary(signal)
            .then((library) => setState({ kind: "ready", library }))
            .catch((error) => {
            if (signal?.aborted)
                return;
            console.error(error);
            setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
        });
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        const refresh = () => load(controller.signal);
        const stopScan = onServerEvent("scan", refresh);
        const stopLibrary = onServerEvent("library", refresh);
        return () => {
            stopScan();
            stopLibrary();
            controller.abort();
        };
    }, [load]);
    if (state.kind === "loading")
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    if (state.kind === "error") {
        return (_jsx(EmptyState, { title: "Cartelle non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    const { library } = state;
    const scanNow = () => {
        setProblem("");
        setAsked(true);
        scanLibrary()
            .then(() => load())
            .catch((error) => {
            console.error(error);
            setProblem("Non sono riuscito a chiedere il controllo. Riprova tra poco.");
        })
            .finally(() => setAsked(false));
    };
    if (library.folders.length === 0) {
        return (_jsx(EmptyState, { title: "Nessuna cartella video", children: "Scrivi le cartelle dei tuoi video nell'impostazione FRANZPLAY_LIBRARIES e riavvia FranzPLAY: compariranno qui." }));
    }
    const busy = library.scanning || asked;
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.top, children: [_jsxs("p", { className: styles.lead, children: ["FranzPLAY legge queste cartelle e non le modifica mai. Le controlla da solo", " ", every(library.interval), ". Per aggiungerne o toglierne una, cambia l'impostazione FRANZPLAY_LIBRARIES e riavvia FranzPLAY."] }), _jsx("button", { type: "button", className: styles.primary, disabled: busy, onClick: scanNow, children: busy ? "Controllo in corso…" : "Controlla adesso" })] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), _jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Cartelle video", children: library.folders.map((folder) => (_jsx("li", { children: _jsx(Folder, { folder: folder }) }, folder.path))) }), library.lastScan && _jsx(LastCheck, { scan: library.lastScan }), _jsx(ShortVideosForm, { minDuration: library.minDuration, tooShort: library.tooShort, onSaved: () => load() }, library.minDuration)] }));
}
function every(seconds) {
    if (seconds === 60)
        return "ogni minuto";
    if (seconds % 60 === 0)
        return `ogni ${seconds / 60} minuti`;
    return `ogni ${seconds} secondi`;
}
function Folder({ folder }) {
    return (_jsxs("div", { className: `glass ${styles.person}`, children: [_jsxs("div", { className: styles.failed, children: [_jsx("p", { className: `${styles.name} ${styles.path}`, children: folder.path }), _jsxs("p", { className: styles.role, children: [folder.videos.toLocaleString("it-IT"), " video", folder.missing > 0 &&
                                ` · ${folder.missing.toLocaleString("it-IT")} ${folder.missing === 1 ? "non trovato" : "non trovati"}`] }), folder.problem && (_jsxs(_Fragment, { children: [_jsx("p", { className: styles.bad, children: "Non riesco a leggere tutta la cartella: finch\u00E9 non si risolve, nessun suo video viene segnato come mancante." }), _jsx("p", { className: styles.error, children: folder.problem })] })), folder.looksUnplugged && (_jsx("p", { className: styles.bad, children: "La cartella \u00E8 vuota ma aveva dei video: il disco \u00E8 collegato? Intanto nessun video viene segnato come mancante." })), folder.missing > 0 && !folder.problem && !folder.looksUnplugged && (_jsx("p", { className: styles.role, children: "I video non trovati restano nel catalogo, con i loro mi piace e commenti, per 30 giorni: se tornano, si ritrova tutto." }))] }), !folder.problem && !folder.looksUnplugged && (_jsx("span", { className: styles.good, children: "Tutto a posto" }))] }));
}
const changeNames = [
    ["added", "nuovo", "nuovi"],
    ["moved", "spostato", "spostati"],
    ["updated", "cambiato", "cambiati"],
    ["restored", "ritrovato", "ritrovati"],
    ["missing", "non trovato", "non trovati"],
    ["forgotten", "dimenticato", "dimenticati"],
    ["duplicates", "doppione ignorato", "doppioni ignorati"],
    ["problems", "problema", "problemi"],
];
// describeChanges says in words what one check found.
export function describeChanges(scan) {
    const parts = changeNames
        .filter(([key]) => scan[key] > 0)
        .map(([key, one, many]) => {
        const n = scan[key];
        return `${n.toLocaleString("it-IT")} ${n === 1 ? one : many}`;
    });
    return parts.length === 0 ? "nessun cambiamento" : parts.join(" · ");
}
// took says how long a check lasted.
export function took(seconds) {
    if (seconds < 1)
        return "in meno di un secondo";
    const n = Math.round(seconds);
    return n === 1 ? "in un secondo" : `in ${n} secondi`;
}
function LastCheck({ scan }) {
    return (_jsxs("section", { className: `glass ${styles.stat} ${styles.lastCheck}`, "aria-label": "Ultimo controllo", children: [_jsxs("p", { className: styles.role, children: ["Ultimo controllo ", formatSince(scan.at, new Date()), ", ", took(scan.seconds)] }), scan.error ? (_jsxs("p", { className: styles.bad, children: ["Il controllo non \u00E8 riuscito: ", scan.error] })) : (_jsx("p", { className: styles.name, children: describeChanges(scan) }))] }));
}
