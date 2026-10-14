import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { createInvite, deleteInvite, fetchInvites, inviteLink, maxNoteLength, } from "../../api/invites";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatDate } from "../../lib/format";
import styles from "./Admin.module.css";
// InvitesPage lets the administrator invite family and friends: a link
// that lets one person create their own account, within 7 days.
export function InvitesPage() {
    const [state, setState] = useState({ kind: "loading" });
    const [making, setMaking] = useState(false);
    const [made, setMade] = useState(null);
    useEffect(() => {
        const controller = new AbortController();
        fetchInvites(controller.signal)
            .then((invites) => setState({ kind: "ready", invites }))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setState({ kind: "error" });
        });
        return () => controller.abort();
    }, []);
    const add = (result) => {
        setState((s) => s.kind === "ready" ? { kind: "ready", invites: [result.invite, ...s.invites] } : s);
        setMaking(false);
        setMade(result);
    };
    const remove = (id) => setState((s) => s.kind === "ready" ? { kind: "ready", invites: s.invites.filter((i) => i.id !== id) } : s);
    if (state.kind === "loading")
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    if (state.kind === "error") {
        return (_jsx(EmptyState, { title: "Inviti non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.top, children: [_jsx("p", { className: styles.lead, children: "Crea un link e mandalo a chi vuoi invitare, con un messaggio o una email. Chi lo apre sceglie da solo nome e password. Ogni link vale per una persona sola e funziona per 7 giorni." }), !making && !made && (_jsxs("button", { type: "button", className: styles.primary, onClick: () => setMaking(true), children: [_jsx(Icon, { name: "link", size: 18 }), "Crea un invito"] }))] }), making && _jsx(NewInviteForm, { onMade: add, onCancel: () => setMaking(false) }), made && _jsx(NewLink, { invite: made.invite, code: made.code, onDone: () => setMade(null) }), state.invites.length === 0 ? (!making &&
                !made && (_jsx(EmptyState, { title: "Nessun invito", children: "Qui vedrai gli inviti che crei: chi li ha usati e quali aspettano ancora." }))) : (_jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Inviti", children: state.invites.map((invite) => (_jsx("li", { children: _jsx(InviteRow, { invite: invite, onRemoved: () => remove(invite.id) }) }, invite.id))) }))] }));
}
function NewInviteForm({ onMade, onCancel, }) {
    const [note, setNote] = useState("");
    const [canUpload, setCanUpload] = useState(false);
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState("");
    const send = (event) => {
        event.preventDefault();
        setSending(true);
        setProblem("");
        createInvite(note, canUpload)
            .then(onMade)
            .catch((error) => {
            console.error(error);
            setProblem(explain(error));
            setSending(false);
        });
    };
    return (_jsxs("form", { className: `glass ${styles.panel}`, onSubmit: send, "aria-label": "Nuovo invito", children: [_jsxs("label", { className: styles.field, children: ["Per chi \u00E8 (facoltativo, ti serve per ricordarlo)", _jsx("input", { value: note, maxLength: maxNoteLength, autoComplete: "off", placeholder: "Per esempio: Nonna Maria", 
                        // biome-ignore lint/a11y/noAutofocus: the person just asked to make an invite
                        autoFocus: true, onChange: (e) => setNote(e.target.value) })] }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", checked: canUpload, onChange: (e) => setCanUpload(e.target.checked) }), "Potr\u00E0 caricare video"] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onCancel, children: "Annulla" }), _jsx("button", { type: "submit", className: styles.primary, disabled: sending, children: "Crea il link" })] })] }));
}
// NewLink shows the link of the invite just made. It is the only time it
// can be seen: FranzPLAY keeps only a fingerprint of it.
function NewLink({ invite, code, onDone }) {
    const link = inviteLink(code);
    const [copied, setCopied] = useState(false);
    // The clipboard works only on secure pages (https or this computer):
    // at home FranzPLAY is often plain http, so the link can also be selected.
    const canCopy = typeof navigator !== "undefined" && navigator.clipboard !== undefined;
    const copy = () => {
        navigator.clipboard
            .writeText(link)
            .then(() => setCopied(true))
            .catch((error) => console.error(error));
    };
    return (_jsxs("section", { className: `glass ${styles.panel}`, "aria-label": "Link dell'invito", children: [_jsx("h2", { className: styles.subheading, children: invite.note ? `Il link per ${invite.note}` : "Il link dell'invito" }), _jsxs("label", { className: styles.field, children: ["Mandalo a chi vuoi invitare", _jsx("input", { readOnly: true, value: link, onFocus: (e) => e.target.select(), className: styles.linkBox })] }), _jsx("p", { className: styles.done, children: "Copialo adesso: per sicurezza FranzPLAY non potr\u00E0 mostrarlo di nuovo. Se lo perdi, crea un invito nuovo." }), _jsxs("div", { className: styles.buttons, children: [canCopy && (_jsxs("button", { type: "button", className: styles.primary, onClick: copy, children: [_jsx(Icon, { name: copied ? "check" : "link", size: 18 }), copied ? "Copiato" : "Copia il link"] })), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onDone, children: "Fatto" })] })] }));
}
function InviteRow({ invite, onRemoved }) {
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const remove = () => {
        setBusy(true);
        setProblem("");
        deleteInvite(invite.id)
            .then(onRemoved)
            .catch((error) => {
            console.error(error);
            setProblem(explain(error));
            setBusy(false);
        });
    };
    return (_jsxs("div", { className: `glass ${styles.person}`, children: [_jsxs("div", { className: styles.who, children: [_jsx("span", { className: styles.avatar, children: _jsx(Icon, { name: invite.status === "used" ? "check" : "link", size: 20 }) }), _jsxs("div", { children: [_jsx("p", { className: styles.name, children: invite.note || "Invito senza nome" }), _jsxs("p", { className: styles.role, children: [statusText(invite), invite.canUpload && " · potrà caricare video"] })] })] }), _jsxs("button", { type: "button", className: `glass ${styles.action} ${invite.status === "waiting" ? styles.danger : ""}`, disabled: busy, onClick: remove, children: [_jsx(Icon, { name: "trash", size: 16 }), invite.status === "waiting" ? "Annulla l'invito" : "Togli dall'elenco"] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
// statusText says where an invite is, in words.
export function statusText(invite) {
    switch (invite.status) {
        case "waiting":
            return `Aspetta · funziona fino al ${formatDate(invite.expiresAt)}`;
        case "used":
            return invite.usedBy ? `Usato da ${invite.usedBy}` : "Usato";
        case "expired":
            return `Scaduto il ${formatDate(invite.expiresAt)}, senza essere usato`;
    }
}
// explain turns a refusal of the server into a sentence for people.
function explain(error) {
    if (!(error instanceof ApiError)) {
        return "Il server non risponde. Riprova tra poco.";
    }
    switch (error.status) {
        case 400:
            return `Il nome dell'invito deve stare in una riga di al massimo ${maxNoteLength} caratteri.`;
        case 404:
            return "Questo invito non c'è più: ricarica la pagina.";
        default:
            return "Qualcosa è andato storto sul server. Riprova tra poco.";
    }
}
