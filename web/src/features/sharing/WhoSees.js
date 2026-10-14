import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useState } from "react";
import { avatarUrl } from "../../api/auth";
import { fetchPeople } from "../../api/people";
import { Avatar } from "../../components/Avatar";
import styles from "./WhoSees.module.css";
const labels = {
    everyone: "Tutti",
    me: "Solo io",
    people: "Alcune persone",
};
// WhoSees chooses who sees something: everybody, only me, or the people I
// tick in the list that opens under "Alcune persone".
export function WhoSees({ choice, onChange, hints, }) {
    const group = useId();
    return (_jsxs("fieldset", { className: styles.root, children: [_jsx("legend", { children: "Chi pu\u00F2 vederlo" }), _jsx("div", { className: styles.choices, children: ["everyone", "me", "people"].map((audience) => (_jsxs("label", { className: styles.choice, children: [_jsx("input", { type: "radio", name: group, checked: choice.audience === audience, onChange: () => onChange({ ...choice, audience }) }), labels[audience]] }, audience))) }), _jsx("p", { className: styles.note, children: hints[choice.audience] }), choice.audience === "people" && (_jsx(PeoplePicker, { chosen: choice.people, onChange: (people) => onChange({ ...choice, people }) }))] }));
}
// Past this many people, a box to find a name comes first.
const findFrom = 8;
// PeoplePicker is the list of people with a tick each.
function PeoplePicker({ chosen, onChange, }) {
    const [state, setState] = useState({ kind: "loading" });
    const [find, setFind] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        fetchPeople(controller.signal)
            .then((people) => setState({ kind: "ready", people }))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setState({ kind: "error" });
        });
        return () => controller.abort();
    }, []);
    if (state.kind === "loading")
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    if (state.kind === "error") {
        return (_jsx("p", { role: "alert", className: styles.problem, children: "L'elenco delle persone non \u00E8 disponibile: riprova tra poco." }));
    }
    if (state.people.length === 0) {
        return (_jsx("p", { className: styles.note, children: "Su FranzPLAY non c'\u00E8 ancora nessun altro: quando arriver\u00E0 qualcuno, potrai sceglierlo qui." }));
    }
    const toggle = (id) => onChange(chosen.includes(id) ? chosen.filter((p) => p !== id) : [...chosen, id]);
    const wanted = find.trim().toLowerCase();
    const shown = state.people.filter((p) => wanted === "" || p.name.toLowerCase().includes(wanted));
    return (_jsxs("div", { className: styles.picker, children: [state.people.length > findFrom && (_jsx("input", { type: "search", className: styles.find, placeholder: "Cerca un nome", "aria-label": "Cerca un nome", value: find, onChange: (e) => setFind(e.target.value) })), _jsx("ul", { className: styles.people, "aria-label": "Persone", children: shown.map((p) => (_jsx("li", { children: _jsxs("label", { className: styles.person, children: [_jsx("input", { type: "checkbox", checked: chosen.includes(p.id), onChange: () => toggle(p.id) }), _jsx(Avatar, { name: p.name, size: 28, photo: avatarUrl(p.id, p.avatar) }), _jsx("span", { className: styles.name, children: p.name })] }) }, p.id))) }), _jsx("p", { className: styles.note, children: chosen.length === 0
                    ? "Scegli almeno una persona."
                    : chosen.length === 1
                        ? "Hai scelto 1 persona."
                        : `Hai scelto ${chosen.length} persone.` })] }));
}
