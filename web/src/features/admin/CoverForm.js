import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { resetCover, setCoverSecond, uploadCover } from "../../api/adminVideos";
import { ApiError } from "../../api/client";
import { streamURL } from "../../api/videos";
import { formatDuration } from "../../lib/format";
import { usePresence } from "../../lib/presence";
import { loadPhoto } from "../profile/photo";
import styles from "./Admin.module.css";
import { CoverCropper } from "./CoverCropper";
import { renderCover } from "./coverImage";
import { OnlineSearch } from "./OnlineSearch";
// CoverForm lets the administrator choose the cover of a video: an image
// of their own or one found on the internet, cut to the shape of a cover,
// or a moment of the video. The
// choice stays until they go back to the one FranzPLAY picks: a new
// reading of the folders or a search on the internet never replaces it.
export function CoverForm({ video, onChosen, onClose, }) {
    const [picture, setPicture] = useState(null);
    // The window to fit the picture closes softly: it keeps the picture meanwhile.
    const cropper = usePresence(picture);
    const cropping = cropper.shown;
    const [moment, setMoment] = useState(false);
    const [online, setOnline] = useState(false);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    // The picture's address lives until the cropper closes.
    useEffect(() => {
        if (!picture)
            return;
        return () => URL.revokeObjectURL(picture.url);
    }, [picture]);
    const save = (work, chosen) => {
        setBusy(true);
        setProblem("");
        work()
            .then(() => {
            setPicture(null);
            onChosen(chosen);
        })
            .catch((error) => {
            console.error(error);
            setProblem(problemText(error));
        })
            .finally(() => setBusy(false));
    };
    const open = (file) => {
        setProblem("");
        loadPhoto(file)
            .then(setPicture)
            .catch((error) => {
            console.error(error);
            setProblem("Questo file non sembra un'immagine. Prova con una foto JPEG o PNG.");
        });
    };
    const pick = (event) => {
        const file = event.target.files?.[0];
        event.target.value = ""; // the same file can be picked again
        if (file)
            open(file);
    };
    const now = nowText(video);
    return (_jsxs("section", { className: styles.inline, "aria-label": `Copertina di ${video.title}`, children: [_jsx("p", { className: styles.coverNow, children: now }), _jsxs("div", { className: styles.buttons, children: [_jsxs("label", { className: `glass ${styles.action}`, children: ["Carica un'immagine", _jsx("input", { type: "file", accept: "image/jpeg,image/png,image/webp", className: styles.fileInput, disabled: busy, onChange: pick })] }), _jsx("button", { type: "button", className: `glass ${styles.action}`, "aria-expanded": moment, disabled: busy || video.duration === null, onClick: () => {
                            setMoment(!moment);
                            setOnline(false);
                        }, children: "Scegli un momento" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, "aria-expanded": online, disabled: busy, onClick: () => {
                            setOnline(!online);
                            setMoment(false);
                        }, children: "Cerca su internet" }), video.coverChoice !== "" && (_jsx("button", { type: "button", className: `glass ${styles.action}`, disabled: busy, onClick: () => save(() => resetCover(video.id), { ...video, coverChoice: "", coverSecond: null }), children: "Torna a quella automatica" })), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: onClose, children: "Chiudi" })] }), moment && video.duration !== null && (_jsx(MomentPicker, { video: video, duration: video.duration, busy: busy, onPick: (second) => save(() => setCoverSecond(video.id, second), {
                    ...video,
                    coverChoice: "moment",
                    coverSecond: second,
                }) })), online && _jsx(OnlineSearch, { title: video.title, busy: busy, onPick: open }), problem && !picture && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), cropping && (_jsx(CoverCropper, { ref: cropper.ref, leaving: cropper.leaving, picture: cropping, saving: busy, problem: problem, onCancel: () => {
                    setPicture(null);
                    setProblem("");
                }, onSave: (rect) => save(async () => uploadCover(video.id, await renderCover(cropping.url, rect)), {
                    ...video,
                    coverChoice: "image",
                    coverSecond: null,
                }) }))] }));
}
// MomentPicker shows the video: the administrator stops it where they
// like, or writes the second, and uses that moment as cover.
function MomentPicker({ video, duration, busy, onPick, }) {
    const player = useRef(null);
    const [second, setSecond] = useState(video.coverSecond ?? 0);
    // The video opens at the moment chosen before; later moves only seek.
    const [start] = useState(second);
    const seek = (value) => {
        const s = Math.min(duration, Math.max(0, Math.floor(value)));
        setSecond(s);
        if (player.current)
            player.current.currentTime = s;
    };
    return (_jsxs("div", { className: styles.moment, children: [_jsx("video", { ref: player, className: styles.momentVideo, src: `${streamURL(video.id)}#t=${start}`, controls: true, preload: "metadata", "aria-label": "Il video: fermalo nel momento che vuoi come copertina", onTimeUpdate: (e) => setSecond(Math.floor(e.currentTarget.currentTime)) }), _jsxs("div", { className: styles.momentControls, children: [_jsxs("label", { className: styles.field, children: ["Secondo (di ", duration, ")", _jsx("input", { type: "number", min: 0, max: duration, step: 1, value: second, onChange: (e) => seek(Number(e.target.value)) })] }), _jsxs("button", { type: "button", className: styles.primary, disabled: busy, onClick: () => onPick(second), children: ["Usa il momento ", formatDuration(second)] })] })] }));
}
// nowText says where the cover comes from now.
function nowText(video) {
    switch (video.coverChoice) {
        case "image":
            return "La copertina ora è un'immagine caricata da te.";
        case "moment":
            return `La copertina ora è il momento ${formatDuration(video.coverSecond ?? 0)} del video.`;
        default:
            return "La copertina ora la sceglie FranzPLAY: un'immagine accanto al video, una trovata su internet o un fotogramma.";
    }
}
function problemText(error) {
    if (error instanceof ApiError) {
        switch (error.status) {
            case 413:
                return "L'immagine è troppo grande: al massimo 10 MB.";
            case 415:
                return "Questo file non è un'immagine JPEG, PNG o WebP.";
            case 409:
                return "Il file del video non si trova, o non è ancora stato letto: riprova più tardi.";
        }
    }
    return "Non si è riusciti a salvare. Riprova tra poco.";
}
