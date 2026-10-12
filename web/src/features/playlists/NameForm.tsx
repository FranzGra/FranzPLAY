import { type FormEvent, useState } from "react";
import { maxNameLength } from "../../api/playlists";
import styles from "./Playlists.module.css";

// NameForm asks for the name of a list, to make it or rename it.
export function NameForm({
  initial = "",
  submit,
  failure,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  submit: string;
  failure: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");
  const empty = name.trim() === "";

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (empty || sending) return;
    setSending(true);
    setProblem("");
    onSubmit(name)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(failure);
      })
      .finally(() => setSending(false));
  };

  return (
    <form className={styles.nameForm} onSubmit={send}>
      <input
        className={styles.nameInput}
        aria-label="Nome della playlist"
        placeholder="Nome della playlist"
        value={name}
        maxLength={maxNameLength}
        // biome-ignore lint/a11y/noAutofocus: the person just asked to type a name
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" className={`glass ${styles.action}`} onClick={onCancel}>
        Annulla
      </button>
      <button type="submit" className={styles.primary} disabled={empty || sending}>
        {submit}
      </button>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}
