import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { maxNameLength } from "../../api/playlists";
import styles from "./Playlists.module.css";
// NameForm asks for the name of a list, to make it or rename it.
export function NameForm({ initial = "", submit, failure, onSubmit, onCancel, }) {
    const [name, setName] = useState(initial);
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState("");
    const empty = name.trim() === "";
    const send = (event) => {
        event.preventDefault();
        if (empty || sending)
            return;
        setSending(true);
        setProblem("");
        onSubmit(name)
            .catch((error) => {
            console.error(error);
            setProblem(failure);
        })
            .finally(() => setSending(false));
    };
    return (_jsxs("form", { className: styles.nameForm, onSubmit: send, children: [_jsx("input", { className: styles.nameInput, "aria-label": "Nome della playlist", placeholder: "Nome della playlist", value: name, maxLength: maxNameLength, 
                // biome-ignore lint/a11y/noAutofocus: the person just asked to type a name
                autoFocus: true, onChange: (e) => setName(e.target.value), onKeyDown: (e) => {
                    if (e.key === "Escape")
                        onCancel();
                } }), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onCancel, children: "Annulla" }), _jsx("button", { type: "submit", className: styles.primary, disabled: empty || sending, children: submit }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
