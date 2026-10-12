import { type ChangeEvent, useState } from "react";
import { type AdminVideo, remakeClip, removeClip, uploadClip } from "../../api/adminVideos";
import { ApiError } from "../../api/client";
import styles from "./Admin.module.css";

// The largest video the server accepts for a clip.
const maxClipBytes = 100 * 1024 * 1024;

// ClipForm lets the administrator choose the clip that plays on a video's
// card: a short video of their own, none at all, or the one FranzPLAY
// makes from the video, made again.
export function ClipForm({
  video,
  onChosen,
  onClose,
}: {
  video: AdminVideo;
  onChosen: (video: AdminVideo, message: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const save = (work: () => Promise<void>, chosen: AdminVideo, message: string) => {
    setBusy(true);
    setProblem("");
    work()
      .then(() => onChosen(chosen, message))
      .catch((error: unknown) => {
        console.error(error);
        setProblem(problemText(error));
      })
      .finally(() => setBusy(false));
  };

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be picked again
    if (!file) return;
    if (file.size > maxClipBytes) {
      setProblem("Il video è troppo grande: al massimo 100 MB. Ne basta uno di pochi secondi.");
      return;
    }
    save(
      () => uploadClip(video.id, file),
      { ...video, clipChoice: "video" },
      "In coda: l'anteprima nuova arriva tra poco.",
    );
  };

  return (
    <section className={styles.inline} aria-label={`Anteprima di ${video.title}`}>
      <p className={styles.coverNow}>{nowText(video)}</p>
      {video.clip && (
        <video
          className={styles.momentVideo}
          src={video.clip}
          muted
          loop
          autoPlay
          playsInline
          aria-label="L'anteprima di adesso"
        />
      )}
      <div className={styles.buttons}>
        <label className={`glass ${styles.action}`}>
          Carica un video
          <input
            type="file"
            accept="video/mp4,video/webm"
            className={styles.fileInput}
            disabled={busy}
            onChange={pick}
          />
        </label>
        <button
          type="button"
          className={`glass ${styles.action}`}
          disabled={busy}
          onClick={() =>
            save(
              () => remakeClip(video.id),
              { ...video, clipChoice: "" },
              "In coda: FranzPLAY rifà l'anteprima dal video.",
            )
          }
        >
          Rifalla dal video
        </button>
        {video.clipChoice !== "none" && (
          <button
            type="button"
            className={`glass ${styles.action}`}
            disabled={busy}
            onClick={() =>
              save(
                () => removeClip(video.id),
                { ...video, clipChoice: "none" },
                "Fatto: niente anteprima su questo video.",
              )
            }
          >
            Nessuna anteprima
          </button>
        )}
        <button type="button" className={`glass ${styles.action}`} onClick={onClose}>
          Chiudi
        </button>
      </div>
      {busy && (
        <p role="status" className={styles.done}>
          Invio in corso…
        </p>
      )}
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </section>
  );
}

// nowText says where the clip comes from now.
function nowText(video: AdminVideo): string {
  switch (video.clipChoice) {
    case "video":
      return "L'anteprima sulla scheda del video ora è un video caricato da te: se ne usano i primi 15 secondi.";
    case "none":
      return "Ora questo video non ha anteprima sulla sua scheda.";
    default:
      return "L'anteprima sulla scheda del video ora la fa FranzPLAY, con pochi secondi presi da momenti diversi.";
  }
}

function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 413:
        return "Il video è troppo grande: al massimo 100 MB.";
      case 415:
        return "Questo file non è un video MP4 o WebM.";
      case 409:
        return "Il file del video non si trova: riprova quando è di nuovo nella sua cartella.";
    }
  }
  return "Non si è riusciti a salvare. Riprova tra poco.";
}
