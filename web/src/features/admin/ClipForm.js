import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { remakeClip, removeClip, uploadClip } from "../../api/adminVideos";
import { ApiError } from "../../api/client";
import styles from "./Admin.module.css";
// The largest video the server accepts for a clip.
const maxClipBytes = 100 * 1024 * 1024;
// ClipForm lets the administrator choose the clip that plays on a video's
// card: a short video of their own, none at all, or the one FranzPLAY
// makes from the video, made again.
export function ClipForm({ video, onChosen, onClose, }) {
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const save = (work, chosen, message) => {
        setBusy(true);
        setProblem("");
        work()
            .then(() => onChosen(chosen, message))
            .catch((error) => {
            console.error(error);
            setProblem(problemText(error));
        })
            .finally(() => setBusy(false));
    };
    const pick = (event) => {
        const file = event.target.files?.[0];
        event.target.value = ""; // the same file can be picked again
        if (!file)
            return;
        if (file.size > maxClipBytes) {
            setProblem("Il video è troppo grande: al massimo 100 MB. Ne basta uno di pochi secondi.");
            return;
        }
        save(() => uploadClip(video.id, file), { ...video, clipChoice: "video" }, "In coda: l'anteprima nuova arriva tra poco.");
    };
    return (_jsxs("section", { className: styles.inline, "aria-label": `Anteprima di ${video.title}`, children: [_jsx("p", { className: styles.coverNow, children: nowText(video) }), video.clip && (_jsx("video", { className: styles.momentVideo, src: video.clip, muted: true, loop: true, autoPlay: true, playsInline: true, "aria-label": "L'anteprima di adesso" })), _jsxs("div", { className: styles.buttons, children: [_jsxs("label", { className: `glass ${styles.action}`, children: ["Carica un video", _jsx("input", { type: "file", accept: "video/mp4,video/webm", className: styles.fileInput, disabled: busy, onChange: pick })] }), _jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: busy, onClick: () => save(() => remakeClip(video.id), { ...video, clipChoice: "" }, "In coda: FranzPLAY rifà l'anteprima dal video."), children: "Rifalla dal video" }), video.clipChoice !== "none" && (_jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: busy, onClick: () => save(() => removeClip(video.id), { ...video, clipChoice: "none" }, "Fatto: niente anteprima su questo video."), children: "Nessuna anteprima" })), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onClose, children: "Chiudi" })] }), busy && (_jsx("p", { role: "status", className: styles.done, children: "Invio in corso\u2026" })), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
// nowText says where the clip comes from now.
function nowText(video) {
    switch (video.clipChoice) {
        case "video":
            return "L'anteprima sulla scheda del video ora è un video caricato da te: se ne usano i primi 15 secondi.";
        case "none":
            return "Ora questo video non ha anteprima sulla sua scheda.";
        default:
            return "L'anteprima sulla scheda del video ora la fa FranzPLAY, con pochi secondi presi da momenti diversi.";
    }
}
function problemText(error) {
    if (error instanceof ApiError) {
        switch (error.status) {
            case 413:
                return "Il video è troppo grande: al massimo 100 MB.";
            case 415:
                return "Questo file non è un video MP4 o WebM.";
            case 409:
                return "Il file del video non si trova: riprova quando è di nuovo nella sua cartella.";
        }
    }
    return "Non si è riusciti a salvare. Riprova tra poco.";
}
