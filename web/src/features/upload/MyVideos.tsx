import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { changeMyVideo, deleteMyVideo, fetchMyVideos, type MyVideo } from "../../api/myVideos";
import { formatBytes, formatDate } from "../../lib/format";
import { type Choice, choiceOf, ready, seenBy, sharing } from "../sharing/audience";
import { WhoSees } from "../sharing/WhoSees";
import { videoHints } from "./hints";
import styles from "./MyVideos.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; videos: MyVideo[] };

// MyVideos lists the videos I uploaded, with a new title, who sees it or a
// delete for each. version changes when a new one arrives, to read the list again.
export function MyVideos({ version, onChange }: { version: number; onChange: () => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    // version is only a signal to read the list again.
    void version;
    const controller = new AbortController();
    fetchMyVideos(controller.signal)
      .then((videos) => setState({ kind: "ready", videos }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [version]);

  if (state.kind === "loading") return null;
  if (state.kind === "error") {
    return (
      <p role="alert" className={styles.problem}>
        L'elenco dei tuoi video non è disponibile: ricarica la pagina tra poco.
      </p>
    );
  }
  const replace = (video: MyVideo) =>
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", videos: s.videos.map((v) => (v.id === video.id ? video : v)) }
        : s,
    );
  const remove = (id: number) => {
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", videos: s.videos.filter((v) => v.id !== id) } : s,
    );
    onChange();
  };

  return (
    <section className={styles.root} aria-label="I tuoi video">
      <h2 className={styles.heading}>I tuoi video</h2>
      {state.videos.length === 0 ? (
        <p className={styles.note}>
          Qui compariranno i video che carichi, con i tasti per cambiare titolo, decidere chi li
          vede o eliminarli.
        </p>
      ) : (
        <ul className={styles.list}>
          {state.videos.map((video) => (
            <li key={video.id}>
              <VideoRow video={video} onChanged={replace} onDeleted={() => remove(video.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function VideoRow({
  video,
  onChanged,
  onDeleted,
}: {
  video: MyVideo;
  onChanged: (video: MyVideo) => void;
  onDeleted: () => void;
}) {
  const [asking, setAsking] = useState<"nothing" | "title" | "who" | "delete">("nothing");
  const [who, setWho] = useState<Choice>(() => choiceOf(video.private, video.sharedWith));
  const [title, setTitle] = useState(video.title);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setProblem("");
    work()
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
      })
      .finally(() => setBusy(false));
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim();
    if (clean === "") {
      setProblem("Il titolo non può essere vuoto.");
      return;
    }
    run(async () => {
      onChanged(await changeMyVideo(video.id, { title: clean }));
      setAsking("nothing");
    });
  };

  return (
    <div className={`glass ${styles.row}`}>
      <Link to={`/video/${video.id}`} className={styles.cover} tabIndex={-1} aria-hidden="true">
        {video.cover && <img src={video.cover} alt="" loading="lazy" />}
      </Link>
      <div className={styles.text}>
        <Link to={`/video/${video.id}`} className={styles.title}>
          {video.title}
        </Link>
        <p className={styles.note}>
          {formatDate(video.addedAt)} · {formatBytes(video.size)}
          {` · ${seenBy(video.private, video.sharedWith)}`}
          {video.hidden && " · nascosto dall'amministratore"}
        </p>

        {asking === "title" && (
          <form className={styles.inline} onSubmit={rename} aria-label="Nuovo titolo">
            <input
              value={title}
              maxLength={200}
              aria-label="Titolo"
              // biome-ignore lint/a11y/noAutofocus: the person just asked to change it
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
            <button type="submit" className={styles.primary} disabled={busy}>
              Salva
            </button>
            <button
              type="button"
              className={`glass ${styles.action}`}
              onClick={() => {
                setTitle(video.title);
                setAsking("nothing");
              }}
            >
              Annulla
            </button>
          </form>
        )}
        {asking === "delete" && (
          <div className={styles.confirm}>
            <p>
              Eliminare <strong>{video.title}</strong>? Spariscono il file, i mi piace e i commenti.
              Non si può annullare.
            </p>
            <div className={styles.buttons}>
              <button
                type="button"
                className={`glass ${styles.action}`}
                onClick={() => setAsking("nothing")}
              >
                Annulla
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.danger}`}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await deleteMyVideo(video.id);
                    onDeleted();
                  })
                }
              >
                Sì, elimina
              </button>
            </div>
          </div>
        )}
        {asking === "nothing" && (
          <div className={styles.buttons}>
            <button
              type="button"
              className={`glass ${styles.action}`}
              onClick={() => setAsking("title")}
            >
              Cambia titolo
            </button>
            <button
              type="button"
              className={`glass ${styles.action}`}
              onClick={() => {
                setWho(choiceOf(video.private, video.sharedWith));
                setAsking("who");
              }}
            >
              Chi lo vede
            </button>
            <button
              type="button"
              className={`glass ${styles.action}`}
              onClick={() => setAsking("delete")}
            >
              Elimina
            </button>
          </div>
        )}
        {problem && (
          <p role="alert" className={styles.problem}>
            {problem}
          </p>
        )}
      </div>
      {asking === "who" && (
        <form
          className={styles.who}
          aria-label="Chi lo vede"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready(who)) {
              setProblem("Scegli almeno una persona che potrà vederlo.");
              return;
            }
            run(async () => {
              onChanged(await changeMyVideo(video.id, sharing(who)));
              setAsking("nothing");
            });
          }}
        >
          <WhoSees choice={who} onChange={setWho} hints={videoHints} />
          <div className={styles.buttons}>
            <button type="submit" className={styles.primary} disabled={busy}>
              Salva
            </button>
            <button
              type="button"
              className={`glass ${styles.action}`}
              onClick={() => {
                setProblem("");
                setAsking("nothing");
              }}
            >
              Annulla
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function explain(error: unknown): string {
  if (!(error instanceof ApiError)) return "Il server non risponde. Riprova tra poco.";
  switch (error.status) {
    case 400:
      if (error.message.includes("people"))
        return "Qualcuna delle persone scelte non c'è più: ricarica la pagina e scegli di nuovo.";
      return "Il titolo può avere al massimo 200 caratteri, su una riga.";
    case 404:
      return "Questo video non c'è più: ricarica la pagina.";
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
