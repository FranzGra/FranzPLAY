import { useEffect, useState } from "react";
import { type Category, fetchCategories } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { SiteName } from "../../components/SiteName";
import { ContinueRow } from "../continue/ContinueRow";
import { LikedRow } from "../likes/LikedRow";
import { SavedRow } from "../playlists/SavedRow";
import { RecommendedRow } from "../recommend/RecommendedRow";
import { LatestRow } from "../videos/LatestRow";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import { CategoryChips } from "./CategoryChips";
import styles from "./HomePage.module.css";
import { LookPanel } from "./LookPanel";
import { lookStyle, SectionsContext, useWide } from "./look";
import { useHomeLayout } from "./useHomeLayout";

// HomePage looks like the old FranzPLAY's: a title, the categories to see
// only one of them, then big sections (to continue, saved, liked, newest,
// suggested) and all the videos in a mixed order. Each section can be
// closed by its title, and stays closed for the person on every device.
// On a computer or tablet the person also chooses how many cards in a line,
// how big, and how much of each section to show.
export function HomePage() {
  usePageTitle("");
  const [category, setCategory] = useState("");
  const categories = useCategories();
  const layout = useHomeLayout();
  const wide = useWide();
  const [choosing, setChoosing] = useState(false);
  // A new order at every visit of the Home, the same while it is open.
  const [seed] = useState(() => 1 + Math.floor(Math.random() * 2 ** 31));
  // "Tutti i video" are mixed, as in the old FranzPLAY: the newest have
  // their own row. A category shows its newest first.
  const { state, loadMore } = useVideoList(category ? { category } : { seed });

  return (
    <div style={lookStyle(layout.look)}>
      <header className={styles.header}>
        <span className={styles.headerIcon}>
          <Icon name="sparkles" size={24} />
        </span>
        <div className={styles.headerText}>
          <h1 className={styles.headerTitle}>Esplora la libreria</h1>
          <p className={styles.headerSub}>
            Benvenuto su <SiteName />
          </p>
        </div>
        {wide && layout.ready && (
          <button
            type="button"
            className={`glass ${styles.customize}`}
            aria-expanded={choosing}
            onClick={() => setChoosing((c) => !c)}
          >
            <Icon name="sliders" size={18} />
            Personalizza
          </button>
        )}
      </header>
      {wide && choosing && <LookPanel look={layout.look} onChange={layout.setLook} />}
      {categories.length > 0 && (
        <CategoryChips categories={categories} chosen={category} onChoose={setCategory} />
      )}
      {category === "" && layout.ready && (
        <SectionsContext.Provider value={layout.look.sections}>
          <div className={`stagger ${styles.sections}`}>
            <ContinueRow fold={layout.fold("continue")} />
            <SavedRow fold={layout.fold("saved")} />
            <LikedRow fold={layout.fold("liked")} />
            <LatestRow fold={layout.fold("latest")} />
            <RecommendedRow fold={layout.fold("recommended")} />
          </div>
        </SectionsContext.Provider>
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
    </div>
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
