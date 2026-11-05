import { type ChangeEvent, useEffect, useId, useState } from "react";
import {
  type AdminVideo,
  remakeClip,
  removeClip,
  setClipMoment,
  uploadClip,
} from "../../api/adminVideos";
import { ApiError } from "../../api/client";
import {
  defaultClipSeconds,
  fetchClipSettings,
  maxClipSeconds,
  minClipSeconds,
} from "../../api/clipSettings";
import { Icon } from "../../components/Icon";
import { formatDuration } from "../../lib/format";
import { MomentPicker } from "./CoverForm";
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
  const [choosing, setChoosing] = useState(false);
  // How long the site's clips last: the length offered for this one.
  const [siteSeconds, setSiteSeconds] = useState(defaultClipSeconds);
  useEffect(() => {
    const controller = new AbortController();
    fetchClipSettings(controller.signal)
      .then((s) => setSiteSeconds(s.seconds))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);

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
  const ownMoment = video.clipSecond !== null || video.clipSeconds !== null;
  const canChoose = video.duration !== null && video.duration >= 4 && !video.fileProblem;
  const fromHere = (second: number, seconds: number) => {
    // The site's length is not kept: if the site changes it, this clip follows.
    const length = seconds === siteSeconds ? null : seconds;
    save(
      () => setClipMoment(video.id, second, length),
      { ...video, clipChoice: "", clipSecond: second, clipSeconds: length },
      `In coda: l'anteprima riparte da ${formatDuration(second)} e dura ${seconds} secondi.`,
    );
    setChoosing(false);
  };
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
            {canChoose && (
              <button
                type="button"
                className={ui.btn}
                disabled={locked}
                aria-expanded={choosing}
                onClick={() => setChoosing(!choosing)}
              >
                <Icon name="clock" size={16} />
                {choosing ? "Chiudi la scelta del momento" : "Scegli il momento"}
              </button>
            )}
            {ownMoment && (
              <button
                type="button"
                className={`${ui.btn} ${ui.ghost}`}
                disabled={locked}
                onClick={() =>
                  save(
                    () => setClipMoment(video.id, null, null),
                    { ...video, clipChoice: "", clipSecond: null, clipSeconds: null },
                    "In coda: l'anteprima torna come quelle del sito.",
                  )
                }
              >
                Torna come le altre
              </button>
            )}
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
      {choosing && canChoose && video.duration !== null && (
        <ClipMoment
          video={video}
          duration={video.duration}
          busy={locked}
          firstSeconds={video.clipSeconds ?? siteSeconds}
          onPick={fromHere}
        />
      )}
    </Card>
  );
}

// ClipMoment is the video with its slider, as for the cover: the
// administrator stops it where the clip should start and chooses how long
// it lasts. The video stays on the chosen frame, the first of the clip.
function ClipMoment({
  video,
  duration,
  busy,
  firstSeconds,
  onPick,
}: {
  video: AdminVideo;
  duration: number;
  busy: boolean;
  firstSeconds: number;
  onPick: (second: number, seconds: number) => void;
}) {
  const [seconds, setSeconds] = useState(firstSeconds);
  const [problem, setProblem] = useState("");
  const secondsId = useId();
  const last = Math.max(0, duration - 1);
  const start = Math.min(last, video.clipSecond ?? Math.floor(duration / 4));
  return (
    <div className={edit.clipMoment}>
      <p className={ui.hint}>
        Ferma il video dove deve partire l'anteprima: il fotogramma fermo è il primo che si vede. Se
        il video finisce prima della durata scelta, l'anteprima parte un po' prima.
      </p>
      <MomentPicker
        video={video}
        duration={duration}
        last={last}
        sliderLabel="Inizio dell'anteprima"
        start={start}
        busy={busy}
        videoLabel="Il video: fermalo dove deve partire l'anteprima"
        action={() => (
          <>
            <Icon name="refresh" size={16} />
            Rigenera anteprima da qui
          </>
        )}
        onPick={(second) => {
          if (seconds < minClipSeconds || seconds > maxClipSeconds) {
            setProblem(`Scegli una durata tra ${minClipSeconds} e ${maxClipSeconds} secondi.`);
            return;
          }
          setProblem("");
          onPick(second, seconds);
        }}
      >
        <span className={ui.field}>
          <label htmlFor={secondsId} className={ui.label}>
            Durata (secondi)
          </label>
          <input
            id={secondsId}
            type="number"
            inputMode="numeric"
            className={`${ui.input} ${edit.secondInput}`}
            min={minClipSeconds}
            max={maxClipSeconds}
            step={1}
            value={seconds}
            onChange={(e) => setSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
        </span>
      </MomentPicker>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </div>
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
      if (video.clipSecond !== null) {
        const length = video.clipSeconds === null ? "" : `, per ${video.clipSeconds} secondi`;
        return `Fatta dal video, a partire da ${formatDuration(video.clipSecond)}${length}: scelto da te.`;
      }
      if (video.clipSeconds !== null) {
        return `Pochi secondi presi dal video, ${video.clipSeconds} in tutto: scelto da te.`;
      }
      return "Pochi secondi presi da momenti diversi del video, o dal punto scelto in Amministrazione › Sito.";
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
