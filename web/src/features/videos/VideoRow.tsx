import type { ReactNode, RefObject } from "react";
import { Children, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { Icon, type IconName } from "../../components/Icon";
import { useSections } from "../home/look";
import type { Fold } from "../home/useHomeLayout";
import styles from "./VideoRow.module.css";

type VideoRowProps = {
  title: string;
  // icon is drawn in a small tile before the title.
  icon?: IconName;
  // more leads to the page with all the videos of the row.
  more?: string;
  // fold lets the person close the row by its title, and open it again.
  fold?: Fold;
  children: ReactNode;
};

// VideoRow is a big titled section of video cards, like the sections of
// the old FranzPLAY's Home. On a computer or tablet it shows one or two
// lines of cards, or one line that scrolls sideways, as the person chose;
// on a phone it is always a line that scrolls. children are the <li> of
// the cards. A closed section folds away softly.
export function VideoRow({ title, icon, more, fold, children }: VideoRowProps) {
  const id = useId();
  const open = fold?.open ?? true;
  const sections = useSections();
  const scroll = sections === "scroll";
  const list = useRef<HTMLUListElement>(null);
  const ends = useScrollEnds(list, open && scroll);
  const columns = useColumns(list, !scroll);
  const [all, setAll] = useState(false);
  const cards = Children.toArray(children);
  // Unknown columns (the grid not drawn yet) show every card.
  const fits = columns * (sections === "two" ? 2 : 1);
  const cut = !scroll && !all && fits > 0 && cards.length > fits;
  const extra = !scroll && fits > 0 && cards.length > fits;
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
              title={open ? "Chiudi questa sezione" : "Apri questa sezione"}
            >
              {icon && <TitleIcon name={icon} />}
              <span className={styles.titleText}>{title}</span>
              <span className={styles.chevron}>
                <Icon name="chevronRight" size={20} />
              </span>
            </button>
          ) : (
            <span className={styles.plain}>
              {icon && <TitleIcon name={icon} />}
              {title}
            </span>
          )}
        </h2>
        {open && (
          <div className={styles.side}>
            {more && (
              <Link to={more} className={styles.more} aria-label={`Vedi tutti: ${title}`}>
                Vedi tutti
              </Link>
            )}
            {scroll && (ends.left || ends.right) && (
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
      {/* Closed, the cards stay in the page but fold away, so the section
          can open and close with a soft movement. */}
      <div className={styles.body} aria-hidden={!open} inert={!open}>
        <div className={styles.inner}>
          <ul ref={list} className={`stagger ${styles.list}`} data-sections={sections}>
            {cut ? cards.slice(0, fits) : cards}
          </ul>
          {extra && (
            <button
              type="button"
              className={styles.all}
              aria-expanded={all}
              onClick={() => setAll((a) => !a)}
            >
              {all ? "Mostra meno" : `Mostra tutti (${cards.length})`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function TitleIcon({ name }: { name: IconName }) {
  return (
    <span className={styles.icon}>
      <Icon name={name} size={20} />
    </span>
  );
}

// useColumns counts the cards that fit in a line of the grid, and keeps
// counting while the window changes size. 0 means not known yet.
function useColumns(list: RefObject<HTMLUListElement | null>, grid: boolean): number {
  const [columns, setColumns] = useState(0);
  useEffect(() => {
    const el = list.current;
    if (!grid || !el) {
      setColumns(0);
      return;
    }
    const count = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean);
      // Without real measures (as in tests) the template is not a list
      // of widths in pixels: then every card shows.
      setColumns(tracks.every((t) => t.endsWith("px")) ? tracks.length : 0);
    };
    count();
    if (typeof ResizeObserver === "undefined") return;
    // A card changes width when another look changes the columns, even
    // if the line keeps its width.
    const watch = new ResizeObserver(count);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    return () => watch.disconnect();
  }, [list, grid]);
  return columns;
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
