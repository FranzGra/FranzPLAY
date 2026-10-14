import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError } from "../../api/client";
import { checkInvite, join } from "../../api/invites";
import { useAuth } from "../../app/auth";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { checkSetup, Field } from "./AuthPage";
import styles from "./AuthPage.module.css";
// JoinPage is what someone sees opening an invite link: they choose their
// name and password, and they are in. The code of the invite is after "#"
// in the address.
export function JoinPage() {
    usePageTitle("Invito");
    const { state: auth } = useAuth();
    const code = useLocation().hash.slice(1);
    const [state, setState] = useState("checking");
    useEffect(() => {
        if (code === "") {
            setState("invalid");
            return;
        }
        const controller = new AbortController();
        checkInvite(code, controller.signal)
            .then((ok) => setState(ok ? "valid" : "invalid"))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setState("offline");
        });
        return () => controller.abort();
    }, [code]);
    if (auth.kind === "signed-in") {
        return (_jsxs(Message, { title: "Sei gi\u00E0 dentro", children: ["Questo link serve a una persona nuova per creare il suo account. Tu sei gi\u00E0 dentro come", " ", auth.account.name, ": manda il link a chi vuoi invitare."] }));
    }
    switch (state) {
        case "checking":
            return _jsx("main", { className: styles.root, "aria-busy": "true" });
        case "invalid":
            return (_jsx(Message, { title: "Questo invito non funziona pi\u00F9", children: "Forse \u00E8 gi\u00E0 stato usato, \u00E8 scaduto o \u00E8 stato tolto. Chiedi un invito nuovo a chi ti ha mandato il link." }));
        case "offline":
            return (_jsx(Message, { title: "Il server non risponde", children: "Controlla di essere collegato e riapri il link tra poco." }));
        case "valid":
            return _jsx(JoinForm, { code: code });
    }
}
function JoinForm({ code }) {
    const { signedIn } = useAuth();
    const navigate = useNavigate();
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const errorId = useId();
    async function onSubmit(event) {
        event.preventDefault();
        const problem = checkSetup(name, password, confirm);
        if (problem) {
            setError(problem);
            return;
        }
        setBusy(true);
        setError("");
        try {
            const account = await join(code, name, password);
            navigate("/", { replace: true });
            signedIn(account);
        }
        catch (err) {
            setError(explain(err));
            setBusy(false);
        }
    }
    const describedBy = error ? errorId : undefined;
    return (_jsx("main", { className: styles.root, children: _jsxs("form", { className: `glass ${styles.card}`, onSubmit: onSubmit, noValidate: true, children: [_jsx("span", { className: styles.logoMark, "aria-hidden": "true", children: _jsx(Icon, { name: "play", size: 22 }) }), _jsx("h1", { className: styles.title, children: "Sei stato invitato in FranzPLAY" }), _jsx("p", { className: styles.intro, children: "Scegli il nome con cui ti vedranno gli altri e una password. Ti serviranno per entrare le prossime volte." }), _jsx(Field, { label: "Nome", value: name, onChange: setName, autoComplete: "username", describedBy: describedBy }), _jsx(Field, { label: "Password", type: "password", value: password, onChange: setPassword, autoComplete: "new-password", describedBy: describedBy }), _jsx(Field, { label: "Ripeti la password", type: "password", value: confirm, onChange: setConfirm, autoComplete: "new-password", describedBy: describedBy }), error && (_jsx("p", { id: errorId, className: styles.error, role: "alert", children: error })), _jsx("button", { type: "submit", className: styles.submit, disabled: busy, children: "Crea e entra" })] }) }));
}
function Message({ title, children }) {
    return (_jsx("main", { className: styles.root, children: _jsxs("div", { className: `glass ${styles.card}`, children: [_jsx("span", { className: styles.logoMark, "aria-hidden": "true", children: _jsx(Icon, { name: "play", size: 22 }) }), _jsx("h1", { className: styles.title, children: title }), _jsx("p", { className: styles.intro, children: children }), _jsx(Link, { to: "/", replace: true, className: `${styles.submit} ${styles.asLink}`, children: "Vai a FranzPLAY" })] }) }));
}
// explain turns a refusal of the server into a sentence for people.
function explain(error) {
    if (!(error instanceof ApiError)) {
        return "Il server non risponde. Controlla di essere collegato e riprova.";
    }
    switch (error.status) {
        case 400:
            return "Il nome può contenere solo lettere, numeri, spazi, punti, trattini e trattini bassi.";
        case 409:
            return "C'è già una persona con questo nome: scegline un altro.";
        case 410:
            return "Questo invito non funziona più: chiedine uno nuovo a chi ti ha mandato il link.";
        default:
            return "Qualcosa è andato storto sul server. Riprova tra poco.";
    }
}
