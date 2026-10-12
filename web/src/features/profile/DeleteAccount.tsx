import { type FormEvent, useState } from "react";
import { deleteMe } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useAuth } from "../../app/auth";
import styles from "./ProfilePage.module.css";

// DeleteAccount removes my account for good. It first says what is lost,
// then asks for the password: a phone left on the table is not enough.
export function DeleteAccount() {
  const { sessionClosed } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  if (!open) {
    return (
      <button type="button" className={styles.danger} onClick={() => setOpen(true)}>
        Elimina il mio account
      </button>
    );
  }

  const send = (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setProblem("");
    deleteMe(password)
      .then(sessionClosed)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
        setSending(false);
      });
  };

  return (
    <form
      className={`glass ${styles.form} ${styles.dangerForm}`}
      onSubmit={send}
      aria-label="Elimina il mio account"
    >
      <p className={styles.dangerText}>
        Il tuo account sparisce per sempre, insieme a cronologia, mi piace, playlist e commenti. Non
        si può tornare indietro. I video restano dove sono.
      </p>
      <label className={styles.field}>
        Scrivi la tua password per confermare
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          // biome-ignore lint/a11y/noAutofocus: the person just asked to delete
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {problem && (
        <p role="alert" className={styles.formProblem}>
          {problem}
        </p>
      )}
      <div className={styles.formButtons}>
        <button
          type="button"
          className={`glass ${styles.signOut}`}
          onClick={() => {
            setOpen(false);
            setPassword("");
            setProblem("");
          }}
        >
          Annulla
        </button>
        <button type="submit" className={styles.dangerSave} disabled={sending || password === ""}>
          Elimina per sempre
        </button>
      </div>
    </form>
  );
}

function explain(error: unknown): string {
  if (!(error instanceof ApiError)) return "Il server non risponde. Riprova tra poco.";
  switch (error.status) {
    case 403:
      return "La password non è giusta.";
    case 409:
      return "Sei l'unico amministratore: prima rendi amministratore un'altra persona.";
    case 429:
      return "Troppe password sbagliate. Aspetta un minuto e riprova.";
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
