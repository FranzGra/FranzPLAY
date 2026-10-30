import { useEffect, useState } from "react";
import { type Category, fetchCategories } from "../../api/videos";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import styles from "./CategoriesPage.module.css";
import { CategoryTile } from "./CategoryTile";

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
              <CategoryTile
                name={category.name}
                videos={category.videos}
                color={category.color}
                image={category.image}
                to={`/categorie/${encodeURIComponent(category.name)}`}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
