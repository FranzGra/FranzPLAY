import { useEffect, useState } from "react";
import { fetchVideos, type Video } from "../../api/videos";
import type { Fold } from "../home/useHomeLayout";
import { VideoCard } from "./VideoCard";
import { VideoRow } from "./VideoRow";

// rowSize is how many of the newest videos the row shows.
const rowSize = 12;

// LatestRow shows on the Home the videos arrived last, since the list
// below them is in a mixed order. With no videos it shows nothing.
export function LatestRow({ fold }: { fold?: Fold }) {
  const [now] = useState(() => new Date());
  const [videos, setVideos] = useState<Video[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetchVideos({ limit: rowSize }, controller.signal)
      .then((list) => setVideos(list.videos))
      .catch((error: unknown) => {
        // Without it the Home still works: the row simply does not appear.
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);
  if (videos.length === 0) return null;
  return (
    <VideoRow title="Ultimi arrivati" fold={fold}>
      {videos.map((video) => (
        <li key={video.id}>
          <VideoCard video={video} now={now} />
        </li>
      ))}
    </VideoRow>
  );
}
