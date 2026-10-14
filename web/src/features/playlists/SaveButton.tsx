import {
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type Ref,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  createPlaylist,
  fetchPlaylists,
  maxNameLength,
  type Playlist,
  playlistName,
  putInPlaylist,
} from "../../api/playlists";
import { Icon } from "../../components/Icon";
import { usePresence } from "../../lib/presence";
import { useWide } from "../home/look";
import styles from "./SaveButton.module.css";

// gap is the space between the button and the panel, in pixels.
const gap = 8;
// margin keeps the panel this far from the window's edges.
const margin = 8;
// panelWidth is the panel's width on a computer.
const panelWidth = 320;
// roomWanted is the height under the button that is enough to open there:
// a few lists, the rest scroll. Only with less room does it open above.
const roomWanted = 240;

// Place is where the panel sits in the window, measured from the button.
type Place = { left: number; width: number; maxHeight: number } & (
  | { top: number }
  | { bottom: number }
);

// SaveButton opens a panel where I put the video in my lists, or make a
// new list for it. On a computer the panel grows out of the button and
// shrinks back into it; on a phone it covers the whole screen, rising from
// the bottom, with big rows for the thumb. Each time the video goes into a
// list, the button's icon bounces.
export function SaveButton({ videoId }: { videoId: number }) {
  const [open, setOpen] = useState(false);
  const panel = usePresence(open ? true : null);
  const sheet = !useWide();
  // saved counts the lists the video went into: each one bounces the icon.
  const [saved, setSaved] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  // The lists live here, not in the panel: the button tells how many
  // hold the video, before the panel opens and while ticks change.
  const [state, setState] = useState<State>({ kind: "loading" });

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

  // Watch later is a list like the others in the data, so it counts too.
  const inside = state.kind === "ready" ? state.lists.filter((l) => l.contains).length : 0;

  // On a computer the panel hangs from the button, or rises above it when
  // there is more room there. It lives at the end of the page (a portal),
  // so no column next to it, like the videos on the right, can cover it.
  const measure = useCallback(() => {
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(panelWidth, window.innerWidth - 2 * margin);
    const left = Math.max(margin, Math.min(box.left, window.innerWidth - width - margin));
    const below = window.innerHeight - box.bottom - gap - margin;
    const above = box.top - gap - margin;
    setPlace(
      below >= roomWanted || below >= above
        ? { left, width, top: box.bottom + gap, maxHeight: below }
        : { left, width, bottom: window.innerHeight - box.top + gap, maxHeight: above },
    );
  }, []);

  useLayoutEffect(() => {
    if (!open || sheet) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, sheet, measure]);

  // Closing gives the focus back to the button, for the keyboard.
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // A touch outside closes the panel; the phone's sheet lives outside
    // the button's box, so a touch on it counts as inside.
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (root.current?.contains(e.target) || panel.ref.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close, panel.ref]);

  // Under the phone's sheet the page must not scroll with the finger.
  useEffect(() => {
    if (!open || !sheet) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open, sheet]);

  const content = panel.shown && (
    <Panel
      ref={panel.ref}
      leaving={panel.leaving}
      sheet={sheet}
      place={place}
      videoId={videoId}
      state={state}
      setState={setState}
      onSaved={() => setSaved((n) => n + 1)}
      onClose={close}
    />
  );

  return (
    <div className={styles.root} ref={root}>
      <button
        ref={button}
        type="button"
        className={`glass ${styles.button}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span key={saved} className={styles.icon} data-bounce={saved > 0 || undefined}>
          <Icon name={inside > 0 ? "check" : "save"} size={20} />
        </span>
        Salva
      </button>
      {inside > 0 && (
        <span className={styles.count} aria-live="polite">
          in {inside} playlist
        </span>
      )}
      {/* The panel goes straight into the page's body: no box around the
          button can cut it or stack it under the videos or the tab bar. */}
      {content && createPortal(content, document.body)}
    </div>
  );
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; lists: Playlist[] };

function Panel({
  ref,
  leaving,
  sheet,
  place,
  videoId,
  state,
  setState,
  onSaved,
  onClose,
}: {
  ref: Ref<HTMLDivElement>;
  leaving: boolean;
  sheet: boolean;
  place: Place | null;
  videoId: number;
  state: State;
  setState: Dispatch<SetStateAction<State>>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState("");
  // The list just ticked or made here: only that one moves.
  const [touched, setTouched] = useState<number | null>(null);
  const [made, setMade] = useState<number | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // The panel lives at the end of the page, away from the button: the
  // keyboard and screen readers move into it as it opens.
  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  const mark = (id: number, contains: boolean) =>
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", lists: s.lists.map((l) => (l.id === id ? { ...l, contains } : l)) }
        : s,
    );

  const toggle = (list: Playlist) => {
    const contains = !list.contains;
    mark(list.id, contains);
    setTouched(list.id);
    if (contains) onSaved();
    setProblem("");
    putInPlaylist(list.id, videoId, contains).catch((error: unknown) => {
      console.error(error);
      mark(list.id, !contains);
      setProblem("Non sono riuscito a salvare. Riprova.");
    });
  };

  const created = (list: Playlist) => {
    onSaved();
    setTouched(list.id);
    setMade(list.id);
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", lists: [...s.lists, { ...list, contains: true }] } : s,
    );
  };

  const where: CSSProperties | undefined =
    sheet || !place
      ? undefined
      : {
          left: place.left,
          width: place.width,
          maxHeight: place.maxHeight,
          ...("top" in place ? { top: place.top } : { bottom: place.bottom }),
        };

  return (
    <div
      ref={ref}
      className={`glass ${sheet ? styles.sheet : styles.panel}`}
      style={where}
      data-above={(place && "bottom" in place) || undefined}
      role="dialog"
      aria-label="Salva in una playlist"
      aria-modal={sheet || undefined}
      data-leaving={leaving || undefined}
    >
      <div className={styles.head}>
        <h2 className={styles.title}>{sheet ? "Salva in una playlist" : "Salva in…"}</h2>
        <button
          ref={closeButton}
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Chiudi"
        >
          <Icon name="close" size={sheet ? 22 : 18} />
        </button>
      </div>
      {/* Only the lists scroll; the title and the buttons stay. */}
      <div className={styles.body}>
        {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
        {state.kind === "error" && (
          <p className={styles.problem}>Non sono riuscito a caricare le playlist. Riprova.</p>
        )}
        {state.kind === "ready" && (
          <>
            <ul className={styles.lists}>
              {state.lists.map((list) => (
                <li
                  key={list.id}
                  data-touched={list.id === touched || undefined}
                  data-new={list.id === made || undefined}
                >
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
      </div>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {sheet && (
        <div className={styles.foot}>
          <button type="button" className={styles.done} onClick={onClose}>
            Fatto
          </button>
        </div>
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
