import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { fetchRegistration, saveRegistration } from "../../api/auth";
import { ApiError } from "../../api/client";
import { lookProblem, saveLook } from "../../api/site";
import { useSite } from "../../app/site";
import { EmptyState } from "../../components/EmptyState";
import styles from "./Admin.module.css";
import { LookFields } from "./LookFields";
// SitePage holds the settings of the whole site: its name and color, and
// whether anyone may create an account by themselves.
export function SitePage() {
    return (_jsxs(_Fragment, { children: [_jsx(LookSettings, {}), _jsx(RegistrationSettings, {})] }));
}
// LookSettings changes the name and color everybody sees. The form opens
// once the site's look has arrived, so it starts from the saved one.
function LookSettings() {
    const { ready } = useSite();
    if (!ready)
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    return _jsx(LookForm, {});
}
function LookForm() {
    const site = useSite();
    const [look, setLook] = useState(site.look);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const [done, setDone] = useState("");
    const send = (event) => {
        event.preventDefault();
        const mistake = lookProblem(look);
        if (mistake) {
            setProblem(mistake);
            return;
        }
        setBusy(true);
        setProblem("");
        setDone("");
        saveLook(look)
            .then((saved) => {
            site.changed(saved);
            setDone("Salvato. Tutti vedono il nome e il colore nuovi.");
        })
            .catch((error) => {
            console.error(error);
            setProblem(error instanceof ApiError && error.status === 400
                ? "Il nome o il colore non vanno bene: controlla e riprova."
                : "Non si è riusciti a salvare. Riprova tra poco.");
        })
            .finally(() => setBusy(false));
    };
    const unchanged = look.nameFirst === site.look.nameFirst &&
        look.nameSecond === site.look.nameSecond &&
        look.color.toLowerCase() === site.look.color;
    return (_jsxs(_Fragment, { children: [_jsx("h2", { className: styles.groupTitle, children: "Nome e colore" }), _jsxs("form", { className: `glass ${styles.person}`, onSubmit: send, "aria-label": "Nome e colore del sito", children: [_jsx("p", { className: styles.role, children: "Il nome compare in alto, nella pagina di accesso e nel titolo della scheda del browser. Il colore \u00E8 quello di pulsanti e collegamenti." }), _jsx(LookFields, { look: look, onChange: setLook }), _jsx("button", { type: "submit", className: styles.primary, disabled: busy || unchanged, children: "Salva nome e colore" }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), done && (_jsx("p", { role: "status", className: styles.done, children: done }))] })] }));
}
// RegistrationSettings decides whether anyone may create an account by
// themselves.
function RegistrationSettings() {
    const [state, setState] = useState({ kind: "loading" });
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const [done, setDone] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        fetchRegistration(controller.signal)
            .then((open) => setState({ kind: "ready", open }))
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
    const change = (open) => {
        setBusy(true);
        setProblem("");
        setDone("");
        saveRegistration(open)
            .then((saved) => {
            setState({ kind: "ready", open: saved });
            setDone(saved
                ? "Registrazione aperta. Nella pagina di accesso c'è il tasto «Registrati»."
                : "Registrazione chiusa. Si entra solo con un invito o se aggiungi tu la persona.");
        })
            .catch((error) => {
            console.error(error);
            setProblem("Non si è riusciti a salvare. Riprova tra poco.");
        })
            .finally(() => setBusy(false));
    };
    return (_jsxs(_Fragment, { children: [_jsx("h2", { className: styles.groupTitle, children: "Accesso al sito" }), _jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Accesso al sito", children: _jsxs("li", { className: `glass ${styles.person}`, children: [_jsxs("div", { children: [_jsx("p", { className: styles.name, children: "Chiunque pu\u00F2 registrarsi" }), _jsx("p", { className: styles.role, children: "Se \u00E8 acceso, chi apre FranzPLAY pu\u00F2 crearsi un account da solo, senza invito. Le persone nuove sono utenti normali e non possono caricare video: lo decidi tu in Persone. Se \u00E8 spento, si entra solo con un invito o se aggiungi tu la persona." })] }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", "aria-label": "Chiunque pu\u00F2 registrarsi", checked: state.open, disabled: busy, onChange: (e) => change(e.target.checked) }), "Acceso"] })] }) }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), done && (_jsx("p", { role: "status", className: styles.done, children: done }))] }));
}
