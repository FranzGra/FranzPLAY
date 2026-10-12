import type { CSSProperties } from "react";
import styles from "./Avatar.module.css";

// Avatar is a person's round picture: for now the first letter of their
// name, the same on the profile, the channel and the top bar. Its size
// comes from size, or else from --avatar-size set by the page around it
// (so a page can change it on phones).
export function Avatar({ name, size }: { name: string; size?: number }) {
  return (
    <span
      className={styles.root}
      style={size === undefined ? undefined : ({ "--avatar-size": `${size}px` } as CSSProperties)}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
