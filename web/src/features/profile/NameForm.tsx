import { type FormEvent, useState } from "react";
import { type Account, nameProblem, rename } from "../../api/auth";
import { ApiError } from "../../api/client";
import styles from "./ProfilePage.module.css";

// NameForm changes my name. It is also the name I log in with, so the form
// says so: next time, the old one will not work.
export function NameForm({
  current,
  onDone,
  onCancel,
}: {
  current: string;
  onDone: (account: Account) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(current);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  const send = (event: FormEvent) => {
    event.preventDefault();
    const mistake = nameProblem(name);
    if (mistake) {
      setProblem(mistake);
      return;
    }
    setSending(true);
    setProblem("");
    rename(name)
      .then(onDone)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
        setSending(false);
      });
  };

  return (
    <form className={`glass ${styles.form}`} onSubmit={send} aria-label="Cambia nome">
      <label className={styles.field}>
        Nuovo nome
        <input
          value={name}
          autoComplete="username"
          maxLength={64}
          // biome-ignore lint/a11y/noAutofocus: the person just asked to change it
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className={styles.formNote}>È anche il nome con cui entri in FranzPLAY.</p>
      {problem && (
        <p role="alert" className={styles.formProblem}>
          {problem}
        </p>
      )}
      <div className={styles.formButtons}>
        <button type="button" className={`glass ${styles.signOut}`} onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className={styles.save} disabled={sending || name.trim() === current}>
          Salva il nome
        </button>
      </div>
    </form>
  );
}

function explain(error: unknown): string {
  if (!(error instanceof ApiError)) return "Il server non risponde. Riprova tra poco.";
  switch (error.status) {
    case 409:
      return "Questo nome lo usa già un'altra persona.";
    case 400:
      return "Il nome può avere solo lettere, numeri, spazi, punti, trattini e trattini bassi.";
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
