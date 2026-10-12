import { useEffect, useState } from "react";
import { fetchRegistration, saveRegistration } from "../../api/auth";
import { EmptyState } from "../../components/EmptyState";
import styles from "./Admin.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; open: boolean };

// SitePage holds the settings of the whole site. For now: whether anyone
// may create an account by themselves.
export function SitePage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchRegistration(controller.signal)
      .then((open) => setState({ kind: "ready", open }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "error") {
    return (
      <EmptyState title="Impostazioni non disponibili">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }

  const change = (open: boolean) => {
    setBusy(true);
    setProblem("");
    setDone("");
    saveRegistration(open)
      .then((saved) => {
        setState({ kind: "ready", open: saved });
        setDone(
          saved
            ? "Registrazione aperta. Nella pagina di accesso c'è il tasto «Registrati»."
            : "Registrazione chiusa. Si entra solo con un invito o se aggiungi tu la persona.",
        );
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      <h2 className={styles.groupTitle}>Accesso al sito</h2>
      <ul className={styles.list} aria-label="Accesso al sito">
        <li className={`glass ${styles.person}`}>
          <div>
            <p className={styles.name}>Chiunque può registrarsi</p>
            <p className={styles.role}>
              Se è acceso, chi apre FranzPLAY può crearsi un account da solo, senza invito. Le
              persone nuove sono utenti normali e non possono caricare video: lo decidi tu in
              Persone. Se è spento, si entra solo con un invito o se aggiungi tu la persona.
            </p>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              aria-label="Chiunque può registrarsi"
              checked={state.open}
              disabled={busy}
              onChange={(e) => change(e.target.checked)}
            />
            Acceso
          </label>
        </li>
      </ul>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className={styles.done}>
          {done}
        </p>
      )}
    </>
  );
}
