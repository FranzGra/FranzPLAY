import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { deleteMe } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useAuth } from "../../app/auth";
import styles from "./ProfilePage.module.css";
// DeleteAccount removes my account for good. It first says what is lost,
// then asks for the password: a phone left on the table is not enough.
export function DeleteAccount() {
    const { sessionClosed } = useAuth();
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState("");
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState("");
    if (!open) {
        return (_jsx("button", { type: "button", className: styles.danger, onClick: () => setOpen(true), children: "Elimina il mio account" }));
    }
    const send = (event) => {
        event.preventDefault();
        setSending(true);
        setProblem("");
        deleteMe(password)
            .then(sessionClosed)
            .catch((error) => {
            console.error(error);
            setProblem(explain(error));
            setSending(false);
        });
    };
    return (_jsxs("form", { className: `glass ${styles.form} ${styles.dangerForm}`, onSubmit: send, "aria-label": "Elimina il mio account", children: [_jsx("p", { className: styles.dangerText, children: "Il tuo account sparisce per sempre, insieme a cronologia, mi piace, playlist e commenti. Non si pu\u00F2 tornare indietro. I video restano dove sono." }), _jsxs("label", { className: styles.field, children: ["Scrivi la tua password per confermare", _jsx("input", { type: "password", value: password, autoComplete: "current-password", 
                        // biome-ignore lint/a11y/noAutofocus: the person just asked to delete
                        autoFocus: true, onChange: (e) => setPassword(e.target.value) })] }), problem && (_jsx("p", { role: "alert", className: styles.formProblem, children: problem })), _jsxs("div", { className: styles.formButtons, children: [_jsx("button", { type: "button", className: `glass ${styles.signOut}`, onClick: () => {
                            setOpen(false);
                            setPassword("");
                            setProblem("");
                        }, children: "Annulla" }), _jsx("button", { type: "submit", className: styles.dangerSave, disabled: sending || password === "", children: "Elimina per sempre" })] })] }));
}
function explain(error) {
    if (!(error instanceof ApiError))
        return "Il server non risponde. Riprova tra poco.";
    switch (error.status) {
        case 403:
            return "La password non è giusta.";
        case 409:
            return "Sei l'unico amministratore: prima rendi amministratore un'altra persona.";
        case 429:
            return "Troppe password sbagliate. Aspetta un minuto e riprova.";
        default:
            return "Qualcosa è andato storto sul server. Riprova tra poco.";
    }
}
