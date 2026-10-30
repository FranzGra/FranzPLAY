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
import { Icon } from "../../components/Icon";
import { LookFields } from "./LookFields";
import pages from "./Pages.module.css";
import { UpdateSettings } from "./UpdateSettings";
import { Card, Chip, Loading, PageHeader, SettingSwitch, Unavailable, ui } from "./ui";

// SitePage holds the settings of the whole site: its name and color, and
// whether anyone may create an account by themselves, and the check for
// new versions.
export function SitePage() {
  return (
    <div className={ui.ui}>
      <PageHeader
        title="Sito"
        description="Le impostazioni di tutto FranzPLAY: come si chiama, il suo colore, chi può entrare e come, e il controllo delle nuove versioni."
      />
      <div className={ui.grid}>
        <div className={`${ui.span7} ${ui.stack}`}>
          <LookSettings />
        </div>
        <div className={`${ui.span5} ${ui.stack}`}>
          <Card title="Chi può entrare" icon="lock">
            <RegistrationSettings />
            <LoginMethodSettings />
          </Card>
          <UpdateSettings />
        </div>
      </div>
    </div>
  );
}

// LookSettings changes the name and color everybody sees. The form opens
// once the site's look has arrived, so it starts from the saved one.
function LookSettings() {
  const { ready } = useSite();
  if (!ready) return <Loading />;
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
    <Card title="Nome e colore" icon="sparkles">
      <form className={pages.editor} onSubmit={send} aria-label="Nome e colore del sito">
        <p className={ui.cardText}>
          Il nome compare in alto, nella pagina di accesso e nel titolo della scheda del browser. Il
          colore è quello di pulsanti e collegamenti.
        </p>
        <LookFields look={look} onChange={setLook} />
        <div className={pages.formFoot}>
          <span />
          <div className={ui.chips}>
            {unchanged ? (
              <Chip tone="ok" icon="check">
                Nessuna modifica da salvare
              </Chip>
            ) : (
              <>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.ghost}`}
                  disabled={busy}
                  onClick={() => {
                    setLook(site.look);
                    setProblem("");
                  }}
                >
                  Annulla
                </button>
                <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy}>
                  <Icon name="check" size={16} />
                  Salva nome e colore
                </button>
              </>
            )}
          </div>
        </div>
        {problem && (
          <p role="alert" className={ui.problem}>
            {problem}
          </p>
        )}
        {done && (
          <p role="status" className={ui.okText}>
            {done}
          </p>
        )}
      </form>
    </Card>
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

  if (state.kind === "loading") return <Loading />;
  if (state.kind === "error") return <Unavailable title="Impostazioni non disponibili" />;

  const change = (open: boolean) => {
    setBusy(true);
    setProblem("");
    setDone("");
    return saveRegistration(open)
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
    <div className={pages.block}>
      <SettingSwitch
        label="Chiunque può registrarsi"
        hint="Se è acceso, chi apre FranzPLAY può crearsi un account da solo, senza invito. Le persone nuove sono utenti normali e non possono caricare video: lo decidi tu in Persone. Se è spento, si entra solo con un invito o se aggiungi tu la persona."
        checked={state.open}
        disabled={busy}
        onChange={change}
      />
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className={ui.okText}>
          {done}
        </p>
      )}
    </div>
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

  if (failed) return <Unavailable title="Modi di accesso non disponibili" />;
  if (list === null) return <Loading />;

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
    <div className={pages.block}>
      <h3 className={pages.blockTitle}>Modi per entrare</h3>
      <p className={ui.hint}>
        Vale per tutti; in Persone puoi restringere i modi di una persona sola. Ne resta sempre
        almeno uno.
      </p>
      <ul className={ui.settingList} aria-label="Modi per entrare">
        {methods.map((m) => (
          <li key={m}>
            <SettingSwitch
              label={methodNames[m]}
              hint={methodHints[m]}
              checked={list.includes(m)}
              disabled={busy || (list.length === 1 && list.includes(m))}
              on="Ammesso"
              off="Non ammesso"
              onChange={(on) => toggle(m, on)}
            />
          </li>
        ))}
      </ul>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className={ui.okText}>
          {done}
        </p>
      )}
    </div>
  );
}
