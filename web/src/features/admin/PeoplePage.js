import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { avatarUrl, nameProblem, passwordProblem } from "../../api/auth";
import { ApiError } from "../../api/client";
import { createUser, deleteUser, fetchUsers, resetPassword, updateUser, } from "../../api/users";
import { useAccount } from "../../app/auth";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { formatBytes, formatSince } from "../../lib/format";
import styles from "./Admin.module.css";
const byName = (a, b) => a.name.localeCompare(b.name, "it");
const gigabyte = 1024 ** 3;
// The spaces the administrator picks from, in GB, plus the one the person
// has now when it is not among them.
const quotaChoices = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000].map((gb) => gb * gigabyte);
const choicesFor = (current) => quotaChoices.includes(current) ? quotaChoices : [...quotaChoices, current].sort((a, b) => a - b);
// PeoplePage lets the administrator add people, decide what each may do,
// give a new password to who forgot theirs, and remove people.
export function PeoplePage() {
    const [state, setState] = useState({ kind: "loading" });
    const [adding, setAdding] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        fetchUsers(controller.signal)
            .then((people) => setState({ kind: "ready", people }))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setState({ kind: "error" });
        });
        return () => controller.abort();
    }, []);
    const replace = (person) => setState((s) => s.kind === "ready"
        ? {
            kind: "ready",
            people: s.people.map((p) => (p.id === person.id ? { ...p, ...person } : p)),
        }
        : s);
    const add = (person) => {
        setState((s) => s.kind === "ready"
            ? { kind: "ready", people: [...s.people, { ...person, lastLogin: null }].sort(byName) }
            : s);
        setAdding(false);
    };
    const remove = (id) => setState((s) => s.kind === "ready" ? { kind: "ready", people: s.people.filter((p) => p.id !== id) } : s);
    if (state.kind === "loading")
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    if (state.kind === "error") {
        return (_jsx(EmptyState, { title: "Elenco non disponibile", children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.top, children: [_jsx("p", { className: styles.lead, children: "Solo le persone che aggiungi qui possono entrare in FranzPLAY. Dai a ognuno il suo nome e una password: potr\u00E0 cambiarla dal suo profilo." }), !adding && (_jsxs("button", { type: "button", className: styles.primary, onClick: () => setAdding(true), children: [_jsx(Icon, { name: "plus", size: 18 }), "Aggiungi una persona"] }))] }), adding && _jsx(NewPersonForm, { onAdded: add, onCancel: () => setAdding(false) }), _jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Persone", children: state.people.map((person) => (_jsx("li", { children: _jsx(PersonRow, { person: person, onChanged: replace, onRemoved: () => remove(person.id) }) }, person.id))) })] }));
}
function NewPersonForm({ onAdded, onCancel, }) {
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [admin, setAdmin] = useState(false);
    const [canUpload, setCanUpload] = useState(false);
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState("");
    const send = (event) => {
        event.preventDefault();
        const mistake = nameProblem(name) || passwordProblem(password);
        if (mistake) {
            setProblem(mistake);
            return;
        }
        setSending(true);
        setProblem("");
        createUser({ name, password, role: admin ? "admin" : "user", canUpload })
            .then(onAdded)
            .catch((error) => {
            console.error(error);
            setProblem(explain(error));
            setSending(false);
        });
    };
    return (_jsxs("form", { className: `glass ${styles.panel}`, onSubmit: send, "aria-label": "Nuova persona", children: [_jsxs("label", { className: styles.field, children: ["Nome", _jsx("input", { value: name, autoComplete: "off", 
                        // biome-ignore lint/a11y/noAutofocus: the person just asked to add someone
                        autoFocus: true, onChange: (e) => setName(e.target.value) })] }), _jsxs("label", { className: styles.field, children: ["Password", _jsx("input", { type: "password", value: password, autoComplete: "new-password", onChange: (e) => setPassword(e.target.value) })] }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", checked: canUpload, onChange: (e) => setCanUpload(e.target.checked) }), "Pu\u00F2 caricare video"] }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", checked: admin, onChange: (e) => setAdmin(e.target.checked) }), "Amministratore"] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onCancel, children: "Annulla" }), _jsx("button", { type: "submit", className: styles.primary, disabled: sending, children: "Aggiungi" })] })] }));
}
function PersonRow({ person, onChanged, onRemoved, }) {
    const me = useAccount();
    const itsMe = person.id === me.id;
    const [asking, setAsking] = useState("nothing");
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const [done, setDone] = useState("");
    const run = (work) => {
        setBusy(true);
        setProblem("");
        setDone("");
        work()
            .catch((error) => {
            console.error(error);
            setProblem(explain(error));
        })
            .finally(() => setBusy(false));
    };
    const change = (role, canUpload, uploadQuota) => run(async () => onChanged(await updateUser(person.id, { role, canUpload, uploadQuota })));
    return (_jsxs("div", { className: `glass ${styles.person}`, children: [_jsxs("div", { className: styles.who, children: [_jsx(Avatar, { name: person.name, size: 44, photo: avatarUrl(person.id, person.avatar) }), _jsxs("div", { children: [_jsxs("p", { className: styles.name, children: [person.name, itsMe && _jsx("span", { className: styles.you, children: " (tu)" })] }), _jsxs("p", { className: styles.role, children: [person.role === "admin" ? "Amministratore" : "Utente", person.canUpload && ` · carica video, fino a ${formatBytes(person.uploadQuota)}`] }), _jsx("p", { className: styles.role, children: person.lastLogin
                                    ? `Ultimo accesso ${formatSince(person.lastLogin, new Date())}`
                                    : "Non è ancora entrato con nome e password" })] })] }), _jsxs("div", { className: `${styles.controls} ${styles.personControls}`, children: [_jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", checked: person.canUpload, disabled: busy, onChange: (e) => change(person.role, e.target.checked) }), "Pu\u00F2 caricare video"] }), person.canUpload && (_jsxs("label", { className: styles.check, children: ["Spazio", _jsx(Select, { compact: true, "aria-label": "Spazio", value: person.uploadQuota, disabled: busy, options: choicesFor(person.uploadQuota).map((bytes) => ({
                                    value: bytes,
                                    label: formatBytes(bytes),
                                })), onChange: (bytes) => change(person.role, true, bytes) })] })), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", checked: person.role === "admin", 
                                // Taking away your own role would lock you out of this page.
                                disabled: busy || itsMe, onChange: (e) => change(e.target.checked ? "admin" : "user", person.canUpload) }), "Amministratore"] }), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setAsking(asking === "password" ? "nothing" : "password"), children: "Nuova password" }), !itsMe && (_jsxs("button", { type: "button", className: `glass ${styles.action} ${styles.danger}`, onClick: () => setAsking("delete"), children: [_jsx(Icon, { name: "trash", size: 16 }), "Elimina"] }))] }), asking === "password" && (_jsx(PasswordForm, { name: person.name, onCancel: () => setAsking("nothing"), onSubmit: (password) => run(async () => {
                    await resetPassword(person.id, password);
                    setAsking("nothing");
                    setDone(`Password cambiata. Dilla a ${person.name}: dovrà entrare di nuovo.`);
                }) })), asking === "delete" && (_jsxs("div", { className: styles.confirm, children: [_jsxs("p", { children: ["Eliminare ", _jsx("strong", { children: person.name }), "? Spariscono anche i suoi commenti, mi piace, playlist e cronologia. Non si pu\u00F2 annullare."] }), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setAsking("nothing"), children: "Annulla" }), _jsx("button", { type: "button", className: `${styles.action} ${styles.danger}`, disabled: busy, onClick: () => run(async () => {
                                    await deleteUser(person.id);
                                    onRemoved();
                                }), children: "S\u00EC, elimina" })] })] })), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), done && (_jsx("p", { role: "status", className: styles.done, children: done }))] }));
}
function PasswordForm({ name, onSubmit, onCancel, }) {
    const [password, setPassword] = useState("");
    const [problem, setProblem] = useState("");
    const send = (event) => {
        event.preventDefault();
        const mistake = passwordProblem(password);
        setProblem(mistake);
        if (!mistake)
            onSubmit(password);
    };
    return (_jsxs("form", { className: styles.inline, onSubmit: send, children: [_jsxs("label", { className: styles.field, children: ["Nuova password per ", name, _jsx("input", { type: "password", value: password, autoComplete: "new-password", 
                        // biome-ignore lint/a11y/noAutofocus: the person just asked to type it
                        autoFocus: true, onChange: (e) => setPassword(e.target.value) })] }), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onCancel, children: "Annulla" }), _jsx("button", { type: "submit", className: styles.primary, children: "Salva" })] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
// explain turns a refusal of the server into a sentence for people.
function explain(error) {
    if (!(error instanceof ApiError)) {
        return "Il server non risponde. Riprova tra poco.";
    }
    switch (error.status) {
        case 400:
            return "Il nome può contenere solo lettere, numeri, spazi, punti, trattini e trattini bassi.";
        case 404:
            return "Questa persona non c'è più: ricarica la pagina.";
        case 409:
            return error.message.includes("administrator")
                ? "Deve restare almeno un amministratore."
                : "C'è già una persona con questo nome.";
        default:
            return "Qualcosa è andato storto sul server. Riprova tra poco.";
    }
}
