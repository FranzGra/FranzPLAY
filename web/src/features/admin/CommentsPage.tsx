import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { avatarUrl } from "../../api/auth";
import { deleteComment, fetchRecentComments, type RecentComment } from "../../api/comments";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { formatSince } from "../../lib/format";
import pages from "./Pages.module.css";
import { Card, Chip, Empty, Loading, PageHeader, Unavailable, ui } from "./ui";

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

  const header = (
    <PageHeader
      title="Commenti"
      description="Tutti i commenti, dai più nuovi. Puoi eliminare quelli che non vanno bene: chi li ha scritti non riceve avvisi."
    />
  );
  if (state.kind === "loading") {
    return (
      <div className={ui.ui}>
        {header}
        <Loading />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={ui.ui}>
        {header}
        <Unavailable title="Commenti non disponibili" />
      </div>
    );
  }
  if (state.comments.length === 0) {
    return (
      <div className={ui.ui}>
        {header}
        <Empty icon="comment" title="Ancora nessun commento">
          Quando qualcuno scrive sotto un video, il commento compare qui.
        </Empty>
      </div>
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
    <div className={ui.ui}>
      {header}
      <Card
        title="Dai più nuovi"
        icon="comment"
        sub={`${state.total.toLocaleString("it-IT")} ${state.total === 1 ? "commento" : "commenti"}`}
      >
        <ul className={pages.comments} aria-label="Commenti">
          {state.comments.map((c) => (
            <li key={c.id}>
              <CommentRow comment={c} onRemoved={() => removed(c)} />
            </li>
          ))}
        </ul>
        {state.comments.length < state.total && state.comments.length < maxShown && (
          <div className={pages.more}>
            <button type="button" className={ui.btn} onClick={more}>
              Mostra altri
            </button>
          </div>
        )}
      </Card>
    </div>
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
    <article className={pages.comment} data-asking={asking || undefined}>
      <Avatar
        name={comment.author.name}
        size={40}
        photo={avatarUrl(comment.author.id, comment.author.avatar)}
      />
      <div className={pages.commentMain}>
        <p className={pages.commentHead}>
          <strong>{comment.author.name}</strong>
          {comment.reply ? " ha risposto sotto " : " ha scritto sotto "}
          {comment.video.visible ? (
            <Link className={ui.link} to={`/video/${comment.video.id}`}>
              {comment.video.title}
            </Link>
          ) : (
            <span>{comment.video.title} (nascosto o non trovato)</span>
          )}{" "}
          · {formatSince(comment.createdAt, new Date())}
        </p>
        <p className={pages.commentBody}>{comment.body}</p>
        {comment.replies > 0 && (
          <Chip icon="comment">
            {comment.replies === 1 ? "1 risposta" : `${comment.replies} risposte`}
          </Chip>
        )}
        {asking && (
          <div className={pages.confirm}>
            <p>
              Eliminare questo commento?
              {comment.replies > 0 &&
                ` Spariscono anche ${comment.replies === 1 ? "la sua risposta" : `le sue ${comment.replies} risposte`}.`}
            </p>
            <div className={ui.chips}>
              <button
                type="button"
                className={`${ui.btn} ${ui.ghost}`}
                onClick={() => setAsking(false)}
              >
                Annulla
              </button>
              <button
                type="button"
                className={`${ui.btn} ${ui.dangerBtn}`}
                disabled={busy}
                onClick={remove}
              >
                <Icon name="trash" size={16} />
                Sì, elimina
              </button>
            </div>
          </div>
        )}
        {problem && (
          <p role="alert" className={ui.problem}>
            {problem}
          </p>
        )}
      </div>
      {!asking && (
        <button
          type="button"
          className={`${ui.btn} ${ui.small} ${ui.dangerBtn}`}
          onClick={() => setAsking(true)}
        >
          <Icon name="trash" size={16} />
          Elimina
        </button>
      )}
    </article>
  );
}
