import { useEffect, useState } from "react";
import { fetchSubtitles, type SubtitleTrack } from "../../api/videos";

const none: SubtitleTrack[] = [];

// useSubtitles loads the subtitles of a video. Without them the video
// still plays, so a failure only goes to the console. A new round asks
// again; the same answer keeps the same list, so the player does not
// choose its subtitles a second time.
export function useSubtitles(id: number, round = 0): SubtitleTrack[] {
  const [tracks, setTracks] = useState<SubtitleTrack[]>(none);
  // biome-ignore lint/correctness/useExhaustiveDependencies: another video starts from no subtitles.
  useEffect(() => setTracks(none), [id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: round is what asks again.
  useEffect(() => {
    const controller = new AbortController();
    fetchSubtitles(id, controller.signal)
      .then((fresh) =>
        setTracks((old) => (JSON.stringify(old) === JSON.stringify(fresh) ? old : fresh)),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [id, round]);
  return tracks;
}
