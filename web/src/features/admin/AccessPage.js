import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { fetchLogins } from "../../api/logins";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import styles from "./Admin.module.css";
const outcomes = {
    entered: "Entrato",
    wrong_password: "Password sbagliata",
    locked: "Bloccato: troppi tentativi",
};
const when = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" });
// AccessPage is the access log: every try to log in of the last 90 days,
// the newest first, so the administrator sees who entered and notices if
// someone is guessing passwords.
export function AccessPage() {
    const [search, setSearch] = useState("");
    const [onlyFailed, setOnlyFailed] = useState(false);
    const [state, setState] = useState({ kind: "loading" });
    const [loadingMore, setLoadingMore] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        // Typing a search waits a moment, so not every letter asks the server.
        const timer = setTimeout(() => {
            fetchLogins({ search, onlyFailed }, controller.signal)
                .then((page) => setState({ kind: "ready", ...page }))
                .catch((error) => {
                if (controller.signal.aborted)
                    return;
                console.error(error);
                setState({ kind: "error" });
            });
        }, 250);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [search, onlyFailed]);
    const more = () => {
        if (state.kind !== "ready")
            return;
        setLoadingMore(true);
        fetchLogins({ search, onlyFailed, before: state.logins.at(-1)?.id })
            .then((page) => setState((s) => s.kind === "ready"
            ? { kind: "ready", logins: [...s.logins, ...page.logins], more: page.more }
            : s))
            .catch((error) => {
            console.error(error);
            setState({ kind: "error" });
        })
            .finally(() => setLoadingMore(false));
    };
    const filtering = search.trim() !== "" || onlyFailed;
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.top, children: _jsx("p", { className: styles.lead, children: "Chi ha provato a entrare negli ultimi 90 giorni, quando e da quale indirizzo. Tante password sbagliate di seguito possono voler dire che qualcuno prova a indovinarle." }) }), _jsxs("div", { className: styles.tools, children: [_jsx("search", { className: styles.searchForm, children: _jsxs("label", { className: `glass ${styles.searchBox}`, children: [_jsx(Icon, { name: "search", size: 18 }), _jsx("span", { className: "visually-hidden", children: "Cerca un nome o un indirizzo" }), _jsx("input", { type: "search", placeholder: "Nome o indirizzo", value: search, onChange: (e) => setSearch(e.target.value) })] }) }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", checked: onlyFailed, onChange: (e) => setOnlyFailed(e.target.checked) }), "Solo tentativi sbagliati"] })] }), state.kind === "loading" && _jsx("div", { className: styles.placeholder, "aria-busy": "true" }), state.kind === "error" && (_jsx(EmptyState, { title: "Registro non disponibile", children: "Il server non ha risposto. Ricarica la pagina tra poco." })), state.kind === "ready" && state.logins.length === 0 && (_jsx(EmptyState, { title: filtering ? "Nessun accesso trovato" : "Ancora nessun accesso", children: filtering
                    ? "Prova a cercare un'altra parola o togli il filtro."
                    : "Quando qualcuno entra con nome e password, compare qui." })), state.kind === "ready" && state.logins.length > 0 && (_jsxs(_Fragment, { children: [_jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Accessi", children: state.logins.map((l) => (_jsxs("li", { className: `glass ${styles.person}`, children: [_jsxs("div", { children: [_jsx("p", { className: styles.name, children: l.name || "(nessun nome)" }), _jsxs("p", { className: styles.role, children: [when.format(l.at), " \u00B7 da ", l.address] })] }), _jsx("span", { className: l.outcome === "entered" ? styles.badgeOk : styles.badge, children: outcomes[l.outcome] })] }, l.id))) }), state.more && (_jsx("button", { type: "button", className: `glass ${styles.action} ${styles.more}`, disabled: loadingMore, onClick: more, children: "Mostra altri" }))] }))] }));
}
