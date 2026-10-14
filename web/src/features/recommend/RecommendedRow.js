import { jsx as _jsx } from "react/jsx-runtime";
import { useState } from "react";
import { fetchRecommended, reasonText } from "../../api/recommend";
import { VideoCard } from "../videos/VideoCard";
import { VideoRow } from "../videos/VideoRow";
import { useSuggestions } from "./useSuggestions";
// RecommendedRow shows the videos the person may like, each saying why.
// Until they watch or like something there is nothing to say, and the
// row does not appear.
export function RecommendedRow({ fold }) {
    const [now] = useState(() => new Date());
    const suggestions = useSuggestions(fetchRecommended);
    if (suggestions.length === 0)
        return null;
    return (_jsx(VideoRow, { title: "Potrebbe piacerti", icon: "sparkles", fold: fold, children: suggestions.map((s) => (_jsx("li", { children: _jsx(VideoCard, { video: s.video, now: now, note: reasonText(s) }) }, s.video.id))) }));
}
