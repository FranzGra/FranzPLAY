import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

type EmptyStateProps = {
  title: string;
  children: ReactNode;
  // headingLevel is 1 when the empty state is the whole page, 2 (default) inside a page.
  headingLevel?: 1 | 2;
};

// EmptyState explains what will appear on a page that has nothing to show yet.
export function EmptyState({ title, children, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className={`glass ${styles.root}`}>
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.text}>{children}</p>
    </div>
  );
}
