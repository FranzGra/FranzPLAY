import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useState } from "react";
import { login, nameProblem, passwordProblem, register, setup } from "../../api/auth";
import { ApiError } from "../../api/client";
import { lookProblem, saveLook, siteName } from "../../api/site";
import { useAuth } from "../../app/auth";
import { useSite } from "../../app/site";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { LookFields } from "../admin/LookFields";
import styles from "./AuthPage.module.css";
function title(mode, name) {
    switch (mode) {
        case "login":
            return `Accedi a ${name}`;
        case "setup":
            return "Benvenuto in FranzPLAY";
        case "register":
            return "Crea il tuo account";
    }
}
// AuthPage is what people see before logging in: the login form, or, on a
// brand new FranzPLAY, the form that creates the administrator (asking for
// the code in the log only when the installer turned it on). When the
// administrator lets anyone register, the login form also offers to
// create an account.
export function AuthPage({ mode: startMode, setupCode = false, openRegistration = false, }) {
    const [mode, setMode] = useState(startMode);
    usePageTitle({ login: "Accedi", setup: "Benvenuto", register: "Registrati" }[mode]);
    const { signedIn } = useAuth();
    const site = useSite();
    const look = site.look;
    // At the first setup the administrator can also name the site.
    const [newLook, setNewLook] = useState(look);
    const [code, setCode] = useState("");
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const errorId = useId();
    async function onSubmit(event) {
        event.preventDefault();
        const problem = mode === "login"
            ? ""
            : checkSetup(name, password, confirm) || (mode === "setup" ? lookProblem(newLook) : "");
        if (problem) {
            setError(problem);
            return;
        }
        setBusy(true);
        setError("");
        try {
            const account = mode === "setup"
                ? await setup(setupCode ? code : "", name, password)
                : mode === "register"
                    ? await register(name, password)
                    : await login(name, password);
            if (mode === "setup") {
                await keepLook(newLook);
            }
            signedIn(account);
        }
        catch (err) {
            setError(explain(err, mode));
            setBusy(false);
        }
    }
    // keepLook saves the name and color chosen at the first setup. The
    // administrator is already created: if this fails, FranzPLAY keeps its
    // own name, which can be changed later in Amministrazione › Sito.
    async function keepLook(chosen) {
        const same = chosen.nameFirst === look.nameFirst &&
            chosen.nameSecond === look.nameSecond &&
            chosen.color.toLowerCase() === look.color;
        if (same)
            return;
        try {
            site.changed(await saveLook(chosen));
        }
        catch (err) {
            console.error(err);
        }
    }
    const describedBy = error ? errorId : undefined;
    return (_jsx("main", { className: styles.root, children: _jsxs("form", { className: `glass ${styles.card}`, onSubmit: onSubmit, noValidate: true, children: [_jsx("span", { className: styles.logoMark, "aria-hidden": "true", children: _jsx(Icon, { name: "play", size: 22 }) }), _jsx("h1", { className: styles.title, children: title(mode, siteName(look)) }), mode === "setup" && (_jsxs("p", { className: styles.intro, children: ["Crea l'amministratore, cio\u00E8 il tuo utente: potrai gestire video, persone e impostazioni.", setupCode && (_jsxs(_Fragment, { children: [" ", "Il codice di installazione \u00E8 scritto nel terminale dove hai avviato FranzPLAY, alla voce ", _jsx("code", { children: "setup_code" }), "."] }))] })), mode === "register" && (_jsx("p", { className: styles.intro, children: "Scegli il nome e la password con cui entrerai in FranzPLAY." })), mode === "setup" && setupCode && (_jsx(Field, { label: "Codice di installazione", value: code, onChange: setCode, autoComplete: "off", placeholder: "XXXX-XXXX-XXXX", describedBy: describedBy })), _jsx(Field, { label: "Nome", value: name, onChange: setName, autoComplete: "username", describedBy: describedBy }), _jsx(Field, { label: "Password", type: "password", value: password, onChange: setPassword, autoComplete: mode === "login" ? "current-password" : "new-password", describedBy: describedBy }), mode !== "login" && (_jsx(Field, { label: "Ripeti la password", type: "password", value: confirm, onChange: setConfirm, autoComplete: "new-password", describedBy: describedBy })), mode === "setup" && (_jsxs("section", { className: styles.siteLook, "aria-label": "Il tuo sito", children: [_jsx("p", { className: styles.intro, children: "Come si chiama il tuo sito? Puoi lasciarlo cos\u00EC e cambiarlo quando vuoi in Amministrazione." }), _jsx(LookFields, { look: newLook, onChange: setNewLook })] })), error && (_jsx("p", { id: errorId, className: styles.error, role: "alert", children: error })), _jsx("button", { type: "submit", className: styles.submit, disabled: busy, children: mode === "login" ? "Entra" : "Crea e entra" }), openRegistration && mode !== "setup" && (_jsxs("p", { className: styles.switch, children: [mode === "login" ? "Non hai un account?" : "Hai già un account?", " ", _jsx("button", { type: "button", className: styles.link, onClick: () => {
                                setMode(mode === "login" ? "register" : "login");
                                setError("");
                                setConfirm("");
                            }, children: mode === "login" ? "Registrati" : "Accedi" })] }))] }) }));
}
export function Field({ label, value, onChange, type = "text", autoComplete, placeholder, describedBy, }) {
    return (_jsxs("label", { className: styles.field, children: [_jsx("span", { className: styles.label, children: label }), _jsx("input", { className: styles.input, type: type, value: value, autoComplete: autoComplete, placeholder: placeholder, "aria-describedby": describedBy, autoCapitalize: "none", spellCheck: false, required: true, onChange: (event) => onChange(event.target.value) })] }));
}
// checkSetup finds mistakes before asking the server.
export function checkSetup(name, password, confirm) {
    const problem = nameProblem(name) || passwordProblem(password);
    if (problem) {
        return problem;
    }
    if (password !== confirm) {
        return "Le due password non sono uguali.";
    }
    return "";
}
// explain turns a refusal of the server into a sentence for people.
function explain(error, mode) {
    if (!(error instanceof ApiError)) {
        return "Il server non risponde. Controlla che FranzPLAY sia acceso e riprova.";
    }
    switch (error.status) {
        case 400:
            return mode === "login"
                ? "Scrivi nome e password."
                : "Il nome può contenere solo lettere, numeri, spazi, punti, trattini e trattini bassi.";
        case 401:
            return mode === "setup"
                ? "Il codice di installazione non è giusto. Copialo dal terminale."
                : "Nome o password sbagliati.";
        case 403:
            if (mode !== "register" || error.message === "request from another site") {
                return "Il server ha rifiutato la richiesta perché arriva da un indirizzo diverso da quello del sito. Se usi un proxy, controlla che passi l'indirizzo giusto.";
            }
            return "La registrazione è chiusa: per entrare chiedi un invito a chi gestisce FranzPLAY.";
        case 409:
            return mode === "register"
                ? "Questo nome lo usa già un'altra persona: scegline un altro."
                : "FranzPLAY ha già un amministratore: ricarica la pagina per accedere.";
        case 429:
            return mode === "register"
                ? "Troppi account nuovi da questa rete. Aspetta qualche minuto e riprova."
                : "Troppe password sbagliate. Aspetta un minuto e riprova.";
        default:
            return "Qualcosa è andato storto sul server. Riprova tra poco.";
    }
}
