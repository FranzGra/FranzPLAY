import { type ReactNode, useId } from "react";
import styles from "./VideoRow.module.css";

// VideoRow is a titled row of video cards that scrolls sideways, like the
// rows of YouTube's Home. children are the <li> of the cards.
export function VideoRow({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.root} aria-labelledby={id}>
      <h2 id={id} className={styles.title}>
        {title}
      </h2>
      <ul className={styles.list}>{children}</ul>
    </section>
  );
}
