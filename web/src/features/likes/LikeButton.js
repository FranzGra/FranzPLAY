import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { fetchLike, setLike } from "../../api/likes";
import { Icon } from "../../components/Icon";
import styles from "./LikeButton.module.css";
// LikeButton shows how many people like a video and lets me like it.
// It changes at once and goes back if the server refuses. Liking makes
// the thumb bounce with a little burst around it, and the number rolls up
// or down to its new value.
export function LikeButton({ videoId }) {
    const [like, setLikeState] = useState(null);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    // burst counts the likes given here: each one draws a new burst.
    const [burst, setBurst] = useState(0);
    // Which way the number last moved, so it rolls the right way.
    const [direction, setDirection] = useState("up");
    useEffect(() => {
        const controller = new AbortController();
        setLikeState(null);
        fetchLike(videoId, controller.signal)
            .then(setLikeState)
            .catch((error) => {
            if (!controller.signal.aborted)
                console.error(error);
        });
        return () => controller.abort();
    }, [videoId]);
    // Without the like the video is still fine to watch: no button.
    if (like === null)
        return null;
    const toggle = () => {
        const before = like;
        const liked = !before.liked;
        setLikeState({ liked, count: Math.max(0, before.count + (liked ? 1 : -1)) });
        setDirection(liked ? "up" : "down");
        if (liked)
            setBurst((b) => b + 1);
        setSaving(true);
        setFailed(false);
        setLike(videoId, liked)
            .then(setLikeState)
            .catch((error) => {
            console.error(error);
            setLikeState(before);
            setFailed(true);
        })
            .finally(() => setSaving(false));
    };
    return (_jsxs("div", { className: styles.root, children: [_jsxs("button", { type: "button", className: `glass ${styles.button}`, "aria-pressed": like.liked, disabled: saving, onClick: toggle, title: like.liked ? "Non mi piace più" : "Mi piace", children: [_jsxs("span", { className: styles.icon, children: [_jsx(Icon, { name: "like", size: 20 }), like.liked && burst > 0 && (_jsx("span", { className: styles.burst, "data-testid": "like-burst", "aria-hidden": "true" }, burst))] }), "Mi piace", like.count > 0 && (_jsx("span", { className: styles.count, "aria-hidden": "true", children: _jsx("span", { className: styles.number, "data-direction": direction, children: like.count.toLocaleString("it-IT") }, like.count) }))] }), _jsx("span", { className: "visually-hidden", "aria-live": "polite", children: like.count === 1 ? "Piace a 1 persona" : `Piace a ${like.count} persone` }), failed && (_jsx("span", { role: "alert", className: styles.problem, children: "Non sono riuscito a salvare il like. Riprova." }))] }));
}
