import { EmptyState } from "../components/EmptyState";
import { useAuth } from "./auth";
import styles from "./StartupProblem.module.css";

// StartupProblem is shown when the server does not answer at all.
export function StartupProblem() {
  const { retry } = useAuth();
  return (
    <main className={styles.root}>
      <EmptyState title="Il server non risponde" headingLevel={1}>
        Controlla che FranzPLAY sia acceso, poi riprova.
      </EmptyState>
      <button type="button" className={`glass ${styles.retry}`} onClick={retry}>
        Riprova
      </button>
    </main>
  );
}
