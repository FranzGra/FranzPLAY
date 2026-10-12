import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import {
  createInvite,
  deleteInvite,
  fetchInvites,
  type Invite,
  inviteLink,
  maxNoteLength,
} from "../../api/invites";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatDate } from "../../lib/format";
import styles from "./Admin.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; invites: Invite[] };

// InvitesPage lets the administrator invite family and friends: a link
// that lets one person create their own account, within 7 days.
export function InvitesPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<{ invite: Invite; code: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchInvites(controller.signal)
      .then((invites) => setState({ kind: "ready", invites }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  const add = (result: { invite: Invite; code: string }) => {
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", invites: [result.invite, ...s.invites] } : s,
    );
    setMaking(false);
    setMade(result);
  };
  const remove = (id: number) =>
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", invites: s.invites.filter((i) => i.id !== id) } : s,
    );

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "error") {
    return (
      <EmptyState title="Inviti non disponibili">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }
  return (
    <>
      <div className={styles.top}>
        <p className={styles.lead}>
          Crea un link e mandalo a chi vuoi invitare, con un messaggio o una email. Chi lo apre
          sceglie da solo nome e password. Ogni link vale per una persona sola e funziona per 7
          giorni.
        </p>
        {!making && !made && (
          <button type="button" className={styles.primary} onClick={() => setMaking(true)}>
            <Icon name="link" size={18} />
            Crea un invito
          </button>
        )}
      </div>
      {making && <NewInviteForm onMade={add} onCancel={() => setMaking(false)} />}
      {made && <NewLink invite={made.invite} code={made.code} onDone={() => setMade(null)} />}
      {state.invites.length === 0 ? (
        !making &&
        !made && (
          <EmptyState title="Nessun invito">
            Qui vedrai gli inviti che crei: chi li ha usati e quali aspettano ancora.
          </EmptyState>
        )
      ) : (
        <ul className={styles.list} aria-label="Inviti">
          {state.invites.map((invite) => (
            <li key={invite.id}>
              <InviteRow invite={invite} onRemoved={() => remove(invite.id)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NewInviteForm({
  onMade,
  onCancel,
}: {
  onMade: (result: { invite: Invite; code: string }) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [canUpload, setCanUpload] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  const send = (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setProblem("");
    createInvite(note, canUpload)
      .then(onMade)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
        setSending(false);
      });
  };

  return (
    <form className={`glass ${styles.panel}`} onSubmit={send} aria-label="Nuovo invito">
      <label className={styles.field}>
        Per chi è (facoltativo, ti serve per ricordarlo)
        <input
          value={note}
          maxLength={maxNoteLength}
          autoComplete="off"
          placeholder="Per esempio: Nonna Maria"
          // biome-ignore lint/a11y/noAutofocus: the person just asked to make an invite
          autoFocus
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={canUpload}
          onChange={(e) => setCanUpload(e.target.checked)}
        />
        Potrà caricare video
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
          Crea il link
        </button>
      </div>
    </form>
  );
}

// NewLink shows the link of the invite just made. It is the only time it
// can be seen: FranzPLAY keeps only a fingerprint of it.
function NewLink({ invite, code, onDone }: { invite: Invite; code: string; onDone: () => void }) {
  const link = inviteLink(code);
  const [copied, setCopied] = useState(false);
  // The clipboard works only on secure pages (https or this computer):
  // at home FranzPLAY is often plain http, so the link can also be selected.
  const canCopy = typeof navigator !== "undefined" && navigator.clipboard !== undefined;

  const copy = () => {
    navigator.clipboard
      .writeText(link)
      .then(() => setCopied(true))
      .catch((error: unknown) => console.error(error));
  };

  return (
    <section className={`glass ${styles.panel}`} aria-label="Link dell'invito">
      <h2 className={styles.subheading}>
        {invite.note ? `Il link per ${invite.note}` : "Il link dell'invito"}
      </h2>
      <label className={styles.field}>
        Mandalo a chi vuoi invitare
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className={styles.linkBox}
        />
      </label>
      <p className={styles.done}>
        Copialo adesso: per sicurezza FranzPLAY non potrà mostrarlo di nuovo. Se lo perdi, crea un
        invito nuovo.
      </p>
      <div className={styles.buttons}>
        {canCopy && (
          <button type="button" className={styles.primary} onClick={copy}>
            <Icon name={copied ? "check" : "link"} size={18} />
            {copied ? "Copiato" : "Copia il link"}
          </button>
        )}
        <button type="button" className={`glass ${styles.action}`} onClick={onDone}>
          Fatto
        </button>
      </div>
    </section>
  );
}

function InviteRow({ invite, onRemoved }: { invite: Invite; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const remove = () => {
    setBusy(true);
    setProblem("");
    deleteInvite(invite.id)
      .then(onRemoved)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
        setBusy(false);
      });
  };

  return (
    <div className={`glass ${styles.person}`}>
      <div className={styles.who}>
        <span className={styles.avatar}>
          <Icon name={invite.status === "used" ? "check" : "link"} size={20} />
        </span>
        <div>
          <p className={styles.name}>{invite.note || "Invito senza nome"}</p>
          <p className={styles.role}>
            {statusText(invite)}
            {invite.canUpload && " · potrà caricare video"}
          </p>
        </div>
      </div>
      <button
        type="button"
        className={`glass ${styles.action} ${invite.status === "waiting" ? styles.danger : ""}`}
        disabled={busy}
        onClick={remove}
      >
        <Icon name="trash" size={16} />
        {invite.status === "waiting" ? "Annulla l'invito" : "Togli dall'elenco"}
      </button>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </div>
  );
}

// statusText says where an invite is, in words.
export function statusText(invite: Invite): string {
  switch (invite.status) {
    case "waiting":
      return `Aspetta · funziona fino al ${formatDate(invite.expiresAt)}`;
    case "used":
      return invite.usedBy ? `Usato da ${invite.usedBy}` : "Usato";
    case "expired":
      return `Scaduto il ${formatDate(invite.expiresAt)}, senza essere usato`;
  }
}

// explain turns a refusal of the server into a sentence for people.
function explain(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Il server non risponde. Riprova tra poco.";
  }
  switch (error.status) {
    case 400:
      return `Il nome dell'invito deve stare in una riga di al massimo ${maxNoteLength} caratteri.`;
    case 404:
      return "Questo invito non c'è più: ricarica la pagina.";
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
