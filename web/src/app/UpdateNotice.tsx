import { useEffect, useId, useRef, useState } from "react";
import { fetchUpdates, type Updates, updateCommand } from "../api/updates";
import { Icon } from "../components/Icon";
import styles from "./UpdateNotice.module.css";

// The browser remembers the version whose window was closed, so it opens
// once per new version. Without storage (private window) it just opens again.
const seenKey = "franzplay.update.seen";

function seenVersion(): string {
  try {
    return window.localStorage.getItem(seenKey) ?? "";
  } catch {
    return "";
  }
}

function rememberSeen(version: string) {
  try {
    window.localStorage.setItem(seenKey, version);
  } catch {
    // Nothing to do: the window will open again next time.
  }
}

// useNewVersion asks once whether a newer official release exists. Only
// administrators may ask; a failure is silent, it is only a notice.
export function useNewVersion(admin: boolean): Updates | null {
  const [found, setFound] = useState<Updates | null>(null);
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    fetchUpdates(controller.signal)
      .then((u) => setFound(u.enabled && u.newer ? u : null))
      .catch(() => {});
    return () => controller.abort();
  }, [admin]);
  return found;
}

// UpdatePill sits at the bottom of the side menu and opens the window again.
export function UpdatePill({ updates, onOpen }: { updates: Updates; onOpen: () => void }) {
  return (
    <button type="button" className={`glass ${styles.pill}`} onClick={onOpen}>
      <span className={styles.dot} aria-hidden="true" />
      Nuova versione {updates.latest}
    </button>
  );
}

// useUpdateWindow says whether the window about the new version is open.
// It opens by itself once per version; closing it remembers that version.
export function useUpdateWindow(updates: Updates | null) {
  const latest = updates?.latest ?? "";
  const [shown, setShown] = useState("");
  const [closed, setClosed] = useState(() => seenVersion());
  const open = latest !== "" && (shown === latest || closed !== latest);
  return {
    open,
    show: () => setShown(latest),
    close: () => {
      rememberSeen(latest);
      setClosed(latest);
      setShown("");
    },
  };
}

// UpdateDialog says how to update, with the command to copy.
export function UpdateDialog({ updates, onClose }: { updates: Updates; onClose: () => void }) {
  const title = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const canCopy = typeof navigator !== "undefined" && navigator.clipboard !== undefined;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close.current();
        return;
      }
      // Tab stays inside the window.
      if (e.key !== "Tab" || !dialog.current) return;
      const items = dialog.current.querySelectorAll<HTMLElement>("a[href], button, input");
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  const copy = () => {
    navigator.clipboard
      .writeText(updateCommand)
      .then(() => setCopied(true))
      .catch((error: unknown) => console.error(error));
  };

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialog}
        className={`glass ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title}
      >
        <h2 id={title} className={styles.title}>
          È disponibile FranzPLAY {updates.latest}
        </h2>
        <p className={styles.text}>
          Hai la versione {updates.release}. FranzPLAY non si aggiorna da solo: quando vuoi, apri un
          terminale nella cartella di FranzPLAY (quella con <code>compose.yaml</code>) e scrivi:
        </p>
        <input
          readOnly
          aria-label="Comando per aggiornare"
          value={updateCommand}
          onFocus={(e) => e.target.select()}
          className={styles.command}
        />
        <div className={styles.buttons}>
          {canCopy && (
            <button type="button" className={styles.primary} onClick={copy}>
              <Icon name={copied ? "check" : "copy"} size={18} />
              {copied ? "Copiato" : "Copia"}
            </button>
          )}
          {updates.url && (
            <a
              className={`glass ${styles.action}`}
              href={updates.url}
              target="_blank"
              rel="noreferrer"
            >
              Note di rilascio
            </a>
          )}
          <button
            ref={closeButton}
            type="button"
            className={`glass ${styles.action}`}
            onClick={onClose}
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
