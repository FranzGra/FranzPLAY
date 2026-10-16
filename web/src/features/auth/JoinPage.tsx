import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { fetchSetup, type Method, nameProblem } from "../../api/auth";
import { ApiError } from "../../api/client";
import { checkInvite, join } from "../../api/invites";
import { useAuth } from "../../app/auth";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { Field } from "./AuthPage";
import styles from "./AuthPage.module.css";
import { type NewChoice, NewSecret } from "./secret/NewSecret";

type State = "checking" | "valid" | "invalid" | "offline";

// JoinPage is what someone sees opening an invite link: they choose their
// name and password, and they are in. The code of the invite is after "#"
// in the address.
export function JoinPage() {
  usePageTitle("Invito");
  const { state: auth } = useAuth();
  const code = useLocation().hash.slice(1);
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    if (code === "") {
      setState("invalid");
      return;
    }
    const controller = new AbortController();
    checkInvite(code, controller.signal)
      .then((ok) => setState(ok ? "valid" : "invalid"))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState("offline");
      });
    return () => controller.abort();
  }, [code]);

  if (auth.kind === "signed-in") {
    return (
      <Message title="Sei già dentro">
        Questo link serve a una persona nuova per creare il suo account. Tu sei già dentro come{" "}
        {auth.account.name}: manda il link a chi vuoi invitare.
      </Message>
    );
  }
  switch (state) {
    case "checking":
      return <main className={styles.root} aria-busy="true" />;
    case "invalid":
      return (
        <Message title="Questo invito non funziona più">
          Forse è già stato usato, è scaduto o è stato tolto. Chiedi un invito nuovo a chi ti ha
          mandato il link.
        </Message>
      );
    case "offline":
      return (
        <Message title="Il server non risponde">
          Controlla di essere collegato e riapri il link tra poco.
        </Message>
      );
    case "valid":
      return <JoinForm code={code} />;
  }
}

function JoinForm({ code }: { code: string }) {
  const { signedIn } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [allowed, setAllowed] = useState<Method[]>(["password"]);
  const [choice, setChoice] = useState<NewChoice | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const errorId = useId();

  useEffect(() => {
    const stop = new AbortController();
    fetchSetup(stop.signal)
      .then((s) => setAllowed(s.methods))
      .catch((err: unknown) => {
        if (!stop.signal.aborted) console.error(err);
      });
    return () => stop.abort();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = nameProblem(name) || choice?.problem || "";
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const account = await join(code, name, choice?.secret ?? "", choice?.method);
      navigate("/", { replace: true });
      signedIn(account);
    } catch (err) {
      setError(explain(err));
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
        <h1 className={styles.title}>Sei stato invitato in FranzPLAY</h1>
        <p className={styles.intro}>
          Scegli il nome con cui ti vedranno gli altri e il modo in cui entrerai le prossime volte.
        </p>
        <Field
          label="Nome"
          value={name}
          onChange={setName}
          autoComplete="username"
          describedBy={describedBy}
        />
        <NewSecret allowed={allowed} onChange={setChoice} />
        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={styles.submit} disabled={busy}>
          Crea e entra
        </button>
      </form>
    </main>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={styles.root}>
      <div className={`glass ${styles.card}`}>
        <span className={styles.logoMark} aria-hidden="true">
          <Icon name="play" size={22} />
        </span>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.intro}>{children}</p>
        <Link to="/" replace className={`${styles.submit} ${styles.asLink}`}>
          Vai a FranzPLAY
        </Link>
      </div>
    </main>
  );
}

// explain turns a refusal of the server into a sentence for people.
function explain(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Il server non risponde. Controlla di essere collegato e riprova.";
  }
  switch (error.status) {
    case 400:
      return "Il nome può contenere solo lettere, numeri, spazi, punti, trattini e trattini bassi.";
    case 409:
      return "C'è già una persona con questo nome: scegline un altro.";
    case 410:
      return "Questo invito non funziona più: chiedine uno nuovo a chi ti ha mandato il link.";
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
