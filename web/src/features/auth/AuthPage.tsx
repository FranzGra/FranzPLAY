import { type FormEvent, useId, useState } from "react";
import { login, nameProblem, passwordProblem, setup } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useAuth } from "../../app/auth";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import styles from "./AuthPage.module.css";

type Mode = "login" | "setup";

// AuthPage is what people see before logging in: the login form, or, on a
// brand new FranzPLAY, the form that creates the administrator.
export function AuthPage({ mode }: { mode: Mode }) {
  usePageTitle(mode === "setup" ? "Benvenuto" : "Accedi");
  const { signedIn } = useAuth();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const errorId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = mode === "setup" ? checkSetup(name, password, confirm) : "";
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const account =
        mode === "setup" ? await setup(code, name, password) : await login(name, password);
      signedIn(account);
    } catch (err) {
      setError(explain(err, mode));
      setBusy(false);
    }
  }

  const describedBy = error ? errorId : undefined;
  return (
    <main className={styles.root}>
      <form className={`glass ${styles.card}`} onSubmit={onSubmit} noValidate>
        <span className={styles.logoMark} aria-hidden="true">
          <Icon name="play" size={22} />
        </span>
        <h1 className={styles.title}>
          {mode === "setup" ? "Benvenuto in FranzPLAY" : "Accedi a FranzPLAY"}
        </h1>
        {mode === "setup" && (
          <p className={styles.intro}>
            Crea l'amministratore, cioè il tuo utente. Il codice di installazione è scritto nel
            terminale dove hai avviato FranzPLAY, alla voce <code>setup_code</code>.
          </p>
        )}

        {mode === "setup" && (
          <Field
            label="Codice di installazione"
            value={code}
            onChange={setCode}
            autoComplete="off"
            placeholder="XXXX-XXXX-XXXX"
            describedBy={describedBy}
          />
        )}
        <Field
          label="Nome"
          value={name}
          onChange={setName}
          autoComplete="username"
          describedBy={describedBy}
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === "setup" ? "new-password" : "current-password"}
          describedBy={describedBy}
        />
        {mode === "setup" && (
          <Field
            label="Ripeti la password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            describedBy={describedBy}
          />
        )}

        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button type="submit" className={styles.submit} disabled={busy}>
          {mode === "setup" ? "Crea e entra" : "Entra"}
        </button>
      </form>
    </main>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password";
  autoComplete: string;
  placeholder?: string;
  describedBy?: string;
};

export function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  describedBy,
}: FieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-describedby={describedBy}
        autoCapitalize="none"
        spellCheck={false}
        required
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

// checkSetup finds mistakes before asking the server.
export function checkSetup(name: string, password: string, confirm: string): string {
  const problem = nameProblem(name) || passwordProblem(password);
  if (problem) {
    return problem;
  }
  if (password !== confirm) {
    return "Le due password non sono uguali.";
  }
  return "";
}

// explain turns a refusal of the server into a sentence for people.
function explain(error: unknown, mode: Mode): string {
  if (!(error instanceof ApiError)) {
    return "Il server non risponde. Controlla che FranzPLAY sia acceso e riprova.";
  }
  switch (error.status) {
    case 400:
      return mode === "setup"
        ? "Il nome può contenere solo lettere, numeri, spazi, punti, trattini e trattini bassi."
        : "Scrivi nome e password.";
    case 401:
      return mode === "setup"
        ? "Il codice di installazione non è giusto. Copialo dal terminale."
        : "Nome o password sbagliati.";
    case 409:
      return "FranzPLAY ha già un amministratore: ricarica la pagina per accedere.";
    case 429:
      return "Troppe password sbagliate. Aspetta un minuto e riprova.";
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
