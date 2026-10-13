import { useEffect, useState } from "react";
import { fetchPlaylist, fetchPlaylists } from "../../api/playlists";
import type { Video } from "../../api/videos";
import type { Fold } from "../home/useHomeLayout";
import { VideoCard } from "../videos/VideoCard";
import { VideoRow } from "../videos/VideoRow";

// rowSize is how many videos the row shows; the list has all of them.
const rowSize = 12;

type Saved = { list: number; videos: Video[] };

// SavedRow shows on the Home the videos in my "Guarda più tardi". With
// none it shows nothing.
export function SavedRow({ fold }: { fold?: Fold }) {
  const [now] = useState(() => new Date());
  const [saved, setSaved] = useState<Saved | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadSaved(controller.signal)
      .then(setSaved)
      .catch((error: unknown) => {
        // Without it the Home still works: the row simply does not appear.
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);
  if (!saved || saved.videos.length === 0) return null;
  return (
    <VideoRow title="I tuoi salvati" icon="save" fold={fold} more={`/playlist/${saved.list}`}>
      {saved.videos.map((video) => (
        <li key={video.id}>
          <VideoCard video={video} now={now} />
        </li>
      ))}
    </VideoRow>
  );
}

async function loadSaved(signal: AbortSignal): Promise<Saved | null> {
  const later = (await fetchPlaylists(undefined, signal)).find((p) => p.kind === "later");
  if (!later || later.videos === 0) return null;
  const page = await fetchPlaylist(later.id, signal);
  return { list: later.id, videos: page.videos.slice(0, rowSize) };
}
