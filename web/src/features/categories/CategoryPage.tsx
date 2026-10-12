import { Link, useParams } from "react-router";
import { usePageTitle } from "../../components/PageTitle";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./CategoriesPage.module.css";

// CategoryPage shows the videos of one category.
export function CategoryPage() {
  const name = useParams().name ?? "";
  usePageTitle(name);
  const { state, loadMore } = useVideoList(name);

  return (
    <>
      <p className={styles.back}>
        <Link to="/categorie">‹ Categorie</Link>
      </p>
      <h1 className={styles.heading}>{name}</h1>
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
