import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Icon } from "../../components/Icon";
import { speedLabel, speeds } from "./controls";
import styles from "./Player.module.css";
import { optionLabel, styleKeys, subtitleCSS, subtitleOptions, } from "./subtitleStyle";
// SettingsMenu is the panel opened by the gear button. Each setting has its
// own page, as on YouTube, so the panel stays small on phones. A deeper
// page slides in from the right, going back slides in from the left.
export function SettingsMenu(props) {
    const { speed, onSpeed, tracks, track, onTrack, audio, audioStream, onAudio } = props;
    const { subtitleStyle, onSubtitleStyle, repeat, onRepeat, onClose, ref, leaving } = props;
    const [page, setPageOnly] = useState("main");
    // How the page came in; none for the first one, which opens with the panel.
    const [direction, setDirection] = useState(undefined);
    const setPage = (next) => {
        setDirection(next === "main" || (next === "style" && page !== "main") ? "back" : "forward");
        setPageOnly(next);
    };
    const trackLabel = tracks.find((t) => t.key === track)?.label ?? "Disattivati";
    return (_jsx("div", { ref: ref, className: `glass ${styles.menu}`, role: "dialog", "aria-label": "Impostazioni del video", "data-leaving": leaving || undefined, onKeyDown: (event) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
            }
        }, children: _jsxs("div", { className: styles.menuPage, "data-direction": direction, children: [page === "main" && (_jsxs(_Fragment, { children: [_jsx(Row, { label: "Velocit\u00E0", value: speedLabel(speed), onClick: () => setPage("speed") }), audio.length > 1 && (_jsx(Row, { label: "Audio", value: audio.find((a) => a.stream === audioStream)?.label ?? "", onClick: () => setPage("audio") })), _jsx(Row, { label: "Sottotitoli", value: tracks.length === 0 ? "Nessuno" : trackLabel, onClick: () => setPage("subtitles") }), _jsx(Row, { label: "Stile dei sottotitoli", value: "", onClick: () => setPage("style") }), _jsxs("button", { type: "button", role: "switch", "aria-checked": repeat, className: styles.menuRow, onClick: () => onRepeat(!repeat), children: [_jsx("span", { children: "Ripeti" }), _jsx("span", { className: styles.switch, "aria-hidden": "true" })] })] })), page === "speed" && (_jsx(Choices, { title: "Velocit\u00E0", onBack: () => setPage("main"), options: speeds.map((s) => ({
                        key: String(s),
                        label: speedLabel(s),
                        chosen: s === speed,
                    })), onChoose: (key) => {
                        onSpeed(Number(key));
                        onClose();
                    } })), page === "audio" && (_jsx(Choices, { title: "Audio", onBack: () => setPage("main"), options: audio.map((a) => ({
                        key: String(a.stream),
                        label: a.label,
                        chosen: a.stream === audioStream,
                    })), onChoose: (key) => {
                        onAudio(Number(key));
                        onClose();
                    } })), page === "subtitles" && (_jsx(Choices, { title: "Sottotitoli", onBack: () => setPage("main"), options: [
                        { key: "", label: "Disattivati", chosen: track === null },
                        ...tracks.map((t) => ({ key: t.key, label: t.label, chosen: t.key === track })),
                    ], onChoose: (key) => {
                        onTrack(key || null);
                        onClose();
                    }, note: tracks.length === 0
                        ? "Questo video non ha sottotitoli. Mettili accanto al video con lo stesso nome, per esempio «mare.it.srt»."
                        : undefined })), page === "style" && (_jsxs(_Fragment, { children: [_jsx(Back, { title: "Stile dei sottotitoli", onBack: () => setPage("main") }), styleKeys.map((key) => (_jsx(Row, { label: subtitleOptions[key].title, value: optionLabel(key, subtitleStyle[key]), onClick: () => setPage(key) }, key))), _jsx("div", { className: styles.preview, "aria-hidden": "true", children: _jsx("span", { style: subtitleCSS(subtitleStyle), className: styles.previewText, children: "Cos\u00EC appariranno i sottotitoli" }) })] })), styleKeys.map((key) => page === key && (_jsx(Choices, { title: subtitleOptions[key].title, onBack: () => setPage("style"), options: subtitleOptions[key].options.map((o) => ({
                        key: o.value,
                        label: o.label,
                        chosen: o.value === subtitleStyle[key],
                    })), onChoose: (value) => {
                        onSubtitleStyle({ ...subtitleStyle, [key]: value });
                        setPage("style");
                    } }, key)))] }, page) }));
}
function Row({ label, value, onClick }) {
    return (_jsxs("button", { type: "button", className: styles.menuRow, onClick: onClick, children: [_jsx("span", { children: label }), _jsxs("span", { className: styles.menuValue, children: [value, _jsx(Icon, { name: "chevronRight", size: 16 })] })] }));
}
function Back({ title, onBack }) {
    return (_jsxs("button", { type: "button", className: styles.menuBack, onClick: onBack, children: [_jsx(Icon, { name: "chevronLeft", size: 16 }), title] }));
}
function Choices({ title, onBack, options, onChoose, note }) {
    return (_jsxs(_Fragment, { children: [_jsx(Back, { title: title, onBack: onBack }), _jsx("ul", { className: styles.menuList, "aria-label": title, children: options.map((o) => (_jsx("li", { children: _jsxs("button", { type: "button", "aria-pressed": o.chosen, className: styles.menuRow, onClick: () => onChoose(o.key), children: [_jsx("span", { className: styles.menuCheck, children: o.chosen && _jsx(Icon, { name: "check", size: 16 }) }), _jsx("span", { className: styles.menuLabel, children: o.label })] }) }, o.key))) }), note && _jsx("p", { className: styles.menuNote, children: note })] }));
}
