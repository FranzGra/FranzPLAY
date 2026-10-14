import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { maxCategory, maxTitle, setVideoDetails } from "../../api/adminVideos";
import styles from "./Admin.module.css";
// DetailsForm changes the title and category of a video. Only what
// FranzPLAY shows changes: the file keeps its name and its folder. The
// ones found by FranzPLAY can always be put back.
export function DetailsForm({ video, onSaved, onCancel, }) {
    const [title, setTitle] = useState(video.title);
    const [category, setCategory] = useState(video.category);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const send = (event) => {
        event.preventDefault();
        const t = title.trim();
        const c = category.trim();
        if (t === "" || [...t].length > maxTitle) {
            setProblem(`Il titolo deve avere da 1 a ${maxTitle} caratteri.`);
            return;
        }
        if ([...c].length > maxCategory) {
            setProblem(`La categoria può avere al massimo ${maxCategory} caratteri.`);
            return;
        }
        // Writing back exactly what was found means "as found": it then
        // follows the file again if it is renamed or moved.
        const details = {
            title: t === video.foundTitle ? null : t,
            category: c === video.foundCategory ? null : c,
        };
        setBusy(true);
        setProblem("");
        setVideoDetails(video.id, details)
            .then(() => onSaved({
            ...video,
            title: t,
            category: c,
            titleSet: details.title !== null,
            categorySet: details.category !== null,
        }))
            .catch((error) => {
            console.error(error);
            setProblem("Non si è riusciti a salvare. Riprova tra poco.");
            setBusy(false);
        });
    };
    return (_jsxs("form", { className: styles.inline, onSubmit: send, "aria-label": `Modifica ${video.title}`, children: [_jsxs("label", { className: styles.field, children: ["Titolo", _jsx("input", { value: title, maxLength: maxTitle, onChange: (e) => setTitle(e.target.value) }), title.trim() !== video.foundTitle && (_jsxs("span", { children: ["Trovato da FranzPLAY: \u00AB", video.foundTitle, "\u00BB.", " ", _jsx("button", { type: "button", className: styles.linkButton, onClick: () => setTitle(video.foundTitle), children: "Rimetti questo" })] }))] }), _jsxs("label", { className: styles.field, children: ["Categoria", _jsx("input", { value: category, maxLength: maxCategory, list: "admin-categories", placeholder: "Nessuna categoria", onChange: (e) => setCategory(e.target.value) }), category.trim() !== video.foundCategory && (_jsxs("span", { children: [video.foundCategory
                                ? `Dalla cartella: «${video.foundCategory}». `
                                : "Dalla cartella: nessuna. ", _jsx("button", { type: "button", className: styles.linkButton, onClick: () => setCategory(video.foundCategory), children: "Rimetti questa" })] }))] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onCancel, children: "Annulla" }), _jsx("button", { type: "submit", className: styles.primary, disabled: busy, children: "Salva" })] })] }));
}
