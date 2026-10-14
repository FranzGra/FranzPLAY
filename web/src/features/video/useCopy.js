import { useCallback, useEffect, useRef, useState } from "react";
import { onServerEvent } from "../../api/events";
import { prepareVideo } from "../../api/videos";
// pollEvery is how often the page asks how far the copy is, while it is
// being made: the queue says nothing between the start and the end.
const pollEvery = 5000;
// useCopy asks the server to prepare the copy of a video, first in the
// queue, as soon as this browser cannot play the file: when the browser
// says so beforehand, or when the player fails. Then it follows the queue
// until the copy is ready.
export function useCopy(video, canPlayType) {
    const [state, setState] = useState(null);
    const [percent, setPercent] = useState(null);
    const [round, setRound] = useState(0);
    const last = useRef(null);
    const ask = useCallback(() => {
        prepareVideo(video.id)
            .then(({ state: next, percent }) => {
            if (next === "ready" && last.current !== "ready") {
                setRound((r) => r + 1);
            }
            last.current = next;
            setState(next);
            setPercent(percent);
        })
            .catch((error) => console.error(error));
    }, [video.id]);
    // A file not every device plays, no copy yet, and the browser already
    // says it cannot play it: no need to wait for the player to fail.
    const knownUnplayable = !video.playable && !video.copy && video.fileType !== "" && canPlayType(video.fileType) === "";
    useEffect(() => {
        if (knownUnplayable)
            ask();
    }, [knownUnplayable, ask]);
    // While the copy is on its way, every change in the queue may be it.
    const following = state === "waiting" || state === "working";
    useEffect(() => {
        if (!following)
            return;
        const stopJobs = onServerEvent("jobs", ask);
        const stopLibrary = onServerEvent("library", ask);
        const timer = state === "working" ? window.setInterval(ask, pollEvery) : undefined;
        return () => {
            stopJobs();
            stopLibrary();
            window.clearInterval(timer);
        };
    }, [following, state, ask]);
    // Only a file not every device plays has a copy to wait for; asked
    // once: if the copy fails too, asking again would not help.
    const waitsForCopy = !video.playable && !video.copy;
    const unsupported = useCallback(() => {
        if (waitsForCopy && last.current === null)
            ask();
    }, [waitsForCopy, ask]);
    return { state, percent, round, unsupported };
}
// copyHint explains to the person what is happening with the copy; it is
// undefined when there is nothing particular to say.
export function copyHint(video, state, percent) {
    const cannot = "Questo dispositivo non sa aprire il file così com'è.";
    switch (state) {
        case "waiting":
            return `${cannot} FranzPLAY ne sta preparando una versione adatta: è in coda, davanti agli altri lavori. Il video partirà da solo appena è pronta.`;
        case "working":
            return `${cannot} FranzPLAY ne sta preparando adesso una versione adatta${percent === null ? "" : ` (${percent}%)`}: il video partirà da solo appena è pronta.`;
        case "failed":
            return "FranzPLAY non è riuscito a preparare una versione di questo video adatta a questo dispositivo. L'amministratore trova l'errore nella pagina dei lavori.";
    }
    if (!video.playable) {
        return "Il formato di questo video non è adatto a tutti i browser. FranzPLAY ne sta preparando una copia che si vede ovunque: riprova più tardi.";
    }
    return undefined;
}
