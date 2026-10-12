import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  createPlaylist,
  fetchPlaylists,
  maxNameLength,
  type Playlist,
  playlistName,
  putInPlaylist,
} from "../../api/playlists";
import { Icon } from "../../components/Icon";
import styles from "./SaveButton.module.css";

// SaveButton opens a small panel where I put the video in my lists, or
// make a new list for it.
export function SaveButton({ videoId }: { videoId: number }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      button.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={root}>
      <button
        ref={button}
        type="button"
        className={`glass ${styles.button}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="save" size={20} />
        Salva
      </button>
      {open && <Panel videoId={videoId} onClose={() => setOpen(false)} />}
    </div>
  );
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; lists: Playlist[] };

function Panel({ videoId, onClose }: { videoId: number; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchPlaylists(videoId, controller.signal)
      .then((lists) => setState({ kind: "ready", lists }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [videoId]);

  const mark = (id: number, contains: boolean) =>
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", lists: s.lists.map((l) => (l.id === id ? { ...l, contains } : l)) }
        : s,
    );

  const toggle = (list: Playlist) => {
    const contains = !list.contains;
    mark(list.id, contains);
    setProblem("");
    putInPlaylist(list.id, videoId, contains).catch((error: unknown) => {
      console.error(error);
      mark(list.id, !contains);
      setProblem("Non sono riuscito a salvare. Riprova.");
    });
  };

  const created = (list: Playlist) =>
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", lists: [...s.lists, { ...list, contains: true }] } : s,
    );

  return (
    <div className={`glass ${styles.panel}`} role="dialog" aria-label="Salva in una playlist">
      <div className={styles.head}>
        <h2 className={styles.title}>Salva in…</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Chiudi">
          <Icon name="close" size={18} />
        </button>
      </div>
      {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
      {state.kind === "error" && (
        <p className={styles.problem}>Non sono riuscito a caricare le playlist. Riprova.</p>
      )}
      {state.kind === "ready" && (
        <>
          <ul className={styles.lists}>
            {state.lists.map((list) => (
              <li key={list.id}>
                <label className={styles.option}>
                  <input
                    type="checkbox"
                    checked={list.contains ?? false}
                    onChange={() => toggle(list)}
                  />
                  <span className={styles.check} aria-hidden="true">
                    <Icon name="check" size={14} />
                  </span>
                  {list.kind === "later" && <Icon name="clock" size={18} />}
                  <span className={styles.name}>{playlistName(list)}</span>
                </label>
              </li>
            ))}
          </ul>
          <NewPlaylist videoId={videoId} onCreated={created} />
        </>
      )}
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </div>
  );
}

// NewPlaylist makes a list with the video already in it.
function NewPlaylist({
  videoId,
  onCreated,
}: {
  videoId: number;
  onCreated: (list: Playlist) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  if (!open) {
    return (
      <button type="button" className={styles.new} onClick={() => setOpen(true)}>
        <Icon name="plus" size={18} />
        Nuova playlist
      </button>
    );
  }

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "" || sending) return;
    setSending(true);
    setProblem("");
    try {
      const list = await createPlaylist(name);
      await putInPlaylist(list.id, videoId, true);
      onCreated({ ...list, videos: list.videos + 1 });
      setName("");
      setOpen(false);
    } catch (error) {
      console.error(error);
      setProblem("Non sono riuscito a creare la playlist. Riprova.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={create}>
      <input
        className={styles.input}
        aria-label="Nome della nuova playlist"
        placeholder="Nome della playlist"
        value={name}
        maxLength={maxNameLength}
        // biome-ignore lint/a11y/noAutofocus: the person just asked for a new list
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className={styles.create} disabled={name.trim() === "" || sending}>
        Crea
      </button>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}
