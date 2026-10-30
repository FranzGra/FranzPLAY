import { type ChangeEvent, useState } from "react";
import { type AdminVideo, remakeClip, removeClip, uploadClip } from "../../api/adminVideos";
import { ApiError } from "../../api/client";
import { Icon } from "../../components/Icon";
import edit from "./Edit.module.css";
import { Card, ui } from "./ui";

// The largest video the server accepts for a clip.
const maxClipBytes = 100 * 1024 * 1024;

// ClipForm is the clip that plays on a video's card when the pointer
// passes over it: the one FranzPLAY makes from the video, a short video
// of the administrator's own, or none at all.
export function ClipForm({
  video,
  onChosen,
}: {
  video: AdminVideo;
  onChosen: (video: AdminVideo, message: string) => void;
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

  const locked = busy || video.missing;
  const choices = [
    { id: "", label: "Fatta da FranzPLAY" },
    { id: "video", label: "Caricata da te" },
    { id: "none", label: "Nessuna" },
  ] as const;

  return (
    <Card title="Anteprima sulla scheda" icon="play" sub="Parte quando passi sopra la scheda">
      <section className={edit.clipGrid} aria-label={`Anteprima di ${video.title}`}>
        <div className={edit.clipNow}>
          {video.clip && video.clipChoice !== "none" ? (
            <video
              className={edit.clipVideo}
              src={video.clip}
              muted
              loop
              autoPlay
              playsInline
              aria-label="L'anteprima di adesso"
            />
          ) : (
            <span className={edit.noPoster}>
              <Icon name="film" size={28} />
              {video.clipChoice === "none" ? "Senza anteprima" : "Non ancora pronta"}
            </span>
          )}
        </div>
        <div className={edit.clipSide}>
          <ul className={edit.clipState} aria-label="Da dove viene">
            {choices.map((c) => (
              <li key={c.id} aria-current={video.clipChoice === c.id || undefined}>
                {video.clipChoice === c.id && <Icon name="check" size={14} />}
                {c.label}
              </li>
            ))}
          </ul>
          <p className={ui.cardText}>{nowText(video)}</p>
          <div className={ui.chips}>
            <label className={ui.btn} aria-disabled={locked || undefined}>
              <Icon name="upload" size={16} />
              Carica un video
              <input
                type="file"
                accept="video/mp4,video/webm"
                className={ui.fileInput}
                disabled={locked}
                onChange={pick}
              />
            </label>
            <button
              type="button"
              className={ui.btn}
              disabled={locked}
              onClick={() =>
                save(
                  () => remakeClip(video.id),
                  { ...video, clipChoice: "" },
                  "In coda: FranzPLAY rifà l'anteprima dal video.",
                )
              }
            >
              <Icon name="refresh" size={16} />
              Rifalla dal video
            </button>
            {video.clipChoice !== "none" && (
              <button
                type="button"
                className={`${ui.btn} ${ui.ghost}`}
                disabled={locked}
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
          </div>
          {busy && (
            <p role="status" className={ui.hint}>
              Invio in corso…
            </p>
          )}
          {problem && (
            <p role="alert" className={ui.problem}>
              {problem}
            </p>
          )}
        </div>
      </section>
    </Card>
  );
}

// nowText says where the clip comes from now.
function nowText(video: AdminVideo): string {
  switch (video.clipChoice) {
    case "video":
      return "Un video caricato da te: se ne usano i primi 15 secondi.";
    case "none":
      return "Questo video non ha anteprima sulla sua scheda.";
    default:
      return "Pochi secondi presi da momenti diversi del video.";
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
