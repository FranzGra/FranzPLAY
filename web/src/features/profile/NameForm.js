import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { nameProblem, rename } from "../../api/auth";
import { ApiError } from "../../api/client";
import styles from "./ProfilePage.module.css";
// NameForm changes my name. It is also the name I log in with, so the form
// says so: next time, the old one will not work.
export function NameForm({ current, onDone, onCancel, }) {
    const [name, setName] = useState(current);
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState("");
    const send = (event) => {
        event.preventDefault();
        const mistake = nameProblem(name);
        if (mistake) {
            setProblem(mistake);
            return;
        }
        setSending(true);
        setProblem("");
        rename(name)
            .then(onDone)
            .catch((error) => {
            console.error(error);
            setProblem(explain(error));
            setSending(false);
        });
    };
    return (_jsxs("form", { className: `glass ${styles.form}`, onSubmit: send, "aria-label": "Cambia nome", children: [_jsxs("label", { className: styles.field, children: ["Nuovo nome", _jsx("input", { value: name, autoComplete: "username", maxLength: 64, 
                        // biome-ignore lint/a11y/noAutofocus: the person just asked to change it
                        autoFocus: true, onChange: (e) => setName(e.target.value) })] }), _jsx("p", { className: styles.formNote, children: "\u00C8 anche il nome con cui entri in FranzPLAY." }), problem && (_jsx("p", { role: "alert", className: styles.formProblem, children: problem })), _jsxs("div", { className: styles.formButtons, children: [_jsx("button", { type: "button", className: `glass ${styles.signOut}`, onClick: onCancel, children: "Annulla" }), _jsx("button", { type: "submit", className: styles.save, disabled: sending || name.trim() === current, children: "Salva il nome" })] })] }));
}
function explain(error) {
    if (!(error instanceof ApiError))
        return "Il server non risponde. Riprova tra poco.";
    switch (error.status) {
        case 409:
            return "Questo nome lo usa già un'altra persona.";
        case 400:
            return "Il nome può avere solo lettere, numeri, spazi, punti, trattini e trattini bassi.";
        default:
            return "Qualcosa è andato storto sul server. Riprova tra poco.";
    }
}
