import { useEffect, useState } from "react";
import { fetchContinue, leaveContinue, type Watched } from "../../api/progress";
import { Icon } from "../../components/Icon";
import { removeSmoothly } from "../../lib/motion";
import type { Fold } from "../home/useHomeLayout";
import { VideoCard } from "../videos/VideoCard";
import { VideoRow } from "../videos/VideoRow";
import styles from "./ContinueRow.module.css";

// ContinueRow shows the videos the person is in the middle of, most recent
// first, each with how much was watched. Each can be taken out of the
// row: the history keeps it. With none it shows nothing: the Home already
// has plenty to look at.
export function ContinueRow({ fold }: { fold?: Fold }) {
  const [now] = useState(() => new Date());
  const [started, setStarted] = useState<Watched[]>([]);
  const [problem, setProblem] = useState("");

  // If the videos in progress do not load the row simply does not appear,
  // so a failure only goes to the console.
  useEffect(() => {
    const controller = new AbortController();
    fetchContinue(controller.signal)
      .then(setStarted)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);

  // takeOut lets the video fade away while the server takes it out of the
  // row; the others then glide into its place. If the server refuses, it
  // comes back where it was.
  const takeOut = (gone: Watched, item: Element | null) => {
    setProblem("");
    removeSmoothly(
      item,
      () => leaveContinue(gone.video.id),
      () => setStarted((list) => list.filter((w) => w.video.id !== gone.video.id)),
    ).catch((error: unknown) => {
      console.error(error);
      setProblem("Non sono riuscito a togliere il video. Riprova.");
    });
  };

  if (started.length === 0) return null;
  return (
    <>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      <VideoRow title="Continua a guardare" fold={fold}>
        {started.map((w) => (
          <li key={w.video.id} className={styles.item} data-flip>
            <VideoCard video={w.video} now={now} position={w.position} />
            <button
              type="button"
              className={`glass ${styles.leave}`}
              aria-label={`Togli «${w.video.title}» da Continua a guardare`}
              title="Togli da Continua a guardare (resta nella cronologia)"
              onClick={(event) => takeOut(w, event.currentTarget.closest("li"))}
            >
              <Icon name="close" size={16} />
            </button>
          </li>
        ))}
      </VideoRow>
    </>
  );
}
