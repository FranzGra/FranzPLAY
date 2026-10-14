import { type FormEvent, useState } from "react";
import { changePassword, passwordProblem } from "../../api/auth";
import { ApiError } from "../../api/client";
import styles from "./ProfilePage.module.css";

// PasswordForm changes my password. The other devices where I am logged in
// are logged out, this one stays in.
export function PasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  const send = (event: FormEvent) => {
    event.preventDefault();
    const mistake =
      passwordProblem(next) || (next !== again ? "Le due password nuove non sono uguali." : "");
    if (mistake) {
      setProblem(mistake);
      return;
    }
    setSending(true);
    setProblem("");
    changePassword(current, next)
      .then(onDone)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
        setSending(false);
      });
  };

  return (
    <form className={`glass ${styles.form}`} onSubmit={send} aria-label="Cambia password">
      <label className={styles.field}>
        Password attuale
        <input
          type="password"
          value={current}
          autoComplete="current-password"
          // biome-ignore lint/a11y/noAutofocus: the person just asked to change it
          autoFocus
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        Nuova password
        <input
          type="password"
          value={next}
          autoComplete="new-password"
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        Ripeti la nuova password
        <input
          type="password"
          value={again}
          autoComplete="new-password"
          onChange={(e) => setAgain(e.target.value)}
        />
      </label>
      {problem && (
        <p role="alert" className={styles.formProblem}>
          {problem}
        </p>
      )}
      <div className={styles.formButtons}>
        <button type="button" className={`glass ${styles.signOut}`} onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className={styles.save} disabled={sending || current === ""}>
          Cambia password
        </button>
      </div>
    </form>
  );
}

function explain(error: unknown): string {
  if (!(error instanceof ApiError)) return "Il server non risponde. Riprova tra poco.";
  switch (error.status) {
    case 403:
      return "La password attuale non è giusta.";
    case 400:
      return "La nuova password deve avere da 8 a 128 caratteri.";
    case 429:
      return "Troppe password sbagliate. Aspetta un minuto e riprova.";
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
