import { type FormEvent, useEffect, useId, useState } from "react";
import {
  fetchSetup,
  login,
  loginMethod,
  type Method,
  nameProblem,
  passwordProblem,
  register,
  setup,
} from "../../api/auth";
import { ApiError } from "../../api/client";
import { type Look, lookProblem, saveLook, siteName } from "../../api/site";
import { useAuth } from "../../app/auth";
import { useSite } from "../../app/site";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { LookFields } from "../admin/LookFields";
import styles from "./AuthPage.module.css";
import { type NewChoice, NewSecret } from "./secret/NewSecret";
import { SecretInput } from "./secret/SecretInput";
import { blockedText } from "./secret/wait";

type Mode = "login" | "setup" | "register";

function title(mode: Mode, name: string): string {
  switch (mode) {
    case "login":
      return `Accedi a ${name}`;
    case "setup":
      return "Benvenuto in FranzPLAY";
    case "register":
      return "Crea il tuo account";
  }
}

// AuthPage is what people see before logging in: the login form, or, on a
// brand new FranzPLAY, the form that creates the administrator (asking for
// the code in the log only when the installer turned it on). When the
// administrator lets anyone register, the login form also offers to
// create an account.
export function AuthPage({
  mode: startMode,
  setupCode = false,
  openRegistration = false,
  onBack,
}: {
  mode: Mode;
  setupCode?: boolean;
  openRegistration?: boolean;
  // onBack, when given, offers a way back to the page the person came
  // from, like the video of a public link.
  onBack?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(startMode);
  usePageTitle({ login: "Accedi", setup: "Benvenuto", register: "Registrati" }[mode]);
  const { signedIn } = useAuth();
  const site = useSite();
  const look = site.look;
  // At the first setup the administrator can also name the site.
  const [newLook, setNewLook] = useState<Look>(look);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  // Logging in goes in two steps: the name, then the way that person
  // enters (method), asked of the server. null: still at the name.
  const [method, setMethod] = useState<Method | null>(null);
  const [shake, setShake] = useState(0);
  // Registering: the methods allowed, and what the person chose.
  const [allowed, setAllowed] = useState<Method[]>(["password"]);
  const [choice, setChoice] = useState<NewChoice | null>(null);

  useEffect(() => {
    if (mode !== "register") return;
    const stop = new AbortController();
    fetchSetup(stop.signal)
      .then((s) => setAllowed(s.methods))
      .catch((err: unknown) => {
        if (!stop.signal.aborted) console.error(err);
      });
    return () => stop.abort();
  }, [mode]);

  // askMethod is the first step of logging in.
  async function askMethod() {
    if (name.trim() === "") {
      setError("Scrivi il tuo nome.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setMethod(await loginMethod(name));
      setPassword("");
    } catch (err) {
      setError(explain(err, mode, "password"));
    }
    setBusy(false);
  }

  async function enter(secret: string) {
    if (method === null) return;
    if (secret === "") {
      setError(method === "password" ? "Scrivi la password." : "");
      return;
    }
    setBusy(true);
    setError("");
    try {
      signedIn(await login(name, secret));
    } catch (err) {
      setError(explain(err, mode, method));
      setPassword("");
      setShake((n) => n + 1);
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "login") {
      await (method === null ? askMethod() : enter(password));
      return;
    }
    const problem =
      mode === "register"
        ? nameProblem(name) || choice?.problem || ""
        : checkSetup(name, password, confirm) || lookProblem(newLook);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const account =
        mode === "setup"
          ? await setup(setupCode ? code : "", name, password)
          : await register(name, choice?.method ?? "password", choice?.secret ?? "");
      if (mode === "setup") {
        await keepLook(newLook);
      }
      signedIn(account);
    } catch (err) {
      setError(explain(err, mode, choice?.method ?? "password"));
      setBusy(false);
    }
  }

  // keepLook saves the name and color chosen at the first setup. The
  // administrator is already created: if this fails, FranzPLAY keeps its
  // own name, which can be changed later in Amministrazione › Sito.
  async function keepLook(chosen: Look) {
    const same =
      chosen.nameFirst === look.nameFirst &&
      chosen.nameSecond === look.nameSecond &&
      chosen.color.toLowerCase() === look.color;
    if (same) return;
    try {
      site.changed(await saveLook(chosen));
    } catch (err) {
      console.error(err);
    }
  }

  const describedBy = error ? errorId : undefined;
  return (
    <main className={styles.root}>
      <form className={`glass ${styles.card}`} onSubmit={onSubmit} noValidate>
        <span className={styles.logoMark} aria-hidden="true">
          <Icon name="play" size={22} />
        </span>
        <h1 className={styles.title}>{title(mode, siteName(look))}</h1>
        {mode === "setup" && (
          <p className={styles.intro}>
            Crea l'amministratore, cioè il tuo utente: potrai gestire video, persone e impostazioni.
            {setupCode && (
              <>
                {" "}
                Il codice di installazione è scritto nel terminale dove hai avviato FranzPLAY, alla
                voce <code>setup_code</code>.
              </>
            )}
          </p>
        )}

        {mode === "register" && (
          <p className={styles.intro}>Scegli il nome e il modo in cui entrerai in FranzPLAY.</p>
        )}

        {mode === "setup" && setupCode && (
          <Field
            label="Codice di installazione"
            value={code}
            onChange={setCode}
            autoComplete="off"
            placeholder="XXXX-XXXX-XXXX"
            describedBy={describedBy}
          />
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
              onComplete={(value) => void enter(value)}
              autoFocus
              disabled={busy}
              shake={shake}
              describedBy={describedBy}
            />
          </>
        ) : (
          <Field
            label="Nome"
            value={name}
            onChange={setName}
            autoComplete="username"
            describedBy={describedBy}
          />
        )}
        {mode === "setup" && (
          <>
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              describedBy={describedBy}
            />
            <Field
              label="Ripeti la password"
              type="password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              describedBy={describedBy}
            />
          </>
        )}
        {mode === "register" && <NewSecret allowed={allowed} onChange={setChoice} />}
        {mode === "setup" && (
          <section className={styles.siteLook} aria-label="Il tuo sito">
            <p className={styles.intro}>
              Come si chiama il tuo sito? Puoi lasciarlo così e cambiarlo quando vuoi in
              Amministrazione.
            </p>
            <LookFields look={newLook} onChange={setNewLook} />
          </section>
        )}

        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}

        {(mode !== "login" || method === null || method === "password") && (
          <button type="submit" className={styles.submit} disabled={busy}>
            {mode !== "login" ? "Crea e entra" : method === null ? "Avanti" : "Entra"}
          </button>
        )}

        {openRegistration && mode !== "setup" && (
          <p className={styles.switch}>
            {mode === "login" ? "Non hai un account?" : "Hai già un account?"}{" "}
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
                setConfirm("");
                setMethod(null);
                setPassword("");
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

const wrongWhat: Record<Method, string> = {
  password: "Nome o password sbagliati.",
  pin: "Nome o PIN sbagliati.",
  pattern: "Nome o sequenza sbagliati.",
};

// explain turns a refusal of the server into a sentence for people.
function explain(error: unknown, mode: Mode, method: Method): string {
  if (!(error instanceof ApiError)) {
    return "Il server non risponde. Controlla che FranzPLAY sia acceso e riprova.";
  }
  switch (error.status) {
    case 400:
      if (mode === "login") return "Scrivi nome e password.";
      if (error.message.includes("method")) {
        return "Questo modo di entrare non è ammesso su questo server: scegline un altro.";
      }
      return "Il nome può contenere solo lettere, numeri, spazi, punti, trattini e trattini bassi.";
    case 401:
      return mode === "setup"
        ? "Il codice di installazione non è giusto. Copialo dal terminale."
        : wrongWhat[method];
    case 403:
      if (mode !== "register" || error.message === "request from another site") {
        return "Il server ha rifiutato la richiesta perché arriva da un indirizzo diverso da quello del sito. Se usi un proxy, controlla che passi l'indirizzo giusto.";
      }
      return "La registrazione è chiusa: per entrare chiedi un invito a chi gestisce FranzPLAY.";
    case 409:
      return mode === "register"
        ? "Questo nome lo usa già un'altra persona: scegline un altro."
        : "FranzPLAY ha già un amministratore: ricarica la pagina per accedere.";
    case 429:
      return mode === "register"
        ? "Troppi account nuovi da questa rete. Aspetta qualche minuto e riprova."
        : blockedText(error);
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
