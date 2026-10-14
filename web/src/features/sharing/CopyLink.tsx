import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { fullLink } from "./audience";
import styles from "./CopyLink.module.css";

// CopyLink shows the link of a video seen by link, with a button that
// copies it, to paste in a message. compact leaves only the button.
export function CopyLink({ link, compact = false }: { link: string; compact?: boolean }) {
  const address = fullLink(link);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(address);
      setCopied("yes");
    } catch (error: unknown) {
      // Without the clipboard (an address without https, an old browser)
      // the link is selected, to copy by hand.
      console.error(error);
      field.current?.select();
      setCopied("failed");
    }
    timer.current = window.setTimeout(() => setCopied("no"), 2500);
  }

  return (
    <div className={compact ? styles.compact : styles.root}>
      {!compact && (
        <input
          ref={field}
          className={styles.address}
          value={address}
          readOnly
          aria-label="Link del video"
          onFocus={(e) => e.target.select()}
        />
      )}
      <button
        type="button"
        className={`${styles.button} ${copied === "yes" ? styles.done : ""}`}
        onClick={() => void copy()}
      >
        <Icon name={copied === "yes" ? "check" : "copy"} size={18} />
        {copied === "yes" ? "Copiato" : "Copia link"}
      </button>
      <span className={styles.status} role="status">
        {copied === "yes"
          ? "Link copiato: incollalo in un messaggio."
          : copied === "failed"
            ? compact
              ? `Copia questo link: ${address}`
              : "Non riesco a copiarlo da solo: è selezionato, copialo tu."
            : ""}
      </span>
    </div>
  );
}
