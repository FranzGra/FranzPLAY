import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { fetchAdminCategories, maxLabel, removeCategoryImage, saveCategory, uploadCategoryImage, } from "../../api/adminCategories";
import { ApiError } from "../../api/client";
import { EmptyState } from "../../components/EmptyState";
import { formatVideos } from "../../lib/format";
import { usePresence } from "../../lib/presence";
import { loadPhoto } from "../profile/photo";
import styles from "./Admin.module.css";
import { CoverCropper } from "./CoverCropper";
import { renderCover } from "./coverImage";
import { presets } from "./LookFields";
import look from "./LookFields.module.css";
// CategoriesAdminPage lets the administrator give each category the name
// people see, a color and an image. The videos and their folders do not
// change: only what people see.
export function CategoriesAdminPage() {
    const [state, setState] = useState({ kind: "loading" });
    const load = useCallback((signal) => {
        fetchAdminCategories(signal)
            .then((list) => setState({ kind: "ready", list }))
            .catch((error) => {
            if (signal?.aborted)
                return;
            console.error(error);
            setState({ kind: "error" });
        });
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        return () => controller.abort();
    }, [load]);
    if (state.kind === "loading")
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    if (state.kind === "error") {
        return (_jsx(EmptyState, { title: "Categorie non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    return (_jsxs(_Fragment, { children: [_jsx("p", { className: `${styles.lead} ${styles.count}`, children: "Le categorie sono le sottocartelle dei video, o quelle che scegli tu per un video. Qui decidi come le vedono tutti: un altro nome, un colore, un'immagine. Due categorie con lo stesso nome si vedono come una sola. Le cartelle non cambiano." }), state.list.length === 0 ? (_jsx("p", { className: styles.lead, children: "Ancora nessuna categoria." })) : (_jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Categorie", children: state.list.map((c) => (_jsx("li", { children: _jsx(CategoryRow, { category: c, onChanged: () => load() }) }, c.name))) }))] }));
}
function CategoryRow({ category, onChanged }) {
    const [label, setLabel] = useState(category.label);
    const [color, setColor] = useState(category.color);
    const [picture, setPicture] = useState(null);
    // The window to fit the picture closes softly: it keeps the picture meanwhile.
    const cropper = usePresence(picture);
    const cropping = cropper.shown;
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const [done, setDone] = useState("");
    useEffect(() => {
        if (!picture)
            return;
        return () => URL.revokeObjectURL(picture.url);
    }, [picture]);
    const run = (work, ok) => {
        setBusy(true);
        setProblem("");
        setDone("");
        work()
            .then(() => {
            setPicture(null);
            setDone(ok);
            onChanged();
        })
            .catch((error) => {
            console.error(error);
            setProblem(error instanceof ApiError && error.status === 400
                ? "Il nome o il colore non vanno bene: controlla e riprova."
                : "Non si è riusciti a salvare. Riprova tra poco.");
        })
            .finally(() => setBusy(false));
    };
    const send = (event) => {
        event.preventDefault();
        run(() => saveCategory(category.name, label.trim(), color), "Salvato.");
    };
    const pick = (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file)
            return;
        setProblem("");
        loadPhoto(file)
            .then(setPicture)
            .catch((error) => {
            console.error(error);
            setProblem("Questo file non sembra un'immagine. Prova con una foto JPEG o PNG.");
        });
    };
    const unchanged = label.trim() === category.label && color === category.color;
    const shown = category.label || category.name;
    return (_jsxs("form", { className: `glass ${styles.person}`, onSubmit: send, "aria-label": `Categoria ${category.name}`, children: [_jsxs("div", { className: styles.videoInfo, children: [_jsx("span", { className: styles.thumb, style: color ? { boxShadow: `inset 4px 0 0 ${color}` } : {}, children: category.image && _jsx("img", { src: category.image, alt: "", loading: "lazy" }) }), _jsxs("div", { className: styles.failed, children: [_jsx("p", { className: styles.name, children: shown }), _jsxs("p", { className: styles.role, children: [category.label ? `Cartella: ${category.name} · ` : "", formatVideos(category.videos)] })] })] }), _jsxs("label", { className: styles.field, children: ["Nome che vedono tutti", _jsx("input", { value: label, maxLength: maxLabel, placeholder: category.name, onChange: (e) => setLabel(e.target.value) })] }), _jsxs("fieldset", { className: look.colors, children: [_jsx("legend", { children: "Colore" }), _jsx("button", { type: "button", className: `${look.swatch} ${styles.noColor}`, "aria-label": "Nessun colore", "aria-pressed": color === "", title: "Nessun colore", onClick: () => setColor("") }), presets.map((p) => (_jsx("button", { type: "button", className: look.swatch, style: { background: p.value }, "aria-label": p.name, "aria-pressed": color === p.value, title: p.name, onClick: () => setColor(p.value) }, p.value))), _jsxs("label", { className: look.custom, children: [_jsx("input", { type: "color", value: color || "#2997ff", "aria-label": "Un altro colore", onChange: (e) => setColor(e.target.value.toLowerCase()) }), "Un altro"] })] }), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "submit", className: styles.primary, disabled: busy || unchanged, children: "Salva nome e colore" }), _jsxs("label", { className: `glass ${styles.action}`, children: [category.image ? "Cambia immagine" : "Aggiungi un'immagine", _jsx("input", { type: "file", accept: "image/jpeg,image/png,image/webp", className: styles.fileInput, disabled: busy, onChange: pick })] }), category.image && (_jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: busy, onClick: () => run(() => removeCategoryImage(category.name), "Immagine tolta."), children: "Togli l'immagine" }))] }), problem && !picture && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), done && (_jsx("p", { role: "status", className: styles.done, children: done })), cropping && (_jsx(CoverCropper, { ref: cropper.ref, leaving: cropper.leaving, picture: cropping, saving: busy, problem: problem, title: `Immagine di ${shown}`, saveLabel: "Usa questa immagine", onCancel: () => {
                    setPicture(null);
                    setProblem("");
                }, onSave: (rect) => run(async () => uploadCategoryImage(category.name, await renderCover(cropping.url, rect)), "Immagine salvata.") }))] }));
}
