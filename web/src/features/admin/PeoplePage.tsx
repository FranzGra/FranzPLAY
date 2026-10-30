import { type FormEvent, useEffect, useState } from "react";
import {
  type Account,
  avatarUrl,
  fetchServerMethods,
  type Method,
  methodNames,
  methods,
  nameProblem,
} from "../../api/auth";
import { ApiError } from "../../api/client";
import {
  createUser,
  deleteUser,
  fetchUsers,
  type Person,
  resetPassword,
  updateUser,
} from "../../api/users";
import { useAccount } from "../../app/auth";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { formatBytes, formatSince } from "../../lib/format";
import { type NewChoice, NewSecret } from "../auth/secret/NewSecret";
import pages from "./Pages.module.css";
import { Chip, Empty, Loading, PageHeader, SettingSwitch, Unavailable, ui } from "./ui";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; people: Person[] };

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name, "it");

const gigabyte = 1024 ** 3;

// The spaces the administrator picks from, in GB, plus the one the person
// has now when it is not among them.
const quotaChoices = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000].map((gb) => gb * gigabyte);
const choicesFor = (current: number) =>
  quotaChoices.includes(current) ? quotaChoices : [...quotaChoices, current].sort((a, b) => a - b);

// PeoplePage lets the administrator add people, decide what each may do,
// give a new password to who forgot theirs, and remove people.
export function PeoplePage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [adding, setAdding] = useState(false);
  // server: the login methods allowed on the whole server.
  const [server, setServer] = useState<Method[]>(["password"]);

  useEffect(() => {
    const controller = new AbortController();
    fetchServerMethods(controller.signal)
      .then(setServer)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
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
        ? {
            kind: "ready",
            people: s.people.map((p) => (p.id === person.id ? { ...p, ...person } : p)),
          }
        : s,
    );
  const add = (person: Account) => {
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", people: [...s.people, { ...person, lastLogin: null }].sort(byName) }
        : s,
    );
    setAdding(false);
  };
  const remove = (id: number) =>
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", people: s.people.filter((p) => p.id !== id) } : s,
    );

  const header = (
    <PageHeader
      title="Persone"
      description="Solo le persone che aggiungi qui possono entrare in FranzPLAY. Dai a ognuno il suo nome e un modo di entrare (password, PIN o sequenza): potrà cambiarlo dal suo profilo."
      actions={
        !adding && (
          <button
            type="button"
            className={`${ui.btn} ${ui.primary}`}
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" size={18} />
            Aggiungi una persona
          </button>
        )
      }
      below={
        state.kind === "ready" && (
          <div className={`${ui.chips} ${pages.headChips}`}>
            <Chip icon="people">{count(state.people.length, "persona", "persone")}</Chip>
            <Chip icon="shield">
              {count(admins(state.people), "amministratore", "amministratori")}
            </Chip>
            <Chip icon="upload">
              {count(uploaders(state.people), "carica video", "caricano video")}
            </Chip>
          </div>
        )
      }
    />
  );
  if (state.kind === "loading") {
    return (
      <div className={ui.ui}>
        {header}
        <Loading />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={ui.ui}>
        {header}
        <Unavailable title="Elenco non disponibile" />
      </div>
    );
  }
  return (
    <div className={ui.ui}>
      {header}
      {adding && <NewPersonForm server={server} onAdded={add} onCancel={() => setAdding(false)} />}
      {state.people.length === 0 ? (
        <Empty icon="people" title="Ancora nessuna persona" />
      ) : (
        <ul className={pages.people} aria-label="Persone">
          {state.people.map((person) => (
            <li key={person.id}>
              <PersonRow
                person={person}
                server={server}
                onChanged={replace}
                onRemoved={() => remove(person.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const admins = (people: Person[]) => people.filter((p) => p.role === "admin").length;
const uploaders = (people: Person[]) => people.filter((p) => p.canUpload).length;
const count = (x: number, one: string, many: string) => (x === 1 ? `1 ${one}` : `${x} ${many}`);

function NewPersonForm({
  server,
  onAdded,
  onCancel,
}: {
  server: Method[];
  onAdded: (person: Account) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [own, setOwn] = useState<Method[]>([]);
  const [choice, setChoice] = useState<NewChoice | null>(null);
  const [admin, setAdmin] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  const send = (event: FormEvent) => {
    event.preventDefault();
    const mistake = nameProblem(name) || choice?.problem || "";
    if (mistake) {
      setProblem(mistake);
      return;
    }
    setSending(true);
    setProblem("");
    createUser({
      name,
      method: choice?.method ?? "password",
      password: choice?.secret ?? "",
      ownMethods: own,
      role: admin ? "admin" : "user",
      canUpload,
    })
      .then(onAdded)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
        setSending(false);
      });
  };

  return (
    <form
      className={`${ui.card} ${pages.newForm}`}
      onSubmit={send}
      aria-label="Nuova persona"
      noValidate
    >
      <h2 className={ui.cardTitle}>
        <span className={ui.cardIcon} aria-hidden="true">
          <Icon name="plus" size={18} />
        </span>
        Nuova persona
      </h2>
      <label className={ui.field}>
        <span className={ui.label}>Nome</span>
        <input
          className={ui.input}
          value={name}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the person just asked to add someone
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <MethodsChoice server={server} own={own} onChange={setOwn} />
      <NewSecret
        key={own.join()}
        allowed={own.length > 0 ? own : server}
        onChange={setChoice}
        disabled={sending}
      />
      <div className={pages.checks}>
        <label className={pages.check}>
          <input
            type="checkbox"
            checked={canUpload}
            onChange={(e) => setCanUpload(e.target.checked)}
          />
          Può caricare video
        </label>
        <label className={pages.check}>
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
          Amministratore
        </label>
      </div>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
      <div className={pages.formFoot}>
        <span />
        <div className={ui.chips}>
          <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={onCancel}>
            Annulla
          </button>
          <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={sending}>
            <Icon name="check" size={16} />
            Aggiungi
          </button>
        </div>
      </div>
    </form>
  );
}

type Asking = "nothing" | "password" | "delete";

function PersonRow({
  person,
  server,
  onChanged,
  onRemoved,
}: {
  person: Person;
  server: Method[];
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

  const change = (role: Account["role"], canUpload: boolean, uploadQuota?: number) =>
    run(async () => onChanged(await updateUser(person.id, { role, canUpload, uploadQuota })));
  // Taking the permission away also turns off every public link the
  // person made: the server does it, here we only say so.
  const changePublic = (canSharePublic: boolean) =>
    run(async () => {
      onChanged(
        await updateUser(person.id, {
          role: person.role,
          canUpload: person.canUpload,
          canSharePublic,
        }),
      );
      if (!canSharePublic && person.role !== "admin") {
        setDone(`I link pubblici creati da ${person.name} non funzionano più.`);
      }
    });

  return (
    <article className={`${ui.card} ${pages.person}`} aria-label={person.name}>
      <header className={pages.personHead}>
        <Avatar name={person.name} size={48} photo={avatarUrl(person.id, person.avatar)} />
        <div className={pages.personText}>
          <p className={pages.personName}>
            <span>
              {person.name}
              {itsMe && <span className={pages.you}> (tu)</span>}
            </span>
            {person.role === "admin" && (
              <Chip tone="info" icon="shield">
                Amministratore
              </Chip>
            )}
          </p>
          <p className={pages.personMeta}>
            {person.role === "admin" ? "Amministratore" : "Utente"}
            {person.canUpload && ` · carica video, fino a ${formatBytes(person.uploadQuota)}`}
            {person.canSharePublic && person.role !== "admin" && " · crea link pubblici"}
          </p>
          <p className={pages.personMeta}>
            Entra con {methodNames[person.loginMethod].toLowerCase()}
            {person.mustChooseMethod &&
              " (non più ammesso: al prossimo accesso ne sceglierà un altro)"}
            {person.ownMethods &&
              ` · solo ${person.ownMethods.map((m) => methodNames[m].toLowerCase()).join(", ")}`}
          </p>
          <p className={pages.personMeta}>
            {person.lastLogin
              ? `Ultimo accesso ${formatSince(person.lastLogin, new Date())}`
              : "Non è ancora entrato con nome e password"}
          </p>
        </div>
        <div className={pages.personActions}>
          <button
            type="button"
            className={`${ui.btn} ${ui.small}`}
            aria-expanded={asking === "password"}
            onClick={() => setAsking(asking === "password" ? "nothing" : "password")}
          >
            <Icon name="key" size={16} />
            Nuovo accesso
          </button>
          {!itsMe && (
            <button
              type="button"
              className={`${ui.btn} ${ui.small} ${ui.dangerBtn}`}
              onClick={() => setAsking("delete")}
            >
              <Icon name="trash" size={16} />
              Elimina
            </button>
          )}
        </div>
      </header>

      <div className={pages.perms}>
        <div className={pages.perm}>
          <SettingSwitch
            label="Può caricare video"
            hint="Dalla sua pagina Profilo"
            checked={person.canUpload}
            disabled={busy}
            on="Sì"
            off="No"
            onChange={(on) => change(person.role, on)}
          />
          {person.canUpload && (
            <div className={pages.permField}>
              <span className={ui.label}>Spazio</span>
              <Select
                compact
                aria-label="Spazio"
                value={person.uploadQuota}
                disabled={busy}
                options={choicesFor(person.uploadQuota).map((bytes) => ({
                  value: bytes,
                  label: formatBytes(bytes),
                }))}
                onChange={(bytes) => change(person.role, true, bytes)}
              />
            </div>
          )}
        </div>
        <div className={pages.perm}>
          <SettingSwitch
            label="Può creare link pubblici"
            hint={
              person.role === "admin"
                ? "Gli amministratori possono sempre"
                : "Link che chiunque apre, anche senza account"
            }
            checked={person.role === "admin" || person.canSharePublic}
            disabled={busy || person.role === "admin"}
            on="Sì"
            off="No"
            onChange={changePublic}
          />
        </div>
        <div className={pages.perm}>
          <SettingSwitch
            label="Amministratore"
            hint={itsMe ? "Sei tu: non puoi toglierlo a te stesso" : "Vede e cambia queste pagine"}
            checked={person.role === "admin"}
            // Taking away your own role would lock you out of this page.
            disabled={busy || itsMe}
            on="Sì"
            off="No"
            onChange={(on) => change(on ? "admin" : "user", person.canUpload)}
          />
        </div>
        <div className={pages.perm}>
          <MethodsChoice
            server={server}
            own={person.ownMethods ?? []}
            disabled={busy}
            onChange={(own) =>
              run(async () => {
                onChanged(
                  await updateUser(person.id, {
                    role: person.role,
                    canUpload: person.canUpload,
                    ownMethods: own,
                  }),
                );
                setDone(
                  own.includes(person.loginMethod) || own.length === 0
                    ? "Modi per entrare salvati."
                    : `Salvato. ${person.name} entrerà ancora una volta con il suo ${methodNames[person.loginMethod].toLowerCase()}, poi dovrà sceglierne uno ammesso.`,
                );
              })
            }
          />
        </div>
      </div>

      {asking === "password" && (
        <ResetForm
          name={person.name}
          allowed={person.allowedMethods}
          busy={busy}
          onCancel={() => setAsking("nothing")}
          onSubmit={(choice) =>
            run(async () => {
              await resetPassword(person.id, choice.secret, choice.method);
              setAsking("nothing");
              setDone(
                `Accesso cambiato (${methodNames[choice.method].toLowerCase()}). Dillo a ${person.name}: dovrà entrare di nuovo.`,
              );
            })
          }
        />
      )}
      {asking === "delete" && (
        <div className={pages.confirm}>
          <p>
            Eliminare <strong>{person.name}</strong>? Spariscono anche i suoi commenti, mi piace,
            playlist e cronologia. Non si può annullare.
          </p>
          <div className={ui.chips}>
            <button
              type="button"
              className={`${ui.btn} ${ui.ghost}`}
              onClick={() => setAsking("nothing")}
            >
              Annulla
            </button>
            <button
              type="button"
              className={`${ui.btn} ${ui.dangerBtn}`}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await deleteUser(person.id);
                  onRemoved();
                })
              }
            >
              <Icon name="trash" size={16} />
              Sì, elimina
            </button>
          </div>
        </div>
      )}
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
    </article>
  );
}

// MethodsChoice narrows the login methods of one person, inside the
// server's. No box ticked, or all of them, means "as the server".
function MethodsChoice({
  server,
  own,
  onChange,
  disabled = false,
}: {
  server: Method[];
  own: Method[];
  onChange: (own: Method[]) => void;
  disabled?: boolean;
}) {
  const shown = own.length > 0 ? own : server;
  const toggle = (m: Method, on: boolean) => {
    const next = methods.filter((x) => server.includes(x) && (x === m ? on : shown.includes(x)));
    if (next.length === 0) return;
    onChange(next.length === server.length ? [] : next);
  };
  return (
    <fieldset className={pages.methods} disabled={disabled}>
      <legend>Modi per entrare</legend>
      <div className={pages.checks}>
        {methods.map((m) => (
          <label key={m} className={pages.check}>
            <input
              type="checkbox"
              checked={shown.includes(m)}
              disabled={!server.includes(m) || (shown.length === 1 && shown.includes(m))}
              onChange={(e) => toggle(m, e.target.checked)}
            />
            {methodNames[m]}
          </label>
        ))}
      </div>
      <p className={ui.hint}>
        {own.length === 0 ? "Come il resto del server" : "Solo per questa persona"}
      </p>
    </fieldset>
  );
}

function ResetForm({
  name,
  allowed,
  busy,
  onSubmit,
  onCancel,
}: {
  name: string;
  allowed: Method[];
  busy: boolean;
  onSubmit: (choice: NewChoice) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<NewChoice | null>(null);
  const [problem, setProblem] = useState("");
  const send = (event: FormEvent) => {
    event.preventDefault();
    const mistake = choice?.problem ?? "Scegli il nuovo accesso.";
    setProblem(mistake);
    if (!mistake && choice) onSubmit(choice);
  };
  return (
    <form
      className={pages.inlineForm}
      onSubmit={send}
      aria-label={`Nuovo accesso per ${name}`}
      noValidate
    >
      <p className={pages.blockTitle}>Nuovo accesso per {name}</p>
      <NewSecret
        allowed={allowed}
        onChange={setChoice}
        disabled={busy}
        passwordLabel="Nuova password"
      />
      <div className={ui.chips}>
        <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy}>
          Salva
        </button>
      </div>
      {problem && (
        <p role="alert" className={ui.problem}>
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
      return error.message.includes("method") ||
        error.message.includes("PIN") ||
        error.message.includes("pattern")
        ? "Questo modo di entrare non è ammesso per questa persona, o non è completo."
        : "Il nome può contenere solo lettere, numeri, spazi, punti, trattini e trattini bassi.";
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
