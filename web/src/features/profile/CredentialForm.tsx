import { type FormEvent, useState } from "react";
import {
  type Account,
  changeCredential,
  checkCredential,
  fetchMe,
  type Method,
  methodNames,
} from "../../api/auth";
import { ApiError } from "../../api/client";
import { type NewChoice, NewSecret } from "../auth/secret/NewSecret";
import { SecretInput } from "../auth/secret/SecretInput";
import { blockedText } from "../auth/secret/wait";
import styles from "./ProfilePage.module.css";

const currentName: Record<Method, string> = {
  password: "la tua password attuale",
  pin: "il tuo PIN attuale",
  pattern: "la tua sequenza attuale",
};

// CredentialForm changes how I log in: first I confirm the current
// password, PIN or pattern, then I choose a method among those allowed and
// set the new one. The other devices where I am logged in are logged out,
// this one stays in. onDone gets my account as it is now.
export function CredentialForm({
  account,
  onDone,
  onCancel,
}: {
  account: Account;
  onDone: (account: Account) => void;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [choice, setChoice] = useState<NewChoice | null>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");
  const [shake, setShake] = useState(0);

  const confirm = (value: string) => {
    if (value === "") return;
    setSending(true);
    setProblem("");
    checkCredential(value)
      .then(() => {
        setConfirmed(true);
        setSending(false);
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error, account.loginMethod));
        setCurrent("");
        setShake((n) => n + 1);
        setSending(false);
      });
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) {
      confirm(current);
      return;
    }
    if (!choice || choice.problem) {
      setProblem(choice?.problem ?? "");
      return;
    }
    setSending(true);
    setProblem("");
    changeCredential(current, choice.method, choice.secret)
      .then(() => fetchMe())
      .then((me) => {
        if (me) onDone(me);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (error instanceof ApiError && error.status === 403) {
          setConfirmed(false); // the current one changed meanwhile: ask again
          setCurrent("");
        }
        setProblem(explain(error, account.loginMethod));
        setSending(false);
      });
  };

  return (
    <form className={`glass ${styles.form}`} onSubmit={send} aria-label="Cambia accesso" noValidate>
      {!confirmed ? (
        <>
          <p className={styles.formTitle}>Prima conferma {currentName[account.loginMethod]}</p>
          <SecretInput
            method={account.loginMethod}
            label={`${methodNames[account.loginMethod]} attuale`}
            value={current}
            onChange={setCurrent}
            onComplete={confirm}
            autoFocus
            disabled={sending}
            shake={shake}
          />
        </>
      ) : (
        <>
          <p className={styles.formTitle}>Come vuoi entrare d'ora in poi?</p>
          <NewSecret
            allowed={account.allowedMethods}
            initial={account.mustChooseMethod ? undefined : account.loginMethod}
            onChange={setChoice}
            disabled={sending}
            passwordLabel="Nuova password"
          />
        </>
      )}
      {problem && (
        <p role="alert" className={styles.formProblem}>
          {problem}
        </p>
      )}
      <div className={styles.formButtons}>
        {onCancel && (
          <button type="button" className={`glass ${styles.signOut}`} onClick={onCancel}>
            Annulla
          </button>
        )}
        {(confirmed || account.loginMethod === "password") && (
          <button
            type="submit"
            className={styles.save}
            disabled={sending || (!confirmed && current === "")}
          >
            {confirmed ? "Salva" : "Continua"}
          </button>
        )}
      </div>
    </form>
  );
}

function explain(error: unknown, method: Method): string {
  if (!(error instanceof ApiError)) return "Il server non risponde. Riprova tra poco.";
  switch (error.status) {
    case 403:
      return (
        { password: "La password", pin: "Il PIN", pattern: "La sequenza" }[method] +
        (method === "pin" ? " non è giusto." : " non è giusta.")
      );
    case 400:
      return "Questo modo di entrare non va bene o non è ammesso per il tuo account.";
    case 429:
      return blockedText(error);
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
