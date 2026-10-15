import { useEffect, useId, useRef } from "react";
import { Icon } from "../../components/Icon";
import styles from "./Public.module.css";

// GuestDialog tells a guest, who watches through a public link, that
// liking, commenting and saving need an account. It is a modal dialog:
// the focus moves into it and stays there, Esc or the close button shut
// it, and the focus goes back to the button that opened it.
export function GuestDialog({
  openRegistration,
  onLogin,
  onRegister,
  onClose,
}: {
  openRegistration: boolean;
  onLogin: () => void;
  onRegister: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();

  useEffect(() => {
    const before = document.activeElement;
    first.current?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !box.current) return;
    // Tab goes round the buttons of the dialog, never behind it.
    const buttons = [...box.current.querySelectorAll<HTMLElement>("button")];
    const firstButton = buttons[0];
    const lastButton = buttons[buttons.length - 1];
    if (!firstButton || !lastButton) return;
    if (event.shiftKey && document.activeElement === firstButton) {
      event.preventDefault();
      lastButton.focus();
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault();
      firstButton.focus();
    }
  }

  return (
    // The backdrop closes the dialog with the mouse; the keyboard has Esc.
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is not a control
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc closes it, in the dialog
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className={`glass ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onKeyDown={onKeyDown}
      >
        <button type="button" className={styles.close} aria-label="Chiudi" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
        <h2 id={titleId} className={styles.dialogTitle}>
          Serve un account
        </h2>
        <div id={textId}>
          <p className={styles.dialogText}>
            Per mettere Mi piace, commentare o salvare nelle tue playlist devi registrarti e
            accedere con il tuo account.
          </p>
          {!openRegistration && (
            <p className={styles.dialogText}>
              Per creare un account serve un invito: chiedilo a chi ti ha mandato questo link.
            </p>
          )}
        </div>
        <div className={styles.dialogActions}>
          <button ref={first} type="button" className={styles.primary} onClick={onLogin}>
            Accedi
          </button>
          {openRegistration && (
            <button type="button" className={`glass ${styles.pill}`} onClick={onRegister}>
              Registrati
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
