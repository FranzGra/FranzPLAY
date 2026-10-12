import { useEffect, useState } from "react";
import { type Category, fetchCategories } from "../../api/videos";
import { usePageTitle } from "../../components/PageTitle";
import { ContinueRow } from "../continue/ContinueRow";
import { LikedRow } from "../likes/LikedRow";
import { SavedRow } from "../playlists/SavedRow";
import { RecommendedRow } from "../recommend/RecommendedRow";
import { LatestRow } from "../videos/LatestRow";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./HomePage.module.css";
import { useHomeLayout } from "./useHomeLayout";

// HomePage shows the categories on top to see only one of them, then
// rows (to continue, saved, liked, newest, suggested) and all the videos
// in a mixed order, like on YouTube. Each row can be closed by its title, and
// stays closed for the person on every device.
export function HomePage() {
  usePageTitle("");
  const [category, setCategory] = useState("");
  const categories = useCategories();
  const layout = useHomeLayout();
  // A new order at every visit of the Home, the same while it is open.
  const [seed] = useState(() => 1 + Math.floor(Math.random() * 2 ** 31));
  // "Tutti i video" are mixed, as in the old FranzPLAY: the newest have
  // their own row. A category shows its newest first.
  const { state, loadMore } = useVideoList(category ? { category } : { seed });

  return (
    <>
      <h1 className="visually-hidden">Home</h1>
      {categories.length > 0 && (
        <ul className={styles.chips} aria-label="Categorie">
          {["", ...categories.map((c) => c.name)].map((name) => (
            <li key={name}>
              <button
                type="button"
                className={styles.chip}
                aria-pressed={name === category}
                onClick={() => setCategory(name)}
              >
                {name || "Tutti"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {category === "" && layout.ready && (
        <>
          <ContinueRow fold={layout.fold("continue")} />
          <SavedRow fold={layout.fold("saved")} />
          <LikedRow fold={layout.fold("liked")} />
          <LatestRow fold={layout.fold("latest")} />
          <RecommendedRow fold={layout.fold("recommended")} />
        </>
      )}
      {category === "" && <h2 className={styles.gridTitle}>Tutti i video</h2>}
      <VideoGrid
        state={state}
        onMore={loadMore}
        label={category ? `Video di ${category}` : "Tutti i video"}
        empty={{
          title: "Ancora nessun video",
          text: "Quando colleghi una cartella video, i tuoi video compariranno qui, con i nuovi arrivi e quelli da continuare a guardare.",
        }}
      />
    </>
  );
}

// useCategories loads the categories for the chips. If they do not load,
// the chips simply do not appear: the videos are what matters.
function useCategories(): Category[] {
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then(setCategories)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
        }
      });
    return () => controller.abort();
  }, []);
  return categories;
}
