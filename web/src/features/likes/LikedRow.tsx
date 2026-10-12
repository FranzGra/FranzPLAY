import { useEffect, useState } from "react";
import { fetchLiked } from "../../api/likes";
import type { Video } from "../../api/videos";
import { VideoCard } from "../videos/VideoCard";
import { VideoRow } from "../videos/VideoRow";

// rowSize is how many videos the row shows; the page has all of them.
const rowSize = 12;

// LikedRow shows on the Home the last videos I liked. With none it shows
// nothing.
export function LikedRow() {
  const [now] = useState(() => new Date());
  const [videos, setVideos] = useState<Video[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetchLiked({ limit: rowSize }, controller.signal)
      .then((list) => setVideos(list.videos))
      .catch((error: unknown) => {
        // Without it the Home still works: the row simply does not appear.
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);
  if (videos.length === 0) return null;
  return (
    <VideoRow title="Ti piacciono" more="/mi-piace">
      {videos.map((video) => (
        <li key={video.id}>
          <VideoCard video={video} now={now} />
        </li>
      ))}
    </VideoRow>
  );
}
