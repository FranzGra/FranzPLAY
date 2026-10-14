import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { saveRules } from "../../api/online";
import { Select } from "../../components/Select";
import styles from "./Admin.module.css";
const names = {
    youtube: "YouTube",
    tmdb: "TMDB (film)",
    tpdb: "ThePornDB",
};
const hours = Array.from({ length: 24 }, (_, h) => h);
function hourText(h) {
    return `${String(h).padStart(2, "0")}:00`;
}
const hourOptions = hours.map((h) => ({ value: h, label: hourText(h) }));
// OnlineRulesForm sets when FranzPLAY may ask the internet, how many
// videos a day, and which source it asks first.
export function OnlineRulesForm({ status, onSaved, }) {
    const [rules, setRules] = useState(status.rules);
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState("");
    const anyTime = rules.from === rules.to;
    const move = (index, by) => {
        const order = [...rules.order];
        const [source] = order.splice(index, 1);
        if (!source)
            return;
        order.splice(index + by, 0, source);
        setRules({ ...rules, order });
    };
    const send = (event) => {
        event.preventDefault();
        setSending(true);
        setProblem("");
        saveRules(rules)
            .then(onSaved)
            .catch((error) => {
            console.error(error);
            setProblem("Non si è riusciti a salvare le regole. Riprova tra poco.");
        })
            .finally(() => setSending(false));
    };
    return (_jsxs("form", { className: `glass ${styles.rules}`, onSubmit: send, "aria-label": "Regole", children: [_jsx("h2", { className: styles.name, children: "Regole" }), _jsxs("p", { className: styles.role, children: ["Oggi FranzPLAY ha chiesto informazioni su ", status.askedToday, " video."] }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", checked: !anyTime, onChange: (e) => setRules({ ...rules, from: e.target.checked ? 2 : 0, to: e.target.checked ? 6 : 0 }) }), "Chiedi solo in certe ore"] }), !anyTime && (_jsxs("div", { className: styles.momentControls, children: [_jsxs("label", { className: styles.field, children: ["Dalle", _jsx(Select, { "aria-label": "Dalle", value: rules.from, options: hourOptions, onChange: (from) => setRules({ ...rules, from }) })] }), _jsxs("label", { className: styles.field, children: ["Alle", _jsx(Select, { "aria-label": "Alle", value: rules.to, options: hourOptions, onChange: (to) => setRules({ ...rules, to }) })] })] })), _jsxs("label", { className: styles.field, children: ["Al massimo quanti video al giorno (0 = senza limite)", _jsx("input", { type: "number", min: 0, max: 100000, step: 1, value: rules.daily, onChange: (e) => setRules({
                            ...rules,
                            daily: Math.min(100000, Math.max(0, Math.floor(Number(e.target.value) || 0))),
                        }) })] }), _jsxs("div", { children: [_jsx("p", { className: styles.role, children: "Ordine delle fonti: FranzPLAY chiede prima alla prima che pu\u00F2 riconoscere il video. Se non lo trova, prova la successiva." }), _jsx("ol", { className: styles.order, "aria-label": "Ordine delle fonti", children: rules.order.map((source, i) => (_jsxs("li", { children: [_jsxs("span", { children: [i + 1, ". ", names[source]] }), _jsxs("span", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.action}`, "aria-label": `Sposta ${names[source]} su`, disabled: i === 0, onClick: () => move(i, -1), children: "\u2191" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, "aria-label": `Sposta ${names[source]} giù`, disabled: i === rules.order.length - 1, onClick: () => move(i, 1), children: "\u2193" })] })] }, source))) })] }), _jsxs("label", { className: styles.check, children: [_jsx("input", { type: "checkbox", checked: rules.confirm, onChange: (e) => setRules({ ...rules, confirm: e.target.checked }) }), "Chiedi conferma prima di usare quello che trova"] }), _jsx("p", { className: styles.role, children: "Con la conferma, copertina e titolo trovati aspettano qui sotto finch\u00E9 scegli \u00ABUsa\u00BB o \u00ABScarta\u00BB. Le fonti rispondono solo quando riconoscono proprio quel video (stesso codice, stesso titolo e anno, o stessa impronta del file), quindi non c'\u00E8 un punteggio da regolare." }), _jsx("div", { className: styles.buttons, children: _jsx("button", { type: "submit", className: styles.primary, disabled: sending, children: "Salva le regole" }) }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
