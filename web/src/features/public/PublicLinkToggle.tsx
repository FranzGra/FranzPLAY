import { useState } from "react";
import { Icon } from "../../components/Icon";
import styles from "./Public.module.css";
import { PublicLinkPanel } from "./PublicLinkPanel";

// PublicLinkToggle is the public link of a video in a list: whether it is
// public, and a button that opens the panel to make, copy, renew or turn
// off its link. link comes with the list, so nothing is asked per row.
export function PublicLinkToggle({
  videoId,
  title,
  link,
  onChange,
}: {
  videoId: number;
  title: string;
  link: string | null;
  onChange?: (link: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // The list may not follow the change: the pill does, here.
  const [current, setCurrent] = useState(link);
  return (
    <div>
      <div className={styles.cardLink}>
        <span className={current === null ? styles.stateOff : styles.stateOn}>
          {current === null ? "Non pubblico" : "Pubblico"}
        </span>
        <button
          type="button"
          className={`glass ${styles.pill} ${styles.small}`}
          aria-expanded={open}
          aria-label={`Link pubblico di ${title}`}
          onClick={() => setOpen(!open)}
        >
          <Icon name="globe" size={16} />
          Link pubblico
        </button>
      </div>
      {open && (
        <PublicLinkPanel
          videoId={videoId}
          initial={current}
          onChange={(next) => {
            setCurrent(next);
            onChange?.(next);
          }}
          compact
        />
      )}
    </div>
  );
}
