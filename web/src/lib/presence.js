import { useLayoutEffect, useRef, useState } from "react";
// safetyTime is the longest a leaving move may take: if the browser never
// says it ended (a hidden tab, say), the element goes anyway.
const safetyTime = 600; // milliseconds
// usePresence keeps something on the page while it plays its leaving move,
// so menus and windows close as softly as they open. Give it what to show,
// or null for nothing. While it leaves, put data-leaving on the element:
// its CSS gives it a leaving animation, like var(--motion-pop-out). With
// no animation (less motion, or in tests) it goes at once.
export function usePresence(value) {
    const ref = useRef(null);
    const [shown, setShown] = useState(value);
    // A new value shows at once. (Changing our own state while drawing is
    // allowed: React draws again straight away.)
    if (value !== null && value !== shown)
        setShown(value);
    const leaving = value === null && shown !== null;
    useLayoutEffect(() => {
        if (!leaving)
            return;
        const element = ref.current;
        const gone = () => setShown(null);
        if (!element || !animates(element)) {
            gone();
            return;
        }
        const onEnd = (event) => {
            if (event.target === element)
                gone();
        };
        element.addEventListener("animationend", onEnd);
        const timer = window.setTimeout(gone, safetyTime);
        return () => {
            element.removeEventListener("animationend", onEnd);
            window.clearTimeout(timer);
        };
    }, [leaving]);
    return { shown, leaving, ref };
}
// animates says whether the element is playing a CSS animation.
function animates(element) {
    const name = window.getComputedStyle(element).animationName;
    return name !== "" && name !== "none";
}
