import { type FormEvent, useEffect, useState } from "react";
import { type Account, nameProblem, passwordProblem } from "../../api/auth";
import { ApiError } from "../../api/client";
import { createUser, deleteUser, fetchUsers, resetPassword, updateUser } from "../../api/users";
import { useAccount } from "../../app/auth";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import styles from "./Admin.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; people: Account[] };

const byName = (a: Account, b: Account) => a.name.localeCompare(b.name, "it");

// PeoplePage lets the administrator add people, decide what each may do,
// give a new password to who forgot theirs, and remove people.
export function PeoplePage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchUsers(controller.signal)
      .then((people) => setState({ kind: "ready", people }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  const replace = (person: Account) =>
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", people: s.people.map((p) => (p.id === person.id ? person : p)) }
        : s,
    );
  const add = (person: Account) => {
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", people: [...s.people, person].sort(byName) } : s,
    );
    setAdding(false);
  };
  const remove = (id: number) =>
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", people: s.people.filter((p) => p.id !== id) } : s,
    );

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "error") {
    return (
      <EmptyState title="Elenco non disponibile">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }
  return (
    <>
      <div className={styles.top}>
        <p className={styles.lead}>
          Solo le persone che aggiungi qui possono entrare in FranzPLAY. Dai a ognuno il suo nome e
          una password: potrà cambiarla dal suo profilo.
        </p>
        {!adding && (
          <button type="button" className={styles.primary} onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
            Aggiungi una persona
          </button>
        )}
      </div>
      {adding && <NewPersonForm onAdded={add} onCancel={() => setAdding(false)} />}
      <ul className={styles.list} aria-label="Persone">
        {state.people.map((person) => (
          <li key={person.id}>
            <PersonRow person={person} onChanged={replace} onRemoved={() => remove(person.id)} />
          </li>
        ))}
      </ul>
    </>
  );
}

function NewPersonForm({
  onAdded,
  onCancel,
}: {
  onAdded: (person: Account) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  const send = (event: FormEvent) => {
    event.preventDefault();
    const mistake = nameProblem(name) || passwordProblem(password);
    if (mistake) {
      setProblem(mistake);
      return;
    }
    setSending(true);
    setProblem("");
    createUser({ name, password, role: admin ? "admin" : "user", canUpload })
      .then(onAdded)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
        setSending(false);
      });
  };

  return (
    <form className={`glass ${styles.panel}`} onSubmit={send} aria-label="Nuova persona">
      <label className={styles.field}>
        Nome
        <input
          value={name}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the person just asked to add someone
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        Password
        <input
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={canUpload}
          onChange={(e) => setCanUpload(e.target.checked)}
        />
        Può caricare video
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
        Amministratore
      </label>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      <div className={styles.buttons}>
        <button type="button" className={`glass ${styles.action}`} onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className={styles.primary} disabled={sending}>
          Aggiungi
        </button>
      </div>
    </form>
  );
}

type Asking = "nothing" | "password" | "delete";

function PersonRow({
  person,
  onChanged,
  onRemoved,
}: {
  person: Account;
  onChanged: (person: Account) => void;
  onRemoved: () => void;
}) {
  const me = useAccount();
  const itsMe = person.id === me.id;
  const [asking, setAsking] = useState<Asking>("nothing");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setProblem("");
    setDone("");
    work()
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
      })
      .finally(() => setBusy(false));
  };

  const change = (role: Account["role"], canUpload: boolean) =>
    run(async () => onChanged(await updateUser(person.id, { role, canUpload })));

  return (
    <div className={`glass ${styles.person}`}>
      <div className={styles.who}>
        <span className={styles.avatar}>
          <Icon name="profile" size={20} />
        </span>
        <div>
          <p className={styles.name}>
            {person.name}
            {itsMe && <span className={styles.you}> (tu)</span>}
          </p>
          <p className={styles.role}>
            {person.role === "admin" ? "Amministratore" : "Utente"}
            {person.canUpload && " · carica video"}
          </p>
        </div>
      </div>

      <div className={styles.controls}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={person.canUpload}
            disabled={busy}
            onChange={(e) => change(person.role, e.target.checked)}
          />
          Può caricare video
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={person.role === "admin"}
            // Taking away your own role would lock you out of this page.
            disabled={busy || itsMe}
            onChange={(e) => change(e.target.checked ? "admin" : "user", person.canUpload)}
          />
          Amministratore
        </label>
        <button
          type="button"
          className={`glass ${styles.action}`}
          onClick={() => setAsking(asking === "password" ? "nothing" : "password")}
        >
          Nuova password
        </button>
        {!itsMe && (
          <button
            type="button"
            className={`glass ${styles.action} ${styles.danger}`}
            onClick={() => setAsking("delete")}
          >
            <Icon name="trash" size={16} />
            Elimina
          </button>
        )}
      </div>

      {asking === "password" && (
        <PasswordForm
          name={person.name}
          onCancel={() => setAsking("nothing")}
          onSubmit={(password) =>
            run(async () => {
              await resetPassword(person.id, password);
              setAsking("nothing");
              setDone(`Password cambiata. Dilla a ${person.name}: dovrà entrare di nuovo.`);
            })
          }
        />
      )}
      {asking === "delete" && (
        <div className={styles.confirm}>
          <p>
            Eliminare <strong>{person.name}</strong>? Spariscono anche i suoi commenti, mi piace,
            playlist e cronologia. Non si può annullare.
          </p>
          <div className={styles.buttons}>
            <button
              type="button"
              className={`glass ${styles.action}`}
              onClick={() => setAsking("nothing")}
            >
              Annulla
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.danger}`}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await deleteUser(person.id);
                  onRemoved();
                })
              }
            >
              Sì, elimina
            </button>
          </div>
        </div>
      )}
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
    </div>
  );
}

function PasswordForm({
  name,
  onSubmit,
  onCancel,
}: {
  name: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  const send = (event: FormEvent) => {
    event.preventDefault();
    const mistake = passwordProblem(password);
    setProblem(mistake);
    if (!mistake) onSubmit(password);
  };
  return (
    <form className={styles.inline} onSubmit={send}>
      <label className={styles.field}>
        Nuova password per {name}
        <input
          type="password"
          value={password}
          autoComplete="new-password"
          // biome-ignore lint/a11y/noAutofocus: the person just asked to type it
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className={styles.buttons}>
        <button type="button" className={`glass ${styles.action}`} onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className={styles.primary}>
          Salva
        </button>
      </div>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}

// explain turns a refusal of the server into a sentence for people.
function explain(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Il server non risponde. Riprova tra poco.";
  }
  switch (error.status) {
    case 400:
      return "Il nome può contenere solo lettere, numeri, spazi, punti, trattini e trattini bassi.";
    case 404:
      return "Questa persona non c'è più: ricarica la pagina.";
    case 409:
      return error.message.includes("administrator")
        ? "Deve restare almeno un amministratore."
        : "C'è già una persona con questo nome.";
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
