import styles from "./PageLoading.module.css";

// PageLoading holds the place of a page while its code arrives. Like the
// other loading states it stays empty: on a good connection it lasts too
// little to be seen, and a blank space flickers less than a spinner.
export function PageLoading() {
  return <div className={styles.root} aria-busy="true" />;
}
