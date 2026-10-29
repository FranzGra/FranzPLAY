import { type CSSProperties, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { type Category, fetchCategories } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatVideos } from "../../lib/format";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./CategoriesPage.module.css";
import { tileColor } from "./color";

// CategoryPage shows the videos of one category. With pictures (chosen by
// the administrator, or found in its folder), it opens with a big band:
// the wide picture behind, the tall poster beside the name.
export function CategoryPage() {
  const name = useParams().name ?? "";
  usePageTitle(name);
  const { state, loadMore } = useVideoList({ category: name });
  const category = useCategory(name);

  return (
    <>
      <p className={styles.back}>
        <Link to="/categorie" className="glass">
          <Icon name="chevronLeft" size={20} />
          Categorie
        </Link>
      </p>
      {category && (category.image || category.poster) ? (
        <CategoryHero category={category} />
      ) : (
        <h1 className={styles.heading}>{name}</h1>
      )}
      <VideoGrid
        state={state}
        onMore={loadMore}
        label={`Video di ${name}`}
        empty={{
          title: "Nessun video qui",
          text: "Questa categoria è vuota: forse la cartella è stata spostata o rinominata.",
        }}
      />
    </>
  );
}

// useCategory finds a category among all of them, for its pictures. Until
// it arrives, or if it fails, the page shows the plain title: the videos
// matter more.
function useCategory(name: string): Category | null {
  const [category, setCategory] = useState<Category | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setCategory(null);
    fetchCategories(controller.signal)
      .then((all) => setCategory(all.find((c) => c.name === name) ?? null))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [name]);
  return category;
}

// CategoryHero is the band at the top of a category with pictures. With
// only a poster, the poster itself, blurred, fills the band behind it.
function CategoryHero({ category }: { category: Category }) {
  const backdrop = category.image ?? category.poster;
  return (
    <header
      className={styles.hero}
      data-blur={category.image ? undefined : ""}
      style={{ "--tile-color": tileColor(category) } as CSSProperties}
    >
      {backdrop && <img className={styles.backdrop} src={backdrop} alt="" decoding="async" />}
      {category.poster && (
        <img className={styles.heroPoster} src={category.poster} alt="" decoding="async" />
      )}
      <div className={styles.heroText}>
        <h1 className={styles.heroName}>{category.name}</h1>
        <p className={styles.heroCount}>{formatVideos(category.videos)}</p>
      </div>
    </header>
  );
}
