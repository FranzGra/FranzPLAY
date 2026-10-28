import { type CSSProperties, useEffect, useState } from "react";
import { Link } from "react-router";
import { type Category, fetchCategories } from "../../api/videos";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatVideos } from "../../lib/format";
import styles from "./CategoriesPage.module.css";
import { tileColor } from "./color";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; categories: Category[] };

// CategoriesPage lists the categories: the sub-folders of the video folders,
// with the name, color and image the administrator may have given them.
export function CategoriesPage() {
  usePageTitle("Categorie");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then((categories) => setState({ kind: "ready", categories }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setState({ kind: "error" });
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <h1 className={styles.heading}>
        <Icon name="categories" />
        Categorie
      </h1>
      {state.kind === "error" && (
        <EmptyState title="Categorie non disponibili">
          Il server non ha risposto. Ricarica la pagina tra poco.
        </EmptyState>
      )}
      {state.kind === "ready" && state.categories.length === 0 && (
        <EmptyState title="Ancora nessuna categoria">
          Le sottocartelle delle tue cartelle video diventano categorie: per esempio i video in
          «Vacanze» finiscono nella categoria Vacanze.
        </EmptyState>
      )}
      {state.kind === "ready" && state.categories.length > 0 && (
        <ul className={`stagger ${styles.list}`}>
          {state.categories.map((category) => (
            <li key={category.name}>
              <CategoryTile category={category} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// CategoryTile is a big card for a category. With a wide image (chosen by
// the administrator, or found in its folder), the picture under a dark
// shade where the name is. With only a tall poster from its folder, the
// poster stands in the corner of its colored card, like a book on a
// shelf. Without either, as in the old FranzPLAY: its color fading into
// dark, a grainy surface and a big folder in the corner that straightens
// up under the mouse.
function CategoryTile({ category }: { category: Category }) {
  const { image, poster } = category;
  return (
    <Link
      to={`/categorie/${encodeURIComponent(category.name)}`}
      className={styles.tile}
      data-image={image ? "" : undefined}
      data-poster={!image && poster ? "" : undefined}
      style={{ "--tile-color": tileColor(category) } as CSSProperties}
    >
      {image ? (
        <img className={styles.image} src={image} alt="" loading="lazy" decoding="async" />
      ) : poster ? (
        <img className={styles.poster} src={poster} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className={styles.folder}>
          <Icon name="folder" size={160} />
        </span>
      )}
      <span className={styles.name}>{category.name}</span>
      <span className={styles.count}>{formatVideos(category.videos)}</span>
    </Link>
  );
}
