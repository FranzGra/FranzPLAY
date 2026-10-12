import type { ReactNode, RefObject } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  const list = useRef<HTMLUListElement>(null);
  const ends = useScrollEnds(list, open);
  // One press moves by almost a screen of cards, keeping one in sight.
  const move = (direction: 1 | -1) => {
    const el = list.current;
    el?.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };
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
        {open && (
          <div className={styles.side}>
            {more && (
              <Link to={more} className={styles.more} aria-label={`Vedi tutti: ${title}`}>
                Vedi tutti
              </Link>
            )}
            {(ends.left || ends.right) && (
              <div className={styles.arrows}>
                <button
                  type="button"
                  className={styles.arrow}
                  disabled={!ends.left}
                  onClick={() => move(-1)}
                  aria-label={`Indietro: ${title}`}
                >
                  <Icon name="chevronLeft" size={18} />
                </button>
                <button
                  type="button"
                  className={styles.arrow}
                  disabled={!ends.right}
                  onClick={() => move(1)}
                  aria-label={`Avanti: ${title}`}
                >
                  <Icon name="chevronRight" size={18} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {open && (
        <ul ref={list} className={styles.list}>
          {children}
        </ul>
      )}
    </section>
  );
}

type Ends = { left: boolean; right: boolean };

// useScrollEnds says whether the row can still scroll left and right, and
// keeps the answer up to date while it scrolls or changes size.
function useScrollEnds(list: RefObject<HTMLUListElement | null>, open: boolean): Ends {
  const [ends, setEnds] = useState<Ends>({ left: false, right: false });
  const update = useCallback(() => {
    const el = list.current;
    if (!el) {
      return;
    }
    // A pixel of slack: zoomed pages scroll by fractions.
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEnds((old) => (old.left === left && old.right === right ? old : { left, right }));
  }, [list]);
  useEffect(() => {
    const el = list.current;
    if (!open || !el) {
      return;
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Cards arriving later, or a wider window, change what fits.
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    watch?.observe(el);
    for (const child of el.children) {
      watch?.observe(child);
    }
    return () => {
      el.removeEventListener("scroll", update);
      watch?.disconnect();
    };
  }, [list, open, update]);
  return ends;
}
