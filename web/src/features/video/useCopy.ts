import { useCallback, useEffect, useRef, useState } from "react";
import { onServerEvent } from "../../api/events";
import { type CopyState, prepareVideo, type Video } from "../../api/videos";

// pollEvery is how often the page asks how far the copy is, while it is
// being made: the queue says nothing between the start and the end.
const pollEvery = 5000;

// Copy is what the video page knows about the copy of a video for every
// device, once this browser turned out not to play the file itself.
export type Copy = {
  // state is where the copy is; null until the browser had a problem.
  state: CopyState | null;
  // percent is how much of the copy is made, while it is made; null = not known.
  percent: number | null;
  // round grows each time the copy becomes ready: the player starts again.
  round: number;
  // unsupported is what the player calls when the browser cannot play it.
  unsupported: () => void;
};

// useCopy asks the server to prepare the copy of a video, first in the
// queue, as soon as this browser cannot play the file: when the browser
// says so beforehand, or when the player fails. Then it follows the queue
// until the copy is ready.
export function useCopy(video: Video, canPlayType: (type: string) => string): Copy {
  const [state, setState] = useState<CopyState | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const last = useRef<CopyState | null>(null);

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
      .catch((error: unknown) => console.error(error));
  }, [video.id]);

  // A file not every device plays, no copy yet, and the browser already
  // says it cannot play it: no need to wait for the player to fail.
  const knownUnplayable =
    !video.playable && !video.copy && video.fileType !== "" && canPlayType(video.fileType) === "";
  useEffect(() => {
    if (knownUnplayable) ask();
  }, [knownUnplayable, ask]);

  // While the copy is on its way, every change in the queue may be it.
  const following = state === "waiting" || state === "working";
  useEffect(() => {
    if (!following) return;
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
    if (waitsForCopy && last.current === null) ask();
  }, [waitsForCopy, ask]);

  return { state, percent, round, unsupported };
}

// copyHint explains to the person what is happening with the copy; it is
// undefined when there is nothing particular to say.
export function copyHint(
  video: Video,
  state: CopyState | null,
  percent: number | null,
): string | undefined {
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
