import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { AudioTrack } from "../../api/audio";
import type { SubtitleTrack } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { skipChoices, speedLabel, speeds } from "./controls";
import styles from "./Player.module.css";
import {
  type SubtitleStyle,
  styleKeys,
  subtitleColors,
  subtitleOptions,
  subtitlePreviewCSS,
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
  skip: number; // seconds of a jump forward or back
  onSkip?: (seconds: number) => void; // none: the jump cannot be chosen here
  onClose: () => void;
  ref?: Ref<HTMLDivElement>; // the panel, for its closing move
  leaving?: boolean; // the panel is closing
};

type Page = "main" | "speed" | "skip" | "audio" | "subtitles" | "style";

// SettingsMenu is the panel opened by the gear button. Each setting has its
// own page, as on YouTube, so the panel stays small on phones. A deeper
// page slides in from the right, going back slides in from the left. The
// style of the subtitles is the exception: all its choices are on one page,
// each a click away, above a preview that follows them.
export function SettingsMenu(props: SettingsMenuProps) {
  const { speed, onSpeed, tracks, track, onTrack, audio, audioStream, onAudio } = props;
  const { subtitleStyle, onSubtitleStyle, repeat, onRepeat, skip, onSkip, onClose, ref, leaving } =
    props;
  const [page, setPageOnly] = useState<Page>("main");
  // How the page came in; none for the first one, which opens with the panel.
  const [direction, setDirection] = useState<"forward" | "back" | undefined>(undefined);
  const setPage = (next: Page) => {
    setDirection(next === "main" ? "back" : "forward");
    setPageOnly(next);
  };
  const trackLabel = tracks.find((t) => t.key === track)?.label ?? "Disattivati";
  const onStylePage = page === "style";

  // Back from the style page, the keyboard stays on the row that led there.
  const leftStyle = useRef(false);
  const styleRow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (page === "style") leftStyle.current = true;
    else if (leftStyle.current) {
      leftStyle.current = false;
      styleRow.current?.focus({ preventScroll: true });
    }
  }, [page]);

  return (
    <div
      ref={ref}
      className={`glass ${styles.menu}`}
      role="dialog"
      aria-label="Impostazioni del video"
      data-leaving={leaving || undefined}
      data-page={onStylePage ? "style" : undefined}
      // A click on the page's labels keeps the keyboard here, away from the player.
      tabIndex={onStylePage ? -1 : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        } else if (onStylePage) {
          // The player's keys sleep while the style is being chosen.
          event.stopPropagation();
        }
      }}
    >
      <div key={page} className={styles.menuPage} data-direction={direction}>
        {page === "main" && (
          <>
            <Row label="Velocità" value={speedLabel(speed)} onClick={() => setPage("speed")} />
            {onSkip && (
              <Row
                label="Salto avanti/indietro"
                value={`${skip} s`}
                onClick={() => setPage("skip")}
              />
            )}
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
            <Row
              ref={styleRow}
              label="Stile dei sottotitoli"
              value=""
              onClick={() => setPage("style")}
            />
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

        {page === "skip" && onSkip && (
          <Choices
            title="Salto avanti/indietro"
            onBack={() => setPage("main")}
            options={skipChoices.map((s) => ({
              key: String(s),
              label: `${s} secondi`,
              chosen: s === skip,
            }))}
            onChoose={(key) => {
              onSkip(Number(key));
              onClose();
            }}
            note="Vale per i tasti, le frecce della tastiera e il doppio tocco ai lati del video."
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

        {onStylePage && (
          <StylePage
            style={subtitleStyle}
            onChange={onSubtitleStyle}
            onBack={() => setPage("main")}
          />
        )}
      </div>
    </div>
  );
}

type RowProps = {
  label: string;
  value: string;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
};

function Row({ label, value, onClick, ref }: RowProps) {
  return (
    <button ref={ref} type="button" className={styles.menuRow} onClick={onClick}>
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

type StylePageProps = {
  style: SubtitleStyle;
  onChange: (style: SubtitleStyle) => void;
  onBack: () => void;
};

// StylePage shows every setting of the subtitles at once. The back button
// and the preview stay in place; on a small player the settings between
// them scroll.
function StylePage({ style, onChange, onBack }: StylePageProps) {
  const groups = useRef<HTMLDivElement>(null);
  // The keyboard starts on the first setting, as the row that led here is gone.
  useEffect(() => {
    groups.current
      ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      ?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <Back title="Stile dei sottotitoli" onBack={onBack} />
      <div ref={groups} className={styles.styleGroups}>
        {styleKeys.map((key) => (
          <StyleGroup
            key={key}
            setting={key}
            value={style[key]}
            onChoose={(value) => onChange({ ...style, [key]: value })}
          />
        ))}
      </div>
      <div className={styles.preview} data-position={style.position} aria-hidden="true">
        <span style={subtitlePreviewCSS(style)} className={styles.previewText}>
          Così appariranno i sottotitoli
        </span>
      </div>
    </>
  );
}

type StyleGroupProps = {
  setting: keyof SubtitleStyle;
  value: string;
  onChoose: (value: string) => void;
};

// StyleGroup is one setting: its name, and below it all the choices as
// radio buttons. The arrows move and choose, as in any group of radios.
function StyleGroup({ setting, value, onChoose }: StyleGroupProps) {
  const titleId = useId();
  const { title, options } = subtitleOptions[setting];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = options[(at + step + options.length) % options.length];
    if (!next) return;
    onChoose(next.value);
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div className={styles.styleGroup}>
      <div id={titleId} className={styles.styleTitle}>
        {title}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={titleId}
        className={styles.segments}
        onKeyDown={onKeyDown}
      >
        {options.map((o) => (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control, the look of a native radio would be in the way
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={o.value === value ? 0 : -1}
            data-value={o.value}
            className={styles.segment}
            onClick={(event) => {
              event.currentTarget.focus(); // Safari leaves a clicked button without it
              onChoose(o.value);
            }}
          >
            {setting === "color" && (
              <span
                className={styles.swatch}
                style={{ backgroundColor: subtitleColors[o.value as SubtitleStyle["color"]] }}
                aria-hidden="true"
              />
            )}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
