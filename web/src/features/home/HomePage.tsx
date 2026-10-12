import { useEffect, useState } from "react";
import { type Category, fetchCategories } from "../../api/videos";
import { usePageTitle } from "../../components/PageTitle";
import { ContinueRow } from "../continue/ContinueRow";
import { RecommendedRow } from "../recommend/RecommendedRow";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./HomePage.module.css";

// HomePage shows the newest videos, with a row of categories on top to
// see only one of them, the videos to continue and the ones the person
// may like, like on YouTube.
export function HomePage() {
  usePageTitle("");
  const [category, setCategory] = useState("");
  const categories = useCategories();
  const { state, loadMore } = useVideoList({ category });

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
      {category === "" && (
        <>
          <ContinueRow />
          <RecommendedRow />
        </>
      )}
      <VideoGrid
        state={state}
        onMore={loadMore}
        label={category ? `Video di ${category}` : "Ultimi video"}
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
