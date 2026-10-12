import { useEffect, useState } from "react";
import { fetchContinue, type Watched } from "../../api/progress";
import { VideoCard } from "../videos/VideoCard";
import { VideoRow } from "../videos/VideoRow";

// ContinueRow shows the videos the person is in the middle of, most recent
// first, each with how much was watched. With none it shows nothing: the
// Home already has plenty to look at.
export function ContinueRow() {
  const [now] = useState(() => new Date());
  const started = useStarted();
  if (started.length === 0) return null;
  return (
    <VideoRow title="Continua a guardare">
      {started.map(({ video, position }) => (
        <li key={video.id}>
          <VideoCard video={video} now={now} position={position} />
        </li>
      ))}
    </VideoRow>
  );
}

// useStarted loads the videos in progress. If they do not load the row
// simply does not appear, so a failure only goes to the console.
function useStarted(): Watched[] {
  const [started, setStarted] = useState<Watched[]>([]);
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
