import type { MouseEvent, ReactNode } from "react";
import { Icon } from "../../components/Icon";
import styles from "./RemovableCard.module.css";

type RemovableCardProps = {
  // card is a VideoCard with layout="row".
  card: ReactNode;
  // label says to screen readers what the button takes away, and where from.
  label: string;
  // title is the short hint shown under the mouse.
  title: string;
  onRemove: (event: MouseEvent<HTMLButtonElement>) => void;
};

// RemovableCard is a video in a list (history, a playlist) with a button
// that takes it out. The button sits inside the card, at its right edge, so
// the two read as one piece and light up together under the mouse.
export function RemovableCard({ card, label, title, onRemove }: RemovableCardProps) {
  return (
    <div className={styles.root}>
      {card}
      <button
        type="button"
        className={styles.remove}
        aria-label={label}
        title={title}
        onClick={onRemove}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
