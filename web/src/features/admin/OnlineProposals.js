import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { acceptProposal, discardProposal, fetchProposals, proposalPictureURL, } from "../../api/online";
import styles from "./Admin.module.css";
const names = {
    youtube: "YouTube",
    tmdb: "TMDB",
    tpdb: "ThePornDB",
};
// OnlineProposals lists what the sources found while the administrator
// asked to confirm: each one is used or thrown away by hand.
export function OnlineProposals({ onChange }) {
    const [state, setState] = useState({ kind: "loading" });
    const [busy, setBusy] = useState(0);
    const [problem, setProblem] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        fetchProposals(controller.signal)
            .then((list) => setState({ kind: "ready", list }))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setState({ kind: "error" });
        });
        return () => controller.abort();
    }, []);
    const decide = (p, use) => {
        if (state.kind !== "ready")
            return;
        setBusy(p.videoId);
        setProblem("");
        (use ? acceptProposal(p.videoId) : discardProposal(p.videoId))
            .then(() => {
            const list = state.list.filter((other) => other.videoId !== p.videoId);
            setState({ kind: "ready", list });
            onChange(list.length);
        })
            .catch((error) => {
            console.error(error);
            setProblem("Non si è riusciti a salvare la scelta. Riprova tra poco.");
        })
            .finally(() => setBusy(0));
    };
    return (_jsxs("section", { className: `glass ${styles.rules}`, "aria-label": "Da confermare", children: [_jsx("h2", { className: styles.name, children: "Da confermare" }), state.kind === "loading" && _jsx("div", { className: styles.placeholder, "aria-busy": "true" }), state.kind === "error" && (_jsx("p", { role: "alert", className: styles.problem, children: "Il server non ha risposto. Ricarica la pagina tra poco." })), state.kind === "ready" && state.list.length === 0 && (_jsx("p", { className: styles.role, children: "Niente da confermare. Quando una fonte trova copertina e titolo di un video, compaiono qui." })), state.kind === "ready" && state.list.length > 0 && (_jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Proposte", children: state.list.map((p) => (_jsxs("li", { className: `glass ${styles.proposal}`, children: [_jsx("div", { className: styles.thumb, children: p.picture ? (_jsx("img", { src: proposalPictureURL(p.videoId), alt: "", loading: "lazy" })) : (_jsx("span", { children: "Nessuna immagine" })) }), _jsxs("div", { children: [_jsx("p", { className: styles.name, children: p.title || p.video }), _jsxs("p", { className: styles.role, children: ["Per \u00AB", p.video, "\u00BB, da ", names[p.source], p.author && ` · ${p.author}`, p.date && ` · ${p.date}`] })] }), _jsxs("span", { className: styles.buttons, children: [_jsx("button", { type: "button", className: styles.primary, disabled: busy !== 0, "aria-label": `Usa la proposta per ${p.video}`, onClick: () => decide(p, true), children: "Usa" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: busy !== 0, "aria-label": `Scarta la proposta per ${p.video}`, onClick: () => decide(p, false), children: "Scarta" })] })] }, p.videoId))) })), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
