import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { fetchContinue, leaveContinue } from "../../api/progress";
import { Icon } from "../../components/Icon";
import { removeSmoothly } from "../../lib/motion";
import { VideoCard } from "../videos/VideoCard";
import { VideoRow } from "../videos/VideoRow";
import styles from "./ContinueRow.module.css";
// ContinueRow shows the videos the person is in the middle of, most recent
// first, each with how much was watched. Each can be taken out of the
// row: the history keeps it. With none it shows nothing: the Home already
// has plenty to look at.
export function ContinueRow({ fold }) {
    const [now] = useState(() => new Date());
    const [started, setStarted] = useState([]);
    const [problem, setProblem] = useState("");
    // If the videos in progress do not load the row simply does not appear,
    // so a failure only goes to the console.
    useEffect(() => {
        const controller = new AbortController();
        fetchContinue(controller.signal)
            .then(setStarted)
            .catch((error) => {
            if (!controller.signal.aborted)
                console.error(error);
        });
        return () => controller.abort();
    }, []);
    // takeOut lets the video fade away while the server takes it out of the
    // row; the others then glide into its place. If the server refuses, it
    // comes back where it was.
    const takeOut = (gone, item) => {
        setProblem("");
        removeSmoothly(item, () => leaveContinue(gone.video.id), () => setStarted((list) => list.filter((w) => w.video.id !== gone.video.id))).catch((error) => {
            console.error(error);
            setProblem("Non sono riuscito a togliere il video. Riprova.");
        });
    };
    if (started.length === 0)
        return null;
    return (_jsxs(_Fragment, { children: [problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), _jsx(VideoRow, { title: "Continua a guardare", icon: "history", fold: fold, children: started.map((w) => (_jsxs("li", { className: styles.item, "data-flip": true, children: [_jsx(VideoCard, { video: w.video, now: now, position: w.position }), _jsx("button", { type: "button", className: `glass ${styles.leave}`, "aria-label": `Togli «${w.video.title}» da Continua a guardare`, title: "Togli da Continua a guardare (resta nella cronologia)", onClick: (event) => takeOut(w, event.currentTarget.closest("li")), children: _jsx(Icon, { name: "close", size: 16 }) })] }, w.video.id))) })] }));
}
