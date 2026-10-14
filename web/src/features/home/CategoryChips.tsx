import { type CSSProperties, useRef } from "react";
import { Link } from "react-router";
import type { Category } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { useScrollEnds } from "../../lib/scrollEnds";
import { tileColor } from "../categories/color";
import styles from "./CategoryChips.module.css";

type CategoryChipsProps = {
  categories: Category[];
  // chosen is the category shown, "" for all of them.
  chosen: string;
  onChoose: (name: string) => void;
};

// CategoryChips is the line of categories on the Home: "Tutti", then one
// chip for each category, with a dot in the category's own color, as on
// its card in the Categorie page. However many there are, they stay on one
// line that slides sideways: the edges fade where more chips hide, and
// with a mouse two arrows move the line. The last chip opens the page
// with all the categories.
export function CategoryChips({ categories, chosen, onChoose }: CategoryChipsProps) {
  const list = useRef<HTMLUListElement>(null);
  const ends = useScrollEnds(list, true);
  const move = (direction: 1 | -1) => {
    const el = list.current;
    el?.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: "smooth" });
  };
  return (
    <div className={styles.root}>
      <span className={styles.label} aria-hidden="true">
        <Icon name="categories" size={18} />
        <span className={styles.labelText}>Categorie</span>
      </span>
      <div
        className={styles.track}
        data-left={ends.left || undefined}
        data-right={ends.right || undefined}
      >
        <ul ref={list} className={styles.chips} aria-label="Categorie">
          {["", ...categories.map((c) => c.name)].map((name) => {
            const category = categories.find((c) => c.name === name);
            return (
              <li key={name}>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={name === chosen}
                  onClick={() => onChoose(name)}
                >
                  {category && (
                    <span
                      className={styles.dot}
                      style={{ "--dot": tileColor(category) } as CSSProperties}
                    />
                  )}
                  {name || "Tutti"}
                </button>
              </li>
            );
          })}
          <li>
            <Link to="/categorie" className={`${styles.chip} ${styles.all}`}>
              Tutte le categorie
              <Icon name="chevronRight" size={16} />
            </Link>
          </li>
        </ul>
        {ends.left && (
          <button
            type="button"
            className={`${styles.arrow} ${styles.left}`}
            aria-label="Categorie precedenti"
            onClick={() => move(-1)}
          >
            <Icon name="chevronLeft" size={18} />
          </button>
        )}
        {ends.right && (
          <button
            type="button"
            className={`${styles.arrow} ${styles.right}`}
            aria-label="Altre categorie"
            onClick={() => move(1)}
          >
            <Icon name="chevronRight" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
