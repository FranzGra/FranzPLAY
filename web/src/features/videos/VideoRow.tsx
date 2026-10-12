import type { ReactNode } from "react";
import { useId } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import type { Fold } from "../home/useHomeLayout";
import styles from "./VideoRow.module.css";

type VideoRowProps = {
  title: string;
  // more leads to the page with all the videos of the row.
  more?: string;
  // fold lets the person close the row by its title, and open it again.
  fold?: Fold;
  children: ReactNode;
};

// VideoRow is a titled row of video cards that scrolls sideways, like the
// rows of YouTube's Home. children are the <li> of the cards.
export function VideoRow({ title, more, fold, children }: VideoRowProps) {
  const id = useId();
  const open = fold?.open ?? true;
  return (
    <section className={styles.root} aria-labelledby={id} data-open={open}>
      <div className={styles.top}>
        <h2 id={id} className={styles.title}>
          {fold ? (
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={open}
              onClick={fold.onToggle}
              title={open ? "Chiudi questa riga" : "Apri questa riga"}
            >
              {title}
              <Icon name="chevronRight" size={18} />
            </button>
          ) : (
            title
          )}
        </h2>
        {more && open && (
          <Link to={more} className={styles.more} aria-label={`Vedi tutti: ${title}`}>
            Vedi tutti
          </Link>
        )}
      </div>
      {open && <ul className={styles.list}>{children}</ul>}
    </section>
  );
}
