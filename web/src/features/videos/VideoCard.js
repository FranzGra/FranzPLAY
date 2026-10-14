import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { goodConnection } from "../../lib/connection";
import { formatAge, formatDuration } from "../../lib/format";
import { useClipPreview } from "./useClipPreview";
import styles from "./VideoCard.module.css";
// VideoCard is a video in a grid: cover with its duration, title, and
// category with how long ago it arrived and how many people like it. Resting the mouse on it
// plays a few silent seconds of the video; on a touch screen the card that
// stays in the middle of the screen plays them.
export function VideoCard({ video, now, layout = "grid", position, note }) {
    const { playing, handlers, coverRef } = useClipPreview(video.clip, layout === "grid");
    const details = [video.category, formatAge(video.addedAt, now)].filter(Boolean).join(" · ");
    const watched = position !== undefined && video.duration ? Math.min(1, position / video.duration) : null;
    return (_jsxs(Link, { to: `/video/${video.id}`, className: `glow ${styles.root}`, "data-layout": layout, ...handlers, children: [_jsxs("div", { ref: coverRef, className: styles.cover, children: [video.cover ? (_jsx("img", { src: video.cover, alt: "", loading: "lazy", decoding: "async" })) : (_jsx("span", { className: styles.noCover, children: _jsx(Icon, { name: "play", size: 28 }) })), playing && video.clip && _jsx(Clip, { src: chooseClip(video.clip, video.clipHD) }), video.duration !== null && (_jsx("span", { className: styles.duration, children: formatDuration(video.duration) })), watched !== null && (_jsxs("span", { className: styles.watched, children: [_jsx("span", { style: { width: `${watched * 100}%` } }), _jsxs("span", { className: "visually-hidden", children: ["Visto al ", Math.round(watched * 100), "%"] })] }))] }), _jsxs("div", { className: styles.text, children: [_jsx("h3", { className: styles.title, children: video.title }), _jsxs("p", { className: styles.details, children: [details, video.likes > 0 && (_jsxs("span", { className: styles.likes, children: [_jsx(Icon, { name: "like", size: 13 }), video.likes, _jsx("span", { className: "visually-hidden", children: video.likes === 1 ? " mi piace" : " persone a cui piace" })] }))] }), note && _jsx("p", { className: styles.note, children: note })] })] }));
}
// chooseClip picks which clip plays: the sharp one on a good connection,
// like the Wi-Fi at home, the light one otherwise. It asks each time a clip
// starts, so a phone leaving home switches to the light ones.
function chooseClip(clip, clipHD) {
    return clipHD !== null && goodConnection() ? clipHD : clip;
}
// Clip plays a few silent seconds over the cover. It is made only while it
// plays, so nothing is downloaded before, and it shows once it really
// moves, so the cover stays while it loads.
function Clip({ src }) {
    const [moving, setMoving] = useState(false);
    return (_jsx("video", { className: styles.clip, "data-moving": moving || undefined, src: src, muted: true, loop: true, playsInline: true, autoPlay: true, disablePictureInPicture: true, "data-testid": "clip", onPlaying: () => setMoving(true) }));
}
