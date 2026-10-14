import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { maxMinDuration, saveMinDuration } from "../../api/library";
import styles from "./Admin.module.css";
// The minimum offered when the administrator turns the option on.
const defaultSeconds = 10;
// ShortVideosForm leaves out the videos of the folders shorter than a
// number of seconds, such as old previews. They are only left out: the
// files stay where they are, and turning the option off brings them back.
export function ShortVideosForm({ minDuration, tooShort, onSaved, }) {
    const [on, setOn] = useState(minDuration > 0);
    const [seconds, setSeconds] = useState(minDuration || defaultSeconds);
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState("");
    const send = (event) => {
        event.preventDefault();
        if (on && (seconds < 1 || seconds > maxMinDuration)) {
            setProblem(`Scegli un numero di secondi tra 1 e ${maxMinDuration}.`);
            return;
        }
        setSending(true);
        setProblem("");
        saveMinDuration(on ? seconds : 0)
            .then(onSaved)
            .catch((error) => {
            console.error(error);
            setProblem("Non si è riusciti a salvare. Riprova tra poco.");
        })
            .finally(() => setSending(false));
    };
    const unchanged = on ? seconds === minDuration : minDuration === 0;
    return (_jsxs("form", { className: `glass ${styles.rules}`, onSubmit: send, "aria-label": "Video troppo corti", noValidate: true, children: [_jsx("h2", { className: styles.name, children: "Video troppo corti" }), _jsx("p", { className: styles.role, children: "Se nelle cartelle ci sono video brevissimi che non vuoi vedere, come vecchie anteprime, FranzPLAY pu\u00F2 lasciarli fuori. Restano nella cartella e non vengono mai cancellati: se spegni l'opzione, tornano tutti. I video caricati dal browser si vedono sempre." }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", checked: on, onChange: (e) => setOn(e.target.checked) }), "Escludi i video pi\u00F9 corti di"] }), on && (_jsxs("label", { className: `${styles.field} ${styles.seconds}`, children: ["Secondi", _jsx("input", { type: "number", min: 1, max: maxMinDuration, step: 1, value: seconds, onChange: (e) => setSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0))) })] })), minDuration > 0 && (_jsx("p", { role: "status", className: styles.done, children: tooShort === 0
                    ? `Nessun video dura meno di ${minDuration} secondi.`
                    : `${tooShort.toLocaleString("it-IT")} ${tooShort === 1 ? "video non si vede perché dura" : "video non si vedono perché durano"} meno di ${minDuration} secondi. Li trovi in Video › Troppo corti.` })), _jsx("div", { className: styles.buttons, children: _jsx("button", { type: "submit", className: styles.primary, disabled: sending || unchanged, children: "Salva" }) }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
