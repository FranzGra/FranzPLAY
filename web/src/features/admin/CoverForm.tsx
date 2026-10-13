import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { type AdminVideo, resetCover, setCoverSecond, uploadCover } from "../../api/adminVideos";
import { ApiError } from "../../api/client";
import { streamURL } from "../../api/videos";
import { formatDuration } from "../../lib/format";
import { type LoadedPhoto, loadPhoto } from "../profile/photo";
import styles from "./Admin.module.css";
import { CoverCropper } from "./CoverCropper";
import { renderCover } from "./coverImage";
import { OnlineSearch } from "./OnlineSearch";

// CoverForm lets the administrator choose the cover of a video: an image
// of their own or one found on the internet, cut to the shape of a cover,
// or a moment of the video. The
// choice stays until they go back to the one FranzPLAY picks: a new
// reading of the folders or a search on the internet never replaces it.
export function CoverForm({
  video,
  onChosen,
  onClose,
}: {
  video: AdminVideo;
  onChosen: (video: AdminVideo) => void;
  onClose: () => void;
}) {
  const [picture, setPicture] = useState<LoadedPhoto | null>(null);
  const [moment, setMoment] = useState(false);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  // The picture's address lives until the cropper closes.
  useEffect(() => {
    if (!picture) return;
    return () => URL.revokeObjectURL(picture.url);
  }, [picture]);

  const save = (work: () => Promise<void>, chosen: AdminVideo) => {
    setBusy(true);
    setProblem("");
    work()
      .then(() => {
        setPicture(null);
        onChosen(chosen);
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem(problemText(error));
      })
      .finally(() => setBusy(false));
  };

  const open = (file: Blob) => {
    setProblem("");
    loadPhoto(file)
      .then(setPicture)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Questo file non sembra un'immagine. Prova con una foto JPEG o PNG.");
      });
  };

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be picked again
    if (file) open(file);
  };

  const now = nowText(video);
  return (
    <section className={styles.inline} aria-label={`Copertina di ${video.title}`}>
      <p className={styles.coverNow}>{now}</p>
      <div className={styles.buttons}>
        <label className={`glass ${styles.action}`}>
          Carica un'immagine
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={styles.fileInput}
            disabled={busy}
            onChange={pick}
          />
        </label>
        <button
          type="button"
          className={`glass ${styles.action}`}
          aria-expanded={moment}
          disabled={busy || video.duration === null}
          onClick={() => {
            setMoment(!moment);
            setOnline(false);
          }}
        >
          Scegli un momento
        </button>
        <button
          type="button"
          className={`glass ${styles.action}`}
          aria-expanded={online}
          disabled={busy}
          onClick={() => {
            setOnline(!online);
            setMoment(false);
          }}
        >
          Cerca su internet
        </button>
        {video.coverChoice !== "" && (
          <button
            type="button"
            className={`glass ${styles.action}`}
            disabled={busy}
            onClick={() =>
              save(() => resetCover(video.id), { ...video, coverChoice: "", coverSecond: null })
            }
          >
            Torna a quella automatica
          </button>
        )}
        <button type="button" className={`glass ${styles.action}`} onClick={onClose}>
          Chiudi
        </button>
      </div>
      {moment && video.duration !== null && (
        <MomentPicker
          video={video}
          duration={video.duration}
          busy={busy}
          onPick={(second) =>
            save(() => setCoverSecond(video.id, second), {
              ...video,
              coverChoice: "moment",
              coverSecond: second,
            })
          }
        />
      )}
      {online && <OnlineSearch title={video.title} busy={busy} onPick={open} />}
      {problem && !picture && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {picture && (
        <CoverCropper
          picture={picture}
          saving={busy}
          problem={problem}
          onCancel={() => {
            setPicture(null);
            setProblem("");
          }}
          onSave={(rect) =>
            save(async () => uploadCover(video.id, await renderCover(picture.url, rect)), {
              ...video,
              coverChoice: "image",
              coverSecond: null,
            })
          }
        />
      )}
    </section>
  );
}

// MomentPicker shows the video: the administrator stops it where they
// like, or writes the second, and uses that moment as cover.
function MomentPicker({
  video,
  duration,
  busy,
  onPick,
}: {
  video: AdminVideo;
  duration: number;
  busy: boolean;
  onPick: (second: number) => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const [second, setSecond] = useState(video.coverSecond ?? 0);
  // The video opens at the moment chosen before; later moves only seek.
  const [start] = useState(second);

  const seek = (value: number) => {
    const s = Math.min(duration, Math.max(0, Math.floor(value)));
    setSecond(s);
    if (player.current) player.current.currentTime = s;
  };

  return (
    <div className={styles.moment}>
      {/* biome-ignore lint/a11y/useMediaCaption: only the picture matters here */}
      <video
        ref={player}
        className={styles.momentVideo}
        src={`${streamURL(video.id)}#t=${start}`}
        controls
        preload="metadata"
        aria-label="Il video: fermalo nel momento che vuoi come copertina"
        onTimeUpdate={(e) => setSecond(Math.floor(e.currentTarget.currentTime))}
      />
      <div className={styles.momentControls}>
        <label className={styles.field}>
          Secondo (di {duration})
          <input
            type="number"
            min={0}
            max={duration}
            step={1}
            value={second}
            onChange={(e) => seek(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className={styles.primary}
          disabled={busy}
          onClick={() => onPick(second)}
        >
          Usa il momento {formatDuration(second)}
        </button>
      </div>
    </div>
  );
}

// nowText says where the cover comes from now.
function nowText(video: AdminVideo): string {
  switch (video.coverChoice) {
    case "image":
      return "La copertina ora è un'immagine caricata da te.";
    case "moment":
      return `La copertina ora è il momento ${formatDuration(video.coverSecond ?? 0)} del video.`;
    default:
      return "La copertina ora la sceglie FranzPLAY: un'immagine accanto al video, una trovata su internet o un fotogramma.";
  }
}

function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 413:
        return "L'immagine è troppo grande: al massimo 10 MB.";
      case 415:
        return "Questo file non è un'immagine JPEG, PNG o WebP.";
      case 409:
        return "Il file del video non si trova, o non è ancora stato letto: riprova più tardi.";
    }
  }
  return "Non si è riusciti a salvare. Riprova tra poco.";
}
