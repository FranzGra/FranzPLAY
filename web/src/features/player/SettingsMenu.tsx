import { type ReactNode, useState } from "react";
import type { AudioTrack } from "../../api/audio";
import type { SubtitleTrack } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { speedLabel, speeds } from "./controls";
import styles from "./Player.module.css";
import {
  optionLabel,
  type SubtitleStyle,
  styleKeys,
  subtitleCSS,
  subtitleOptions,
} from "./subtitleStyle";

type SettingsMenuProps = {
  speed: number;
  onSpeed: (speed: number) => void;
  tracks: SubtitleTrack[];
  track: string | null; // key of the subtitles shown, null = off
  onTrack: (key: string | null) => void;
  audio: AudioTrack[]; // the sound tracks; fewer than two = no choice
  audioStream: number | null; // the one playing
  onAudio: (stream: number) => void;
  subtitleStyle: SubtitleStyle;
  onSubtitleStyle: (style: SubtitleStyle) => void;
  repeat: boolean; // start again at the end
  onRepeat: (repeat: boolean) => void;
  onClose: () => void;
};

type Page = "main" | "speed" | "audio" | "subtitles" | "style" | keyof SubtitleStyle;

// SettingsMenu is the panel opened by the gear button. Each setting has its
// own page, as on YouTube, so the panel stays small on phones.
export function SettingsMenu(props: SettingsMenuProps) {
  const { speed, onSpeed, tracks, track, onTrack, audio, audioStream, onAudio } = props;
  const { subtitleStyle, onSubtitleStyle, repeat, onRepeat, onClose } = props;
  const [page, setPage] = useState<Page>("main");
  const trackLabel = tracks.find((t) => t.key === track)?.label ?? "Disattivati";

  return (
    <div
      className={`glass ${styles.menu}`}
      role="dialog"
      aria-label="Impostazioni del video"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {page === "main" && (
        <>
          <Row label="Velocità" value={speedLabel(speed)} onClick={() => setPage("speed")} />
          {audio.length > 1 && (
            <Row
              label="Audio"
              value={audio.find((a) => a.stream === audioStream)?.label ?? ""}
              onClick={() => setPage("audio")}
            />
          )}
          <Row
            label="Sottotitoli"
            value={tracks.length === 0 ? "Nessuno" : trackLabel}
            onClick={() => setPage("subtitles")}
          />
          <Row label="Stile dei sottotitoli" value="" onClick={() => setPage("style")} />
          <button
            type="button"
            role="switch"
            aria-checked={repeat}
            className={styles.menuRow}
            onClick={() => onRepeat(!repeat)}
          >
            <span>Ripeti</span>
            <span className={styles.switch} aria-hidden="true" />
          </button>
        </>
      )}

      {page === "speed" && (
        <Choices
          title="Velocità"
          onBack={() => setPage("main")}
          options={speeds.map((s) => ({
            key: String(s),
            label: speedLabel(s),
            chosen: s === speed,
          }))}
          onChoose={(key) => {
            onSpeed(Number(key));
            onClose();
          }}
        />
      )}

      {page === "audio" && (
        <Choices
          title="Audio"
          onBack={() => setPage("main")}
          options={audio.map((a) => ({
            key: String(a.stream),
            label: a.label,
            chosen: a.stream === audioStream,
          }))}
          onChoose={(key) => {
            onAudio(Number(key));
            onClose();
          }}
        />
      )}

      {page === "subtitles" && (
        <Choices
          title="Sottotitoli"
          onBack={() => setPage("main")}
          options={[
            { key: "", label: "Disattivati", chosen: track === null },
            ...tracks.map((t) => ({ key: t.key, label: t.label, chosen: t.key === track })),
          ]}
          onChoose={(key) => {
            onTrack(key || null);
            onClose();
          }}
          note={
            tracks.length === 0
              ? "Questo video non ha sottotitoli. Mettili accanto al video con lo stesso nome, per esempio «mare.it.srt»."
              : undefined
          }
        />
      )}

      {page === "style" && (
        <>
          <Back title="Stile dei sottotitoli" onBack={() => setPage("main")} />
          {styleKeys.map((key) => (
            <Row
              key={key}
              label={subtitleOptions[key].title}
              value={optionLabel(key, subtitleStyle[key])}
              onClick={() => setPage(key)}
            />
          ))}
          <div className={styles.preview} aria-hidden="true">
            <span style={subtitleCSS(subtitleStyle)} className={styles.previewText}>
              Così appariranno i sottotitoli
            </span>
          </div>
        </>
      )}

      {styleKeys.map(
        (key) =>
          page === key && (
            <Choices
              key={key}
              title={subtitleOptions[key].title}
              onBack={() => setPage("style")}
              options={subtitleOptions[key].options.map((o) => ({
                key: o.value,
                label: o.label,
                chosen: o.value === subtitleStyle[key],
              }))}
              onChoose={(value) => {
                onSubtitleStyle({ ...subtitleStyle, [key]: value });
                setPage("style");
              }}
            />
          ),
      )}
    </div>
  );
}

function Row({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.menuRow} onClick={onClick}>
      <span>{label}</span>
      <span className={styles.menuValue}>
        {value}
        <Icon name="chevronRight" size={16} />
      </span>
    </button>
  );
}

function Back({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <button type="button" className={styles.menuBack} onClick={onBack}>
      <Icon name="chevronLeft" size={16} />
      {title}
    </button>
  );
}

type ChoicesProps = {
  title: string;
  onBack: () => void;
  options: { key: string; label: string; chosen: boolean }[];
  onChoose: (key: string) => void;
  note?: ReactNode;
};

function Choices({ title, onBack, options, onChoose, note }: ChoicesProps) {
  return (
    <>
      <Back title={title} onBack={onBack} />
      <ul className={styles.menuList} aria-label={title}>
        {options.map((o) => (
          <li key={o.key}>
            <button
              type="button"
              aria-pressed={o.chosen}
              className={styles.menuRow}
              onClick={() => onChoose(o.key)}
            >
              <span className={styles.menuCheck}>
                {o.chosen && <Icon name="check" size={16} />}
              </span>
              <span className={styles.menuLabel}>{o.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {note && <p className={styles.menuNote}>{note}</p>}
    </>
  );
}
