import { type RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
import { placeStyle, useAnchored } from "../../lib/anchored";
import { usePresence } from "../../lib/presence";
import { useWide } from "../home/look";
import type { Choice } from "./audience";
import { type Hints, WhoSees } from "./WhoSees";
import styles from "./WhoSeesWindow.module.css";

// panelWidth is the window's width on a computer.
const panelWidth = 440;
// roomWanted is the height under the button that is enough to open there:
// the options fit, a long list of people scrolls. With less it opens above.
const roomWanted = 380;

// WhoSeesWindow asks who sees something, over the page: nothing on the
// page moves or stretches while it is open. On a computer it is a small
// window hanging from its button (or rising above it, when there is more
// room there); on a phone it covers the whole screen, rising from the
// bottom, like the window to save a video in a playlist. The choice lives
// with the caller, who saves it on onSave and closes the window.
export function WhoSeesWindow({
  open,
  button,
  title,
  choice,
  onChange,
  hints,
  link,
  linkLater,
  problem,
  busy = false,
  onSave,
  onClose,
}: {
  open: boolean;
  // button is the one that opens the window: the window hangs from it, and
  // the focus goes back to it on closing.
  button: RefObject<HTMLButtonElement | null>;
  title: string;
  choice: Choice;
  onChange: (choice: Choice) => void;
  hints: Hints;
  link?: string | null;
  linkLater?: string;
  problem: string;
  busy?: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const panel = usePresence(open ? true : null);
  const sheet = !useWide();
  const place = useAnchored(button, open && !sheet, panelWidth, roomWanted);
  const closeButton = useRef<HTMLButtonElement>(null);
  // The latest onClose, so the listeners below need not change with it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Closing gives the focus back to the button, for the keyboard.
  useEffect(() => {
    if (!open) return;
    const close = () => {
      closeRef.current();
      button.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // A touch outside closes the window, without saving. The button
    // closes it on its own, with a click.
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (button.current?.contains(e.target) || panel.ref.current?.contains(e.target)) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, button, panel.ref]);

  // The window lives at the end of the page, away from the button: the
  // keyboard and screen readers move into it as it opens.
  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);

  // Under the phone's window the page must not scroll with the finger.
  useEffect(() => {
    if (!open || !sheet) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open, sheet]);

  if (!panel.shown) return null;
  return createPortal(
    <div
      ref={panel.ref}
      className={`glass ${sheet ? styles.sheet : styles.panel}`}
      style={sheet || !place ? undefined : placeStyle(place)}
      data-above={(place && "bottom" in place) || undefined}
      data-right={place?.fromRight || undefined}
      data-leaving={panel.leaving || undefined}
      role="dialog"
      aria-label={title}
      aria-modal={sheet || undefined}
    >
      <div className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        <button
          ref={closeButton}
          type="button"
          className={styles.close}
          onClick={() => {
            onClose();
            button.current?.focus();
          }}
          aria-label="Chiudi"
        >
          <Icon name="close" size={sheet ? 22 : 18} />
        </button>
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {/* Only the options scroll; the title and the buttons stay. */}
        <div className={styles.body}>
          <WhoSees
            choice={choice}
            onChange={onChange}
            hints={hints}
            link={link}
            linkLater={linkLater}
            hideLegend
          />
        </div>
        {problem && (
          <p role="alert" className={styles.problem}>
            {problem}
          </p>
        )}
        <div className={styles.foot}>
          {!sheet && (
            <button
              type="button"
              className={styles.cancel}
              onClick={() => {
                onClose();
                button.current?.focus();
              }}
            >
              Annulla
            </button>
          )}
          <button type="submit" className={styles.save} disabled={busy}>
            Salva
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
