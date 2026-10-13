import { useId, useState } from "react";
import { Link } from "react-router";
import { avatarUrl } from "../../api/auth";
import { type Comment, maxCommentLength } from "../../api/comments";
import { formatSince } from "../../lib/format";
import styles from "./Comments.module.css";
import { countComments, useComments } from "./useComments";

// Comments is the section under a video where people talk about it:
// conversations newest first, each with its replies.
export function Comments({ videoId }: { videoId: number }) {
  const { state, add, remove } = useComments(videoId);
  const [now] = useState(() => new Date());
  const titleId = useId();

  const count = state.kind === "ready" ? countComments(state.comments) : 0;
  return (
    <section className={styles.root} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {count === 0 ? "Commenti" : count === 1 ? "1 commento" : `${count} commenti`}
      </h2>
      {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
      {state.kind === "error" && (
        <p className={styles.muted}>Non sono riuscito a caricare i commenti. Ricarica la pagina.</p>
      )}
      {state.kind === "ready" && (
        <>
          <CommentForm
            label="Aggiungi un commento"
            placeholder="Aggiungi un commento…"
            submit="Commenta"
            onSubmit={(body) => add(body)}
          />
          {state.comments.length === 0 ? (
            <p className={styles.muted}>Ancora nessun commento. Scrivi il primo!</p>
          ) : (
            <ul className={`stagger ${styles.list}`}>
              {state.comments.map((c) => (
                <li key={c.id}>
                  <Conversation comment={c} now={now} add={add} remove={remove} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

type Actions = {
  add: (body: string, rootId?: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
};

// Conversation is a comment with its replies and the form to answer.
function Conversation({ comment, now, add, remove }: { comment: Comment; now: Date } & Actions) {
  const [replying, setReplying] = useState(false);
  const reply = () => setReplying(true);
  return (
    <>
      <CommentView comment={comment} now={now} onReply={reply} remove={remove} />
      {(comment.replies.length > 0 || replying) && (
        <div className={styles.replies}>
          {comment.replies.length > 0 && (
            <ul
              className={`stagger ${styles.list}`}
              aria-label={`Risposte a ${comment.author.name}`}
            >
              {comment.replies.map((r) => (
                <li key={r.id}>
                  <CommentView comment={r} now={now} onReply={reply} remove={remove} />
                </li>
              ))}
            </ul>
          )}
          {replying && (
            <CommentForm
              label={`Rispondi a ${comment.author.name}`}
              placeholder="Aggiungi una risposta…"
              submit="Rispondi"
              autoFocus
              onSubmit={(body) => add(body, comment.id)}
              onDone={() => setReplying(false)}
            />
          )}
        </div>
      )}
    </>
  );
}

function CommentView({
  comment,
  now,
  onReply,
  remove,
}: {
  comment: Comment;
  now: Date;
  onReply: () => void;
  remove: (id: number) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState("");
  const confirm = () => {
    setAsking(false);
    setProblem("");
    remove(comment.id).catch((error: unknown) => {
      console.error(error);
      setProblem("Non sono riuscito a eliminare il commento. Riprova.");
    });
  };
  return (
    <article className={styles.comment} aria-label={`Commento di ${comment.author.name}`}>
      {comment.author.avatar > 0 ? (
        <img
          className={styles.avatar}
          src={avatarUrl(comment.author.id, comment.author.avatar)}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className={styles.avatar} aria-hidden="true">
          {comment.author.name.charAt(0).toUpperCase()}
        </span>
      )}
      <div className={styles.content}>
        <p className={styles.meta}>
          <Link to={`/canale/${comment.author.id}`} className={styles.author}>
            {comment.author.name}
          </Link>
          <time dateTime={comment.createdAt.toISOString()}>
            {formatSince(comment.createdAt, now)}
          </time>
        </p>
        <p className={styles.body}>{comment.body}</p>
        <div className={styles.actions}>
          {asking ? (
            <>
              <span>
                Eliminare il commento{comment.replies.length > 0 && " e le sue risposte"}?
              </span>
              <button
                type="button"
                className={`${styles.small} ${styles.danger}`}
                onClick={confirm}
              >
                Sì, elimina
              </button>
              <button type="button" className={styles.small} onClick={() => setAsking(false)}>
                Annulla
              </button>
            </>
          ) : (
            <>
              <button type="button" className={styles.small} onClick={onReply}>
                Rispondi
              </button>
              {comment.canDelete && (
                <button type="button" className={styles.small} onClick={() => setAsking(true)}>
                  Elimina
                </button>
              )}
            </>
          )}
        </div>
        {problem && (
          <p role="alert" className={styles.problem}>
            {problem}
          </p>
        )}
      </div>
    </article>
  );
}

// CommentForm is where a comment or a reply is written.
function CommentForm({
  label,
  placeholder,
  submit,
  autoFocus = false,
  onSubmit,
  onDone,
}: {
  label: string;
  placeholder: string;
  submit: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<void>;
  onDone?: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");
  const empty = body.trim() === "";

  const send = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (empty || sending) return;
    setSending(true);
    setProblem("");
    onSubmit(body)
      .then(() => {
        setBody("");
        onDone?.();
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non sono riuscito a pubblicare il commento. Riprova.");
      })
      .finally(() => setSending(false));
  };

  return (
    <form className={styles.form} onSubmit={send}>
      <textarea
        className={styles.input}
        aria-label={label}
        placeholder={placeholder}
        value={body}
        maxLength={maxCommentLength}
        rows={body.includes("\n") ? 3 : 1}
        // biome-ignore lint/a11y/noAutofocus: the person just asked to reply here
        autoFocus={autoFocus}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl+Enter (or Cmd+Enter) sends, like in many chats.
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(e);
        }}
      />
      {(!empty || onDone) && (
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.small}
            onClick={() => {
              setBody("");
              setProblem("");
              onDone?.();
            }}
          >
            Annulla
          </button>
          <button type="submit" className={styles.send} disabled={empty || sending}>
            {submit}
          </button>
        </div>
      )}
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}
