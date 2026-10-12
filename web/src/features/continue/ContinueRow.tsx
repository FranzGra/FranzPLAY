import { useEffect, useState } from "react";
import { fetchContinue, type Started } from "../../api/progress";
import { VideoCard } from "../videos/VideoCard";
import styles from "./ContinueRow.module.css";

// ContinueRow shows the videos the person is in the middle of, most recent
// first, each with how much was watched. With none it shows nothing: the
// Home already has plenty to look at.
export function ContinueRow() {
  const [now] = useState(() => new Date());
  const started = useStarted();
  if (started.length === 0) return null;
  return (
    <section className={styles.root} aria-labelledby="continue-title">
      <h2 id="continue-title" className={styles.title}>
        Continua a guardare
      </h2>
      <ul className={styles.list}>
        {started.map(({ video, position }) => (
          <li key={video.id}>
            <VideoCard video={video} now={now} position={position} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// useStarted loads the videos in progress. If they do not load the row
// simply does not appear, so a failure only goes to the console.
function useStarted(): Started[] {
  const [started, setStarted] = useState<Started[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetchContinue(controller.signal)
      .then(setStarted)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);
  return started;
}
