import { type FormEvent, useState } from "react";
import { deleteMe, type Method } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useAccount, useAuth } from "../../app/auth";
import { SecretInput } from "../auth/secret/SecretInput";
import { blockedText } from "../auth/secret/wait";
import styles from "./ProfilePage.module.css";

// DeleteAccount removes my account for good. It first says what is lost,
// then asks for the password: a phone left on the table is not enough.
export function DeleteAccount() {
  const { sessionClosed } = useAuth();
  const method = useAccount().loginMethod;
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

  const remove = (secret: string) => {
    setSending(true);
    setProblem("");
    deleteMe(secret)
      .then(sessionClosed)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error, method));
        if (method !== "password") setPassword("");
        setSending(false);
      });
  };
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (method === "password") remove(password);
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
      <SecretInput
        method={method}
        label={confirmLabel[method]}
        value={password}
        onChange={setPassword}
        onComplete={remove}
        autoFocus
        disabled={sending}
      />
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
        {method === "password" && (
          <button type="submit" className={styles.dangerSave} disabled={sending || password === ""}>
            Elimina per sempre
          </button>
        )}
      </div>
    </form>
  );
}

const confirmLabel: Record<Method, string> = {
  password: "Scrivi la tua password per confermare",
  pin: "Scrivi il tuo PIN per confermare: l'account sparisce subito",
  pattern: "Disegna la tua sequenza per confermare: l'account sparisce subito",
};

function explain(error: unknown, method: Method): string {
  if (!(error instanceof ApiError)) return "Il server non risponde. Riprova tra poco.";
  switch (error.status) {
    case 403:
      return {
        password: "La password non è giusta.",
        pin: "Il PIN non è giusto.",
        pattern: "La sequenza non è giusta.",
      }[method];
    case 409:
      return "Sei l'unico amministratore: prima rendi amministratore un'altra persona.";
    case 429:
      return blockedText(error);
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
