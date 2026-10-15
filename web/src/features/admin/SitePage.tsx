import { type FormEvent, useEffect, useState } from "react";
import { fetchRegistration, saveRegistration } from "../../api/auth";
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
        <li className={`glass ${styles.person}`}>
          <div>
            <p className={styles.name}>Chiunque può registrarsi</p>
            <p className={styles.role}>
              Se è acceso, chi apre FranzPLAY può crearsi un account da solo, senza invito. Le
              persone nuove sono utenti normali e non possono caricare video: lo decidi tu in
              Persone. Se è spento, si entra solo con un invito o se aggiungi tu la persona.
            </p>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              aria-label="Chiunque può registrarsi"
              checked={state.open}
              disabled={busy}
              onChange={(e) => change(e.target.checked)}
            />
            Acceso
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
