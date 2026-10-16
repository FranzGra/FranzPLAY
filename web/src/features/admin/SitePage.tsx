import { type FormEvent, useEffect, useState } from "react";
import {
  fetchRegistration,
  fetchServerMethods,
  type Method,
  methodNames,
  methods,
  saveRegistration,
  saveServerMethods,
} from "../../api/auth";
import { ApiError } from "../../api/client";
import { type Look, lookProblem, saveLook } from "../../api/site";
import { useSite } from "../../app/site";
import { EmptyState } from "../../components/EmptyState";
import styles from "./Admin.module.css";
import { LookFields } from "./LookFields";
import { UpdateSettings } from "./UpdateSettings";

// SitePage holds the settings of the whole site: its name and color, and
// whether anyone may create an account by themselves, and the check for
// new versions.
export function SitePage() {
  return (
    <>
      <LookSettings />
      <RegistrationSettings />
      <LoginMethodSettings />
      <UpdateSettings />
    </>
  );
}

// LookSettings changes the name and color everybody sees. The form opens
// once the site's look has arrived, so it starts from the saved one.
function LookSettings() {
  const { ready } = useSite();
  if (!ready) return <div className={styles.placeholder} aria-busy="true" />;
  return <LookForm />;
}

function LookForm() {
  const site = useSite();
  const [look, setLook] = useState<Look>(site.look);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");

  const send = (event: FormEvent) => {
    event.preventDefault();
    const mistake = lookProblem(look);
    if (mistake) {
      setProblem(mistake);
      return;
    }
    setBusy(true);
    setProblem("");
    setDone("");
    saveLook(look)
      .then((saved) => {
        site.changed(saved);
        setDone("Salvato. Tutti vedono il nome e il colore nuovi.");
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem(
          error instanceof ApiError && error.status === 400
            ? "Il nome o il colore non vanno bene: controlla e riprova."
            : "Non si è riusciti a salvare. Riprova tra poco.",
        );
      })
      .finally(() => setBusy(false));
  };

  const unchanged =
    look.nameFirst === site.look.nameFirst &&
    look.nameSecond === site.look.nameSecond &&
    look.color.toLowerCase() === site.look.color;
  return (
    <>
      <h2 className={styles.groupTitle}>Nome e colore</h2>
      <form
        className={`glass ${styles.person}`}
        onSubmit={send}
        aria-label="Nome e colore del sito"
      >
        <p className={styles.role}>
          Il nome compare in alto, nella pagina di accesso e nel titolo della scheda del browser. Il
          colore è quello di pulsanti e collegamenti.
        </p>
        <LookFields look={look} onChange={setLook} />
        <button type="submit" className={styles.primary} disabled={busy || unchanged}>
          Salva nome e colore
        </button>
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
      </form>
    </>
  );
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; open: boolean };

// RegistrationSettings decides whether anyone may create an account by
// themselves.
function RegistrationSettings() {
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
      <ul className={`stagger ${styles.list}`} aria-label="Accesso al sito">
        <li className={`glass ${styles.setting}`}>
          <div>
            <p className={styles.name}>Chiunque può registrarsi</p>
            <p className={styles.role}>
              Se è acceso, chi apre FranzPLAY può crearsi un account da solo, senza invito. Le
              persone nuove sono utenti normali e non possono caricare video: lo decidi tu in
              Persone. Se è spento, si entra solo con un invito o se aggiungi tu la persona.
            </p>
          </div>
          <label className={styles.toggle}>
            {state.open ? "Acceso" : "Spento"}
            <input
              type="checkbox"
              aria-label="Chiunque può registrarsi"
              checked={state.open}
              disabled={busy}
              onChange={(e) => change(e.target.checked)}
            />
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

const methodHints: Record<Method, string> = {
  password: "La più sicura.",
  pin: "6 cifre su un tastierino: comodo sulla TV e sul telefono, ma meno sicuro.",
  pattern: "Una sequenza di almeno 5 punti su 9, come su Android: comoda, ma meno sicura.",
};

// LoginMethodSettings chooses how people may log in on this server. Each
// person can be narrowed further in Persone. A method taken away keeps
// working once for whoever uses it: then they must choose an allowed one.
function LoginMethodSettings() {
  const [list, setList] = useState<Method[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchServerMethods(controller.signal)
      .then(setList)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) {
    return (
      <EmptyState title="Modi di accesso non disponibili">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }
  if (list === null) return <div className={styles.placeholder} aria-busy="true" />;

  const toggle = (m: Method, on: boolean) => {
    const next = methods.filter((x) => (x === m ? on : list.includes(x)));
    if (next.length === 0) {
      setProblem("Lascia almeno un modo di entrare.");
      return;
    }
    setBusy(true);
    setProblem("");
    setDone("");
    saveServerMethods(next)
      .then((saved) => {
        setList(saved);
        setDone(
          on
            ? `${methodNames[m]} ammess${m === "pin" ? "o" : "a"}: le persone possono sceglierlo dal profilo.`
            : `${methodNames[m]} non più ammess${m === "pin" ? "o" : "a"}. Chi lo usa entra ancora una volta, poi deve sceglierne un altro.`,
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
      <h2 className={styles.groupTitle}>Modi per entrare</h2>
      <p className={styles.lead}>
        Scegli come possono entrare le persone. Vale per tutti; in Persone puoi restringere i modi
        di una persona sola.
      </p>
      <ul className={`stagger ${styles.list}`} aria-label="Modi per entrare">
        {methods.map((m) => (
          <li key={m} className={`glass ${styles.setting}`}>
            <div>
              <p className={styles.name}>{methodNames[m]}</p>
              <p className={styles.role}>{methodHints[m]}</p>
            </div>
            <label className={styles.toggle}>
              {list.includes(m) ? "Ammesso" : "Non ammesso"}
              <input
                type="checkbox"
                aria-label={`${methodNames[m]} ammesso`}
                checked={list.includes(m)}
                disabled={busy || (list.length === 1 && list.includes(m))}
                onChange={(e) => toggle(m, e.target.checked)}
              />
            </label>
          </li>
        ))}
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
