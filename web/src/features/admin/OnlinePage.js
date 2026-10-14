import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchSources, saveKey, saveSources, } from "../../api/online";
import { EmptyState } from "../../components/EmptyState";
import styles from "./Admin.module.css";
import { OnlineProposals } from "./OnlineProposals";
import { OnlineRulesForm } from "./OnlineRules";
// OnlinePage lets the administrator turn on the sources on the internet
// that give covers and details of the videos. FranzPLAY works the same
// with all of them off.
export function OnlinePage() {
    const [state, setState] = useState({ kind: "loading" });
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const [done, setDone] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        fetchSources(controller.signal)
            .then((status) => setState({ kind: "ready", status }))
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
        return (_jsx(EmptyState, { title: "Impostazioni non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    const before = state.status;
    const change = (next) => {
        setBusy(true);
        setProblem("");
        setDone("");
        saveSources(next)
            .then((status) => {
            setState({ kind: "ready", status });
            const turnedOn = (status.youtube && !before.youtube) ||
                (status.tmdb && !before.tmdb) ||
                (status.tpdb && !before.tpdb);
            setDone(turnedOn
                ? "Acceso. FranzPLAY chiede un video alla volta: lo vedi in Lavori."
                : "Salvato.");
        })
            .catch((error) => {
            console.error(error);
            setProblem("Non si è riusciti a salvare. Riprova tra poco.");
        })
            .finally(() => setBusy(false));
    };
    const keySaved = (status, source, name) => {
        setState({ kind: "ready", status });
        setProblem("");
        setDone(status[source]
            ? "Chiave salvata. FranzPLAY chiede di nuovo un video alla volta: lo vedi in Lavori."
            : `Chiave salvata. Ora puoi accendere ${name}.`);
    };
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.top, children: _jsx("p", { className: styles.lead, children: "FranzPLAY funziona anche senza internet. Se accendi una fonte, chiede copertine e informazioni dei video che riconosce. Manda solo quello che serve a trovarli (il codice del video, titolo e anno del film, o un'impronta del file), niente su di te o su chi usa FranzPLAY. Quello che c'\u00E8 nei file accanto ai video conta sempre di pi\u00F9." }) }), _jsxs("ul", { className: `stagger ${styles.list}`, "aria-label": "Fonti su internet", children: [_jsxs("li", { className: `glass ${styles.person}`, children: [_jsxs("div", { children: [_jsx("p", { className: styles.name, children: "YouTube" }), _jsxs("p", { className: styles.role, children: ["Per i video scaricati da YouTube, con il codice nel nome del file, come li salva yt-dlp: ", _jsx("code", { children: "Gita in montagna [dQw4w9WgXcQ].mp4" }), ". D\u00E0 copertina, titolo e canale. Non serve nessuna chiave."] })] }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", "aria-label": "YouTube accesa", checked: before.youtube, disabled: busy, onChange: (e) => change({ ...before, youtube: e.target.checked }) }), "Accesa"] })] }), _jsxs("li", { className: `glass ${styles.person}`, children: [_jsxs("div", { children: [_jsx("p", { className: styles.name, children: "TMDB (film)" }), _jsxs("p", { className: styles.role, children: ["Per i film con titolo e anno nel nome del file: ", _jsx("code", { children: "Il sorpasso (1962).mkv" }), " ", "oppure ", _jsx("code", { children: "The.Matrix.1999.1080p.mkv" }), ". D\u00E0 immagine, titolo, trama, regista e data di uscita. Si usa solo un film con lo stesso titolo e lo stesso anno, cos\u00EC un video di famiglia non diventa un film a caso."] }), _jsxs("p", { className: styles.role, children: ["Serve una chiave gratuita: crea un account su", " ", _jsx("a", { href: "https://www.themoviedb.org/settings/api", target: "_blank", rel: "noreferrer", children: "themoviedb.org" }), " ", "e copia la \u00ABChiave API\u00BB o il \u00ABToken di accesso in lettura\u00BB.", " ", before.tmdbKey ? "La chiave è salvata." : "Nessuna chiave salvata."] }), _jsx("p", { className: styles.role, children: "Questo prodotto usa l'API di TMDB ma non \u00E8 approvato n\u00E9 certificato da TMDB." })] }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", "aria-label": "TMDB accesa", checked: before.tmdb, disabled: busy || !before.tmdbKey, onChange: (e) => change({ ...before, tmdb: e.target.checked }) }), "Accesa"] }), _jsx(KeyForm, { source: "tmdb", name: "TMDB", hasKey: before.tmdbKey, onSaved: keySaved })] }), _jsxs("li", { className: `glass ${styles.person}`, children: [_jsxs("div", { children: [_jsx("p", { className: styles.name, children: "ThePornDB" }), _jsx("p", { className: styles.role, children: "Per qualsiasi video, di solito quelli n\u00E9 da YouTube n\u00E9 film. FranzPLAY calcola un'impronta del file (un numero che dipende solo dal suo contenuto) e manda solo quella. Si usa una scena solo se ThePornDB conosce proprio quel file. D\u00E0 immagine, titolo, descrizione, studio e data." }), _jsxs("p", { className: styles.role, children: ["Serve una chiave gratuita: crea un account su", " ", _jsx("a", { href: "https://theporndb.net/user/api-tokens", target: "_blank", rel: "noreferrer", children: "theporndb.net" }), " ", "e crea un \u00ABAPI token\u00BB.", " ", before.tpdbKey ? "La chiave è salvata." : "Nessuna chiave salvata."] })] }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", "aria-label": "ThePornDB accesa", checked: before.tpdb, disabled: busy || !before.tpdbKey, onChange: (e) => change({ ...before, tpdb: e.target.checked }) }), "Accesa"] }), _jsx(KeyForm, { source: "tpdb", name: "ThePornDB", hasKey: before.tpdbKey, onSaved: keySaved })] })] }), _jsx(OnlineRulesForm, { status: before, onSaved: (status) => {
                    setState({ kind: "ready", status });
                    setProblem("");
                    setDone("Regole salvate.");
                } }), (before.rules.confirm || before.proposals > 0) && (_jsx(OnlineProposals, { onChange: (left) => setState({ kind: "ready", status: { ...before, proposals: left } }) })), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), done && (_jsx("p", { role: "status", className: styles.done, children: done }))] }));
}
// KeyForm saves the key of a source. The key is never shown again: the
// server only says if there is one.
function KeyForm({ source, name, hasKey, onSaved, }) {
    const [key, setKey] = useState("");
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState("");
    const send = (event) => {
        event.preventDefault();
        setSending(true);
        setProblem("");
        saveKey(source, key.trim())
            .then((status) => {
            setKey("");
            onSaved(status, source, name);
        })
            .catch((error) => {
            console.error(error);
            setProblem(explainKeyError(error, name));
        })
            .finally(() => setSending(false));
    };
    return (_jsxs("form", { className: styles.inline, onSubmit: send, "aria-label": `Salva la chiave di ${name}`, children: [_jsxs("label", { className: styles.field, children: [hasKey ? `Nuova chiave di ${name}` : `Chiave di ${name}`, _jsx("input", { type: "password", value: key, autoComplete: "off", spellCheck: false, onChange: (e) => setKey(e.target.value) })] }), _jsx("button", { type: "submit", className: styles.primary, disabled: sending || key.trim() === "", children: "Prova e salva" }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
function explainKeyError(error, name) {
    if (error instanceof ApiError) {
        switch (error.status) {
            case 400:
                return `Questa non sembra una chiave di ${name}. Controlla di averla copiata tutta.`;
            case 422:
                return `${name} dice che questa chiave non è valida. Controlla di averla copiata tutta.`;
            case 502:
                return `${name} non ha risposto: forse manca internet. Riprova tra poco.`;
        }
    }
    return "Non si è riusciti a salvare. Riprova tra poco.";
}
