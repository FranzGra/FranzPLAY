import type { ReactNode } from "react";
import { useId } from "react";
import { Link } from "react-router";
import styles from "./VideoRow.module.css";

type VideoRowProps = {
  title: string;
  // more leads to the page with all the videos of the row.
  more?: string;
  children: ReactNode;
};

// VideoRow is a titled row of video cards that scrolls sideways, like the
// rows of YouTube's Home. children are the <li> of the cards.
export function VideoRow({ title, more, children }: VideoRowProps) {
  const id = useId();
  return (
    <section className={styles.root} aria-labelledby={id}>
      <div className={styles.top}>
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {more && (
          <Link to={more} className={styles.more} aria-label={`Vedi tutti: ${title}`}>
            Vedi tutti
          </Link>
        )}
      </div>
      <ul className={styles.list}>{children}</ul>
    </section>
  );
}
