import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { fetchSetup, login, loginMethod, type Method, nameProblem, register } from "../../api/auth";
import { siteName } from "../../api/site";
import { useAuth } from "../../app/auth";
import { useSite } from "../../app/site";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import styles from "./AuthPage.module.css";
import { explain, type Mode } from "./authText";
import { SetupWizard } from "./SetupWizard";
import { type NewChoice, NewSecret } from "./secret/NewSecret";
import { SecretInput } from "./secret/SecretInput";

export { checkSetup } from "./authText";

function title(mode: Exclude<Mode, "setup">, name: string): string {
  switch (mode) {
    case "login":
      return `Accedi a ${name}`;
    case "register":
      return "Crea il tuo account";
  }
}

const methodWord: Record<Method, string> = {
  password: "la password",
  pin: "il PIN",
  pattern: "la sequenza",
};

// otherWays names the link to the PIN and the pattern, when the server
// allows them, or returns "".
function otherWays(allowed: Method[]): string {
  const pin = allowed.includes("pin");
  const pattern = allowed.includes("pattern");
  if (pin && pattern) return "Entra con PIN o sequenza";
  if (pin) return "Entra con il PIN";
  if (pattern) return "Entra con la sequenza";
  return "";
}

// AuthPage is what people see before logging in: the login form, or, on a
// brand new FranzPLAY, the wizard that creates the administrator
// (SetupWizard). When the administrator lets anyone register, the login
// form also offers to create an account.
export function AuthPage(props: {
  mode: Mode;
  setupCode?: boolean;
  openRegistration?: boolean;
  onBack?: () => void;
}) {
  if (props.mode === "setup") return <SetupWizard setupCode={props.setupCode ?? false} />;
  return (
    <SignIn mode={props.mode} openRegistration={props.openRegistration} onBack={props.onBack} />
  );
}

function SignIn({
  mode: startMode,
  openRegistration = false,
  onBack,
}: {
  mode: Exclude<Mode, "setup">;
  openRegistration?: boolean;
  // onBack, when given, offers a way back to the page the person came
  // from, like the video of a public link.
  onBack?: () => void;
}) {
  const [mode, setMode] = useState(startMode);
  usePageTitle({ login: "Accedi", register: "Registrati" }[mode]);
  const { signedIn } = useAuth();
  const look = useSite().look;
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  const form = useRef<HTMLFormElement>(null);
  // Logging in shows name and password together, so password managers
  // fill both. Who enters with a PIN or a pattern goes on to it (method,
  // asked of the server). null: name and password.
  const [method, setMethod] = useState<Method | null>(null);
  // hint says, without alarm, why the page asks something else.
  const [hint, setHint] = useState("");
  const [shake, setShake] = useState(0);
  // The methods the server allows: at login they decide which other ways
  // are offered; registering, what the person may choose.
  const [allowed, setAllowed] = useState<Method[]>(["password"]);
  const [choice, setChoice] = useState<NewChoice | null>(null);

  useEffect(() => {
    const stop = new AbortController();
    fetchSetup(stop.signal)
      .then((s) => setAllowed(s.methods))
      .catch((err: unknown) => {
        if (!stop.signal.aborted) console.error(err);
      });
    return () => stop.abort();
  }, []);

  function focus(field: "username" | "password") {
    const input = form.current?.elements.namedItem(field);
    if (input instanceof HTMLInputElement) input.focus();
  }

  // askMethod asks the server how the person enters, which never counts as
  // a try. A password stays here; a PIN or a pattern takes its place.
  async function askMethod(): Promise<Method | null> {
    if (name.trim() === "") {
      setError("Scrivi il tuo nome.");
      focus("username");
      return null;
    }
    setBusy(true);
    setError("");
    setHint("");
    try {
      const m = await loginMethod(name);
      if (m !== "password") {
        setMethod(m);
        setPassword("");
        setHint(`${name.trim()} entra con ${methodWord[m]}.`);
      }
      setBusy(false);
      return m;
    } catch (err) {
      setError(explain(err, mode, "password"));
      setBusy(false);
      return null;
    }
  }

  // signIn sends name and password. The server is asked first how the
  // person enters, so a password is never tried against a PIN or a
  // pattern and never counts as a wrong try of theirs.
  async function signIn() {
    if ((await askMethod()) !== "password") return;
    if (password === "") {
      setError("Scrivi la password.");
      focus("password");
      return;
    }
    await enter("password", password);
  }

  // otherWay is the link to the PIN and the pattern: it shows the way of
  // whoever wrote the name, the password too when that is theirs.
  async function otherWay() {
    if (name.trim() === "") {
      setError("Scrivi prima il tuo nome.");
      focus("username");
      return;
    }
    if ((await askMethod()) === "password") {
      setHint(`${name.trim()} entra con la password.`);
      focus("password");
    }
  }

  async function enter(m: Method, secret: string) {
    if (secret === "") {
      setError(m === "password" ? "Scrivi la password." : "");
      return;
    }
    setBusy(true);
    setError("");
    try {
      signedIn(await login(name, secret));
    } catch (err) {
      setError(explain(err, mode, m));
      setHint("");
      setPassword("");
      setShake((n) => n + 1);
      setBusy(false);
      if (m === "password") requestAnimationFrame(() => focus("password"));
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "login") {
      await (method === null ? signIn() : enter(method, password));
      return;
    }
    const problem = nameProblem(name) || choice?.problem || "";
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      signedIn(await register(name, choice?.method ?? "password", choice?.secret ?? ""));
    } catch (err) {
      setError(explain(err, mode, choice?.method ?? "password"));
      setBusy(false);
    }
  }

  const describedBy = error ? errorId : undefined;
  const others = otherWays(allowed);
  return (
    <main className={styles.root}>
      <form ref={form} className={`glass ${styles.card}`} onSubmit={onSubmit} noValidate>
        <span className={styles.logoMark} aria-hidden="true">
          <Icon name="play" size={22} />
        </span>
        <h1 className={styles.title}>{title(mode, siteName(look))}</h1>
        {mode === "register" && (
          <p className={styles.intro}>Scegli il nome e il modo in cui entrerai in FranzPLAY.</p>
        )}

        {mode === "login" && method !== null ? (
          <>
            <p className={styles.who}>
              <span>{name.trim()}</span>
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  setMethod(null);
                  setPassword("");
                  setError("");
                  setHint("");
                }}
              >
                Cambia nome
              </button>
            </p>
            {/* For password managers: the name goes with the password. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={name}
              readOnly
              hidden
            />
            <SecretInput
              method={method}
              value={password}
              onChange={(value) => {
                setPassword(value);
                if (value !== "" && method !== "password") setError("");
              }}
              onComplete={(value) => void enter(method, value)}
              autoFocus
              disabled={busy}
              shake={shake}
              describedBy={describedBy}
            />
          </>
        ) : (
          <Field
            label="Nome"
            name="username"
            value={name}
            onChange={setName}
            autoComplete="username"
            describedBy={describedBy}
          />
        )}
        {mode === "login" && method === null && (
          <Field
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            describedBy={describedBy}
          />
        )}
        {mode === "register" && <NewSecret allowed={allowed} onChange={setChoice} />}
        {hint && !error && (
          <p className={styles.hint} role="status">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}

        {(mode !== "login" || method === null || method === "password") && (
          <button type="submit" className={styles.submit} disabled={busy}>
            {mode === "register" ? "Crea e entra" : "Entra"}
          </button>
        )}

        {mode === "login" && method === null && others !== "" && (
          <p className={styles.switch}>
            <button
              type="button"
              className={styles.link}
              disabled={busy}
              onClick={() => void otherWay()}
            >
              {others}
            </button>
          </p>
        )}

        {openRegistration && (
          <p className={styles.switch}>
            {mode === "login" ? "Non hai un account?" : "Hai già un account?"}{" "}
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
                setMethod(null);
                setPassword("");
                setHint("");
              }}
            >
              {mode === "login" ? "Registrati" : "Accedi"}
            </button>
          </p>
        )}
        {onBack && (
          <p className={styles.switch}>
            <button type="button" className={styles.link} onClick={onBack}>
              Torna al video
            </button>
          </p>
        )}
      </form>
    </main>
  );
}

type FieldProps = {
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password";
  autoComplete: string;
  placeholder?: string;
  describedBy?: string;
};

export function Field({
  label,
  name,
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
        name={name}
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
