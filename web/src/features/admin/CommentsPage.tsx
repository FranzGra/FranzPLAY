import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { deleteComment, fetchRecentComments, type RecentComment } from "../../api/comments";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatSince } from "../../lib/format";
import styles from "./Admin.module.css";

const pageSize = 50;
const maxShown = 200;

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; comments: RecentComment[]; total: number };

// CommentsPage lists every comment, the newest first, so the
// administrator can keep FranzPLAY a pleasant place and delete what does
// not belong.
export function CommentsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const shown = useRef(pageSize);

  const load = useCallback((limit: number, signal?: AbortSignal) => {
    fetchRecentComments(limit, signal)
      .then(({ comments, total }) => setState({ kind: "ready", comments, total }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        console.error(error);
        setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(pageSize, controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "error") {
    return (
      <EmptyState title="Commenti non disponibili">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }
  if (state.comments.length === 0) {
    return (
      <EmptyState title="Ancora nessun commento">
        Quando qualcuno scrive sotto un video, il commento compare qui.
      </EmptyState>
    );
  }

  const removed = (c: RecentComment) => {
    setState((s) =>
      s.kind === "ready" ? { ...s, comments: s.comments.filter((x) => x.id !== c.id) } : s,
    );
    // Its replies went with it: ask again for the list as it is now.
    load(shown.current);
  };
  const more = () => {
    shown.current = Math.min(shown.current + pageSize, maxShown);
    load(shown.current);
  };

  return (
    <>
      <p className={styles.lead}>
        Tutti i commenti, dai più nuovi. Puoi eliminare quelli che non vanno bene: chi li ha scritti
        non riceve avvisi.
      </p>
      <p className={styles.count}>
        {state.total.toLocaleString("it-IT")} {state.total === 1 ? "commento" : "commenti"}
      </p>
      <ul className={`stagger ${styles.list}`} aria-label="Commenti">
        {state.comments.map((c) => (
          <li key={c.id}>
            <CommentRow comment={c} onRemoved={() => removed(c)} />
          </li>
        ))}
      </ul>
      {state.comments.length < state.total && state.comments.length < maxShown && (
        <button type="button" className={`glass ${styles.action} ${styles.more}`} onClick={more}>
          Mostra altri
        </button>
      )}
    </>
  );
}

function CommentRow({ comment, onRemoved }: { comment: RecentComment; onRemoved: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const remove = () => {
    setBusy(true);
    setProblem("");
    deleteComment(comment.id)
      .then(onRemoved)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non sono riuscito a eliminarlo. Riprova tra poco.");
        setBusy(false);
      });
  };

  return (
    <div className={`glass ${styles.person}`}>
      <div className={styles.failed}>
        <p className={styles.role}>
          <strong className={styles.author}>{comment.author.name}</strong>
          {comment.reply ? " ha risposto sotto " : " ha scritto sotto "}
          {comment.video.visible ? (
            <Link to={`/video/${comment.video.id}`}>{comment.video.title}</Link>
          ) : (
            <span>{comment.video.title} (nascosto o non trovato)</span>
          )}{" "}
          · {formatSince(comment.createdAt, new Date())}
        </p>
        <p className={styles.body}>{comment.body}</p>
        {asking && (
          <div className={styles.confirm}>
            <p>
              Eliminare questo commento?
              {comment.replies > 0 &&
                ` Spariscono anche ${comment.replies === 1 ? "la sua risposta" : `le sue ${comment.replies} risposte`}.`}
            </p>
            <div className={styles.buttons}>
              <button
                type="button"
                className={`glass ${styles.action}`}
                onClick={() => setAsking(false)}
              >
                Annulla
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.danger}`}
                disabled={busy}
                onClick={remove}
              >
                Sì, elimina
              </button>
            </div>
          </div>
        )}
        {problem && (
          <p role="alert" className={styles.problem}>
            {problem}
          </p>
        )}
      </div>
      {!asking && (
        <button
          type="button"
          className={`glass ${styles.action} ${styles.danger}`}
          onClick={() => setAsking(true)}
        >
          <Icon name="trash" size={16} />
          Elimina
        </button>
      )}
    </div>
  );
}
