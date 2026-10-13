import { useState } from "react";
import { fetchRecommended, reasonText } from "../../api/recommend";
import type { Fold } from "../home/useHomeLayout";
import { VideoCard } from "../videos/VideoCard";
import { VideoRow } from "../videos/VideoRow";
import { useSuggestions } from "./useSuggestions";

// RecommendedRow shows the videos the person may like, each saying why.
// Until they watch or like something there is nothing to say, and the
// row does not appear.
export function RecommendedRow({ fold }: { fold?: Fold }) {
  const [now] = useState(() => new Date());
  const suggestions = useSuggestions(fetchRecommended);
  if (suggestions.length === 0) return null;
  return (
    <VideoRow title="Potrebbe piacerti" icon="sparkles" fold={fold}>
      {suggestions.map((s) => (
        <li key={s.video.id}>
          <VideoCard video={s.video} now={now} note={reasonText(s)} />
        </li>
      ))}
    </VideoRow>
  );
}
