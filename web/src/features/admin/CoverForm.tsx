import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type AdminVideo,
  refreshVideo,
  resetCover,
  setCoverSecond,
  uploadCover,
} from "../../api/adminVideos";
import { ApiError } from "../../api/client";
import { type Preview, streamURL } from "../../api/videos";
import { Icon, type IconName } from "../../components/Icon";
import { BusyRing } from "../../components/ProgressBar";
import { formatDuration } from "../../lib/format";
import { usePresence } from "../../lib/presence";
import { type LoadedPhoto, loadPhoto } from "../profile/photo";
import { CoverCropper } from "./CoverCropper";
import { renderCover } from "./coverImage";
import edit from "./Edit.module.css";
import { OnlineSearch } from "./OnlineSearch";
import { Card, ui } from "./ui";

type Tab = "video" | "image" | "online" | "auto";

const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: "video", label: "Dal video", icon: "film" },
  { id: "image", label: "Immagine", icon: "upload" },
  { id: "online", label: "Internet", icon: "globe" },
  { id: "auto", label: "Automatica", icon: "sparkles" },
];

// How many moments of the video the grid offers.
const strip = 12;

// CoverForm is the cover of a video: the one in use on the left, and on
// the right four ways to choose another, as tabs: a moment of the video,
// an image of one's own, one found on the internet, or the one FranzPLAY
// picks. The server makes the new cover in its queue: meanwhile the
// picture says "Preparo la nuova copertina…" and changes by itself when it
// is ready (pending, followed by the page). A choice stays until the
// administrator goes back to the automatic one: a new reading of the
// folders or a search on the internet never replaces it.
export function CoverForm({
  video,
  pending,
  onAsked,
}: {
  video: AdminVideo;
  pending: boolean;
  onAsked: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(video.preview || video.duration !== null ? "video" : "image");
  const [picture, setPicture] = useState<LoadedPhoto | null>(null);
  // The window to fit the picture closes softly: it keeps the picture meanwhile.
  const cropper = usePresence(picture);
  const cropping = cropper.shown;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const tabsId = useId();
  const [wideSpace, setWideSpace] = useState<HTMLDivElement | null>(null);

  // The picture's address lives until the cropper closes.
  useEffect(() => {
    if (!picture) return;
    return () => URL.revokeObjectURL(picture.url);
  }, [picture]);

  const save = (work: () => Promise<void>, message: string) => {
    setBusy(true);
    setProblem("");
    work()
      .then(() => {
        setPicture(null);
        onAsked(message);
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

  const locked = busy || video.missing;
  const coming = "In coda: la nuova copertina arriva tra poco.";

  return (
    <Card title="Copertina" icon="image" sub="La vede chi scorre la Home e le liste">
      <section className={edit.coverGrid} aria-label={`Copertina di ${video.title}`}>
        <div className={edit.coverNow}>
          <div className={edit.coverPicture} data-pending={pending || undefined}>
            {video.cover ? (
              <img src={video.cover} alt="La copertina di adesso" />
            ) : (
              <span className={edit.noPoster}>
                <Icon name="image" size={32} />
              </span>
            )}
            {pending && (
              <span className={edit.coverBusy} role="status">
                <BusyRing size={20} />
                Preparo la nuova copertina…
              </span>
            )}
          </div>
          <p className={edit.coverText}>
            {nowText(video)}
            {pending && " Appena pronta si aggiorna qui e nel lettore, senza ricaricare."}
          </p>
        </div>

        <div className={edit.coverChoose}>
          <div className={ui.tabs} role="tablist" aria-label="Scegli la copertina">
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`${tabsId}-${t.id}`}
                type="button"
                role="tab"
                className={ui.tab}
                aria-selected={tab === t.id}
                aria-controls={`${tabsId}-${t.id}-panel`}
                onClick={() => {
                  setTab(t.id);
                  setProblem("");
                }}
              >
                <Icon name={t.icon} size={16} />
                {t.label}
              </button>
            ))}
          </div>
          <div
            id={`${tabsId}-${tab}-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-${tab}`}
            className={edit.tabPanel}
          >
            {tab === "video" && (
              <FromVideo
                video={video}
                busy={locked}
                wideSpace={wideSpace}
                onPick={(second) => save(() => setCoverSecond(video.id, second), coming)}
              />
            )}
            {tab === "image" && (
              <div className={edit.drop}>
                <Icon name="image" size={28} />
                <p>
                  <b>Un'immagine tua</b>
                  JPEG, PNG o WebP fino a 10 MB. Poi la sistemi nella forma della copertina.
                </p>
                <label className={`${ui.btn} ${ui.primary}`} aria-disabled={locked || undefined}>
                  <Icon name="upload" size={16} />
                  Carica un'immagine
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className={ui.fileInput}
                    disabled={locked}
                    onChange={pick}
                  />
                </label>
              </div>
            )}
            {tab === "online" && (
              <OnlineSearch title={video.title} busy={locked} onPick={open} resultsIn={wideSpace} />
            )}
            {tab === "auto" && (
              <div className={edit.auto}>
                <p className={ui.cardText}>
                  FranzPLAY sceglie da solo: un'immagine accanto al file del video, una trovata su
                  internet, o un fotogramma del video.
                </p>
                <div className={ui.chips}>
                  {video.coverChoice === "" ? (
                    <span className={ui.chip} data-tone="ok">
                      <Icon name="check" size={14} />È già quella automatica
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`${ui.btn} ${ui.primary}`}
                      disabled={locked}
                      onClick={() =>
                        save(
                          () => resetCover(video.id),
                          "La copertina la sceglie di nuovo FranzPLAY.",
                        )
                      }
                    >
                      Torna a quella automatica
                    </button>
                  )}
                  <button
                    type="button"
                    className={ui.btn}
                    disabled={locked}
                    onClick={() =>
                      save(
                        () => refreshVideo(video.id),
                        "In coda: copertina e anteprime arrivano tra poco.",
                      )
                    }
                  >
                    <Icon name="refresh" size={16} />
                    Rifai copertina e anteprime
                  </button>
                </div>
              </div>
            )}
            {problem && !picture && (
              <p role="alert" className={ui.problem}>
                {problem}
              </p>
            )}
          </div>
        </div>
        {/* The moments of the video, the exact second and what a search on the
            internet found open here, as wide as the box. */}
        <div ref={setWideSpace} className={edit.coverWide} />
      </section>
      {cropping && (
        <CoverCropper
          ref={cropper.ref}
          leaving={cropper.leaving}
          picture={cropping}
          saving={busy}
          problem={problem}
          onCancel={() => {
            setPicture(null);
            setProblem("");
          }}
          onSave={(rect) =>
            save(async () => uploadCover(video.id, await renderCover(cropping.url, rect)), coming)
          }
        />
      )}
    </Card>
  );
}

// frames picks moments of the video from the frames over its timeline,
// evenly spread, to choose the cover from.
export function frames(preview: Preview, count = strip): { second: number; index: number }[] {
  const out: { second: number; index: number }[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.min(preview.count - 1, Math.round(((i + 0.5) * preview.count) / count));
    if (!out.some((f) => f.index === index)) out.push({ index, second: index * preview.gap });
  }
  return out;
}

// FromVideo is the "Dal video" tab: a grid of moments of the video to pick
// from, and the video itself to stop on the exact second. Next to the tabs
// stays only the way to go from one to the other: both open in wideSpace, as
// wide as the box, so the moments can be judged at a glance.
function FromVideo({
  video,
  busy,
  wideSpace,
  onPick,
}: {
  video: AdminVideo;
  busy: boolean;
  wideSpace: HTMLElement | null;
  onPick: (second: number) => void;
}) {
  const picks = video.preview ? frames(video.preview) : [];
  const [chosen, setChosen] = useState<number | null>(
    video.coverChoice === "moment" ? video.coverSecond : null,
  );
  const [exact, setExact] = useState(picks.length === 0);

  if (video.duration === null) {
    return (
      <p className={ui.cardText}>
        Il video non è ancora stato letto: i suoi momenti si scelgono appena FranzPLAY lo ha letto.
      </p>
    );
  }

  return (
    <div className={edit.fromVideo}>
      {picks.length === 0 && (
        <p className={ui.cardText}>
          Le anteprime del video non sono ancora pronte: ferma il video dove vuoi.
        </p>
      )}
      {picks.length > 0 && (
        <>
          <p className={ui.hint}>
            {exact
              ? "Ferma il video, sposta il cursore o scrivi il secondo che vuoi."
              : `${picks.length} momenti da tutto il video, uno ogni ${formatDuration(
                  Math.round(video.duration / picks.length),
                )}.`}
          </p>
          <div className={edit.fromVideoActions}>
            <button
              type="button"
              className={ui.btn}
              aria-expanded={exact}
              onClick={() => setExact(!exact)}
            >
              {exact ? "Torna ai momenti" : "Scegli il secondo esatto"}
            </button>
          </div>
        </>
      )}
      {wideSpace &&
        createPortal(
          <div className={edit.fromVideoWide}>
            {exact ? (
              <MomentPicker
                video={video}
                duration={video.duration}
                start={chosen ?? video.coverSecond ?? 0}
                busy={busy}
                onPick={onPick}
              />
            ) : (
              video.preview && (
                <>
                  <fieldset className={edit.frames} disabled={busy}>
                    <legend className="visually-hidden">Momenti del video</legend>
                    {picks.map((f) => (
                      <label
                        key={f.index}
                        className={edit.frameItem}
                        data-checked={chosen === f.second}
                      >
                        <input
                          type="radio"
                          name={`moment-${video.id}`}
                          className="visually-hidden"
                          aria-label={`Il momento ${formatDuration(f.second)}`}
                          checked={chosen === f.second}
                          onChange={() => setChosen(f.second)}
                        />
                        <FrameOf preview={video.preview as Preview} index={f.index} />
                        <span className={edit.frameTime}>{formatDuration(f.second)}</span>
                      </label>
                    ))}
                  </fieldset>
                  <div className={edit.fromVideoActions}>
                    <button
                      type="button"
                      className={`${ui.btn} ${ui.primary}`}
                      disabled={busy || chosen === null}
                      onClick={() => chosen !== null && onPick(chosen)}
                    >
                      {chosen === null
                        ? "Scegli un momento"
                        : `Usa ${formatDuration(chosen)} come copertina`}
                    </button>
                  </div>
                </>
              )
            )}
          </div>,
          wideSpace,
        )}
    </div>
  );
}

// MomentPicker shows the video: the administrator stops it where they like,
// moves the slider or writes the second, and uses that moment as cover. The
// picture follows the slider, but with one seek at a time: moves made while
// the video is still looking for a frame only update the place to go next.
function MomentPicker({
  video,
  duration,
  start,
  busy,
  onPick,
}: {
  video: AdminVideo;
  duration: number;
  start: number;
  busy: boolean;
  onPick: (second: number) => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const [second, setSecond] = useState(start);
  // The video opens at the moment chosen before; later moves only seek.
  const [from] = useState(start);
  const next = useRef<number | null>(null);
  const fieldId = useId();
  const sliderId = useId();

  const seek = (value: number) => {
    const s = Math.min(duration, Math.max(0, Math.floor(value)));
    setSecond(s);
    const video = player.current;
    if (!video) return;
    if (!video.paused) video.pause();
    if (video.seeking) next.current = s;
    else video.currentTime = s;
  };

  return (
    <div className={edit.moment}>
      {/* biome-ignore lint/a11y/useMediaCaption: only the picture matters here */}
      <video
        ref={player}
        className={edit.momentVideo}
        src={`${streamURL(video.id)}#t=${from}`}
        controls
        preload="metadata"
        aria-label="Il video: fermalo nel momento che vuoi come copertina"
        onTimeUpdate={(e) => {
          // A seek on its way: the slider stays where the administrator left it.
          if (e.currentTarget.seeking || next.current !== null) return;
          setSecond(Math.floor(e.currentTarget.currentTime));
        }}
        onSeeked={(e) => {
          if (next.current === null) return;
          e.currentTarget.currentTime = next.current;
          next.current = null;
        }}
      />
      <div className={edit.momentSlider}>
        <div className={edit.momentSliderHead}>
          <label htmlFor={sliderId} className={ui.label}>
            Momento del video
          </label>
          <span className={edit.momentTime}>
            {formatDuration(second)} di {formatDuration(duration)}
          </span>
        </div>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={duration}
          step={1}
          value={second}
          aria-valuetext={formatDuration(second)}
          onChange={(e) => seek(Number(e.target.value))}
        />
      </div>
      <div className={edit.momentControls}>
        <span className={ui.field}>
          <label htmlFor={fieldId} className={ui.label}>
            Secondo (di {duration})
          </label>
          <input
            id={fieldId}
            type="number"
            className={`${ui.input} ${edit.secondInput}`}
            min={0}
            max={duration}
            step={1}
            value={second}
            onChange={(e) => seek(Number(e.target.value))}
          />
        </span>
        <button
          type="button"
          className={`${ui.btn} ${ui.primary}`}
          disabled={busy}
          onClick={() => onPick(second)}
        >
          Usa {formatDuration(second)} come copertina
        </button>
      </div>
    </div>
  );
}

// FrameOf shows one frame of the image over the timeline.
function FrameOf({ preview, index }: { preview: Preview; index: number }) {
  const column = index % preview.columns;
  const row = Math.floor(index / preview.columns);
  const rows = Math.ceil(preview.count / preview.columns);
  return (
    <span
      className={edit.frame}
      style={{
        backgroundImage: `url("${preview.src}")`,
        backgroundSize: `${preview.columns * 100}% ${rows * 100}%`,
        backgroundPosition: `${preview.columns > 1 ? (column / (preview.columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
      }}
    />
  );
}

// nowText says where the cover comes from now.
function nowText(video: AdminVideo): string {
  switch (video.coverChoice) {
    case "image":
      return "Scelta: un'immagine caricata da te.";
    case "moment":
      return `Scelta: il momento ${formatDuration(video.coverSecond ?? 0)} del video.`;
    default:
      return "Automatica: la sceglie FranzPLAY.";
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
