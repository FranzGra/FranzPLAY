import { useEffect, useState } from "react";
import {
  fetchPublicLink,
  makePublicLink,
  type PublicLink,
  revokePublicLink,
} from "../../api/publicLinks";
import { Icon } from "../../components/Icon";
import { CopyLink } from "../sharing/CopyLink";
import styles from "./Public.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; link: PublicLink };

// PublicLinkPanel lets the owner of a video make a public link for it: an
// address anybody can open to watch this one video, even without an
// account. No video has one until its owner asks; the owner can renew it
// (the old address stops working) or turn it off.
export function PublicLinkPanel({ videoId }: { videoId: number }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchPublicLink(videoId, controller.signal)
      .then((link) => setState({ kind: "ready", link }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [videoId]);

  if (state.kind !== "ready") return null;
  const { link } = state.link;

  const run = (work: () => Promise<PublicLink>) => {
    setBusy(true);
    setProblem("");
    work()
      .then((next) => setState({ kind: "ready", link: next }))
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non sono riuscito a cambiare il link pubblico. Riprova.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className={`glass ${styles.panel}`} aria-label="Link pubblico">
      <p className={styles.panelTitle}>
        <Icon name="share" size={18} />
        Link pubblico
      </p>
      {link === null ? (
        <>
          <p className={styles.panelText}>
            Con un link pubblico chiunque lo riceva può guardare questo video, anche senza account.
            Vedrà solo questo video, niente altro di FranzPLAY.
          </p>
          <div className={styles.panelActions}>
            <button
              type="button"
              className={`glass ${styles.pill}`}
              disabled={busy}
              onClick={() => run(() => makePublicLink(videoId))}
            >
              Crea link pubblico
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.panelText}>
            Chiunque abbia questo link può guardare il video senza account. Se lo rinnovi, il link
            vecchio smette di funzionare.
          </p>
          <CopyLink link={link} />
          <div className={styles.panelActions}>
            <button
              type="button"
              className={`glass ${styles.pill}`}
              disabled={busy}
              onClick={() => run(() => makePublicLink(videoId))}
            >
              Rinnova link
            </button>
            <button
              type="button"
              className={`glass ${styles.pill} ${styles.danger}`}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await revokePublicLink(videoId);
                  return { link: null, createdAt: null };
                })
              }
            >
              Disattiva link
            </button>
          </div>
        </>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
